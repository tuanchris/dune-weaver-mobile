// WLED effects, ported from WLED v0.15.3 wled00/FX.cpp (EUPL-1.2, redistributed
// under GPLv3 per its Article 5). A line-for-line mirror of the firmware's
// FluidNC/src/WledFx/fx_d.cpp; tools/fx_parity.py (firmware repo) checks them.
//
// Batch d: Palette, Fill Noise, Noise 2-4, Colortwinkles, Lake, Meteor Smooth,
// Twinklefox, Twinklecat, Solid Pattern (+ Tri), Spots, Spots Fade.
import {
  CRGB, ColorFromPalette, FRAMETIME, NOBLEND, PALETTE_SOLID_WRAP, RGBW32, SEGCOLOR, SEGLEN, SEGMENT, SEGPALETTE, beatsin8_t, color_blend,
  constrain, cos8_t, cos_t, cubicwave8, div, f32, fabsf, ftoi, inoise16, inoise8, map, mode_static, qsub8, random16, random8, sin8_t, sin_t,
  strip, triwave16, u16, u32, u8,
} from './shim'

// WLED's fixed frame time (FX.h: 1000/WLED_FPS); here the layer's frame time,
// (WLED's 42 fps; the layer's 33 ms FRAMETIME would make the runner skip every other frame)
const FRAMETIME_FIXED = Math.trunc(1000 / 42)

// ---- Palette ------------------------------------------------------------------
// C++ float constants (double expressions narrowed to float)
const sInt16Scale = f32(1)
const maxAngle = f32(Math.PI / 256.0)
const staticRotationScale = f32(1)
const animatedRotationScale = f32((Math.PI * 2.0) / 0xffff)

export function mode_palette(): number {
  const isMatrix = strip.isMatrix
  const cols = SEGMENT.virtualWidth()
  const rows = isMatrix ? SEGMENT.virtualHeight() : strip.getActiveSegmentsNum()

  const inputShift = SEGMENT.speed
  const inputSize = SEGMENT.intensity
  const inputRotation = SEGMENT.custom1
  const inputAnimateShift = SEGMENT.check1
  const inputAnimateRotation = SEGMENT.check2
  const inputAssumeSquare = SEGMENT.check3

  const theta = !inputAnimateRotation
    ? f32(f32((inputRotation + 128) * maxAngle) / staticRotationScale)
    : f32((Math.imul(strip.now, (inputRotation >> 4) + 1) & 0xffff) * animatedRotationScale)
  const sinTheta = sin_t(theta)
  const cosTheta = cos_t(theta)

  const maxX = f32(Math.max(1, cols - 1))
  const maxY = f32(Math.max(1, rows - 1))
  const maxXIn = inputAssumeSquare ? maxX : f32(1)
  const maxYIn = inputAssumeSquare ? maxY : f32(1)
  const maxXOut = !inputAssumeSquare ? maxX : f32(1)
  const maxYOut = !inputAssumeSquare ? maxY : f32(1)
  const centerX = f32(f32(sInt16Scale * maxXOut) / 2)
  const centerY = f32(f32(sInt16Scale * maxYOut) / 2)
  const scale = f32(fabsf(sinTheta) + f32(f32(fabsf(cosTheta) * maxYOut) / maxXOut))
  const yFrom = isMatrix ? 0 : strip.getCurrSegmentId()
  const yTo = isMatrix ? ftoi(maxY) : yFrom
  for (let y = yFrom; y <= yTo; ++y) {
    const ytCosTheta = f32(f32(cosTheta * f32(f32(y * sInt16Scale) - f32(centerY * maxYIn))) / f32(maxYIn * scale))
    for (let x = 0; x < cols; ++x) {
      const xtSinTheta = f32(f32(sinTheta * f32(f32(x * sInt16Scale) - f32(centerX * maxXIn))) / f32(maxXIn * scale))
      const sourceX = f32(f32(xtSinTheta + ytCosTheta) + centerX)
      // std::min(std::max(sourceX, 0), hi): (a < b) ? b : a, then (b < a) ? b : a
      const lo = sourceX < 0 ? f32(0) : sourceX
      const hi = f32(maxXOut * sInt16Scale)
      let colorIndex = ftoi(f32(f32((hi < lo ? hi : lo) * 255) / f32(sInt16Scale * maxXOut)))
      if (inputSize <= 128) {
        colorIndex = div(colorIndex * inputSize, 128)
      } else {
        // Linear function that maps colorIndex 128=>1, 256=>9.
        colorIndex = div((inputSize - 112) * colorIndex, 16)
      }
      // Finally, shift the palette a bit.
      const paletteOffset = !inputAnimateShift ? inputShift : (Math.imul(strip.now, (inputShift >> 3) + 1) & 0xffff) >> 8
      colorIndex -= paletteOffset
      const color = SEGMENT.color_wheel(u8(colorIndex))
      if (isMatrix) {
        SEGMENT.setPixelColorXY(x, y, color)
      } else {
        SEGMENT.setPixelColor(x, color)
      }
    }
  }
  return FRAMETIME
}

// ---- Fill Noise -------------------------------------------------------------------
export function mode_fillnoise8(): number {
  if (SEGMENT.call === 0) SEGMENT.step = random16(12345)
  for (let i = 0; i < SEGLEN(); i++) {
    const index = inoise8(i * SEGLEN(), SEGMENT.step + i * SEGLEN())
    SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(index, false, PALETTE_SOLID_WRAP(), 0))
  }
  SEGMENT.step = u32(SEGMENT.step + beatsin8_t(SEGMENT.speed, 1, 6))

  return FRAMETIME
}

// ---- Noise 2 ----------------------------------------------------------------------
export function mode_noise16_2(): number {
  const scale = 1000
  SEGMENT.step = u32(SEGMENT.step + (1 + (SEGMENT.speed >> 1)))

  for (let i = 0; i < SEGLEN(); i++) {
    const shift_x = SEGMENT.step >>> 6
    const real_x = u32((i + shift_x) * scale)
    const noise = inoise16(real_x, 0, 4223) >> 8
    const index = sin8_t(noise * 3)

    SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(index, false, PALETTE_SOLID_WRAP(), 0, noise))
  }

  return FRAMETIME
}

// ---- Noise 3 ----------------------------------------------------------------------
export function mode_noise16_3(): number {
  const scale = 800
  SEGMENT.step = u32(SEGMENT.step + (1 + SEGMENT.speed))

  for (let i = 0; i < SEGLEN(); i++) {
    const shift_x = 4223
    const shift_y = 1234
    const real_x = u32((i + shift_x) * scale)
    const real_y = u32((i + shift_y) * scale)
    const real_z = u32(SEGMENT.step * 8)
    const noise = inoise16(real_x, real_y, real_z) >> 8
    const index = sin8_t(noise * 3)

    SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(index, false, PALETTE_SOLID_WRAP(), 0, noise))
  }

  return FRAMETIME
}

// ---- Noise 4 ----------------------------------------------------------------------
export function mode_noise16_4(): number {
  const stp = u32(Math.imul(strip.now, SEGMENT.speed)) >>> 7
  for (let i = 0; i < SEGLEN(); i++) {
    const index = inoise16(u32(i << 12), stp)
    SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(index, false, PALETTE_SOLID_WRAP(), 0))
  }
  return FRAMETIME
}

// ---- Colortwinkles ----------------------------------------------------------------
export function mode_colortwinkle(): number {
  const dataSize = (SEGLEN() + 7) >> 3 // 1 bit per LED
  if (!SEGMENT.allocateData(dataSize)) return mode_static()
  const data = SEGMENT.data as Uint8Array

  let fastled_col = new CRGB()
  const prev = new CRGB()
  const fadeUpAmount = u8(strip.getBrightness() > 28 ? 8 + (SEGMENT.speed >> 2) : 68 - strip.getBrightness())
  const fadeDownAmount = u8(strip.getBrightness() > 28 ? 8 + (SEGMENT.speed >> 3) : 68 - strip.getBrightness())
  for (let i = 0; i < SEGLEN(); i++) {
    fastled_col.set(SEGMENT.getPixelColor(i))
    prev.set(fastled_col)
    const index = i >> 3
    const bitNum = i & 0x07
    const fadeUp = (data[index] >> bitNum) & 0x01

    if (fadeUp) {
      const incrementalColor = fastled_col.clone()
      incrementalColor.nscale8_video(fadeUpAmount)
      fastled_col.add(incrementalColor)

      if (fastled_col.red === 255 || fastled_col.green === 255 || fastled_col.blue === 255) {
        data[index] &= ~(1 << bitNum)
      }
      SEGMENT.setPixelColor(i, fastled_col.red, fastled_col.green, fastled_col.blue)

      if (SEGMENT.getPixelColor(i) === RGBW32(prev.r, prev.g, prev.b, 0)) { // fix "stuck" pixels
        fastled_col.add(fastled_col)
        SEGMENT.setPixelColor(i, fastled_col)
      }
    } else {
      fastled_col.nscale8(255 - fadeDownAmount)
      SEGMENT.setPixelColor(i, fastled_col)
    }
  }

  for (let j = 0; j <= div(SEGLEN(), 50); j++) {
    if (random8() <= SEGMENT.intensity) {
      for (let times = 0; times < 5; times++) { // attempt to spawn a new pixel 5 times
        const i = random16(SEGLEN())
        if (SEGMENT.getPixelColor(i) === 0) {
          fastled_col = ColorFromPalette(SEGPALETTE(), random8(), 64, NOBLEND)
          const index = i >> 3
          const bitNum = i & 0x07
          data[index] |= 1 << bitNum
          SEGMENT.setPixelColor(i, fastled_col)
          break // only spawn 1 new pixel per frame per 50 LEDs
        }
      }
    }
  }
  return FRAMETIME_FIXED
}

// ---- Lake ---------------------------------------------------------------------------
export function mode_lake(): number {
  const sp = div(SEGMENT.speed, 10)
  // beatsin8_t's uint8_t lowest: -64 wraps to 192, exactly as the C++ call converts it
  const wave1 = beatsin8_t(sp + 2, -64, 64)
  const wave2 = beatsin8_t(sp + 1, -64, 64)
  const wave3 = beatsin8_t(sp + 2, 0, 80)

  for (let i = 0; i < SEGLEN(); i++) {
    const index = div(cos8_t(i * 15 + wave1), 2) + div(cubicwave8(i * 23 + wave2), 2)
    const lum = u8(index > wave3 ? index - wave3 : 0)
    SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(index, false, false, 0, lum))
  }

  return FRAMETIME
}

// ---- Meteor Smooth ------------------------------------------------------------------
export function mode_meteor_smooth(): number {
  if (SEGLEN() === 1) return mode_static()
  if (!SEGMENT.allocateData(SEGLEN())) return mode_static()

  const trail = SEGMENT.data as Uint8Array

  const meteorSize = 1 + div(SEGLEN(), 20) // 5%
  const inn = u16(map((SEGMENT.step >>> 6) & 0xff, 0, 255, 0, SEGLEN() - 1))

  const max = SEGMENT.palette === 5 || !SEGMENT.check1 ? 240 : 255
  // fade all leds to colors[1] in LEDs one step
  for (let i = 0; i < SEGLEN(); i++) {
    if (random8() <= 255 - SEGMENT.intensity) {
      const change = trail[i] + 4 - random8(24) // change each time between -20 and +4
      trail[i] = constrain(change, 0, max)
      const col = SEGMENT.check1 ? SEGMENT.color_from_palette(i, true, false, 0, trail[i]) : SEGMENT.color_from_palette(trail[i], false, true, 255)
      SEGMENT.setPixelColor(i, col)
    }
  }

  // draw meteor
  for (let j = 0; j < meteorSize; j++) {
    let index = inn + j
    if (index >= SEGLEN()) {
      index -= SEGLEN()
    }
    trail[index] = max
    const col = SEGMENT.check1 ? SEGMENT.color_from_palette(index, true, false, 0, trail[index]) : SEGMENT.color_from_palette(trail[index], false, true, 255)
    SEGMENT.setPixelColor(index, col)
  }

  SEGMENT.step = u32(SEGMENT.step + SEGMENT.speed + 1)
  return FRAMETIME
}

// ---- Twinklefox / Twinklecat ------------------------------------------------------
function twinklefox_one_twinkle(ms: number, salt: number, cat: boolean): CRGB {
  ms = u32(ms)
  salt = u8(salt)
  // Overall twinkle speed (changed)
  const ticks = Math.floor(ms / SEGMENT.aux0)
  const fastcycle8 = u8(ticks)
  let slowcycle16 = u16((ticks >>> 8) + salt)
  slowcycle16 = u16(slowcycle16 + sin8_t(slowcycle16))
  slowcycle16 = u16(slowcycle16 * 2053 + 1384)
  const slowcycle8 = u8((slowcycle16 & 0xff) + (slowcycle16 >> 8))

  // Overall twinkle density: 0 (NONE lit) to 8 (ALL lit at once).
  const twinkleDensity = (SEGMENT.intensity >> 5) + 1

  let bright = 0
  if ((slowcycle8 & 0x0e) >> 1 < twinkleDensity) {
    let ph = fastcycle8
    if (cat) { // twinklecat, variant where the leds instantly turn on
      bright = 255 - ph
    } else { // vanilla twinklefox
      if (ph < 86) {
        bright = ph * 3
      } else {
        ph -= 86
        bright = 255 - (ph + (ph >> 1))
      }
    }
  }

  const hue = u32(slowcycle8 - salt)
  let c: CRGB
  if (bright > 0) {
    c = ColorFromPalette(SEGPALETTE(), hue, bright, NOBLEND)
    if (!SEGMENT.check1) {
      // A pixel in the 'fading down' part of the cycle fades toward 'red', like an incandescent bulb.
      if (fastcycle8 >= 128) {
        const cooling = (fastcycle8 - 128) >> 4
        c.g = qsub8(c.g, cooling)
        c.b = qsub8(c.b, cooling * 2)
      }
    }
  } else {
    c = new CRGB(CRGB.Black)
  }
  return c
}

function twinklefox_base(cat: boolean): number {
  // "PRNG16" MUST be reset to the same starting value each time, so that its sequence is stable.
  let PRNG16 = 11337

  // Calculate speed
  if (SEGMENT.speed > 100) SEGMENT.aux0 = u16(3 + ((255 - SEGMENT.speed) >> 3))
  else SEGMENT.aux0 = u16(22 + ((100 - SEGMENT.speed) >> 1))

  // Set up the background color, "bg".
  const bg = new CRGB(SEGCOLOR(1))
  const bglight = bg.getAverageLight()
  if (bglight > 64) {
    bg.nscale8_video(16) // very bright, so scale to 1/16th
  } else if (bglight > 16) {
    bg.nscale8_video(64) // not that bright, so scale to 1/4th
  } else {
    bg.nscale8_video(86) // dim, scale to 1/3rd.
  }

  const backgroundBrightness = bg.getAverageLight()

  for (let i = 0; i < SEGLEN(); i++) {
    PRNG16 = u16(u16(PRNG16 * 2053) + 1384) // next 'random' number
    const myclockoffset16 = PRNG16 // use that number as clock offset
    PRNG16 = u16(u16(PRNG16 * 2053) + 1384) // next 'random' number
    // use that number as clock speed adjustment factor (in 8ths, from 8/8ths to 23/8ths)
    const myspeedmultiplierQ5_3 = ((((PRNG16 & 0xff) >> 4) + (PRNG16 & 0x0f)) & 0x0f) + 0x08
    const myclock30 = u32((u32(Math.imul(strip.now, myspeedmultiplierQ5_3)) >>> 3) + myclockoffset16)
    const myunique8 = PRNG16 >> 8 // get 'salt' value for this pixel

    const c = twinklefox_one_twinkle(myclock30, myunique8, cat)

    const cbright = c.getAverageLight()
    const deltabright = cbright - backgroundBrightness
    if (deltabright >= 32 || !bg.any()) {
      // significantly brighter than the background color: use the new color.
      SEGMENT.setPixelColor(i, c.red, c.green, c.blue)
    } else if (deltabright > 0) {
      // just slightly brighter than the background color: mix the new color and the background color
      SEGMENT.setPixelColor(i, color_blend(RGBW32(bg.r, bg.g, bg.b, 0), RGBW32(c.r, c.g, c.b, 0), deltabright * 8))
    } else {
      // not at all brighter than the background color: just use the background color.
      SEGMENT.setPixelColor(i, bg.r, bg.g, bg.b)
    }
  }
  return FRAMETIME
}

export function mode_twinklefox(): number {
  return twinklefox_base(false)
}

export function mode_twinklecat(): number {
  return twinklefox_base(true)
}

// ---- Solid Pattern ------------------------------------------------------------------
export function mode_static_pattern(): number {
  const lit = 1 + SEGMENT.speed
  const unlit = 1 + SEGMENT.intensity
  let drawingLit = true
  let cnt = 0

  for (let i = 0; i < SEGLEN(); i++) {
    SEGMENT.setPixelColor(i, drawingLit ? SEGMENT.color_from_palette(i, true, PALETTE_SOLID_WRAP(), 0) : SEGCOLOR(1))
    cnt++
    if (cnt >= (drawingLit ? lit : unlit)) {
      cnt = 0
      drawingLit = !drawingLit
    }
  }

  return FRAMETIME
}

// ---- Solid Pattern Tri --------------------------------------------------------------
export function mode_tri_static_pattern(): number {
  const segSize = (SEGMENT.intensity >> 5) + 1
  let currSeg = 0
  let currSegCount = 0

  for (let i = 0; i < SEGLEN(); i++) {
    if (currSeg % 3 === 0) {
      SEGMENT.setPixelColor(i, SEGCOLOR(0))
    } else if (currSeg % 3 === 1) {
      SEGMENT.setPixelColor(i, SEGCOLOR(1))
    } else {
      SEGMENT.setPixelColor(i, SEGCOLOR(2))
    }
    currSegCount += 1
    if (currSegCount >= segSize) {
      currSeg += 1
      currSegCount = 0
    }
  }

  return FRAMETIME
}

// ---- Spots / Spots Fade -------------------------------------------------------------
function spots_base(threshold: number): number {
  threshold = u16(threshold)
  if (SEGLEN() === 1) return mode_static()
  if (!SEGMENT.check2) SEGMENT.fill(SEGCOLOR(1))

  const maxZones = SEGLEN() >> 2
  const zones = 1 + ((SEGMENT.intensity * maxZones) >> 8)
  const zoneLen = Math.floor(SEGLEN() / zones)
  const offset = (SEGLEN() - zones * zoneLen) >> 1

  for (let z = 0; z < zones; z++) {
    const pos = offset + z * zoneLen
    for (let i = 0; i < zoneLen; i++) {
      const wave = triwave16(Math.floor((i * 0xffff) / zoneLen))
      if (wave > threshold) {
        const index = 0 + pos + i
        const s = Math.floor(((wave - threshold) * 255) / (0xffff - threshold))
        SEGMENT.setPixelColor(index, color_blend(SEGMENT.color_from_palette(index, true, PALETTE_SOLID_WRAP(), 0), SEGCOLOR(1), 255 - s))
      }
    }
  }

  return FRAMETIME
}

export function mode_spots(): number {
  return spots_base((255 - SEGMENT.speed) << 8)
}

export function mode_spots_fade(): number {
  const counter = u32(Math.imul(strip.now, (SEGMENT.speed >> 2) + 8))
  const t = triwave16(counter)
  const tr = (t >> 1) + (t >> 2)
  return spots_base(tr)
}
