// Runs one ported WLED effect onto a strip — a line-for-line port of the
// firmware's FluidNC/src/WledFx/WledFxRunner.cpp (pixel buffer, effect state,
// 2D matrix -> strip outline mapping). Each LedSim owns one Runner.
import { LED_PALETTE_LIST } from '../ledPalettes'
import { CRGBPalette16, Segment, cos16_t, random16_set_seed, setSegment, sin16_t, strip, type ModeFn } from './shim'

export interface FxInfo {
  name: string
  fn: ModeFn
  is2D: boolean
  c1: number
  c2: number
  c3: number
  /** bit 0..2 = check1..3 */
  checks: number
}

export const K_MATRIX = 16

export interface FxFrame {
  speed: number
  intensity: number
  color1: number // 0xRRGGBB
  color2: number
  palette: number // $LED/Palette id
  now: number // ms
  ring: boolean
}

// FastLED's PartyColors_p: WLED's Default palette where an effect asks for palette colors.
const K_PARTY = [0x5500ab, 0x84007c, 0xb5004b, 0xe5001b, 0xe81700, 0xb84700, 0xab7700, 0xabab00, 0xab5500, 0xdd2200, 0xf2000e, 0xc2003e, 0x8f0071, 0x5f00a1, 0x2f00d0, 0x0007f9]

export const seed = (s: number): void => random16_set_seed(s)

function sample(px: Uint32Array, x256: number, y256: number, out: Uint8Array, o: number): void {
  const lim = (K_MATRIX - 1) * 256
  x256 = x256 < 0 ? 0 : x256 > lim ? lim : x256
  y256 = y256 < 0 ? 0 : y256 > lim ? lim : y256
  const x0 = x256 >> 8, y0 = y256 >> 8, fx = x256 & 255, fy = y256 & 255
  const x1 = x0 + 1 < K_MATRIX ? x0 + 1 : x0, y1 = y0 + 1 < K_MATRIX ? y0 + 1 : y0
  const c00 = px[x0 + y0 * K_MATRIX], c10 = px[x1 + y0 * K_MATRIX], c01 = px[x0 + y1 * K_MATRIX], c11 = px[x1 + y1 * K_MATRIX]
  for (let k = 0, sh = 16; k < 3; k++, sh -= 8) {
    const v = ((c00 >>> sh) & 255) * (256 - fx) * (256 - fy) + ((c10 >>> sh) & 255) * fx * (256 - fy) + ((c01 >>> sh) & 255) * (256 - fx) * fy + ((c11 >>> sh) & 255) * fx * fy
    out[o + k] = Math.floor(v / 65536)
  }
}

function mapToStrip(px: Uint32Array, ring: boolean, rgb: Uint8Array, n: number): void {
  const c = (K_MATRIX - 1) * 128
  const side = (K_MATRIX - 1) * 256
  for (let i = 0; i < n; i++) {
    let x: number, y: number
    if (ring) {
      const t = Math.floor((i * 65536) / n) & 0xffff
      x = c + Math.trunc((c * sin16_t(t)) / 32767)
      y = c - Math.trunc((c * cos16_t(t)) / 32767)
    } else {
      let s = Math.trunc((i * side * 4) / n) + side / 2
      s %= side * 4
      if (s < side) { x = s; y = 0 } else if (s < 2 * side) { x = side; y = s - side } else if (s < 3 * side) { x = 3 * side - s; y = side } else { x = 0; y = 4 * side - s }
    }
    sample(px, x, y, rgb, 3 * i)
  }
}

export class Runner {
  private seg: Segment | null = null
  private fx: FxInfo | null = null
  private n = 0

  release(): void {
    this.seg = null
    this.fx = null
    this.n = 0
  }

  /** One frame of `fx` into rgb (n LEDs x R,G,B). Another fx (or n) restarts it. */
  render(fx: FxInfo, f: FxFrame, rgb: Uint8Array, n: number): boolean {
    if (fx !== this.fx || n !== this.n) {
      this.release()
      const seg = new Segment()
      seg._px = new Uint32Array(fx.is2D ? K_MATRIX * K_MATRIX : n)
      seg._w = fx.is2D ? K_MATRIX : n
      seg._h = fx.is2D ? K_MATRIX : 1
      this.seg = seg
      this.fx = fx
      this.n = n
    }
    const seg = this.seg!
    seg.speed = f.speed & 255
    seg.intensity = f.intensity & 255
    seg.custom1 = fx.c1
    seg.custom2 = fx.c2
    seg.custom3 = fx.c3
    seg.check1 = (fx.checks & 1) !== 0
    seg.check2 = (fx.checks & 2) !== 0
    seg.check3 = (fx.checks & 4) !== 0
    seg.colors[0] = f.color1 & 0xffffff
    seg.colors[1] = f.color2 & 0xffffff
    seg.colors[2] = 0
    seg.palette = f.palette < LED_PALETTE_LIST.length ? f.palette : 0
    seg._currentPalette = new CRGBPalette16(seg.palette === 0 ? K_PARTY : LED_PALETTE_LIST[seg.palette].colors!)

    setSegment(seg)
    strip.now = f.now >>> 0
    strip.isMatrix = fx.is2D
    if (f.now > seg.next_time || seg.call === 0) {
      const delay = fx.fn() & 0xffff
      seg.next_time = (f.now + delay) >>> 0
      seg.call++
    }

    if (fx.is2D) mapToStrip(seg._px, f.ring, rgb, n)
    else {
      for (let i = 0; i < n; i++) {
        const c = seg._px[i]
        rgb[3 * i] = (c >>> 16) & 255
        rgb[3 * i + 1] = (c >>> 8) & 255
        rgb[3 * i + 2] = c & 255
      }
    }
    return true
  }
}
