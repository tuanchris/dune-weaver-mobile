// WLED effects, ported from WLED v0.15.3 wled00/FX.cpp (EUPL-1.2, redistributed
// under GPLv3 per its Article 5). A line-for-line mirror of the firmware's
// FluidNC/src/WledFx/fx_a.cpp; tools/fx_parity.py (firmware repo) checks them.
//
// Batch a: wipes/sweeps, random colors, dynamic, fade, theater rainbow, saw,
// dissolve, sparkles, strobes, blink rainbow, android.
import {
  FRAMETIME, PALETTE_SOLID_WRAP, SEGCOLOR, SEGLEN, SEGMENT, color_blend, get_random_wheel_index, map, mode_static, random16,
  random8, sin8_t, strip, triwave16, u16, u32,
} from './shim'

// ---- Blink / strobe helper ----------------------------------------------------
function blink(color1: number, color2: number, strobe: boolean, do_palette: boolean): number {
  let cycleTime = u32((255 - SEGMENT.speed) * 20)
  let onTime = FRAMETIME
  if (!strobe) onTime += (cycleTime * SEGMENT.intensity) >>> 8
  cycleTime += FRAMETIME * 2
  const it = Math.floor(strip.now / cycleTime)
  const rem = strip.now % cycleTime

  let on = false
  if (it !== SEGMENT.step || rem <= onTime) on = true
  SEGMENT.step = it

  const color = on ? color1 : color2
  if (color === color1 && do_palette) {
    for (let i = 0; i < SEGLEN(); i++) SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 0))
  } else SEGMENT.fill(color)

  return FRAMETIME
}

export function mode_blink_rainbow(): number {
  return blink(SEGMENT.color_wheel(SEGMENT.call & 0xff), SEGCOLOR(1), false, false)
}

export function mode_strobe_rainbow(): number {
  return blink(SEGMENT.color_wheel(SEGMENT.call & 0xff), SEGCOLOR(1), true, false)
}

// ---- Color wipe helper ----------------------------------------------------------
function color_wipe(rev: boolean, useRandomColors: boolean): number {
  if (SEGLEN() === 1) return mode_static()
  const cycleTime = u32(750 + (255 - SEGMENT.speed) * 150)
  const perc = strip.now % cycleTime
  let prog = Math.floor((perc * 65535) / cycleTime)
  const back = prog > 32767
  if (back) {
    prog -= 32767
    if (SEGMENT.step === 0) SEGMENT.step = 1
  } else {
    if (SEGMENT.step === 2) SEGMENT.step = 3 // trigger color change
  }

  if (useRandomColors) {
    if (SEGMENT.call === 0) {
      SEGMENT.aux0 = random8()
      SEGMENT.step = 3
    }
    if (SEGMENT.step === 1) { // if flag set, change to new random color
      SEGMENT.aux1 = get_random_wheel_index(SEGMENT.aux0)
      SEGMENT.step = 2
    }
    if (SEGMENT.step === 3) {
      SEGMENT.aux0 = get_random_wheel_index(SEGMENT.aux1)
      SEGMENT.step = 0
    }
  }

  const ledIndex = Math.floor((prog * SEGLEN()) / 32768)
  let rem = u16(prog * SEGLEN() * 2) // mod 0xFFFF by truncating
  rem = Math.floor(rem / (SEGMENT.intensity + 1))
  if (rem > 255) rem = 255

  const col1 = useRandomColors ? SEGMENT.color_wheel(SEGMENT.aux1) : SEGCOLOR(1)
  for (let i = 0; i < SEGLEN(); i++) {
    const index = rev && back ? SEGLEN() - 1 - i : i
    const col0 = useRandomColors ? SEGMENT.color_wheel(SEGMENT.aux0) : SEGMENT.color_from_palette(index, true, PALETTE_SOLID_WRAP(), 0)

    if (i < ledIndex) {
      SEGMENT.setPixelColor(index, back ? col1 : col0)
    } else {
      SEGMENT.setPixelColor(index, back ? col0 : col1)
      if (i === ledIndex) SEGMENT.setPixelColor(index, color_blend(back ? col0 : col1, back ? col1 : col0, rem))
    }
  }
  return FRAMETIME
}

export function mode_color_sweep(): number {
  return color_wipe(true, false)
}

export function mode_color_wipe_random(): number {
  return color_wipe(false, true)
}

export function mode_color_sweep_random(): number {
  return color_wipe(true, true)
}

// ---- Random Colors ---------------------------------------------------------------
export function mode_random_color(): number {
  const cycleTime = u32(200 + (255 - SEGMENT.speed) * 50)
  const it = Math.floor(strip.now / cycleTime)
  const rem = strip.now % cycleTime
  const fadedur = (cycleTime * SEGMENT.intensity) >>> 8

  let fade = 255
  if (fadedur) {
    fade = Math.floor((rem * 255) / fadedur)
    if (fade > 255) fade = 255
  }

  if (SEGMENT.call === 0) {
    SEGMENT.aux0 = random8()
    SEGMENT.step = 2
  }
  if (it !== SEGMENT.step) { // new color
    SEGMENT.aux1 = SEGMENT.aux0
    SEGMENT.aux0 = get_random_wheel_index(SEGMENT.aux0) // aux0 will store our random color wheel index
    SEGMENT.step = it
  }

  SEGMENT.fill(color_blend(SEGMENT.color_wheel(SEGMENT.aux1), SEGMENT.color_wheel(SEGMENT.aux0), fade))
  return FRAMETIME
}

// ---- Dynamic ---------------------------------------------------------------------
export function mode_dynamic(): number {
  if (!SEGMENT.allocateData(SEGLEN())) return mode_static() // allocation failed
  const data = SEGMENT.data as Uint8Array

  if (SEGMENT.call === 0) {
    for (let i = 0; i < SEGLEN(); i++) data[i] = random8()
  }

  const cycleTime = u32(50 + (255 - SEGMENT.speed) * 15)
  const it = Math.floor(strip.now / cycleTime)
  if (it !== SEGMENT.step && SEGMENT.speed !== 0) { // new color
    for (let i = 0; i < SEGLEN(); i++) {
      if (random8() <= SEGMENT.intensity) data[i] = random8() // random color index
    }
    SEGMENT.step = it
  }

  if (SEGMENT.check1) {
    for (let i = 0; i < SEGLEN(); i++) SEGMENT.blendPixelColor(i, SEGMENT.color_wheel(data[i]), 16)
  } else {
    for (let i = 0; i < SEGLEN(); i++) SEGMENT.setPixelColor(i, SEGMENT.color_wheel(data[i]))
  }
  return FRAMETIME
}

export function mode_dynamic_smooth(): number {
  const old = SEGMENT.check1
  SEGMENT.check1 = true
  mode_dynamic()
  SEGMENT.check1 = old
  return FRAMETIME
}

// ---- Fade ------------------------------------------------------------------------
export function mode_fade(): number {
  const counter = u32(strip.now * ((SEGMENT.speed >> 3) + 10))
  const lum = triwave16(counter) >> 8

  for (let i = 0; i < SEGLEN(); i++) {
    SEGMENT.setPixelColor(i, color_blend(SEGCOLOR(1), SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 0), lum))
  }

  return FRAMETIME
}

// ---- Running / theater helper ------------------------------------------------------
function running(color1: number, color2: number, theatre = false): number {
  const width = (theatre ? 3 : 1) + (SEGMENT.intensity >> 4) // window
  const cycleTime = 50 + (255 - SEGMENT.speed)
  const it = Math.floor(strip.now / cycleTime)
  const usePalette = color1 === SEGCOLOR(0)

  for (let i = 0; i < SEGLEN(); i++) {
    let col = color2
    if (usePalette) color1 = SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 0)
    if (theatre) {
      if (i % width === SEGMENT.aux0) col = color1
    } else {
      const pos = i % (width << 1)
      if (pos < SEGMENT.aux0 - width || (pos >= SEGMENT.aux0 && pos < SEGMENT.aux0 + width)) col = color1
    }
    SEGMENT.setPixelColor(i, col)
  }

  if (it !== SEGMENT.step) {
    SEGMENT.aux0 = u16((SEGMENT.aux0 + 1) % (theatre ? width : width << 1))
    SEGMENT.step = it
  }
  return FRAMETIME
}

export function mode_theater_chase_rainbow(): number {
  return running(SEGMENT.color_wheel(SEGMENT.step), SEGCOLOR(1), true)
}

// ---- Running lights helper (saw only: the dual / sin_gap path is not in this batch)
function running_base(saw: boolean): number {
  const x_scale = SEGMENT.intensity >> 2
  const counter = u32(strip.now * SEGMENT.speed) >>> 9

  for (let i = 0; i < SEGLEN(); i++) {
    let a = u32(i * x_scale - counter)
    if (saw) {
      a &= 0xff
      if (a < 16) {
        a = 192 + a * 8
      } else {
        a = map(a, 16, 255, 64, 192)
      }
      a = u32(255 - a)
    }
    const s = sin8_t(a)
    const ca = color_blend(SEGCOLOR(1), SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 0), s)
    SEGMENT.setPixelColor(i, ca)
  }

  return FRAMETIME
}

export function mode_saw(): number {
  return running_base(true)
}

// ---- Dissolve helper -------------------------------------------------------------
function dissolve(color: number): number {
  const dataSize = 4 * SEGLEN() // sizeof(uint32_t) * SEGLEN
  if (!SEGMENT.allocateData(dataSize)) return mode_static() // allocation failed
  const pixels = SEGMENT.dataView as DataView // uint32_t pixels[SEGLEN]

  if (SEGMENT.call === 0) {
    for (let i = 0; i < SEGLEN(); i++) pixels.setUint32(i * 4, SEGCOLOR(1), true)
    SEGMENT.aux0 = 1
  }

  for (let j = 0; j <= Math.floor(SEGLEN() / 15); j++) {
    if (random8() <= SEGMENT.intensity) {
      for (let times = 0; times < 10; times++) { // attempt to spawn a new pixel 10 times
        const i = random16(SEGLEN())
        if (SEGMENT.aux0) { // dissolve to primary/palette
          if (pixels.getUint32(i * 4, true) === SEGCOLOR(1)) {
            pixels.setUint32(i * 4, color === SEGCOLOR(0) ? SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 0) : color, true)
            break // only spawn 1 new pixel per frame per 50 LEDs
          }
        } else { // dissolve to secondary
          if (pixels.getUint32(i * 4, true) !== SEGCOLOR(1)) {
            pixels.setUint32(i * 4, SEGCOLOR(1), true)
            break
          }
        }
      }
    }
  }
  // fix for #4401
  for (let i = 0; i < SEGLEN(); i++) SEGMENT.setPixelColor(i, pixels.getUint32(i * 4, true))

  if (SEGMENT.step > 255 - SEGMENT.speed + 15) {
    SEGMENT.aux0 = SEGMENT.aux0 ? 0 : 1
    SEGMENT.step = 0
  } else {
    SEGMENT.step = u32(SEGMENT.step + 1)
  }

  return FRAMETIME
}

export function mode_dissolve_random(): number {
  return dissolve(SEGMENT.color_wheel(random8()))
}

// ---- Sparkle Dark / Sparkle+ ------------------------------------------------------
export function mode_flash_sparkle(): number {
  if (!SEGMENT.check2) {
    for (let i = 0; i < SEGLEN(); i++) SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 0))
  }

  if (u32(strip.now - SEGMENT.aux0) > SEGMENT.step) {
    if (random8((255 - SEGMENT.intensity) >> 4) === 0) {
      SEGMENT.setPixelColor(random16(SEGLEN()), SEGCOLOR(1)) // flash
    }
    SEGMENT.step = strip.now
    SEGMENT.aux0 = 255 - SEGMENT.speed
  }
  return FRAMETIME
}

export function mode_hyper_sparkle(): number {
  if (!SEGMENT.check2) {
    for (let i = 0; i < SEGLEN(); i++) SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 0))
  }

  if (u32(strip.now - SEGMENT.aux0) > SEGMENT.step) {
    if (random8((255 - SEGMENT.intensity) >> 4) === 0) {
      for (let i = 0; i < Math.max(1, Math.floor(SEGLEN() / 3)); i++) {
        SEGMENT.setPixelColor(random16(SEGLEN()), SEGCOLOR(1))
      }
    }
    SEGMENT.step = strip.now
    SEGMENT.aux0 = 255 - SEGMENT.speed
  }
  return FRAMETIME
}

// ---- Strobe Mega -----------------------------------------------------------------
export function mode_multi_strobe(): number {
  for (let i = 0; i < SEGLEN(); i++) SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 1))

  SEGMENT.aux0 = u16(50 + 20 * u16(255 - SEGMENT.speed))
  const count = 2 * (Math.floor(SEGMENT.intensity / 10) + 1)
  if (SEGMENT.aux1 < count) {
    if ((SEGMENT.aux1 & 1) === 0) {
      SEGMENT.fill(SEGCOLOR(0))
      SEGMENT.aux0 = 15
    } else {
      SEGMENT.aux0 = 50
    }
  }

  if (u32(strip.now - SEGMENT.aux0) > SEGMENT.step) {
    SEGMENT.aux1 = u16(SEGMENT.aux1 + 1)
    if (SEGMENT.aux1 > count) SEGMENT.aux1 = 0
    SEGMENT.step = strip.now
  }

  return FRAMETIME
}

// ---- Android loading circle --------------------------------------------------------
export function mode_android(): number {
  for (let i = 0; i < SEGLEN(); i++) SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 1))

  if (SEGMENT.aux1 > Math.floor((SEGMENT.intensity * SEGLEN()) / 255)) {
    SEGMENT.aux0 = 1
  } else {
    if (SEGMENT.aux1 < 2) SEGMENT.aux0 = 0
  }

  let a = SEGMENT.step & 0xffff

  if (SEGMENT.aux0 === 0) {
    if (SEGMENT.call % 3 === 1) a++
    else SEGMENT.aux1 = u16(SEGMENT.aux1 + 1)
  } else {
    a++
    if (SEGMENT.call % 3 !== 1) SEGMENT.aux1 = u16(SEGMENT.aux1 - 1)
  }

  if (a >= SEGLEN()) a = 0

  if (a + SEGMENT.aux1 < SEGLEN()) {
    for (let i = a; i < a + SEGMENT.aux1; i++) SEGMENT.setPixelColor(i, SEGCOLOR(0))
  } else {
    for (let i = a; i < SEGLEN(); i++) SEGMENT.setPixelColor(i, SEGCOLOR(0))
    for (let i = 0; i < u32(SEGMENT.aux1 - (SEGLEN() - a)); i++) SEGMENT.setPixelColor(i, SEGCOLOR(0))
  }
  SEGMENT.step = a

  return u16(3 + Math.floor((8 * (255 - SEGMENT.speed)) / SEGLEN()))
}
