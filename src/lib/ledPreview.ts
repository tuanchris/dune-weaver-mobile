// What the LED ring looks like for an effect, for the LEDs tab's ring preview
// and the effect gallery. A still sketch, not a simulation: it shows each
// effect's colors and rough shape (a comet, every third LED, a gradient…) in
// the user's palette/colors, so choices read at a glance.
import { ledEffectInputs } from '../api/board'
import { LED_PALETTE_LIST } from './ledPalettes'

/** Aurora's own curtains when no palette is picked (Leds.cpp palAurora). Pacifica's
 * water is the ocean palette. Every $LED/Palette table is in ./ledPalettes. */
export const AURORA_FX = [0x001a0a, 0x003311, 0x004d1a, 0x006622, 0x00994d, 0x00cc66, 0x00ff7f, 0x2e8b57, 0x008080, 0x4b0082, 0x800080, 0x9400d3, 0x4b0082, 0x008080, 0x00994d, 0x003311]

/** $LED/Palette name -> firmware id (the LED_PALETTE_LIST index). Unknown names,
 * and "rainbow" (id 0's name on firmware before WLED's palettes), are 0. */
export function paletteId(name: string): number {
  return Math.max(0, LED_PALETTE_LIST.findIndex((p) => p.name === name))
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
  return tableColor(LED_PALETTE_LIST[paletteId(name)].colors, t)
}

/** A 16-entry table sampled at t; null = the hue wheel (the default palette). */
function tableColor(table: readonly number[] | null, t: number): string {
  if (!table) return hue(t * 360)
  const f = (((t % 1) + 1) % 1) * 16
  const i = Math.floor(f)
  return hex(mix(table[i % 16], table[(i + 1) % 16], f - i))
}

/** What `effect` draws under the Default palette, sampled at t (0..1): its own colors. */
export function defaultColor(effect: string, look: RingLook, t: number): string {
  switch (effect) {
    case 'fire':
      return paletteColor('heat', t)
    case 'pacifica':
      return paletteColor('ocean', t)
    case 'aurora':
      return tableColor(AURORA_FX, t)
    case 'lightning':
      return '#E8EEFF'
  }
  const u = ledEffectInputs(effect, look.wledPalettes)
  if (u.color2) return t < 0.5 ? look.color : look.color2
  if (u.color) return look.color
  return paletteColor('default', t) // the hue wheel
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
  /** The table has WLED's palettes (LED/Palettes in /sand_settings): a palette
   * then recolors the color effects too. Older firmware ignores it for them. */
  wledPalettes: boolean
  /** Ball tracker: where the ball is (0..1 around the ring), the glow size in
   * LEDs, and what renders behind it. `at` < 0: no ball to follow (a rectangular
   * table), so just the background, as the firmware shows. */
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
  const u = ledEffectInputs(effect, look.wledPalettes)
  // A picked palette replaces the effect's own first color (Leds::fxColor).
  const pal = u.palette && paletteId(look.palette) !== 0 ? look.palette : null
  const c1 = (t: number) => (pal ? paletteColor(pal, t) : look.color)

  switch (effect) {
    case 'off':
      return all(() => dark)
    case 'ball': {
      const b = look.ball ?? { at: 0, size: 3, bg: 'static' }
      const bg =
        b.bg === 'off' ? all(() => dark)
        : b.bg === 'static' ? all(() => lit(look.color2))
        : ringDots(b.bg, n, { ...look, ball: undefined })
      if (b.at < 0) return bg
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
      return all((i) => lit(paletteColor(pal ?? 'ocean', i / n)))
    case 'aurora':
      return all((i) => lit(pal ? paletteColor(pal, i / n) : tableColor(AURORA_FX, i / n)))
    case 'fire':
      return all((i) => lit(paletteColor(pal ?? 'heat', 1 - i / n)))
    case 'lightning':
      return all((i) => (i % 5 === 0 ? lit(pal ? paletteColor(pal, i / n) : '#E8EEFF') : dark))
    case 'theater':
      return all((i) => (i % 3 === 0 ? lit(c1(i / n)) : dark))
    case 'scan':
    case 'meteor':
    case 'running':
      return comet(c1(0))
    case 'sinelon':
    case 'juggle':
    case 'multicomet':
      return comet(paletteColor(look.palette, 0.3))
    case 'gradient':
      return all((i) => lit(hex(mix(toNum(c1(i / n)), toNum(look.color2), (i / n) * 2 > 1 ? 2 - (i / n) * 2 : (i / n) * 2))))
  }
  if (u.color2) return all((i) => lit(i < n / 2 ? c1(i / n) : look.color2))
  if (u.color) return all((i) => lit(c1(i / n)))
  if (u.palette) return all((i) => lit(paletteColor(look.palette, i / n)))
  return all((i) => lit(hue((i / n) * 360)))
}
