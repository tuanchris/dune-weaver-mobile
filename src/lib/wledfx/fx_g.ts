// WLED effects, ported from WLED v0.15.3 wled00/FX.cpp (EUPL-1.2, redistributed
// under GPLv3 per its Article 5). A line-for-line mirror of the firmware's
// FluidNC/src/WledFx/fx_g.cpp; tools/fx_parity.py (firmware repo) checks them.
//
// Batch g: 2D matrix effects (drawn on the runner's 16x16 matrix).
import {
  BLACK, CHSV, CRGB, CRGBPalette16, ColorFromPalette, FRAMETIME, LINEARBLEND, PALETTE_SOLID_WRAP, RGBW32, SEGCOLOR, SEGMENT, SEGPALETTE, WHITE,
  abs8, add8, beatsin8_t, cos8_t, cos_t, div, f32, fabsf, ftoi, gamma8, i8, inoise8, map, mode_static, random16, random16_set_seed, random8,
  roundf, sin8_t, sin_t, sqrt16, strip, u16, u32, u8,
} from './shim'

// Arduino's radians(): deg * DEG_TO_RAD, in double
const DEG_TO_RAD = 0.017453292519943295
const radians = (deg: number): number => deg * DEG_TO_RAD

// ---- DNA ----------------------------------------------------------------------
export function mode_2Ddna(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  SEGMENT.fadeToBlackBy(64)
  for (let i = 0; i < cols; i++) {
    SEGMENT.setPixelColorXY(i, beatsin8_t(SEGMENT.speed >> 3, 0, rows - 1, 0, i * 4), ColorFromPalette(SEGPALETTE(), i * 5 + Math.floor(strip.now / 17), beatsin8_t(5, 55, 255, 0, i * 10), LINEARBLEND))
    SEGMENT.setPixelColorXY(i, beatsin8_t(SEGMENT.speed >> 3, 0, rows - 1, 0, i * 4 + 128), ColorFromPalette(SEGPALETTE(), i * 5 + 128 + Math.floor(strip.now / 17), beatsin8_t(5, 55, 255, 0, i * 10 + 128), LINEARBLEND))
  }
  SEGMENT.blur(SEGMENT.intensity >> 3)

  return FRAMETIME
}

// ---- Drift --------------------------------------------------------------------
export function mode_2DDrift(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  const colsCenter = (cols >> 1) + (cols % 2)
  const rowsCenter = (rows >> 1) + (rows % 2)

  SEGMENT.fadeToBlackBy(128)
  const maxDim = f32(div(Math.max(cols, rows), 2))
  const t = Math.floor(strip.now / (32 - (SEGMENT.speed >> 3)))
  const t_20 = Math.floor(t / 20)
  for (let i = f32(1); i < maxDim; i = f32(i + f32(0.25))) {
    const angle = f32(radians(f32(f32(t) * f32(maxDim - i))))
    const mySin = ftoi(f32(sin_t(angle) * i))
    const myCos = ftoi(f32(cos_t(angle) * i))
    const idx = u32(ftoi(f32(f32(i * 20) + f32(t_20))))
    SEGMENT.setPixelColorXY(colsCenter + mySin, rowsCenter + myCos, ColorFromPalette(SEGPALETTE(), idx, 255, LINEARBLEND))
    if (SEGMENT.check1) SEGMENT.setPixelColorXY(colsCenter + myCos, rowsCenter + mySin, ColorFromPalette(SEGPALETTE(), idx, 255, LINEARBLEND))
  }
  SEGMENT.blur(SEGMENT.intensity >> 3)

  return FRAMETIME
}

// ---- Firenoise ----------------------------------------------------------------
const firePalette = new CRGBPalette16([
  CRGB.Black, CRGB.Black, CRGB.Black, CRGB.Black, CRGB.Red, CRGB.Red, CRGB.Red, CRGB.DarkOrange,
  CRGB.DarkOrange, CRGB.DarkOrange, CRGB.Orange, CRGB.Orange, CRGB.Yellow, CRGB.Orange, CRGB.Yellow, CRGB.Yellow,
])

export function mode_2Dfirenoise(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  if (SEGMENT.call === 0) {
    SEGMENT.fill(BLACK)
  }

  const xscale = SEGMENT.intensity * 4
  const yscale = SEGMENT.speed * 8
  let indexx = 0

  const pal = SEGMENT.check1 ? SEGPALETTE() : firePalette

  for (let j = 0; j < cols; j++) {
    for (let i = 0; i < rows; i++) {
      indexx = inoise8(Math.floor((j * yscale * rows) / 255), i * xscale + Math.floor(strip.now / 4))
      SEGMENT.setPixelColorXY(j, i, ColorFromPalette(pal, Math.min((i * indexx) >> 4, 255), div(i * 255, cols), LINEARBLEND))
    }
  }

  return FRAMETIME
}

// ---- Matrix -------------------------------------------------------------------
export function mode_2Dmatrix(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  const dataSize = (SEGMENT.length() + 7) >> 3
  if (!SEGMENT.allocateData(dataSize)) return mode_static()
  const data = SEGMENT.data as Uint8Array

  if (SEGMENT.call === 0) {
    SEGMENT.fill(BLACK)
    SEGMENT.step = 0
  }

  const fade = u8(map(SEGMENT.custom1, 0, 255, 50, 250))
  const speed = u8((256 - SEGMENT.speed) >> map(Math.min(rows, 150), 0, 150, 0, 3))

  let spawnColor: number
  let trailColor: number
  if (SEGMENT.check1) {
    spawnColor = SEGCOLOR(0)
    trailColor = SEGCOLOR(1)
  } else {
    spawnColor = RGBW32(175, 255, 175, 0)
    trailColor = RGBW32(27, 130, 39, 0)
  }

  let emptyScreen = true
  if (u32(strip.now - SEGMENT.step) >= speed) {
    SEGMENT.step = strip.now
    SEGMENT.fadeToBlackBy(fade)
    for (let row = rows - 1; row >= 0; row--) {
      for (let col = 0; col < cols; col++) {
        let index = SEGMENT.XY(col, row) >> 3
        let bitNum = SEGMENT.XY(col, row) & 0x07
        if ((data[index] >> bitNum) & 0x01) {
          SEGMENT.setPixelColorXY(col, row, trailColor)
          data[index] &= ~(1 << bitNum)
          if (row < rows - 1) {
            SEGMENT.setPixelColorXY(col, row + 1, spawnColor)
            index = SEGMENT.XY(col, row + 1) >> 3
            bitNum = SEGMENT.XY(col, row + 1) & 0x07
            data[index] |= 1 << bitNum
            emptyScreen = false
          }
        }
      }
    }

    if (random8() <= SEGMENT.intensity || emptyScreen) {
      const spawnX = random8(cols)
      SEGMENT.setPixelColorXY(spawnX, 0, spawnColor)
      const index = SEGMENT.XY(spawnX, 0) >> 3
      const bitNum = SEGMENT.XY(spawnX, 0) & 0x07
      data[index] |= 1 << bitNum
    }
  }

  return FRAMETIME
}

// ---- Metaballs ----------------------------------------------------------------
export function mode_2Dmetaballs(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  const speed = f32(f32(0.25) * (1 + (SEGMENT.speed >> 6)))
  const ns = u32(ftoi(f32(f32(strip.now) * speed)))

  const x2 = map(inoise8(ns, 25355, 685), 0, 255, 0, cols - 1)
  const y2 = map(inoise8(ns, 355, 11685), 0, 255, 0, rows - 1)

  const x3 = map(inoise8(ns, 55355, 6685), 0, 255, 0, cols - 1)
  const y3 = map(inoise8(ns, 25355, 22685), 0, 255, 0, rows - 1)

  const x1 = beatsin8_t(ftoi(f32(23 * speed)), 0, cols - 1)
  const y1 = beatsin8_t(ftoi(f32(28 * speed)), 0, rows - 1)

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let dx = Math.abs(x - x1)
      let dy = Math.abs(y - y1)
      let dist = 2 * sqrt16(dx * dx + dy * dy)

      dx = Math.abs(x - x2)
      dy = Math.abs(y - y2)
      dist += sqrt16(dx * dx + dy * dy)

      dx = Math.abs(x - x3)
      dy = Math.abs(y - y3)
      dist += sqrt16(dx * dx + dy * dy)

      const color = dist ? Math.floor(1000 / dist) : 255

      if (color > 0 && color < 60) {
        SEGMENT.setPixelColorXY(x, y, SEGMENT.color_from_palette(map(color * 9, 9, 531, 0, 255), false, PALETTE_SOLID_WRAP(), 0))
      } else {
        SEGMENT.setPixelColorXY(x, y, SEGMENT.color_from_palette(0, false, PALETTE_SOLID_WRAP(), 0))
      }
      SEGMENT.setPixelColorXY(x1, y1, WHITE)
      SEGMENT.setPixelColorXY(x2, y2, WHITE)
      SEGMENT.setPixelColorXY(x3, y3, WHITE)
    }
  }

  return FRAMETIME
}

// ---- Noise2D ------------------------------------------------------------------
export function mode_2Dnoise(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  const scale = SEGMENT.intensity + 2

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const pixelHue8 = inoise8(x * scale, y * scale, Math.floor(strip.now / (16 - (SEGMENT.speed >> 4))))
      SEGMENT.setPixelColorXY(x, y, ColorFromPalette(SEGPALETTE(), pixelHue8))
    }
  }

  return FRAMETIME
}

// ---- Pulser -------------------------------------------------------------------
export function mode_2DPulser(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  SEGMENT.fadeToBlackBy(8 - (SEGMENT.intensity >> 5))
  const a = Math.floor(strip.now / (18 - (SEGMENT.speed >> 4)))
  const x = Math.floor(a / 14) % cols
  const y = map(sin8_t(a * 5) + sin8_t(a * 4) + sin8_t(a * 2), 0, 765, rows - 1, 0)
  SEGMENT.setPixelColorXY(x, y, ColorFromPalette(SEGPALETTE(), map(y, 0, rows - 1, 0, 255), 255, LINEARBLEND))

  SEGMENT.blur(SEGMENT.intensity >> 4)

  return FRAMETIME
}

// ---- Squared Swirl ------------------------------------------------------------
export function mode_2Dsquaredswirl(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  const kBorderWidth = 2

  SEGMENT.fadeToBlackBy(24)
  SEGMENT.blur(SEGMENT.custom3 >> 1)

  const i = beatsin8_t(19, kBorderWidth, cols - kBorderWidth)
  const j = beatsin8_t(22, kBorderWidth, cols - kBorderWidth)
  const k = beatsin8_t(17, kBorderWidth, cols - kBorderWidth)
  const m = beatsin8_t(18, kBorderWidth, rows - kBorderWidth)
  const n = beatsin8_t(15, kBorderWidth, rows - kBorderWidth)
  const p = beatsin8_t(20, kBorderWidth, rows - kBorderWidth)

  SEGMENT.addPixelColorXY(i, m, ColorFromPalette(SEGPALETTE(), Math.floor(strip.now / 29), 255, LINEARBLEND))
  SEGMENT.addPixelColorXY(j, n, ColorFromPalette(SEGPALETTE(), Math.floor(strip.now / 41), 255, LINEARBLEND))
  SEGMENT.addPixelColorXY(k, p, ColorFromPalette(SEGPALETTE(), Math.floor(strip.now / 73), 255, LINEARBLEND))

  return FRAMETIME
}

// ---- Spaceships ---------------------------------------------------------------
export function mode_2Dspaceships(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  const tb = strip.now >>> 12
  if (tb > SEGMENT.step) {
    SEGMENT.aux0 = u16(SEGMENT.aux0 + 1)
    let dir = SEGMENT.aux0
    dir += random8(3) - 1
    if (dir > 7) SEGMENT.aux0 = 0
    else if (dir < 0) SEGMENT.aux0 = 7
    else SEGMENT.aux0 = dir
    SEGMENT.step = u32(tb + random8(4))
  }

  SEGMENT.fadeToBlackBy(map(SEGMENT.speed, 0, 255, 248, 16))
  SEGMENT.move(SEGMENT.aux0, 1)

  for (let i = 0; i < 8; i++) {
    const x = beatsin8_t(12 + i, 2, cols - 3)
    const y = beatsin8_t(15 + i, 2, rows - 3)
    const color = ColorFromPalette(SEGPALETTE(), beatsin8_t(12 + i, 0, 255), 255)
    SEGMENT.addPixelColorXY(x, y, color)
    if (cols > 24 || rows > 24) {
      SEGMENT.addPixelColorXY(x + 1, y, color)
      SEGMENT.addPixelColorXY(x - 1, y, color)
      SEGMENT.addPixelColorXY(x, y + 1, color)
      SEGMENT.addPixelColorXY(x, y - 1, color)
    }
  }
  SEGMENT.blur(SEGMENT.intensity >> 3)

  return FRAMETIME
}

// ---- Crazy Bees ---------------------------------------------------------------
const MAX_BEES = 5
// struct Bee { uint8_t posX, posY, aimX, aimY, hue; int8_t deltaX, deltaY, signX, signY, error; } -- 10 bytes
const BEE_SIZE = 10
function beeAimed(d: DataView, o: number, w: number, h: number): void {
  d.setUint8(o + 2, random8(0, w)) // aimX
  d.setUint8(o + 3, random8(0, h)) // aimY
  d.setUint8(o + 4, random8()) // hue
  const posX = d.getUint8(o), posY = d.getUint8(o + 1), aimX = d.getUint8(o + 2), aimY = d.getUint8(o + 3)
  d.setInt8(o + 5, Math.abs(aimX - posX)) // deltaX
  d.setInt8(o + 6, Math.abs(aimY - posY)) // deltaY
  d.setInt8(o + 7, posX < aimX ? 1 : -1) // signX
  d.setInt8(o + 8, posY < aimY ? 1 : -1) // signY
  d.setInt8(o + 9, d.getInt8(o + 5) - d.getInt8(o + 6)) // error
}

export function mode_2Dcrazybees(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  const n = u8(Math.min(MAX_BEES, div(rows * cols, 256) + 1))

  if (!SEGMENT.allocateData(BEE_SIZE * MAX_BEES)) return mode_static()
  const d = SEGMENT.dataView as DataView

  if (SEGMENT.call === 0) {
    random16_set_seed(strip.now)
    for (let i = 0; i < n; i++) {
      const o = i * BEE_SIZE
      d.setUint8(o, random8(0, cols))
      d.setUint8(o + 1, random8(0, rows))
      beeAimed(d, o, cols, rows)
    }
  }

  if (strip.now > SEGMENT.step) {
    SEGMENT.step = u32(strip.now + div(FRAMETIME * 16, (SEGMENT.speed >> 4) + 1))

    SEGMENT.fadeToBlackBy(32)

    for (let i = 0; i < n; i++) {
      const o = i * BEE_SIZE
      const aimX = d.getUint8(o + 2), aimY = d.getUint8(o + 3), hue = d.getUint8(o + 4)
      SEGMENT.addPixelColorXY(aimX + 1, aimY, new CRGB(new CHSV(hue, 255, 255)))
      SEGMENT.addPixelColorXY(aimX, aimY + 1, new CRGB(new CHSV(hue, 255, 255)))
      SEGMENT.addPixelColorXY(aimX - 1, aimY, new CRGB(new CHSV(hue, 255, 255)))
      SEGMENT.addPixelColorXY(aimX, aimY - 1, new CRGB(new CHSV(hue, 255, 255)))
      const posX = d.getUint8(o), posY = d.getUint8(o + 1)
      if (posX !== aimX || posY !== aimY) {
        SEGMENT.setPixelColorXY(posX, posY, new CRGB(new CHSV(hue, 60, 255)))
        const error2 = d.getInt8(o + 9) * 2
        if (error2 > -d.getInt8(o + 6)) {
          d.setInt8(o + 9, i8(d.getInt8(o + 9) - d.getInt8(o + 6)))
          d.setUint8(o, u8(d.getUint8(o) + d.getInt8(o + 7)))
        }
        if (error2 < d.getInt8(o + 5)) {
          d.setInt8(o + 9, i8(d.getInt8(o + 9) + d.getInt8(o + 5)))
          d.setUint8(o + 1, u8(d.getUint8(o + 1) + d.getInt8(o + 8)))
        }
      } else {
        beeAimed(d, o, cols, rows)
      }
    }
    SEGMENT.blur(SEGMENT.intensity >> 4)
  }
  return FRAMETIME
}

// ---- Ghost Rider --------------------------------------------------------------
const LIGHTERS_AM = 64
// struct Lighter, byte offsets as the C++ lays it out (586 bytes)
const L_GPOSX = 0, L_GPOSY = 2, L_GANGLE = 4, L_ANGLESPEED = 6
const L_POSX = 8, L_POSY = L_POSX + 2 * LIGHTERS_AM, L_ANGLE = L_POSY + 2 * LIGHTERS_AM, L_TIME = L_ANGLE + 2 * LIGHTERS_AM
const L_REG = L_TIME + 2 * LIGHTERS_AM, L_VSPEED = L_REG + LIGHTERS_AM
const LIGHTER_SIZE = L_VSPEED + 2

export function mode_2Dghostrider(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  if (!SEGMENT.allocateData(LIGHTER_SIZE)) return mode_static()
  const d = SEGMENT.dataView as DataView
  const posX = (i: number): number => d.getUint16(L_POSX + 2 * i, true)
  const posY = (i: number): number => d.getUint16(L_POSY + 2 * i, true)
  const time = (i: number): number => d.getUint16(L_TIME + 2 * i, true)

  const maxLighters = Math.min(cols + rows, LIGHTERS_AM)

  if (SEGMENT.aux0 !== cols || SEGMENT.aux1 !== rows) {
    SEGMENT.aux0 = cols
    SEGMENT.aux1 = rows
    d.setInt8(L_ANGLESPEED, random8(0, 20) - 10)
    d.setUint16(L_GANGLE, random16(), true)
    d.setInt8(L_VSPEED, 5)
    d.setInt16(L_GPOSX, div(cols, 2) * 10, true)
    d.setInt16(L_GPOSY, div(rows, 2) * 10, true)
    for (let i = 0; i < maxLighters; i++) {
      d.setUint16(L_POSX + 2 * i, d.getInt16(L_GPOSX, true), true)
      d.setUint16(L_POSY + 2 * i, d.getInt16(L_GPOSY, true) + i, true)
      d.setUint16(L_TIME + 2 * i, i * 2, true)
      d.setUint8(L_REG + i, 0)
    }
  }

  if (strip.now > SEGMENT.step) {
    SEGMENT.step = u32(strip.now + div(1024, cols + rows))

    SEGMENT.fadeToBlackBy((SEGMENT.speed >> 2) + 64)

    const color = new CRGB(CRGB.White)
    SEGMENT.wu_pixel(div(d.getInt16(L_GPOSX, true) * 256, 10), div(d.getInt16(L_GPOSY, true) * 256, 10), color)

    const gAngle = d.getUint16(L_GANGLE, true)
    const Vspeed = d.getInt8(L_VSPEED)
    d.setInt16(L_GPOSX, ftoi(f32(d.getInt16(L_GPOSX, true) + f32(Vspeed * sin_t(f32(radians(gAngle)))))), true)
    d.setInt16(L_GPOSY, ftoi(f32(d.getInt16(L_GPOSY, true) + f32(Vspeed * cos_t(f32(radians(gAngle)))))), true)
    d.setUint16(L_GANGLE, gAngle + d.getInt8(L_ANGLESPEED), true)
    if (d.getInt16(L_GPOSX, true) < 0) d.setInt16(L_GPOSX, (cols - 1) * 10, true)
    if (d.getInt16(L_GPOSX, true) > (cols - 1) * 10) d.setInt16(L_GPOSX, 0, true)
    if (d.getInt16(L_GPOSY, true) < 0) d.setInt16(L_GPOSY, (rows - 1) * 10, true)
    if (d.getInt16(L_GPOSY, true) > (rows - 1) * 10) d.setInt16(L_GPOSY, 0, true)
    for (let i = 0; i < maxLighters; i++) {
      d.setUint16(L_TIME + 2 * i, time(i) + random8(5, 20), true)
      if (time(i) >= 255 || posX(i) <= 0 || posX(i) >= (cols - 1) * 10 || posY(i) <= 0 || posY(i) >= (rows - 1) * 10) {
        d.setUint8(L_REG + i, 1)
      }
      if (d.getUint8(L_REG + i)) {
        d.setUint16(L_POSY + 2 * i, d.getInt16(L_GPOSY, true), true)
        d.setUint16(L_POSX + 2 * i, d.getInt16(L_GPOSX, true), true)
        d.setUint16(L_ANGLE + 2 * i, d.getUint16(L_GANGLE, true) + (random8(20) - 10), true)
        d.setUint16(L_TIME + 2 * i, 0, true)
        d.setUint8(L_REG + i, 0)
      } else {
        const ang = d.getUint16(L_ANGLE + 2 * i, true)
        d.setUint16(L_POSX + 2 * i, ftoi(f32(posX(i) + f32(-7 * sin_t(f32(radians(ang)))))), true)
        d.setUint16(L_POSY + 2 * i, ftoi(f32(posY(i) + f32(-7 * cos_t(f32(radians(ang)))))), true)
      }
      SEGMENT.wu_pixel(div(posX(i) * 256, 10), div(posY(i) * 256, 10), ColorFromPalette(SEGPALETTE(), 256 - time(i)))
    }
    SEGMENT.blur(SEGMENT.intensity >> 3)
  }

  return FRAMETIME
}

// ---- Blobs --------------------------------------------------------------------
const MAX_BLOBS = 8
// struct Blob { float x[8], y[8], sX[8], sY[8], r[8]; bool grow[8]; byte color[8]; } -- 176 bytes
const B_X = 0, B_Y = 32, B_SX = 64, B_SY = 96, B_R = 128, B_GROW = 160, B_COLOR = 168, BLOB_SIZE = 176

export function mode_2Dfloatingblobs(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  const Amount = (SEGMENT.intensity >> 5) + 1

  if (!SEGMENT.allocateData(BLOB_SIZE)) return mode_static()
  const d = SEGMENT.dataView as DataView
  const gf = (base: number, i: number): number => d.getFloat32(base + 4 * i, true)
  const sf = (base: number, i: number, v: number): void => d.setFloat32(base + 4 * i, v, true)

  if (SEGMENT.aux0 !== cols || SEGMENT.aux1 !== rows) {
    SEGMENT.aux0 = cols
    SEGMENT.aux1 = rows
    for (let i = 0; i < MAX_BLOBS; i++) {
      sf(B_R, i, random8(1, cols > 8 ? div(cols, 4) : 2))
      sf(B_SX, i, f32(random8(3, cols) / (256 - SEGMENT.speed)))
      sf(B_SY, i, f32(random8(3, rows) / (256 - SEGMENT.speed)))
      sf(B_X, i, random8(0, cols - 1))
      sf(B_Y, i, random8(0, rows - 1))
      d.setUint8(B_COLOR + i, random8())
      d.setUint8(B_GROW + i, gf(B_R, i) < 1 ? 1 : 0)
      if (gf(B_SX, i) === 0) sf(B_SX, i, 1)
      if (gf(B_SY, i) === 0) sf(B_SY, i, 1)
    }
  }

  SEGMENT.fadeToBlackBy((SEGMENT.custom2 >> 3) + 1)

  for (let i = 0; i < Amount; i++) {
    if (SEGMENT.step < strip.now) d.setUint8(B_COLOR + i, add8(d.getUint8(B_COLOR + i), 4))
    const sX = gf(B_SX, i), sY = gf(B_SY, i)
    const m = fabsf(sX) > fabsf(sY) ? fabsf(sX) : fabsf(sY)
    if (d.getUint8(B_GROW + i)) {
      sf(B_R, i, f32(gf(B_R, i) + f32(m * f32(0.05))))
      if (gf(B_R, i) >= Math.min(f32(cols / 4), 2)) {
        d.setUint8(B_GROW + i, 0)
      }
    } else {
      sf(B_R, i, f32(gf(B_R, i) - f32(m * f32(0.05))))
      if (gf(B_R, i) < 1) {
        d.setUint8(B_GROW + i, 1)
      }
    }
    const c = SEGMENT.color_from_palette(d.getUint8(B_COLOR + i), false, false, 0)
    const r = gf(B_R, i)
    if (r > 1) SEGMENT.fillCircle(ftoi(roundf(gf(B_X, i))), ftoi(roundf(gf(B_Y, i))), ftoi(roundf(r)), c)
    else SEGMENT.setPixelColorXY(ftoi(roundf(gf(B_X, i))), ftoi(roundf(gf(B_Y, i))), c)
    // move x
    let x = gf(B_X, i)
    if (f32(x + r) >= cols - 1) x = f32(x + f32(sX * f32(f32(f32(cols - 1 - x) / r) + f32(0.005))))
    else if (f32(x - r) <= 0) x = f32(x + f32(sX * f32(f32(x / r) + f32(0.005))))
    else x = f32(x + sX)
    sf(B_X, i, x)
    // move y
    let y = gf(B_Y, i)
    if (f32(y + r) >= rows - 1) y = f32(y + f32(sY * f32(f32(f32(rows - 1 - y) / r) + f32(0.005))))
    else if (f32(y - r) <= 0) y = f32(y + f32(sY * f32(f32(y / r) + f32(0.005))))
    else y = f32(y + sY)
    sf(B_Y, i, y)
    // bounce x
    if (gf(B_X, i) < f32(0.01)) {
      sf(B_SX, i, f32(random8(3, cols) / (256 - SEGMENT.speed)))
      sf(B_X, i, f32(0.01))
    } else if (gf(B_X, i) > f32(cols - f32(1.01))) {
      sf(B_SX, i, f32(random8(3, cols) / (256 - SEGMENT.speed)))
      sf(B_SX, i, -gf(B_SX, i))
      sf(B_X, i, f32(cols - f32(1.01)))
    }
    // bounce y
    if (gf(B_Y, i) < f32(0.01)) {
      sf(B_SY, i, f32(random8(3, rows) / (256 - SEGMENT.speed)))
      sf(B_Y, i, f32(0.01))
    } else if (gf(B_Y, i) > f32(rows - f32(1.01))) {
      sf(B_SY, i, f32(random8(3, rows) / (256 - SEGMENT.speed)))
      sf(B_SY, i, -gf(B_SY, i))
      sf(B_Y, i, f32(rows - f32(1.01)))
    }
  }
  SEGMENT.blur(SEGMENT.custom1 >> 2)

  if (SEGMENT.step < strip.now) SEGMENT.step = u32(strip.now + 2000)

  return FRAMETIME
}

// ---- Drift Rose ---------------------------------------------------------------
export function mode_2Ddriftrose(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  const CX = f32(f32((cols - (cols % 2)) / 2) - f32(0.5))
  const CY = f32(f32((rows - (rows % 2)) / 2) - f32(0.5))
  const L = f32(Math.min(cols, rows) / 2)

  SEGMENT.fadeToBlackBy(32 + (SEGMENT.speed >> 3))
  for (let i = 1; i < 37; i++) {
    const angle = f32(radians(i * 10))
    const hi = u8(ftoi(f32(L * 2)))
    const x = u32(ftoi(f32(f32(CX + f32(sin_t(angle) * f32(beatsin8_t(i, 0, hi) - L))) * 255)))
    const y = u32(ftoi(f32(f32(CY + f32(cos_t(angle) * f32(beatsin8_t(i, 0, hi) - L))) * 255)))
    SEGMENT.wu_pixel(x, y, new CRGB(new CHSV(i * 10, 255, 255)))
  }
  SEGMENT.blur(SEGMENT.intensity >> 4)

  return FRAMETIME
}

// ---- Rotozoomer ---------------------------------------------------------------
export function mode_2Dplasmarotozoom(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  const dataSize = SEGMENT.length() + 4 // + sizeof(float)
  if (!SEGMENT.allocateData(dataSize)) return mode_static()
  const d = SEGMENT.dataView as DataView // float a at 0
  const plasma = SEGMENT.data as Uint8Array // plasma at 4..

  const ms = Math.floor(strip.now / 15)

  for (let j = 0; j < rows; j++) {
    const index = j * cols
    for (let i = 0; i < cols; i++) {
      if (SEGMENT.check1) plasma[4 + index + i] = u8(((i * 4) ^ (j * 4)) + Math.floor(ms / 6))
      else plasma[4 + index + i] = inoise8(i * 40, j * 40, ms)
    }
  }

  let a = d.getFloat32(0, true)
  const f = f32(f32(f32(f32(sin_t(f32(a / 2)) + f32((128 - SEGMENT.intensity) / 128)) + f32(1.1))) / f32(1.5))
  const kosinus = f32(cos_t(a) * f)
  const sinus = f32(sin_t(a) * f)
  for (let i = 0; i < cols; i++) {
    const u1 = f32(i * kosinus)
    const v1 = f32(i * sinus)
    for (let j = 0; j < rows; j++) {
      const u = u8(abs8(ftoi(f32(u1 - f32(j * sinus)))) % cols)
      const v = u8(abs8(ftoi(f32(v1 + f32(j * kosinus)))) % rows)
      SEGMENT.setPixelColorXY(i, j, SEGMENT.color_from_palette(plasma[4 + v * cols + u], false, PALETTE_SOLID_WRAP(), 255))
    }
  }
  a = f32(a - f32(f32(0.03) + f32((SEGMENT.speed - 128) * f32(0.0002))))
  if (a < f32(-6283.18530718)) a = f32(a + f32(6283.18530718))
  d.setFloat32(0, a, true)

  return FRAMETIME
}

// ---- Distortion Waves ---------------------------------------------------------
export function mode_2Ddistortionwaves(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  const speed = SEGMENT.speed >> 5
  const scale = SEGMENT.intensity >> 5

  const w = 2

  const a = Math.floor(strip.now / 32)
  const a2 = Math.floor(a / 2)
  const a3 = Math.floor(a / 3)

  const cx = beatsin8_t(10 - speed, 0, cols - 1) * scale
  const cy = beatsin8_t(12 - speed, 0, rows - 1) * scale
  const cx1 = beatsin8_t(13 - speed, 0, cols - 1) * scale
  const cy1 = beatsin8_t(15 - speed, 0, rows - 1) * scale
  const cx2 = beatsin8_t(17 - speed, 0, cols - 1) * scale
  const cy2 = beatsin8_t(14 - speed, 0, rows - 1) * scale

  // unsigned ((xo - cx)^2 + (yo - cy)^2) >> 7, wrapping like the C
  const d2 = (xo: number, yo: number, px: number, py: number): number => u32(Math.imul(u32(xo - px), u32(xo - px)) + Math.imul(u32(yo - py), u32(yo - py))) >>> 7

  let xoffs = 0
  for (let x = 0; x < cols; x++) {
    xoffs = u32(xoffs + scale)
    let yoffs = 0

    for (let y = 0; y < rows; y++) {
      yoffs = u32(yoffs + scale)

      const rdistort = cos8_t((cos8_t(((x << 3) + a) & 255) + cos8_t(((y << 3) - a2) & 255) + a3) & 255) >> 1
      const gdistort = cos8_t((cos8_t(((x << 3) - a2) & 255) + cos8_t(((y << 3) + a3) & 255) + a + 32) & 255) >> 1
      const bdistort = cos8_t((cos8_t(((x << 3) + a3) & 255) + cos8_t(((y << 3) - a) & 255) + a2 + 64) & 255) >> 1

      let valueR = u8(rdistort + w * (a - d2(xoffs, yoffs, cx, cy)))
      let valueG = u8(gdistort + w * (a2 - d2(xoffs, yoffs, cx1, cy1)))
      let valueB = u8(bdistort + w * (a3 - d2(xoffs, yoffs, cx2, cy2)))

      valueR = gamma8(cos8_t(valueR))
      valueG = gamma8(cos8_t(valueG))
      valueB = gamma8(cos8_t(valueB))

      SEGMENT.setPixelColorXY(x, y, RGBW32(valueR, valueG, valueB, 0))
    }
  }

  return FRAMETIME
}
