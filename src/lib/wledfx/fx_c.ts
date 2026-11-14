// WLED effects, ported from WLED v0.15.3 wled00/FX.cpp (EUPL-1.2, redistributed
// under GPLv3 per its Article 5). A line-for-line mirror of the firmware's
// FluidNC/src/WledFx/fx_c.cpp; tools/fx_parity.py (firmware repo) checks them.
//
// Batch c: Fire Flicker, Loading, Rolling Balls, Fairy, Two Dots, Fairytwinkle,
// Running Dual, Chase 3, Tri Wipe, Tri Fade, ICU, Stream 2, Oscillate.
import {
  BLACK, FRAMETIME, MAX, NUM_COLORS, PALETTE_SOLID_WRAP, RGBW32, SEGCOLOR, SEGLEN, SEGMENT, color_blend, div, f32, ftoi, gamma8,
  map, mode_static, random16, random16_get_seed, random16_set_seed, random8, roundf, scale8, sin8_t, strip, u16, u32, u8,
} from './shim'

// ---- Running Dual -------------------------------------------------------------
function sin_gap(inp: number): number {
  inp = u16(inp)
  if (inp & 0x100) return 0
  return sin8_t(u8(inp + 192)) // correct phase shift of sine so that it starts and stops at 0
}

function running_base(saw: boolean, dual = false): number {
  const x_scale = SEGMENT.intensity >> 2
  const counter = u32(strip.now * SEGMENT.speed) >>> 9

  for (let i = 0; i < SEGLEN(); i++) {
    let a = u32(i * x_scale - counter)
    if (saw) {
      a &= 0xff
      if (a < 16) a = 192 + a * 8
      else a = map(a, 16, 255, 64, 192)
      a = u32(255 - a)
    }
    const s = dual ? sin_gap(a) : sin8_t(a)
    let ca = color_blend(SEGCOLOR(1), SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 0), s)
    if (dual) {
      const b = u32((SEGLEN() - 1 - i) * x_scale - counter)
      const t = sin_gap(b)
      const cb = color_blend(SEGCOLOR(1), SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 2), t)
      ca = color_blend(ca, cb, 127)
    }
    SEGMENT.setPixelColor(i, ca)
  }

  return FRAMETIME
}

export function mode_running_dual(): number {
  return running_base(false, true)
}

// ---- Fire Flicker -------------------------------------------------------------
export function mode_fire_flicker(): number {
  const cycleTime = 40 + (255 - SEGMENT.speed)
  const it = Math.floor(strip.now / cycleTime)
  if (SEGMENT.step === it) return FRAMETIME

  const w = u8(SEGCOLOR(0) >>> 24)
  const r = u8(SEGCOLOR(0) >>> 16)
  const g = u8(SEGCOLOR(0) >>> 8)
  const b = u8(SEGCOLOR(0))
  let lum = SEGMENT.palette === 0 ? MAX(w, MAX(r, MAX(g, b))) : 255
  lum = u8(div(lum, div(256 - SEGMENT.intensity, 16) + 1))
  for (let i = 0; i < SEGLEN(); i++) {
    const flicker = random8(lum)
    if (SEGMENT.palette === 0) {
      SEGMENT.setPixelColor(i, MAX(r - flicker, 0), MAX(g - flicker, 0), MAX(b - flicker, 0), MAX(w - flicker, 0))
    } else {
      SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 0, 255 - flicker))
    }
  }

  SEGMENT.step = it
  return FRAMETIME
}

// ---- Loading ------------------------------------------------------------------
function gradient_base(loading: boolean): number {
  if (SEGLEN() === 1) return mode_static()
  const counter = u16(strip.now * ((SEGMENT.speed >> 2) + 1))
  let pp = u16((counter * SEGLEN()) >> 16)
  if (SEGMENT.call === 0) pp = 0
  let val: number // 0 = sec 1 = pri
  // WLED's precedence: (1 + loading) ? ... : ..., i.e. always intensity/2
  const brd = 1 + +loading ? SEGMENT.intensity >> 1 : SEGMENT.intensity >> 2
  const p1 = pp - SEGLEN()
  const p2 = pp + SEGLEN()

  for (let i = 0; i < SEGLEN(); i++) {
    if (loading) {
      val = Math.abs((i > pp ? p2 : pp) - i)
    } else {
      val = Math.min(Math.abs(pp - i), Math.min(Math.abs(p1 - i), Math.abs(p2 - i)))
    }
    val = brd > val ? div(val * 255, brd) : 255
    SEGMENT.setPixelColor(i, color_blend(SEGCOLOR(0), SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 1), val))
  }

  return FRAMETIME
}

export function mode_loading(): number {
  return gradient_base(true)
}

// ---- Two Dots -----------------------------------------------------------------
function police_base(color1: number, color2: number): number {
  if (SEGLEN() === 1) return mode_static()
  const delay = 1 + div(FRAMETIME << 3, SEGLEN()) // longer segments should change faster
  const it = u32(Math.floor(strip.now / map(SEGMENT.speed, 0, 255, delay << 4, delay)))
  const offset = it % SEGLEN()

  let width = (SEGLEN() * (SEGMENT.intensity + 1)) >> 9 // max width is half the strip
  if (!width) width = 1
  for (let i = 0; i < width; i++) {
    const indexR = (offset + i) % SEGLEN()
    const indexB = (offset + i + (SEGLEN() >> 1)) % SEGLEN()
    SEGMENT.setPixelColor(indexR, color1)
    SEGMENT.setPixelColor(indexB, color2)
  }
  return FRAMETIME
}

export function mode_two_dots(): number {
  if (!SEGMENT.check2) SEGMENT.fill(SEGCOLOR(2))
  const color2 = SEGCOLOR(1) === SEGCOLOR(2) ? SEGCOLOR(0) : SEGCOLOR(1)
  return police_base(SEGCOLOR(0), color2)
}

// ---- Fairy / Fairytwinkle -------------------------------------------------------
// struct Flasher { uint16_t stateStart; uint8_t stateDur; bool stateOn; } -- 4 bytes
const FL = 4, FL_START = 0, FL_DUR = 2, FL_ON = 3
const FLASHERS_PER_ZONE = 6
const MAX_SHIMMER = 92

export function mode_fairy(): number {
  // set every pixel to a 'random' color from palette (using seed so it doesn't change between frames)
  let PRNG16 = u16(5100 + strip.getCurrSegmentId())
  for (let i = 0; i < SEGLEN(); i++) {
    PRNG16 = u16(u16(PRNG16 * 2053) + 1384) // next 'random' number
    SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(PRNG16 >> 8, false, false, 0))
  }

  // amount of flasher pixels depending on intensity (0: none, 255: every LED)
  if (SEGMENT.intensity === 0) return FRAMETIME
  const flasherDistance = div(255 - SEGMENT.intensity, 28) + 1 // 1-10
  const numFlashers = div(SEGLEN(), flasherDistance) + 1

  const dataSize = FL * numFlashers
  if (!SEGMENT.allocateData(dataSize)) return FRAMETIME // allocation failed
  const dv = SEGMENT.dataView as DataView
  const fl = SEGMENT.data as Uint8Array
  const now16 = strip.now & 0xffff

  // Up to 11 flashers in one brightness zone, afterwards a new zone for every 6 flashers
  let zones = div(numFlashers, FLASHERS_PER_ZONE)
  if (!zones) zones = 1
  let flashersInZone = div(numFlashers, zones)
  const flasherBri = new Uint8Array(FLASHERS_PER_ZONE * 2 - 1)

  for (let z = 0; z < zones; z++) {
    let flasherBriSum = 0
    const firstFlasher = z * flashersInZone
    if (z === zones - 1) flashersInZone = numFlashers - flashersInZone * (zones - 1)

    for (let f = firstFlasher; f < firstFlasher + flashersInZone; f++) {
      const o = f * FL
      let stateTime = u16(now16 - dv.getUint16(o + FL_START, true))
      // random on/off time reached, switch state
      if (stateTime > fl[o + FL_DUR] * 10) {
        fl[o + FL_ON] = fl[o + FL_ON] ? 0 : 1
        if (fl[o + FL_ON]) {
          fl[o + FL_DUR] = u8(12 + random8(12 + ((255 - SEGMENT.speed) >> 2))) // *10, 250ms to 1250ms
        } else {
          fl[o + FL_DUR] = u8(20 + random8(6 + ((255 - SEGMENT.speed) >> 2))) // *10, 250ms to 1250ms
        }
        dv.setUint16(o + FL_START, now16, true)
        if (stateTime < 255) {
          dv.setUint16(o + FL_START, u16(dv.getUint16(o + FL_START, true) - (255 - stateTime)), true) // start early to get correct bri
          fl[o + FL_DUR] = u8(fl[o + FL_DUR] + 26 - div(stateTime, 10))
          stateTime = 255 - stateTime
        } else {
          stateTime = 0
        }
      }
      if (stateTime > 255) stateTime = 255 // for flasher brightness calculation, fades in first 255 ms of state
      flasherBri[f - firstFlasher] = fl[o + FL_ON] ? stateTime : 255 - (stateTime >> 0)
      flasherBriSum += flasherBri[f - firstFlasher]
    }
    // dim factor, to create "shimmer" as other pixels get less voltage if a lot of flashers are on
    const avgFlasherBri = div(flasherBriSum, flashersInZone)
    const globalPeakBri = 255 - ((avgFlasherBri * MAX_SHIMMER) >> 8) // 183-255, suitable for 1/5th of LEDs flashers

    for (let f = firstFlasher; f < firstFlasher + flashersInZone; f++) {
      const bri = div(flasherBri[f - firstFlasher] * globalPeakBri, 255)
      PRNG16 = u16(u16(PRNG16 * 2053) + 1384) // next 'random' number
      const flasherPos = f * flasherDistance
      SEGMENT.setPixelColor(flasherPos, color_blend(SEGCOLOR(1), SEGMENT.color_from_palette(PRNG16 >> 8, false, false, 0), bri))
      for (let i = flasherPos + 1; i < flasherPos + flasherDistance && i < SEGLEN(); i++) {
        PRNG16 = u16(u16(PRNG16 * 2053) + 1384) // next 'random' number
        SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(PRNG16 >> 8, false, false, 0, globalPeakBri))
      }
    }
  }
  return FRAMETIME
}

export function mode_fairytwinkle(): number {
  const dataSize = FL * SEGLEN()
  if (!SEGMENT.allocateData(dataSize)) return mode_static() // allocation failed
  const dv = SEGMENT.dataView as DataView
  const fl = SEGMENT.data as Uint8Array
  const now16 = strip.now & 0xffff
  let PRNG16 = u16(5100 + strip.getCurrSegmentId())

  const riseFallTime = 400 + (255 - SEGMENT.speed) * 3
  const maxDur = div(riseFallTime, 100) + ((255 - SEGMENT.intensity) >> 2) + 13 + ((255 - SEGMENT.intensity) >> 1)

  for (let f = 0; f < SEGLEN(); f++) {
    const o = f * FL
    let stateTime = u16(now16 - dv.getUint16(o + FL_START, true))
    // random on/off time reached, switch state
    if (stateTime > fl[o + FL_DUR] * 100) {
      fl[o + FL_ON] = fl[o + FL_ON] ? 0 : 1
      const init = !fl[o + FL_DUR]
      if (fl[o + FL_ON]) {
        fl[o + FL_DUR] = u8(div(riseFallTime, 100) + ((255 - SEGMENT.intensity) >> 2) + random8(12 + ((255 - SEGMENT.intensity) >> 1)) + 1)
      } else {
        fl[o + FL_DUR] = u8(div(riseFallTime, 100) + random8(3 + ((255 - SEGMENT.speed) >> 6)) + 1)
      }
      dv.setUint16(o + FL_START, now16, true)
      stateTime = 0
      if (init) {
        dv.setUint16(o + FL_START, u16(dv.getUint16(o + FL_START, true) - riseFallTime), true) // start lit
        fl[o + FL_DUR] = u8(div(riseFallTime, 100) + random8(12 + ((255 - SEGMENT.intensity) >> 1)) + 5) // fire up a little quicker
        stateTime = u16(riseFallTime)
      }
    }
    if (fl[o + FL_ON] && fl[o + FL_DUR] > maxDur) fl[o + FL_DUR] = u8(maxDur) // react more quickly on intensity change
    if (stateTime > riseFallTime) stateTime = riseFallTime // for flasher brightness calculation, fades in first 255 ms of state
    const fadeprog = 255 - div(stateTime * 255, riseFallTime)
    const flasherBri = fl[o + FL_ON] ? 255 - gamma8(fadeprog) : gamma8(fadeprog)
    const lastR = PRNG16
    let diff = 0
    while (diff < 0x4000) {
      // make sure colors of two adjacent LEDs differ enough
      PRNG16 = u16(u16(PRNG16 * 2053) + 1384) // next 'random' number
      diff = PRNG16 > lastR ? PRNG16 - lastR : lastR - PRNG16
    }
    SEGMENT.setPixelColor(f, color_blend(SEGCOLOR(1), SEGMENT.color_from_palette(PRNG16 >> 8, false, false, 0), flasherBri))
  }
  return FRAMETIME
}

// ---- Chase 3 ------------------------------------------------------------------
function tricolor_chase(color1: number, color2: number): number {
  const cycleTime = 50 + ((255 - SEGMENT.speed) << 1)
  const it = Math.floor(strip.now / cycleTime) // iterator
  const width = 1 + (SEGMENT.intensity >> 4) // value of 1-16 for each colour
  let index = it % (width * 3)

  for (let i = 0; i < SEGLEN(); i++, index++) {
    if (index > width * 3 - 1) index = 0

    let color = color1
    if (index > (width << 1) - 1) color = SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 1)
    else if (index > width - 1) color = color2

    SEGMENT.setPixelColor(SEGLEN() - i - 1, color)
  }
  return FRAMETIME
}

export function mode_tricolor_chase(): number {
  return tricolor_chase(SEGCOLOR(2), SEGCOLOR(0))
}

// ---- ICU ----------------------------------------------------------------------
export function mode_icu(): number {
  let dest = SEGMENT.step & 0xffff
  const space = (SEGMENT.intensity >> 3) + 2

  if (!SEGMENT.check2) SEGMENT.fill(SEGCOLOR(1))

  const pindex = u8(map(dest, 0, SEGLEN() - div(SEGLEN(), space), 0, 255))
  const col = SEGMENT.color_from_palette(pindex, false, false, 0)

  SEGMENT.setPixelColor(dest, col)
  SEGMENT.setPixelColor(dest + div(SEGLEN(), space), col)

  if (SEGMENT.aux0 === dest) {
    // pause between eye movements
    if (random8(6) === 0) {
      // blink once in a while
      SEGMENT.setPixelColor(dest, SEGCOLOR(1))
      SEGMENT.setPixelColor(dest + div(SEGLEN(), space), SEGCOLOR(1))
      return 200
    }
    SEGMENT.aux0 = random16(u16(SEGLEN() - div(SEGLEN(), space)))
    return 1000 + random16(2000)
  }

  if (SEGMENT.aux0 > SEGMENT.step) {
    SEGMENT.step = u32(SEGMENT.step + 1)
    dest++
  } else if (SEGMENT.aux0 < SEGMENT.step) {
    SEGMENT.step = u32(SEGMENT.step - 1)
    dest = u32(dest - 1)
  }

  SEGMENT.setPixelColor(dest, col)
  SEGMENT.setPixelColor(dest + div(SEGLEN(), space), col)

  return 5 + Math.floor((50 * (255 - SEGMENT.speed)) / SEGLEN()) // SPEED_FORMULA_L
}

// ---- Tri Wipe -----------------------------------------------------------------
export function mode_tricolor_wipe(): number {
  const cycleTime = 1000 + (255 - SEGMENT.speed) * 200
  const perc = strip.now % cycleTime
  const prog = Math.floor(u32(perc * 65535) / cycleTime)
  const ledIndex = u32(prog * SEGLEN() * 3) >>> 16
  let ledOffset = ledIndex

  for (let i = 0; i < SEGLEN(); i++) {
    SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 2))
  }

  if (ledIndex < SEGLEN()) {
    // wipe from 0 to 1
    for (let i = 0; i < SEGLEN(); i++) {
      SEGMENT.setPixelColor(i, i > ledOffset ? SEGCOLOR(0) : SEGCOLOR(1))
    }
  } else if (ledIndex < SEGLEN() * 2) {
    // wipe from 1 to 2
    ledOffset = ledIndex - SEGLEN()
    for (let i = ledOffset + 1; i < SEGLEN(); i++) {
      SEGMENT.setPixelColor(i, SEGCOLOR(1))
    }
  } else {
    // wipe from 2 to 0
    ledOffset = ledIndex - SEGLEN() * 2
    for (let i = 0; i <= ledOffset; i++) {
      SEGMENT.setPixelColor(i, SEGCOLOR(0))
    }
  }

  return FRAMETIME
}

// ---- Tri Fade -----------------------------------------------------------------
export function mode_tricolor_fade(): number {
  const counter = u16(strip.now * ((SEGMENT.speed >> 3) + 1))
  const prog = (counter * 768) >> 16

  let color1 = 0, color2 = 0
  let stage = 0

  if (prog < 256) {
    color1 = SEGCOLOR(0)
    color2 = SEGCOLOR(1)
    stage = 0
  } else if (prog < 512) {
    color1 = SEGCOLOR(1)
    color2 = SEGCOLOR(2)
    stage = 1
  } else {
    color1 = SEGCOLOR(2)
    color2 = SEGCOLOR(0)
    stage = 2
  }

  const stp = u8(prog) // % 256
  for (let i = 0; i < SEGLEN(); i++) {
    let color: number
    if (stage === 2) {
      color = color_blend(SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 2), color2, stp)
    } else if (stage === 1) {
      color = color_blend(color1, SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 2), stp)
    } else {
      color = color_blend(color1, color2, stp)
    }
    SEGMENT.setPixelColor(i, color)
  }

  return FRAMETIME
}

// ---- Stream 2 -----------------------------------------------------------------
export function mode_random_chase(): number {
  if (SEGMENT.call === 0) {
    const r0 = random8() // sequenced, as the C++ (RGBW32's argument order is open there)
    const g0 = random8()
    const b0 = random8()
    SEGMENT.step = RGBW32(r0, g0, b0, 0)
    SEGMENT.aux0 = random16()
  }
  const prevSeed = random16_get_seed() // save seed so we can restore it at the end of the function
  const cycleTime = 25 + 3 * (255 - SEGMENT.speed)
  const it = Math.floor(strip.now / cycleTime)
  let color = SEGMENT.step
  random16_set_seed(SEGMENT.aux0)

  for (let i = SEGLEN() - 1; i >= 0; i--) {
    const r = random8(6) !== 0 ? (color >>> 16) & 0xff : random8()
    const g = random8(6) !== 0 ? (color >>> 8) & 0xff : random8()
    const b = random8(6) !== 0 ? color & 0xff : random8()
    color = RGBW32(r, g, b, 0)
    SEGMENT.setPixelColor(i, color)
    if (i === SEGLEN() - 1 && SEGMENT.aux1 !== (it & 0xffff)) {
      // new first color in next frame
      SEGMENT.step = color
      SEGMENT.aux0 = random16_get_seed()
    }
  }

  SEGMENT.aux1 = it & 0xffff

  random16_set_seed(prevSeed) // restore original seed so other effects can use "random" PRNG
  return FRAMETIME
}

// ---- Oscillate ----------------------------------------------------------------
// struct Oscillator { uint16_t pos; uint8_t size; int8_t dir; uint8_t speed; } -- 6 bytes (1 padding)
const OS = 6, OS_POS = 0, OS_SIZE = 2, OS_DIR = 3, OS_SPEED = 4

export function mode_oscillate(): number {
  const numOscillators = 3
  const dataSize = OS * numOscillators

  if (!SEGMENT.allocateData(dataSize)) return mode_static() // allocation failed

  const dv = SEGMENT.dataView as DataView
  const init = (k: number, pos: number, size: number, dir: number, speed: number): void => {
    dv.setUint16(k * OS + OS_POS, u16(pos), true)
    dv.setUint8(k * OS + OS_SIZE, u8(size))
    dv.setInt8(k * OS + OS_DIR, dir)
    dv.setUint8(k * OS + OS_SPEED, u8(speed))
  }

  if (SEGMENT.call === 0) {
    init(0, div(SEGLEN(), 4), div(SEGLEN(), 8), 1, 1)
    init(1, div(SEGLEN(), 4) * 3, div(SEGLEN(), 8), 1, 2)
    init(2, div(SEGLEN(), 4) * 2, div(SEGLEN(), 8), -1, 1)
  }

  const cycleTime = 20 + 2 * (255 - SEGMENT.speed)
  const it = Math.floor(strip.now / cycleTime)

  for (let i = 0; i < numOscillators; i++) {
    const o = i * OS
    // if the counter has increased, move the oscillator by the random step
    if (it !== SEGMENT.step) dv.setUint16(o + OS_POS, u16(dv.getUint16(o + OS_POS, true) + dv.getInt8(o + OS_DIR) * dv.getUint8(o + OS_SPEED)), true)
    dv.setUint8(o + OS_SIZE, u8(div(SEGLEN(), 3 + (SEGMENT.intensity >> 3))))
    if (dv.getInt8(o + OS_DIR) === -1 && dv.getUint16(o + OS_POS, true) > SEGLEN() << 1) {
      // use integer overflow
      dv.setUint16(o + OS_POS, 0, true)
      dv.setInt8(o + OS_DIR, 1)
      // make bigger steps for faster speeds
      dv.setUint8(o + OS_SPEED, SEGMENT.speed > 100 ? random8(2, 4) : random8(1, 3))
    }
    if (dv.getInt8(o + OS_DIR) === 1 && dv.getUint16(o + OS_POS, true) >= SEGLEN() - 1) {
      dv.setUint16(o + OS_POS, u16(SEGLEN() - 1), true)
      dv.setInt8(o + OS_DIR, -1)
      dv.setUint8(o + OS_SPEED, SEGMENT.speed > 100 ? random8(2, 4) : random8(1, 3))
    }
  }

  for (let i = 0; i < SEGLEN(); i++) {
    let color = BLACK
    for (let j = 0; j < numOscillators; j++) {
      const pos = dv.getUint16(j * OS + OS_POS, true)
      const size = dv.getUint8(j * OS + OS_SIZE)
      if (i >= pos - size && i <= pos + size) {
        color = color === BLACK ? SEGCOLOR(j) : color_blend(color, SEGCOLOR(j), 128)
      }
    }
    SEGMENT.setPixelColor(i, color)
  }

  SEGMENT.step = it
  return FRAMETIME
}

// ---- Rolling Balls ------------------------------------------------------------
// struct RollingBall { uint32_t lastBounceUpdate; float mass; float velocity; float height; } -- 16 bytes
const RB = 16, RB_LAST = 0, RB_MASS = 4, RB_VEL = 8, RB_HEIGHT = 12

export function rolling_balls(): number {
  // allocate segment data
  const maxNumBalls = 16 // 255/16 + 1
  const dataSize = RB * maxNumBalls
  if (!SEGMENT.allocateData(dataSize)) return mode_static() // allocation failed

  const dv = SEGMENT.dataView as DataView
  const getL = (k: number): number => dv.getUint32(k * RB + RB_LAST, true)
  const setL = (k: number, v: number): void => dv.setUint32(k * RB + RB_LAST, u32(v), true)
  const getM = (k: number): number => dv.getFloat32(k * RB + RB_MASS, true)
  const setM = (k: number, v: number): void => dv.setFloat32(k * RB + RB_MASS, v, true)
  const getV = (k: number): number => dv.getFloat32(k * RB + RB_VEL, true)
  const setV = (k: number, v: number): void => dv.setFloat32(k * RB + RB_VEL, v, true)
  const getH = (k: number): number => dv.getFloat32(k * RB + RB_HEIGHT, true)
  const setH = (k: number, v: number): void => dv.setFloat32(k * RB + RB_HEIGHT, v, true)

  // number of balls based on intensity setting to max of 16 (cycles colors)
  // non-chosen color is a random color
  const numBalls = (SEGMENT.intensity >> 4) + 1
  const hasCol2 = SEGCOLOR(2) !== 0

  if (SEGMENT.call === 0) {
    SEGMENT.fill(hasCol2 ? BLACK : SEGCOLOR(1)) // start clean
    for (let i = 0; i < maxNumBalls; i++) {
      setL(i, strip.now)
      setV(i, f32(f32(20 * f32(random16(1000, 10000))) / 10000)) // number from 1 to 10
      if (random8() < 128) setV(i, -getV(i)) // 50% chance of reverse direction
      setH(i, f32(f32(random16(0, 10000)) / 10000)) // from 0. to 1.
      setM(i, f32(f32(random16(1000, 10000)) / 10000)) // from .1 to 1.
    }
  }

  const cfac = f32(f32(scale8(8, 255 - SEGMENT.speed) + 1) * 20000) // this uses the Aircoookie conversion factor for scaling time using speed slider

  if (SEGMENT.check3) SEGMENT.fade_out(250) // 2-8 pixel trails (optional)
  else {
    if (!SEGMENT.check2) SEGMENT.fill(hasCol2 ? BLACK : SEGCOLOR(1)) // don't fill with background color if user wants to see trails
  }

  for (let i = 0; i < numBalls; i++) {
    const timeSinceLastUpdate = f32(f32(u32(strip.now - getL(i))) / cfac)
    const travel = f32(getV(i) * timeSinceLastUpdate)
    let thisHeight = f32(getH(i) + travel) // this method keeps higher resolution
    // test if intensity level was increased and some balls are way off the track then put them back
    if (thisHeight < -0.5 || thisHeight > 1.5) {
      thisHeight = f32(f32(random16(0, 10000)) / 10000) // from 0. to 1.
      setH(i, thisHeight)
      setL(i, strip.now)
    }
    // check if reached ends of the strip
    if ((thisHeight <= 0 && getV(i) < 0) || (thisHeight >= 1 && getV(i) > 0)) {
      setV(i, -getV(i)) // reverse velocity
      setL(i, strip.now)
      setH(i, thisHeight)
    }
    // check for collisions
    if (SEGMENT.check1) {
      for (let j = i + 1; j < numBalls; j++) {
        if (getV(j) !== getV(i)) {
          //  tcollided + balls[j].lastBounceUpdate is acutal time of collision (this keeps precision with long to float conversions)
          const tc1 = f32(cfac * f32(getH(i) - getH(j)))
          const tc2 = f32(getV(i) * f32(u32(getL(j) - getL(i))))
          const tcollided = f32(f32(tc1 + tc2) / f32(getV(j) - getV(i)))

          if (tcollided > 2 && tcollided < f32(u32(strip.now - getL(j)))) {
            // 2ms minimum to avoid duplicate bounces
            setH(i, f32(getH(i) + f32(f32(getV(i) * f32(tcollided + f32(u32(getL(j) - getL(i))))) / cfac)))
            setH(j, getH(i))
            setL(i, ftoi(f32(tcollided + 0.5)) + getL(j))
            setL(j, getL(i))
            const vtmp = getV(i)
            const vi1 = f32(f32(getM(i) - getM(j)) * vtmp)
            const vi2 = f32(f32(2 * getM(j)) * getV(j))
            setV(i, f32(f32(vi1 + vi2) / f32(getM(i) + getM(j))))
            const vj1 = f32(f32(getM(j) - getM(i)) * getV(j))
            const vj2 = f32(f32(2 * getM(i)) * vtmp)
            setV(j, f32(f32(vj1 + vj2) / f32(getM(i) + getM(j))))
            thisHeight = f32(getH(i) + f32(f32(getV(i) * f32(u32(strip.now - getL(i)))) / cfac))
          }
        }
      }
    }

    let color = SEGCOLOR(0)
    if (SEGMENT.palette) {
      color = SEGMENT.color_from_palette(div(i * 255, numBalls), false, PALETTE_SOLID_WRAP(), 0)
    } else if (hasCol2) {
      color = SEGCOLOR(i % NUM_COLORS)
    }

    if (thisHeight < 0) thisHeight = 0
    if (thisHeight > 1) thisHeight = 1
    const pos = u32(roundf(f32(thisHeight * (SEGLEN() - 1))))
    SEGMENT.setPixelColor(pos, color)
    setL(i, strip.now)
    setH(i, thisHeight)
  }

  return FRAMETIME
}
