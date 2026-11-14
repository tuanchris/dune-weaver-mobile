// WLED effects, ported from WLED v0.15.3 wled00/FX.cpp (EUPL-1.2, redistributed
// under GPLv3 per its Article 5). A line-for-line mirror of the firmware's
// FluidNC/src/WledFx/fx_ref.cpp; tools/fx_parity.py (firmware repo) checks them.
//
// Reference batch: the patterns every other fx_*.ts follows.
import {
  BLACK, CRGBPalette16, ColorFromPalette, FRAMETIME, PALETTE_SOLID_WRAP, SEGCOLOR, SEGLEN, SEGMENT, beatsin8_t, f32, fabsf,
  inoise16, inoise8, map, mode_static, qsub8, sin8_t, strip, u32, u8,
} from './shim'

// ---- Blink ------------------------------------------------------------------
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

export function mode_blink(): number {
  return blink(SEGCOLOR(0), SEGCOLOR(1), false, true)
}

// ---- Noise 1 ------------------------------------------------------------------
export function mode_noise16_1(): number {
  const scale = 320
  SEGMENT.step = u32(SEGMENT.step + (1 + (SEGMENT.speed >> 4)))

  for (let i = 0; i < SEGLEN(); i++) {
    const shift_x = beatsin8_t(11)
    const shift_y = Math.floor(SEGMENT.step / 42)
    const real_x = u32((i + shift_x) * scale)
    const real_y = u32((i + shift_y) * scale)
    const real_z = SEGMENT.step
    const noise = inoise16(real_x, real_y, real_z) >> 8
    const index = sin8_t(noise * 3)

    SEGMENT.setPixelColor(i, SEGMENT.color_from_palette(index, false, PALETTE_SOLID_WRAP(), 0))
  }

  return FRAMETIME
}

// ---- Polar Lights (2D) -----------------------------------------------------------
const auroraPalette = new CRGBPalette16([
  0x000000, 0x003300, 0x006600, 0x009900, 0x00cc00, 0x00ff00, 0x33ff00, 0x66ff00, 0x99ff00, 0xccff00, 0xffff00, 0xffcc00, 0xff9900, 0xff6600, 0xff3300, 0xff0000,
])

export function mode_2DPolarLights(): number {
  if (!strip.isMatrix || !SEGMENT.is2D()) return mode_static()

  const cols = SEGMENT.virtualWidth()
  const rows = SEGMENT.virtualHeight()

  if (SEGMENT.call === 0) {
    SEGMENT.fill(BLACK)
    SEGMENT.step = 0
  }

  const adjustHeight = f32(map(rows, 8, 32, 28, 12))
  const adjScale = u32(map(cols, 8, 64, 310, 63))
  const _scale = u32(map(SEGMENT.intensity, 0, 255, 30, adjScale))
  const _speed = map(SEGMENT.speed, 0, 255, 128, 16) | 0

  for (let x = 0; x < cols; x++) {
    for (let y = 0; y < rows; y++) {
      SEGMENT.step = u32(SEGMENT.step + 1)
      // inoise8 takes uint16 args; qsub8's float arg converts like C (truncate)
      SEGMENT.setPixelColorXY(
        x,
        y,
        ColorFromPalette(
          auroraPalette,
          qsub8(inoise8((SEGMENT.step % 2) + x * _scale, y * 16 + (SEGMENT.step % 16), Math.floor(SEGMENT.step / _speed)), u8(Math.trunc(f32(fabsf(f32(f32(rows / 2) - y)) * adjustHeight)))),
        ),
      )
    }
  }

  return FRAMETIME
}
