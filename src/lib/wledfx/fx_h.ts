// WLED effects, ported from WLED v0.15.3 wled00/FX.cpp (EUPL-1.2, redistributed
// under GPLv3 per its Article 5). A line-for-line mirror of the firmware's
// FluidNC/src/WledFx/fx_h.cpp; tools/fx_parity.py (firmware repo) checks them.
//
// Batch h: WLED's 2D matrix effects, drawn on the runner's 16 x 16 matrix.
import {
  BLACK, CRGB, ColorFromPalette, constrain, DARKSLATEGRAY, FRAMETIME, HeatColor, LINEARBLEND, MAX, MIN, PALETTE_SOLID_WRAP, RGBW32, SEGCOLOR,
  SEGMENT, SEGPALETTE, WHITE, abs8, atan2_t, beat8, beatsin16_t, beatsin8_t, cos8_t, crgbAdd, div, ease8InOutApprox, f32, ftoi,
  inoise16, inoise8, inoise8_raw, lerp8by8, map, mode_static, random16, random8, scale8, sin16_t, sin8_t, sqrtf, strip, u16, u32, u8,
} from './shim'

const XY = (x: number, y: number): number => SEGMENT.XY(x, y)

// WLED's FX.h: its effects' fixed 42 FPS slot (the shim's FRAMETIME is our frame rate)
const FRAMETIME_FIXED = div(1000, 42)

// WLED's util.cpp
function crc16(data: Uint8Array, length: number): number {
  let x: number
  let crc = 0xffff
  if (!length) return 0x1d0f
  let p = 0
  while (length--) {
    x = u8((crc >> 8) ^ data[p++])
    x = u8(x ^ (x >> 4))
    crc = u16((crc << 8) ^ u16(x << 12) ^ u16(x << 5) ^ x)
  }
  return crc
}

// ---- Black Hole ---------------------------------------------------------------
export function mode_2DBlackHole(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()
  let x: number, y: number

  SEGMENT.fadeToBlackBy(16 + (SEGMENT.speed >> 3))
  const t = Math.floor(strip.now / 128)
  // outer stars
  for (let i = 0; i < 8; i++) {
    x = beatsin8_t(SEGMENT.custom1 >> 3, 0, cols - 1, 0, u8((i % 2 ? 128 : 0) + t * i))
    y = beatsin8_t(SEGMENT.intensity >> 3, 0, rows - 1, 0, u8((i % 2 ? 192 : 64) + t * i))
    SEGMENT.addPixelColorXY(x, y, SEGMENT.color_from_palette(i * 32, false, PALETTE_SOLID_WRAP(), SEGMENT.check1 ? 0 : 255))
  }
  // inner stars
  for (let i = 0; i < 4; i++) {
    x = beatsin8_t(SEGMENT.custom2 >> 3, div(cols, 4), cols - 1 - div(cols, 4), 0, u8((i % 2 ? 128 : 0) + t * i))
    y = beatsin8_t(SEGMENT.custom3, div(rows, 4), rows - 1 - div(rows, 4), 0, u8((i % 2 ? 192 : 64) + t * i))
    SEGMENT.addPixelColorXY(x, y, SEGMENT.color_from_palette(255 - i * 64, false, PALETTE_SOLID_WRAP(), SEGMENT.check1 ? 0 : 255))
  }
  // central white dot
  SEGMENT.setPixelColorXY(div(cols, 2), div(rows, 2), WHITE)
  // blur everything a bit
  if (SEGMENT.check3) SEGMENT.blur(16, cols * rows < 100)

  return FRAMETIME
}

// ---- Colored Bursts -------------------------------------------------------------
export function mode_2DColoredBursts(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  if (SEGMENT.call === 0) {
    SEGMENT.aux0 = 0 // start with red hue
  }

  const dot = SEGMENT.check3
  const grad = SEGMENT.check1

  const numLines = u8((SEGMENT.intensity >> 4) + 1)

  SEGMENT.aux0 = u16(SEGMENT.aux0 + 1) // hue
  SEGMENT.fadeToBlackBy(40)
  for (let i = 0; i < numLines; i++) {
    const x1 = beatsin8_t(2 + (SEGMENT.speed >> 4), 0, cols - 1)
    const x2 = beatsin8_t(1 + (SEGMENT.speed >> 4), 0, rows - 1)
    const y1 = beatsin8_t(5 + (SEGMENT.speed >> 4), 0, cols - 1, 0, u8(i * 24))
    const y2 = beatsin8_t(3 + (SEGMENT.speed >> 4), 0, rows - 1, 0, u8(i * 48 + 64))
    const color = ColorFromPalette(SEGPALETTE(), Math.floor((i * 255) / numLines) + (SEGMENT.aux0 & 0xff), 255, LINEARBLEND)

    const xsteps = u8(abs8(x1 - y1) + 1)
    const ysteps = u8(abs8(x2 - y2) + 1)
    const steps = xsteps >= ysteps ? xsteps : ysteps
    // Draw gradient line
    for (let j = 1; j <= steps; j++) {
      const rate = u8(Math.floor((j * 255) / steps))
      const dx = lerp8by8(x1, y1, rate)
      const dy = lerp8by8(x2, y2, rate)
      SEGMENT.addPixelColorXY(dx, dy, color) // use setPixelColorXY for different look
      if (grad) SEGMENT.fadePixelColorXY(dx, dy, rate)
    }

    if (dot) { // add white point at the ends of line
      SEGMENT.setPixelColorXY(x1, x2, WHITE)
      SEGMENT.setPixelColorXY(y1, y2, DARKSLATEGRAY)
    }
  }
  if (SEGMENT.custom3) SEGMENT.blur(SEGMENT.custom3 >> 1)

  return FRAMETIME
}

// ---- DNA Spiral -------------------------------------------------------------------
export function mode_2DDNASpiral(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  if (SEGMENT.call === 0) {
    SEGMENT.fill(BLACK)
  }

  const speeds = (SEGMENT.speed >> 1) + 7
  const freq = SEGMENT.intensity >> 3

  const ms = Math.floor(strip.now / 20)
  SEGMENT.fadeToBlackBy(135)

  for (let i = 0; i < rows; i++) {
    let x = beatsin8_t(speeds, 0, cols - 1, 0, u8(i * freq)) + beatsin8_t(speeds - 7, 0, cols - 1, 0, u8(i * freq + 128))
    let x1 = beatsin8_t(speeds, 0, cols - 1, 0, u8(128 + i * freq)) + beatsin8_t(speeds - 7, 0, cols - 1, 0, u8(128 + 64 + i * freq))
    const hue = u32(div(i * 128, rows) + ms)
    // skip every 4th row every now and then (fade it more)
    if ((i + Math.floor(ms / 8)) & 3) {
      // draw a gradient line between x and x1
      x = div(x, 2)
      x1 = div(x1, 2)
      const steps = abs8(x - x1) + 1
      const positive = x1 >= x // direction of drawing
      for (let k = 1; k <= steps; k++) {
        const rate = Math.floor((k * 255) / steps)
        const dx = positive ? x + k - 1 : x - k + 1 // behaves the same as "lerp8by8" but does not create holes
        SEGMENT.addPixelColorXY(dx, i, ColorFromPalette(SEGPALETTE(), hue, 255, LINEARBLEND)) // use setPixelColorXY for different look
        SEGMENT.fadePixelColorXY(dx, i, rate)
      }
      SEGMENT.setPixelColorXY(x, i, DARKSLATEGRAY)
      SEGMENT.setPixelColorXY(x1, i, WHITE)
    }
  }

  return FRAMETIME
}

// ---- Frizzles -----------------------------------------------------------------------
export function mode_2DFrizzles(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  SEGMENT.fadeToBlackBy(16)
  for (let i = 8; i > 0; i--) {
    // the C's `intensity/8 - i` is size_t: wraps, then the uint16 bpm takes its low bits
    SEGMENT.addPixelColorXY(beatsin8_t((SEGMENT.speed >> 3) + i, 0, cols - 1), beatsin8_t(u16((SEGMENT.intensity >> 3) - i), 0, rows - 1),
      ColorFromPalette(SEGPALETTE(), beatsin8_t(12, 0, 255), 255, LINEARBLEND))
  }
  SEGMENT.blur(SEGMENT.custom1 >> 3)

  return FRAMETIME
}

// ---- Game Of Life ---------------------------------------------------------------------
// SEGENV.data: CRGB prevLeds[w*h] (3 bytes r,g,b each), then uint16_t crcBuffer[2].
// colorCount { CRGB color; int8_t count } is local: colors are kept packed 0xRRGGBB.
export function mode_2Dgameoflife(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()
  const dataSize = 3 * SEGMENT.length() // using width*height prevents reallocation if mirroring is enabled
  const crcBufferLen = 2

  if (!SEGMENT.allocateData(dataSize + 2 * crcBufferLen)) return mode_static() // allocation failed
  const prevLeds = SEGMENT.data as Uint8Array
  const dv = SEGMENT.dataView as DataView
  const prev = (k: number): number => (prevLeds[3 * k] << 16) | (prevLeds[3 * k + 1] << 8) | prevLeds[3 * k + 2]
  const setPrev = (k: number, c: number): void => { prevLeds[3 * k] = (c >>> 16) & 0xff; prevLeds[3 * k + 1] = (c >>> 8) & 0xff; prevLeds[3 * k + 2] = c & 0xff }

  const backgroundColor = new CRGB(SEGCOLOR(1))
  const bg = backgroundColor.u32()

  if (SEGMENT.call === 0 || u32(strip.now - SEGMENT.step) > 3000) {
    SEGMENT.step = strip.now
    SEGMENT.aux0 = 0

    // give the leds random state and colors (based on intensity, colors from palette or all posible colors are chosen)
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
      const state = random8() % 2
      if (state === 0) SEGMENT.setPixelColorXY(x, y, backgroundColor)
      else SEGMENT.setPixelColorXY(x, y, SEGMENT.color_from_palette(random8(), false, PALETTE_SOLID_WRAP(), 255))
    }

    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) setPrev(XY(x, y), CRGB.Black)
    prevLeds.fill(0, dataSize, dataSize + 2 * crcBufferLen)
  } else if (u32(strip.now - SEGMENT.step) < FRAMETIME_FIXED * u32(map(SEGMENT.speed, 0, 255, 64, 4))) {
    // update only when appropriate time passes (in 42 FPS slots)
    return FRAMETIME
  }

  // copy previous leds (save previous generation)
  for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) setPrev(XY(x, y), SEGMENT.getPixelColorXY(x, y))

  // calculate new leds
  const ccColor = new Array<number>(9)
  const ccCount = new Array<number>(9)
  for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
    for (let i = 0; i < 9; i++) { ccColor[i] = bg; ccCount[i] = 0 } // init colorsCount

    // iterate through neighbors and count them and their different colors
    let neighbors = 0
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { // iterate through 3*3 matrix
      if (i === 0 && j === 0) continue // ignore itself
      // wrap around segment
      let xx = x + i, yy = y + j
      if (x + i < 0) xx = cols - 1
      else if (x + i >= cols) xx = 0
      if (y + j < 0) yy = rows - 1
      else if (y + j >= rows) yy = 0

      const xy = XY(xx, yy) // previous cell xy to check
      // count different neighbours and colors
      if (prev(xy) !== bg) {
        neighbors++
        let colorFound = false
        let k: number
        for (k = 0; k < 9 && ccCount[k] !== 0; k++) {
          if (ccColor[k] === prev(xy)) {
            ccCount[k]++
            colorFound = true
          }
        }
        if (!colorFound) { ccColor[k] = prev(xy); ccCount[k] = 1 } // add new color found in the array
      }
    } // i,j

    // Rules of Life
    const col = prev(XY(x, y)) & 0x00ffffff
    const bgc = RGBW32(backgroundColor.r, backgroundColor.g, backgroundColor.b, 0)
    if (col !== bgc && neighbors < 2) SEGMENT.setPixelColorXY(x, y, bgc) // Loneliness
    else if (col !== bgc && neighbors > 3) SEGMENT.setPixelColorXY(x, y, bgc) // Overpopulation
    else if (col === bgc && neighbors === 3) { // Reproduction
      // find dominant color and assign it to a cell
      let domColor = bg, domCount = 0
      for (let i = 0; i < 9 && ccCount[i] !== 0; i++) {
        if (ccCount[i] > domCount) { domColor = ccColor[i]; domCount = ccCount[i] }
      }
      // assign the dominant color w/ a bit of randomness to avoid "gliders"
      if (domCount > 0 && random8(128)) SEGMENT.setPixelColorXY(x, y, domColor)
    } else if (col === bgc && neighbors === 2 && !random8(128)) { // Mutation
      SEGMENT.setPixelColorXY(x, y, SEGMENT.color_from_palette(random8(), false, PALETTE_SOLID_WRAP(), 255))
    }
    // else do nothing!
  } // x,y

  // calculate CRC16 of leds
  const crc = crc16(prevLeds, dataSize)
  // check if we had same CRC and reset if needed
  let repetition = false
  for (let i = 0; i < crcBufferLen && !repetition; i++) repetition = crc === dv.getUint16(dataSize + 2 * i, true) // (Ewowi)
  // same CRC would mean image did not change or was repeating itself
  if (!repetition) SEGMENT.step = strip.now // if no repetition avoid reset
  // remember CRCs across frames
  dv.setUint16(dataSize + 2 * SEGMENT.aux0, crc, true)
  SEGMENT.aux0 = u16(SEGMENT.aux0 + 1) % crcBufferLen

  return FRAMETIME
}

// ---- Hiphotic --------------------------------------------------------------------------
export function mode_2DHiphotic(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()
  const a = Math.floor(strip.now / ((SEGMENT.custom3 >> 1) + 1))

  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      SEGMENT.setPixelColorXY(x, y,
        SEGMENT.color_from_palette(sin8_t(cos8_t(div(x * SEGMENT.speed, 16) + Math.floor(a / 3)) + sin8_t(div(y * SEGMENT.intensity, 16) + Math.floor(a / 4)) + a),
          false, PALETTE_SOLID_WRAP(), 0))
    }
  }

  return FRAMETIME
}

// ---- Julia ------------------------------------------------------------------------------
// SEGENV.data: struct Julia { float xcen; float ycen; float xymag; } (offsets 0, 4, 8)
export function mode_2DJulia(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  if (!SEGMENT.allocateData(12)) return mode_static()
  const julias = SEGMENT.dataView as DataView
  const XCEN = 0, YCEN = 4, XYMAG = 8

  let reAl: number
  let imAg: number

  if (SEGMENT.call === 0) { // Reset the center if we've just re-started this animation.
    julias.setFloat32(XCEN, 0, true)
    julias.setFloat32(YCEN, 0, true)
    julias.setFloat32(XYMAG, 1, true)

    SEGMENT.custom1 = 128 // Make sure the location widgets are centered to start.
    SEGMENT.custom2 = 128
    SEGMENT.custom3 = 16
    SEGMENT.intensity = 24
  }

  julias.setFloat32(XCEN, f32(julias.getFloat32(XCEN, true) + f32((SEGMENT.custom1 - 128) / 100000)), true)
  julias.setFloat32(YCEN, f32(julias.getFloat32(YCEN, true) + f32((SEGMENT.custom2 - 128) / 100000)), true)
  julias.setFloat32(XYMAG, f32(julias.getFloat32(XYMAG, true) + f32(((SEGMENT.custom3 - 16) << 3) / 100000)), true) // reduced resolution slider
  if (julias.getFloat32(XYMAG, true) < f32(0.01)) julias.setFloat32(XYMAG, 0.01, true)
  if (julias.getFloat32(XYMAG, true) > 1) julias.setFloat32(XYMAG, 1, true)

  const xcen = julias.getFloat32(XCEN, true), ycen = julias.getFloat32(YCEN, true), xymag = julias.getFloat32(XYMAG, true)
  let xmin = f32(xcen - xymag)
  let xmax = f32(xcen + xymag)
  let ymin = f32(ycen - xymag)
  let ymax = f32(ycen + xymag)

  // Whole set should be within -1.2,1.2 to -.8 to 1.
  xmin = constrain(xmin, f32(-1.2), f32(1.2))
  xmax = constrain(xmax, f32(-1.2), f32(1.2))
  ymin = constrain(ymin, f32(-0.8), 1)
  ymax = constrain(ymax, f32(-0.8), 1)

  let maxIterations = 15 // How many iterations per pixel before we give up. Make it 8 bits to match our range of colours.
  const maxCalc = 16 // How big is each calculation allowed to be before we give up.

  maxIterations = SEGMENT.intensity >> 1

  // Resize section on the fly for some animaton.
  reAl = f32(-0.94299) // PixelBlaze example
  imAg = f32(0.3162)

  reAl = f32(reAl + f32(sin16_t(u16(strip.now * 34)) / 655340))
  imAg = f32(imAg + f32(sin16_t(u16(strip.now * 26)) / 655340))

  const dx = f32(f32(xmax - xmin) / cols) // Scale the delta x and y values to our matrix size.
  const dy = f32(f32(ymax - ymin) / rows)

  // Start y
  let y = ymin
  for (let j = 0; j < rows; j++) {
    // Start x
    let x = xmin
    for (let i = 0; i < cols; i++) {
      // Now we test, as we iterate z = z^2 + c does z tend towards infinity?
      let a = x
      let b = y
      let iter = 0

      while (iter < maxIterations) { // Here we determine whether or not we're out of bounds.
        const aa = f32(a * a)
        const bb = f32(b * b)
        const len = f32(aa + bb)
        if (len > maxCalc) { // |z| = sqrt(a^2+b^2) OR z^2 = a^2+b^2 to save on having to perform a square root.
          break // Bail
        }

        // This operation corresponds to z -> z^2+c where z=a+ib c=(x,y). Remember to use 'foil'.
        b = f32(f32(f32(2 * a) * b) + imAg)
        a = f32(f32(aa - bb) + reAl)
        iter++
      } // while

      // We color each pixel based on how long it takes to get to infinity, or black if it never gets there.
      if (iter === maxIterations) {
        SEGMENT.setPixelColorXY(i, j, 0)
      } else {
        SEGMENT.setPixelColorXY(i, j, SEGMENT.color_from_palette(div(iter * 255, maxIterations), false, PALETTE_SOLID_WRAP(), 0))
      }
      x = f32(x + dx)
    }
    y = f32(y + dy)
  }

  return FRAMETIME
}

// ---- Lissajous --------------------------------------------------------------------------
export function mode_2DLissajous(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  SEGMENT.fadeToBlackBy(SEGMENT.intensity)
  // uint_fast16_t: its width differs by platform, but only phase/2's low byte is ever used, the same for any width
  const phase = Math.floor(u32(strip.now * (1 + SEGMENT.custom3)) / 32) // allow user to control rotation speed

  for (let i = 0; i < 256; i++) {
    let xlocn = sin8_t(Math.floor(phase / 2) + div(i * SEGMENT.speed, 32))
    let ylocn = cos8_t(Math.floor(phase / 2) + i * 2)
    xlocn = cols < 2 ? 1 : u8(div(map(2 * xlocn, 0, 511, 0, 2 * (cols - 1)) + 1, 2)) // softhack007: "(2* ..... +1) /2" for proper rounding
    ylocn = rows < 2 ? 1 : u8(div(map(2 * ylocn, 0, 511, 0, 2 * (rows - 1)) + 1, 2)) // "rows > 1" is needed to avoid div/0 in map()
    SEGMENT.setPixelColorXY(u8(xlocn), u8(ylocn), SEGMENT.color_from_palette(Math.floor(strip.now / 100) + i, false, PALETTE_SOLID_WRAP(), 0))
  }

  return FRAMETIME
}

// ---- Plasma Ball ----------------------------------------------------------------------------
export function mode_2DPlasmaball(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  SEGMENT.fadeToBlackBy(SEGMENT.custom1 >> 2)
  const t = Math.floor(u32(strip.now * 8) / (256 - SEGMENT.speed)) // optimized to avoid float
  for (let i = 0; i < cols; i++) {
    const thisVal = inoise8(i * 30, t, t)
    const thisMax = map(thisVal, 0, 255, 0, cols - 1)
    for (let j = 0; j < rows; j++) {
      const thisVal_ = inoise8(t, j * 30, t)
      const thisMax_ = map(thisVal_, 0, 255, 0, rows - 1)
      const x = i + thisMax_ - div(cols, 2)
      const y = j + thisMax - div(cols, 2)
      const cx = i + thisMax_
      const cy = j + thisMax

      SEGMENT.addPixelColorXY(i, j,
        (x - y > -2 && x - y < 2) || (cols - 1 - x - y > -2 && cols - 1 - x - y < 2) || cols - cx === 0 || cols - 1 - cx === 0 || rows - cy === 0 || rows - 1 - cy === 0
          ? ColorFromPalette(SEGPALETTE(), beat8(5), thisVal, LINEARBLEND)
          : CRGB.Black)
    }
  }
  SEGMENT.blur(SEGMENT.custom2 >> 5)

  return FRAMETIME
}

// ---- Sindots ----------------------------------------------------------------------------------
export function mode_2DSindots(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  if (SEGMENT.call === 0) {
    SEGMENT.fill(BLACK)
  }

  SEGMENT.fadeToBlackBy(SEGMENT.custom1 >> 3)

  const t1 = u8(Math.floor(strip.now / (257 - SEGMENT.speed))) // 20;
  const t2 = u8((sin8_t(t1) >> 2) * 2)
  for (let i = 0; i < 13; i++) {
    const x = div(sin8_t(t1 + div(i * SEGMENT.intensity, 8)) * (cols - 1), 255) // max index now 255x15/255=15!
    const y = div(sin8_t(t2 + div(i * SEGMENT.intensity, 8)) * (rows - 1), 255) // max index now 255x15/255=15!
    SEGMENT.setPixelColorXY(x, y, ColorFromPalette(SEGPALETTE(), div(i * 255, 13), 255, LINEARBLEND))
  }
  SEGMENT.blur(SEGMENT.custom2 >> 3)

  return FRAMETIME
}

// ---- Sun Radiation -------------------------------------------------------------------------------
export function mode_2DSunradiation(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  if (!SEGMENT.allocateData((cols + 2) * (rows + 2))) return mode_static() // allocation failed
  const bump = SEGMENT.data as Uint8Array

  if (SEGMENT.call === 0) {
    SEGMENT.fill(BLACK)
  }

  const t = Math.floor(strip.now / 4)
  let index = 0
  const someVal = SEGMENT.speed >> 2 // Was 25.
  for (let j = 0; j < rows + 2; j++) {
    for (let i = 0; i < cols + 2; i++) {
      const col = u8(div(inoise8_raw(i * someVal, j * someVal, t), 2))
      bump[index++] = col
    }
  }

  let yindex = cols + 3
  let vly = -(div(rows, 2) + 1)
  for (let y = 0; y < rows; y++) {
    ++vly
    let vlx = -(div(cols, 2) + 1)
    for (let x = 0; x < cols; x++) {
      ++vlx
      const nx = bump[x + yindex + 1] - bump[x + yindex - 1]
      const ny = bump[x + yindex + (cols + 2)] - bump[x + yindex - (cols + 2)]
      const difx = abs8(vlx * 7 - nx)
      const dify = abs8(vly * 7 - ny)
      const temp = difx * difx + dify * dify
      let col = 255 - div(temp, 8) // 8 its a size of effect
      if (col < 0) col = 0
      SEGMENT.setPixelColorXY(x, y, HeatColor(u8(ftoi(f32(col / f32(3 - f32(SEGMENT.intensity / 128)))))))
    }
    yindex += cols + 2
  }

  return FRAMETIME
}

// ---- Tartan -------------------------------------------------------------------------------------------
export function mode_2Dtartan(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  if (SEGMENT.call === 0) {
    SEGMENT.fill(BLACK)
  }

  let hue: number, bri: number
  let intensity: number // size_t: at most 255^4, so it never wraps
  const offsetX = beatsin16_t(3, -360, 360)
  const offsetY = beatsin16_t(2, -360, 360)
  const sharpness = SEGMENT.custom3 >> 3 // 0-3

  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      hue = u8(x * beatsin16_t(10, 1, 10) + offsetY)
      intensity = bri = sin8_t(div(x * SEGMENT.speed, 2) + offsetX)
      for (let i = 0; i < sharpness; i++) intensity *= bri
      intensity = intensity >>> (8 * sharpness)
      SEGMENT.setPixelColorXY(x, y, ColorFromPalette(SEGPALETTE(), hue, intensity, LINEARBLEND))
      hue = u8(y * 3 + offsetX)
      intensity = bri = sin8_t(div(y * SEGMENT.intensity, 2) + offsetY)
      for (let i = 0; i < sharpness; i++) intensity *= bri
      intensity = intensity >>> (8 * sharpness)
      SEGMENT.addPixelColorXY(x, y, ColorFromPalette(SEGPALETTE(), hue, intensity, LINEARBLEND))
    }
  }

  return FRAMETIME
}

// ---- Soap ----------------------------------------------------------------------------------------------
// SEGENV.data: uint8_t noise3d[w*h], then uint32_t noise32_x, noise32_y, noise32_z
export function mode_2Dsoap(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  const dataSize = SEGMENT.width() * SEGMENT.height() // prevent reallocation if mirrored or grouped
  if (!SEGMENT.allocateData(dataSize + 4 * 3)) return mode_static() // allocation failed

  const noise3d = SEGMENT.data as Uint8Array
  const dv = SEGMENT.dataView as DataView
  const noise32_x = dataSize, noise32_y = dataSize + 4, noise32_z = dataSize + 8
  const scale32_x = Math.floor(160000 / cols)
  const scale32_y = Math.floor(160000 / rows)
  const mov = u32(div(MIN(cols, rows) * (SEGMENT.speed + 2), 2))
  const smoothness = u8(MIN(250, SEGMENT.intensity)) // limit as >250 produces very little changes

  // init
  if (SEGMENT.call === 0) {
    dv.setUint32(noise32_x, random16(), true)
    dv.setUint32(noise32_y, random16(), true)
    dv.setUint32(noise32_z, random16(), true)
  } else {
    dv.setUint32(noise32_x, u32(dv.getUint32(noise32_x, true) + mov), true)
    dv.setUint32(noise32_y, u32(dv.getUint32(noise32_y, true) + mov), true)
    dv.setUint32(noise32_z, u32(dv.getUint32(noise32_z, true) + mov), true)
  }

  for (let i = 0; i < cols; i++) {
    const ioffset = (scale32_x * (i - div(cols, 2))) | 0
    for (let j = 0; j < rows; j++) {
      const joffset = (scale32_y * (j - div(rows, 2))) | 0
      const data = u8(inoise16(u32(dv.getUint32(noise32_x, true) + ioffset), u32(dv.getUint32(noise32_y, true) + joffset), dv.getUint32(noise32_z, true)) >> 8)
      noise3d[XY(i, j)] = u8(scale8(noise3d[XY(i, j)], smoothness) + scale8(data, 255 - smoothness))
    }
  }
  // init also if dimensions changed
  if (SEGMENT.call === 0 || SEGMENT.aux0 !== cols || SEGMENT.aux1 !== rows) {
    SEGMENT.aux0 = cols
    SEGMENT.aux1 = rows
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        SEGMENT.setPixelColorXY(i, j, ColorFromPalette(SEGPALETTE(), ~noise3d[XY(i, j)] * 3))
      }
    }
  }

  let zD: number
  let zF: number
  let amplitude: number
  const shiftX = 0 //(SEGMENT.custom1 - 128) / 4;
  const shiftY = 0 //(SEGMENT.custom2 - 128) / 4;
  const ledsbuff: CRGB[] = new Array<CRGB>(MAX(cols, rows))

  amplitude = cols >= 16 ? div(cols - 8, 8) : 1
  for (let y = 0; y < rows; y++) {
    const amount = (noise3d[XY(0, y)] - 128) * 2 * amplitude + 256 * shiftX
    const delta = Math.abs(amount) >> 8
    const fraction = Math.abs(amount) & 255
    for (let x = 0; x < cols; x++) {
      if (amount < 0) {
        zD = x - delta
        zF = zD - 1
      } else {
        zD = x + delta
        zF = zD + 1
      }
      let PixelA: CRGB
      if (zD >= 0 && zD < cols) PixelA = new CRGB(SEGMENT.getPixelColorXY(zD, y))
      else PixelA = ColorFromPalette(SEGPALETTE(), ~noise3d[XY(Math.abs(zD), y)] * 3)
      let PixelB: CRGB
      if (zF >= 0 && zF < cols) PixelB = new CRGB(SEGMENT.getPixelColorXY(zF, y))
      else PixelB = ColorFromPalette(SEGPALETTE(), ~noise3d[XY(Math.abs(zF), y)] * 3)
      ledsbuff[x] = crgbAdd(PixelA.nscale8(ease8InOutApprox(255 - fraction)), PixelB.nscale8(ease8InOutApprox(fraction)))
    }
    for (let x = 0; x < cols; x++) SEGMENT.setPixelColorXY(x, y, ledsbuff[x])
  }

  amplitude = rows >= 16 ? div(rows - 8, 8) : 1
  for (let x = 0; x < cols; x++) {
    const amount = (noise3d[XY(x, 0)] - 128) * 2 * amplitude + 256 * shiftY
    const delta = Math.abs(amount) >> 8
    const fraction = Math.abs(amount) & 255
    for (let y = 0; y < rows; y++) {
      if (amount < 0) {
        zD = y - delta
        zF = zD - 1
      } else {
        zD = y + delta
        zF = zD + 1
      }
      let PixelA: CRGB
      if (zD >= 0 && zD < rows) PixelA = new CRGB(SEGMENT.getPixelColorXY(x, zD))
      else PixelA = ColorFromPalette(SEGPALETTE(), ~noise3d[XY(x, Math.abs(zD))] * 3)
      let PixelB: CRGB
      if (zF >= 0 && zF < rows) PixelB = new CRGB(SEGMENT.getPixelColorXY(x, zF))
      else PixelB = ColorFromPalette(SEGPALETTE(), ~noise3d[XY(x, Math.abs(zF))] * 3)
      ledsbuff[y] = crgbAdd(PixelA.nscale8(ease8InOutApprox(255 - fraction)), PixelB.nscale8(ease8InOutApprox(fraction)))
    }
    for (let y = 0; y < rows; y++) SEGMENT.setPixelColorXY(x, y, ledsbuff[y])
  }

  return FRAMETIME
}

// ---- Octopus ---------------------------------------------------------------------------------------------
// SEGENV.data: map_t { uint8_t angle; uint8_t radius; } rMap[w*h], then uint8_t offsX, offsY
export function mode_2Doctopus(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()
  const mapp = u8(div(180, MAX(cols, rows)))

  const dataSize = SEGMENT.width() * SEGMENT.height() * 2 // prevent reallocation if mirrored or grouped
  if (!SEGMENT.allocateData(dataSize + 2)) return mode_static() // allocation failed

  const rMap = SEGMENT.data as Uint8Array
  const offsX = dataSize, offsY = dataSize + 1

  // re-init if SEGMENT dimensions or offset changed
  if (SEGMENT.call === 0 || SEGMENT.aux0 !== cols || SEGMENT.aux1 !== rows || SEGMENT.custom1 !== rMap[offsX] || SEGMENT.custom2 !== rMap[offsY]) {
    SEGMENT.step = 0 // t
    SEGMENT.aux0 = cols
    SEGMENT.aux1 = rows
    rMap[offsX] = SEGMENT.custom1
    rMap[offsY] = SEGMENT.custom2
    const C_X = div(cols, 2) + div((SEGMENT.custom1 - 128) * cols, 255)
    const C_Y = div(rows, 2) + div((SEGMENT.custom2 - 128) * rows, 255)
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        const dx = x - C_X
        const dy = y - C_Y
        rMap[2 * XY(x, y)] = u8(ftoi(f32(f32(40.7436) * atan2_t(dy, dx)))) // avoid 128*atan2()/PI
        rMap[2 * XY(x, y) + 1] = u8(ftoi(f32(sqrtf(dx * dx + dy * dy) * mapp))) // thanks Sutaburosu
      }
    }
  }

  SEGMENT.step = u32(SEGMENT.step + (SEGMENT.speed >> 5) + 1) // 1-4 range
  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      const angle = rMap[2 * XY(x, y)]
      const radius = rMap[2 * XY(x, y) + 1]
      let intensity = sin8_t(sin8_t(div(angle * 4 - radius, 4) + Math.floor(SEGMENT.step / 2)) + radius - SEGMENT.step + angle * ((SEGMENT.custom3 >> 2) + 1))
      intensity = map((intensity * intensity) & 0xffff, 0, 65535, 0, 255) // add a bit of non-linearity for cleaner display
      const c = ColorFromPalette(SEGPALETTE(), Math.floor(SEGMENT.step / 2) - radius, intensity)
      SEGMENT.setPixelColorXY(x, y, c)
    }
  }
  return FRAMETIME
}

// ---- Waving Cell -------------------------------------------------------------------------------------------
export function mode_2Dwavingcell(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  const t = Math.floor(strip.now / (257 - SEGMENT.speed))
  const aX = u8((SEGMENT.custom1 >> 4) + 9)
  const aY = u8((SEGMENT.custom2 >> 4) + 1)
  const aZ = u8(SEGMENT.custom3 + 1)
  for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++)
    SEGMENT.setPixelColorXY(x, y, ColorFromPalette(SEGPALETTE(), sin8_t(x * aX + sin8_t((y + t) * aY)) + cos8_t(y * aZ) + 1 + t))

  return FRAMETIME
}
