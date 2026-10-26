// What the LED ring looks like for an effect, for the LEDs tab's ring preview
// and the effect gallery. A still sketch, not a simulation: it shows each
// effect's colors and rough shape (a comet, every third LED, a gradient…) in
// the user's palette/colors, so choices read at a glance.
import { ledEffectInputs } from '../api/board'

/** The firmware's 16-entry gradient palettes, mirrored from Leds.cpp (palOcean…palSunset,
 * palAurora). Keep in step with the firmware. "rainbow" is the hue wheel. */
export const PALETTES: Record<string, number[]> = {
  ocean: [0x191970, 0x00008b, 0x191970, 0x000080, 0x00008b, 0x0000cd, 0x2e8b57, 0x008080, 0x5f9ea0, 0x0000ff, 0x008b8b, 0x6495ed, 0x7fffd4, 0x2e8b57, 0x00ffff, 0x87cefa],
  lava: [0x000000, 0x800000, 0x000000, 0x800000, 0x8b0000, 0x800000, 0x8b0000, 0x8b0000, 0x8b0000, 0x8b0000, 0xff0000, 0xffa500, 0xffffff, 0xffa500, 0xff0000, 0x8b0000],
  forest: [0x006400, 0x006400, 0x556b2f, 0x006400, 0x008000, 0x228b22, 0x6b8e23, 0x008000, 0x2e8b57, 0x66cdaa, 0x32cd32, 0x9acd32, 0x90ee90, 0x7cfc00, 0x66cdaa, 0x228b22],
  party: [0x5500ab, 0x84007c, 0xb5004b, 0xe5001b, 0xe81700, 0xb84700, 0xab7700, 0xabab00, 0xab5500, 0xdd2200, 0xf2000e, 0xc2003e, 0x8f0071, 0x5f00a1, 0x2f00d0, 0x0700e9],
  cloud: [0x0000ff, 0x00008b, 0x00008b, 0x00008b, 0x00008b, 0x00008b, 0x00008b, 0x00008b, 0x0000ff, 0x00008b, 0x87ceeb, 0x87ceeb, 0xadd8e6, 0xffffff, 0xadd8e6, 0x87ceeb],
  heat: [0x000000, 0x330000, 0x660000, 0x990000, 0xcc0000, 0xff0000, 0xff3300, 0xff6600, 0xff9900, 0xffcc00, 0xffff00, 0xffff33, 0xffff66, 0xffff99, 0xffffcc, 0xffffff],
  sunset: [0x00008b, 0x4b0082, 0x800080, 0xc71585, 0xff1493, 0xff4500, 0xff8c00, 0xffd700, 0xffa500, 0xff4500, 0xc71585, 0x800080, 0x4b0082, 0x191970, 0x00008b, 0x000033],
  aurora: [0x001a0a, 0x003311, 0x004d1a, 0x006622, 0x00994d, 0x00cc66, 0x00ff7f, 0x2e8b57, 0x008080, 0x4b0082, 0x800080, 0x9400d3, 0x4b0082, 0x008080, 0x00994d, 0x003311],
}

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0').toUpperCase()
const toNum = (h: string) => parseInt(h.replace(/^#/, ''), 16) || 0

function mix(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t) << s
  return ch(16) | ch(8) | ch(0)
}

function hue(deg: number): string {
  const h = ((deg % 360) + 360) % 360 / 60
  const x = 1 - Math.abs((h % 2) - 1)
  const [r, g, b] = h < 1 ? [1, x, 0] : h < 2 ? [x, 1, 0] : h < 3 ? [0, 1, x] : h < 4 ? [0, x, 1] : h < 5 ? [x, 0, 1] : [1, 0, x]
  return hex((Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255))
}

/** A palette sampled at t (0..1, wrapping), interpolated like the firmware. */
export function paletteColor(name: string, t: number): string {
  const table = PALETTES[name]
  if (!table) return hue(t * 360) // rainbow (and anything unknown)
  const f = (((t % 1) + 1) % 1) * 16
  const i = Math.floor(f)
  return hex(mix(table[i % 16], table[(i + 1) % 16], f - i))
}

/** One LED: its color and how lit it is (0 = dark). */
export interface Dot {
  c: string
  a: number
}

export interface RingLook {
  color: string
  color2: string
  palette: string
  /** Ball tracker: where the ball is (0..1 around the ring), the glow size in
   * LEDs, and what renders behind it. */
  ball?: { at: number; size: number; bg: string }
}

/** The ring's n LEDs for `effect`, starting at 12 o'clock, clockwise. */
export function ringDots(effect: string, n: number, look: RingLook): Dot[] {
  const all = (f: (i: number) => Dot): Dot[] => Array.from({ length: n }, (_, i) => f(i))
  const lit = (c: string): Dot => ({ c, a: 1 })
  const dark: Dot = { c: '#000000', a: 0 }
  // A comet: a bright head with a fading tail, a quarter of the way round.
  const comet = (c: string, len = Math.max(3, Math.round(n / 5))) =>
    all((i) => (i < len ? { c, a: 1 - i / len } : dark))
  const u = ledEffectInputs(effect)

  switch (effect) {
    case 'off':
      return all(() => dark)
    case 'ball': {
      const b = look.ball ?? { at: 0, size: 3, bg: 'static' }
      const bg =
        b.bg === 'off' ? all(() => dark)
        : b.bg === 'static' ? all(() => lit(look.color2))
        : ringDots(b.bg, n, { ...look, ball: undefined })
      const head = Math.round(b.at * n)
      const half = Math.max(1, b.size) / 2
      return bg.map((d, i) => {
        const dist = Math.min(Math.abs(i - head), n - Math.abs(i - head))
        return dist <= half ? lit(look.color) : { ...d, a: d.a * 0.35 }
      })
    }
    case 'police':
      return all((i) => lit(i < n / 2 ? '#FF0000' : '#0030FF'))
    case 'pride':
      return all((i) => lit(hue((i / n) * 360)))
    case 'pacifica':
      return all((i) => lit(paletteColor('ocean', i / n)))
    case 'aurora':
      return all((i) => lit(paletteColor('aurora', i / n)))
    case 'lightning':
      return all((i) => (i % 5 === 0 ? lit('#E8EEFF') : dark))
    case 'theater':
      return all((i) => (i % 3 === 0 ? lit(look.color) : dark))
    case 'scan':
    case 'meteor':
    case 'running':
      return comet(look.color)
    case 'sinelon':
    case 'juggle':
    case 'multicomet':
      return comet(paletteColor(look.palette, 0.3))
    case 'gradient':
      return all((i) => lit(hex(mix(toNum(look.color), toNum(look.color2), (i / n) * 2 > 1 ? 2 - (i / n) * 2 : (i / n) * 2))))
  }
  if (u.color2) return all((i) => lit(i < n / 2 ? look.color : look.color2))
  if (u.color) return all(() => lit(look.color))
  if (u.palette) return all((i) => lit(paletteColor(look.palette, i / n)))
  return all((i) => lit(hue((i / n) * 360)))
}
