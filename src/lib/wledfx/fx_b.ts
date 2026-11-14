// WLED effects, ported from WLED v0.15.3 wled00/FX.cpp (EUPL-1.2, redistributed
// under GPLv3 per its Article 5). A line-for-line mirror of the firmware's
// FluidNC/src/WledFx/fx_b.cpp; tools/fx_parity.py (firmware repo) checks them.
//
// Batch b: the chases, Colorful, Traffic Light, Chase 2, Stream, the
// scanners, Lighthouse, Rain and Tetrix.
import {
  FRAMETIME, PALETTE_SOLID_WRAP, SEGCOLOR, SEGLEN, SEGMENT, div, f32, ftoi, get_random_wheel_index, i16, indexToVStrip, map,
  mode_static, random16, random8, strip, u16, u32, u8,
} from './shim'

/*
 * color chase function.
 * color1 = background color
 * color2 and color3 = colors of two adjacent leds
 */
// DW: WLED tests `SEGMENT.mode == FX_MODE_CHASE_RANDOM`; there is no mode id here, so the caller says so.
function chase(color1: number, color2: number, color3: number, do_palette: boolean, chase_random = false): number {
  const counter = u16(Math.imul(strip.now, (SEGMENT.speed >> 2) + 1))
  const a = u16((counter * SEGLEN()) >> 16)

  if (chase_random) {
    if (a < SEGMENT.step) { // we hit the start again, choose new color for Chase random
      SEGMENT.aux1 = SEGMENT.aux0 // store previous random color
      SEGMENT.aux0 = get_random_wheel_index(SEGMENT.aux0)
    }
    color1 = SEGMENT.color_wheel(SEGMENT.aux0)
  }
  SEGMENT.step = a

  // Use intensity setting to vary chase up to 1/2 string length
  const size = 1 + ((SEGMENT.intensity * SEGLEN()) >> 10)

  let b = u16(a + size) // "trail" of chase, filled with color1
  if (b > SEGLEN()) b = u16(b - SEGLEN())
  let c = u16(b + size)
  if (c > SEGLEN()) c = u16(c - SEGLEN())

  // background
  if (do_palette) {
    for (let i = 0; i < SEGLEN(); i++) SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 1))
  } else SEGMENT.fill(color1)

  // if random, fill old background between a and end
  if (chase_random) {
    color1 = SEGMENT.color_wheel(SEGMENT.aux1)
    for (let i = a; i < SEGLEN(); i++) SEGMENT.setPixelColor(i, color1)
  }

  // fill between points a and b with color2
  if (a < b) {
    for (let i = a; i < b; i++) SEGMENT.setPixelColor(i, color2)
  } else {
    for (let i = a; i < SEGLEN(); i++) SEGMENT.setPixelColor(i, color2) // fill until end
    for (let i = 0; i < b; i++) SEGMENT.setPixelColor(i, color2) // fill from start until b
  }

  // fill between points b and c with color2
  if (b < c) {
    for (let i = b; i < c; i++) SEGMENT.setPixelColor(i, color3)
  } else {
    for (let i = b; i < SEGLEN(); i++) SEGMENT.setPixelColor(i, color3) // fill until end
    for (let i = 0; i < c; i++) SEGMENT.setPixelColor(i, color3) // fill from start until c
  }

  return FRAMETIME
}

/*
 * Primary running followed by random color.
 */
export function mode_chase_random(): number {
  return chase(SEGCOLOR(1), SEGCOLOR(2) ? SEGCOLOR(2) : SEGCOLOR(0), SEGCOLOR(0), false, true)
}

/*
 * Primary, secondary running on rainbow.
 */
export function mode_chase_rainbow(): number {
  let color_sep = Math.floor(256 / SEGLEN())
  if (color_sep === 0) color_sep = 1 // correction for segments longer than 256 LEDs
  const color_index = SEGMENT.call & 0xff
  const color = SEGMENT.color_wheel((Math.imul(SEGMENT.step, color_sep) + color_index) & 0xff)

  return chase(color, SEGCOLOR(0), SEGCOLOR(1), false)
}

/*
 * Primary running on rainbow.
 */
export function mode_chase_rainbow_white(): number {
  const n = u16(SEGMENT.step)
  const m = u16(u32(SEGMENT.step + 1) % SEGLEN())
  const color2 = SEGMENT.color_wheel((div(n * 256, SEGLEN()) + (SEGMENT.call & 0xff)) & 0xff)
  const color3 = SEGMENT.color_wheel((div(m * 256, SEGLEN()) + (SEGMENT.call & 0xff)) & 0xff)

  return chase(SEGCOLOR(0), color2, color3, false)
}

/*
 * Red - Amber - Green - Blue lights running
 */
export function mode_colorful(): number {
  let numColors = 4 // 3, 4, or 5
  const cols = [0x00ff0000, 0x00eebb00, 0x0000ee00, 0x000077cc, 0, 0, 0, 0, 0]
  if (SEGMENT.intensity > 160 || SEGMENT.palette) { // palette or color
    if (!SEGMENT.palette) {
      numColors = 3
      for (let i = 0; i < 3; i++) cols[i] = SEGCOLOR(i)
    } else {
      let fac = 80
      if (SEGMENT.palette === 52) { numColors = 5; fac = 61 } // C9 2 has 5 colors
      for (let i = 0; i < numColors; i++) cols[i] = SEGMENT.color_from_palette(i * fac, false, true, 255)
    }
  } else if (SEGMENT.intensity < 80) { // pastel (easter) colors
    cols[0] = 0x00ff8040
    cols[1] = 0x00e5d241
    cols[2] = 0x0077ff77
    cols[3] = 0x0077f0f0
  }
  for (let i = numColors; i < numColors * 2 - 1; i++) cols[i] = cols[i - numColors]

  const cycleTime = 50 + 8 * (255 - SEGMENT.speed)
  const it = Math.floor(strip.now / cycleTime)
  if (it !== SEGMENT.step) {
    if (SEGMENT.speed > 0) SEGMENT.aux0 = u16(SEGMENT.aux0 + 1)
    if (SEGMENT.aux0 >= numColors) SEGMENT.aux0 = 0
    SEGMENT.step = it
  }

  for (let i = 0; i < SEGLEN(); i += numColors) {
    for (let j = 0; j < numColors; j++) SEGMENT.setPixelColor(i + j, cols[SEGMENT.aux0 + j])
  }

  return FRAMETIME
}

/*
 * Emulates a traffic light.
 */
export function mode_traffic_light(): number {
  if (SEGLEN() === 1) return mode_static()
  for (let i = 0; i < SEGLEN(); i++) SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 1))
  let mdelay = 500
  for (let i = 0; i < SEGLEN() - 2; i += 3) {
    switch (SEGMENT.aux0) {
      case 0: SEGMENT.setPixelColor(i, 0x00ff0000); mdelay = 150 + 100 * (255 - SEGMENT.speed); break
      case 1: SEGMENT.setPixelColor(i, 0x00ff0000); mdelay = 150 + 20 * (255 - SEGMENT.speed); SEGMENT.setPixelColor(i + 1, 0x00eecc00); break
      case 2: SEGMENT.setPixelColor(i + 2, 0x0000ff00); mdelay = 150 + 100 * (255 - SEGMENT.speed); break
      case 3: SEGMENT.setPixelColor(i + 1, 0x00eecc00); mdelay = 150 + 20 * (255 - SEGMENT.speed); break
    }
  }

  if (u32(strip.now - SEGMENT.step) > mdelay) {
    SEGMENT.aux0 = u16(SEGMENT.aux0 + 1)
    if (SEGMENT.aux0 === 1 && SEGMENT.intensity > 140) SEGMENT.aux0 = 2 // skip Red + Amber, to get US-style sequence
    if (SEGMENT.aux0 > 3) SEGMENT.aux0 = 0
    SEGMENT.step = strip.now
  }

  return FRAMETIME
}

/*
 * Sec flashes running on prim.
 */
const FLASH_COUNT = 4
export function mode_chase_flash(): number {
  if (SEGLEN() === 1) return mode_static()
  const flash_step = u32(SEGMENT.call) % (FLASH_COUNT * 2 + 1)

  for (let i = 0; i < SEGLEN(); i++) SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 0))

  let delay = 10 + div(30 * u16(255 - SEGMENT.speed), SEGLEN())
  if (flash_step < FLASH_COUNT * 2) {
    if (flash_step % 2 === 0) {
      const n = SEGMENT.step
      const m = u32(SEGMENT.step + 1) % SEGLEN()
      SEGMENT.setPixelColor(n, SEGCOLOR(1))
      SEGMENT.setPixelColor(m, SEGCOLOR(1))
      delay = 20
    } else {
      delay = 30
    }
  } else {
    SEGMENT.step = u32(SEGMENT.step + 1) % SEGLEN()
  }
  return delay
}

/*
 * Prim flashes running, followed by random color.
 */
export function mode_chase_flash_random(): number {
  if (SEGLEN() === 1) return mode_static()
  const flash_step = u32(SEGMENT.call) % (FLASH_COUNT * 2 + 1)

  for (let i = 0; i < SEGMENT.aux1; i++) SEGMENT.setPixelColor(i, SEGMENT.color_wheel(SEGMENT.aux0))

  let delay = 1 + div(10 * u16(255 - SEGMENT.speed), SEGLEN())
  if (flash_step < FLASH_COUNT * 2) {
    const n = SEGMENT.aux1
    const m = (SEGMENT.aux1 + 1) % SEGLEN()
    if (flash_step % 2 === 0) {
      SEGMENT.setPixelColor(n, SEGCOLOR(0))
      SEGMENT.setPixelColor(m, SEGCOLOR(0))
      delay = 20
    } else {
      SEGMENT.setPixelColor(n, SEGMENT.color_wheel(SEGMENT.aux0))
      SEGMENT.setPixelColor(m, SEGCOLOR(1))
      delay = 30
    }
  } else {
    SEGMENT.aux1 = u16((SEGMENT.aux1 + 1) % SEGLEN())

    if (SEGMENT.aux1 === 0) SEGMENT.aux0 = get_random_wheel_index(SEGMENT.aux0)
  }
  return delay
}

/*
 * Alternating pixels running function.
 */
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

/*
 * Alternating color/sec pixels running.
 */
export function mode_running_color(): number {
  return running(SEGCOLOR(0), SEGCOLOR(1))
}

/*
 * Random colored pixels running. ("Stream")
 */
export function mode_running_random(): number {
  const cycleTime = 25 + 3 * (255 - SEGMENT.speed)
  const it = Math.floor(strip.now / cycleTime)
  if (SEGMENT.call === 0) SEGMENT.aux0 = random16() // random seed for PRNG on start

  const zoneSize = ((255 - SEGMENT.intensity) >> 4) + 1
  let PRNG16 = SEGMENT.aux0

  let z = it % zoneSize
  let nzone = !z && it !== SEGMENT.aux1
  for (let i = SEGLEN() - 1; i >= 0; i--) {
    if (nzone || z >= zoneSize) {
      const lastrand = PRNG16 >> 8
      let diff = 0
      while (Math.abs(diff) < 42) { // make sure the difference between adjacent colors is big enough
        PRNG16 = u16(u16(PRNG16 * 2053) + 13849) // next zone, next 'random' number
        diff = i16((PRNG16 >> 8) - lastrand)
      }
      if (nzone) {
        SEGMENT.aux0 = PRNG16 // save next starting seed
        nzone = false
      }
      z = 0
    }
    SEGMENT.setPixelColor(i, SEGMENT.color_wheel(PRNG16 >> 8))
    z++
  }

  SEGMENT.aux1 = u16(it)
  return FRAMETIME
}

/*
 * K.I.T.T.
 */
export function mode_larson_scanner(): number {
  if (SEGLEN() === 1) return mode_static()

  const speed = u32(FRAMETIME * map(SEGMENT.speed, 0, 255, 96, 2)) // map into useful range
  const pixels = Math.floor(SEGLEN() / speed) // how many pixels to advance per frame

  SEGMENT.fade_out(255 - SEGMENT.intensity)

  if (SEGMENT.step > strip.now) return FRAMETIME // we have a pause

  let index = SEGMENT.aux1 + pixels
  // are we slow enough to use frames per pixel?
  if (pixels === 0) {
    const frames = Math.floor(speed / SEGLEN()) // how many frames per 1 pixel
    const s = SEGMENT.step
    SEGMENT.step = u32(s + 1)
    if (s < frames) return FRAMETIME
    SEGMENT.step = 0
    index++
  }

  if (index > SEGLEN()) {
    SEGMENT.aux0 = SEGMENT.aux0 ? 0 : 1 // change direction
    SEGMENT.aux1 = 0 // reset position
    // set delay
    if (SEGMENT.aux0 || SEGMENT.check2) SEGMENT.step = u32(strip.now + SEGMENT.custom1 * 25) // multiply by 25ms
    else SEGMENT.step = 0
  } else {
    // paint as many pixels as needed
    for (let i = SEGMENT.aux1; i < index; i++) {
      const j = SEGMENT.aux0 ? i : SEGLEN() - 1 - i
      const c = SEGMENT.color_from_palette(j, true, PALETTE_SOLID_WRAP(), 0)
      SEGMENT.setPixelColor(j, c)
      if (SEGMENT.check1) SEGMENT.setPixelColor(SEGLEN() - 1 - j, SEGCOLOR(2) ? SEGCOLOR(2) : c)
    }
    SEGMENT.aux1 = u16(index)
  }
  return FRAMETIME
}

/*
 * Creates two Larson scanners moving in opposite directions
 * Custom mode by Keith Lord: https://github.com/kitesurfer1404/WS2812FX/blob/master/src/custom/DualLarson.h
 */
export function mode_dual_larson_scanner(): number {
  SEGMENT.check1 = true
  return mode_larson_scanner()
}

/*
 * Firing comets from one end. "Lighthouse"
 */
export function mode_comet(): number {
  if (SEGLEN() === 1) return mode_static()
  const counter = Math.imul(strip.now, (SEGMENT.speed >> 2) + 1) & 0xffff
  let index = (counter * SEGLEN()) >>> 16
  if (SEGMENT.call === 0) SEGMENT.aux0 = u16(index)

  SEGMENT.fade_out(SEGMENT.intensity)

  SEGMENT.setPixelColor(index, SEGMENT.color_from_palette(index, true, PALETTE_SOLID_WRAP(), 0))
  if (index > SEGMENT.aux0) {
    for (let i = SEGMENT.aux0; i < index; i++) SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 0))
  } else if (index < SEGMENT.aux0 && index < 10) {
    for (let i = 0; i < index; i++) SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 0))
  }
  SEGMENT.aux0 = u16(index++)

  return FRAMETIME
}

/*
 * Fireworks function.
 */
// DW: WLED's mode_fireworks(), the base of mode_rain(); a local copy (another batch registers Fireworks).
function fireworks(): number {
  if (SEGLEN() === 1) return mode_static()
  const width = u16(SEGMENT.is2D() ? SEGMENT.virtualWidth() : SEGMENT.virtualLength())
  const height = u16(SEGMENT.virtualHeight())

  if (SEGMENT.call === 0) {
    SEGMENT.aux0 = 0xffff
    SEGMENT.aux1 = 0xffff
  }
  SEGMENT.fade_out(128)

  let x = u8(SEGMENT.aux0 % width), y = u8(Math.floor(SEGMENT.aux0 / width)) // 2D coordinates stored in upper and lower byte
  if (!SEGMENT.step) {
    // fireworks mode (blur flares)
    const valid1 = SEGMENT.aux0 < width * height
    const valid2 = SEGMENT.aux1 < width * height
    let sv1 = 0, sv2 = 0
    if (valid1) sv1 = SEGMENT.is2D() ? SEGMENT.getPixelColorXY(x, y) : SEGMENT.getPixelColor(SEGMENT.aux0) // get spark color
    if (valid2) sv2 = SEGMENT.is2D() ? SEGMENT.getPixelColorXY(x, y) : SEGMENT.getPixelColor(SEGMENT.aux1)
    SEGMENT.blur(16) // used in mode_rain()
    if (valid1) { if (SEGMENT.is2D()) SEGMENT.setPixelColorXY(x, y, sv1); else SEGMENT.setPixelColor(SEGMENT.aux0, sv1) } // restore spark color after blur
    if (valid2) { if (SEGMENT.is2D()) SEGMENT.setPixelColorXY(x, y, sv2); else SEGMENT.setPixelColor(SEGMENT.aux1, sv2) } // restore old spark color after blur
  }

  for (let i = 0; i < Math.max(1, div(width, 20)); i++) {
    if (random8(129 - (SEGMENT.intensity >> 1)) === 0) {
      const index = random16(width * height)
      x = u8(index % width)
      y = u8(Math.floor(index / width))
      const col = SEGMENT.color_from_palette(random8(), false, false, 0)
      if (SEGMENT.is2D()) SEGMENT.setPixelColorXY(x, y, col)
      else SEGMENT.setPixelColor(index, col)
      SEGMENT.aux1 = SEGMENT.aux0 // old spark
      SEGMENT.aux0 = index // remember where spark occurred
    }
  }
  return FRAMETIME
}

// Twinkling LEDs running. Inspired by https://github.com/kitesurfer1404/WS2812FX/blob/master/src/custom/Rain.h
export function mode_rain(): number {
  if (SEGLEN() === 1) return mode_static()
  const width = SEGMENT.virtualWidth()
  const height = SEGMENT.virtualHeight()
  SEGMENT.step = u32(SEGMENT.step + FRAMETIME)
  if (SEGMENT.call && SEGMENT.step > 5 + Math.floor((50 * (255 - SEGMENT.speed)) / SEGLEN())) { // SPEED_FORMULA_L
    SEGMENT.step = 1
    if (SEGMENT.is2D()) {
      SEGMENT.move(6, 1, true) // move all pixels down
      SEGMENT.aux0 = u16((SEGMENT.aux0 % width) + (Math.floor(SEGMENT.aux0 / width) + 1) * width)
      SEGMENT.aux1 = u16((SEGMENT.aux1 % width) + (Math.floor(SEGMENT.aux1 / width) + 1) * width)
    } else {
      // shift all leds left
      const ctemp = SEGMENT.getPixelColor(0)
      for (let i = 0; i < SEGLEN() - 1; i++) SEGMENT.setPixelColor(i, SEGMENT.getPixelColor(i + 1))
      SEGMENT.setPixelColor(SEGLEN() - 1, ctemp) // wrap around
      SEGMENT.aux0 = u16(SEGMENT.aux0 + 1) // increase spark index
      SEGMENT.aux1 = u16(SEGMENT.aux1 + 1)
    }
    if (SEGMENT.aux0 === 0) SEGMENT.aux0 = 0xffff // reset previous spark position
    if (SEGMENT.aux1 === 0) SEGMENT.aux0 = 0xffff // reset previous spark position
    if (SEGMENT.aux0 >= width * height) SEGMENT.aux0 = 0 // ignore
    if (SEGMENT.aux1 >= width * height) SEGMENT.aux1 = 0
  }
  return fireworks()
}

/*
 * Tetris or Stacking (falling bricks) Effect
 * by Blaz Kristan (AKA blazoncek) (https://github.com/blazoncek, https://blaz.at/home)
 */
// struct Tetris (20 bytes): float pos @0, float speed @4, uint8 col @8, uint16 brick @10, uint16 stack @12, uint32 step @16
const SIZEOF_TETRIS = 20
class Tetris {
  constructor(private v: DataView, private o: number) {}
  get pos(): number { return this.v.getFloat32(this.o, true) } set pos(x: number) { this.v.setFloat32(this.o, x, true) }
  get speed(): number { return this.v.getFloat32(this.o + 4, true) } set speed(x: number) { this.v.setFloat32(this.o + 4, x, true) }
  get col(): number { return this.v.getUint8(this.o + 8) } set col(x: number) { this.v.setUint8(this.o + 8, x) }
  get brick(): number { return this.v.getUint16(this.o + 10, true) } set brick(x: number) { this.v.setUint16(this.o + 10, x, true) }
  get stack(): number { return this.v.getUint16(this.o + 12, true) } set stack(x: number) { this.v.setUint16(this.o + 12, x, true) }
  get step(): number { return this.v.getUint32(this.o + 16, true) } set step(x: number) { this.v.setUint32(this.o + 16, x, true) }
}

// virtualStrip idea by @ewowi (Ewoud Wijma)
function runStrip(stripNr: number, drop: Tetris): void {
  // initialize dropping on first call or segment full
  if (SEGMENT.call === 0) {
    drop.stack = 0 // reset brick stack size
    drop.step = strip.now + 2000 // start by fading out strip
    if (SEGMENT.check1) drop.col = 0 // use only one color from palette
  }

  if (drop.step === 0) { // init brick
    let speed = SEGMENT.speed ? SEGMENT.speed : random8(1, 255)
    speed = map(speed, 1, 255, 5000, 250) // time taken for full (SEGLEN) drop
    drop.speed = f32(f32(SEGLEN() * FRAMETIME) / f32(speed)) // set speed
    drop.pos = SEGLEN() // start at end of segment (no need to subtract 1)
    if (!SEGMENT.check1) drop.col = random8(0, 15) << 4 // limit color choices so there is enough HUE gap
    drop.step = 1 // drop state (0 init, 1 forming, 2 falling)
    drop.brick = (SEGMENT.intensity ? (SEGMENT.intensity >> 5) + 1 : random8(1, 5)) * (1 + (SEGLEN() >> 6)) // size of brick
  }

  if (drop.step === 1) { // forming
    if (random8() >> 6) drop.step = 2 // random drop -> fall
  }

  if (drop.step === 2) { // falling
    if (drop.pos > drop.stack) { // fall until top of stack
      drop.pos = f32(drop.pos - drop.speed) // may add gravity as: speed += gravity
      if (ftoi(drop.pos) < drop.stack) drop.pos = drop.stack
      for (let i = ftoi(drop.pos); i < SEGLEN(); i++) {
        const col = i < ftoi(drop.pos) + drop.brick ? SEGMENT.color_from_palette(drop.col, false, false, 0) : SEGCOLOR(1)
        SEGMENT.setPixelColor(indexToVStrip(i, stripNr), col)
      }
    } else { // we hit bottom
      drop.step = 0 // proceed with next brick, go back to init
      drop.stack = drop.stack + drop.brick // increase the stack size
      if (drop.stack >= SEGLEN()) drop.step = strip.now + 2000 // fade out stack
    }
  }

  if (drop.step > 2) { // fade strip
    drop.brick = 0 // reset brick size (no more growing)
    if (drop.step > strip.now) {
      // allow fading of virtual strip
      for (let i = 0; i < SEGLEN(); i++) SEGMENT.blendPixelColor(indexToVStrip(i, stripNr), SEGCOLOR(1), 25) // 10% blend
    } else {
      drop.stack = 0 // reset brick stack size
      drop.step = 0 // proceed with next brick
      if (SEGMENT.check1) drop.col = drop.col + 8 // gradually increase palette index
    }
  }
}

export function mode_tetrix(): number {
  if (SEGLEN() === 1) return mode_static()
  const strips = SEGMENT.nrOfVStrips() // allow running on virtual strips (columns in 2D segment)
  const dataSize = SIZEOF_TETRIS
  if (!SEGMENT.allocateData(dataSize * strips)) return mode_static() // allocation failed
  const dv = SEGMENT.dataView as DataView

  for (let stripNr = 0; stripNr < strips; stripNr++) runStrip(stripNr, new Tetris(dv, stripNr * dataSize))

  return FRAMETIME
}
