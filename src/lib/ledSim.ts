// The firmware's LED effects, ported to run in the app: a line-for-line port of
// Leds::renderEffect (dune-weaver-firmware FluidNC/src/Leds.cpp), so the LEDs
// tab animates the SAME math the strip runs — same speed and intensity meanings,
// same palettes (lib/ledPreview.ts PALETTES). Keep it in step with the firmware:
// a change to an effect there is a change here.
//
// C semantics made explicit: uint8_t = `& 255`, uint32_t phase = `>>> 0`,
// integer division = `Math.trunc` (`div`). One step() = one firmware frame
// (frame_ms, 33 ms by default); the strip's master brightness is NOT applied
// here — the ring view does that.
import { PALETTES } from './ledPreview'
import type { Dot } from './ledPreview'

const FRAME_MS = 33 // config.yaml leds: frame_ms default — the app can't read the table's
const K_BALLS = 5 // Leds.h kBalls
const PALETTE_IDS = ['rainbow', 'ocean', 'lava', 'forest', 'party', 'cloud', 'heat', 'sunset']
export const SIM_FRAME_MS = FRAME_MS

export interface SimParams {
  effect: string
  speed: number // 1..255
  intensity: number // 0..255
  palette: string
  color: string // #RRGGBB
  color2: string
  ball: { bg: string; bgBright: number; bright: number; size: number; dir: 'cw' | 'ccw'; align: number; angle: number /* 0..1 */ }
}

type Rgb = [number, number, number]
const u8 = (v: number) => v & 255
const div = (a: number, b: number) => Math.trunc(a / b)
const rgbOf = (hex: string): Rgb => {
  const n = parseInt(hex.replace(/^#/, ''), 16) || 0
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const sin8 = (t: number) => Math.floor(Math.sin(u8(t) * ((2 * Math.PI) / 256)) * 127.5 + 127.5) & 255
const scale8 = (v: number, s: number) => (u8(v) * (u8(s) + 1)) >> 8
const qadd8 = (a: number, b: number) => Math.min(255, a + b)
const qsub8 = (a: number, b: number) => Math.max(0, a - b)
const lerp8 = (a: number, b: number, t: number) => u8(a + (((b - a) * u8(t)) >> 8))

function wheel(pos: number): Rgb {
  pos = 255 - u8(pos)
  if (pos < 85) return [255 - pos * 3, 0, pos * 3]
  if (pos < 170) {
    pos -= 85
    return [0, pos * 3, 255 - pos * 3]
  }
  pos -= 170
  return [pos * 3, 255 - pos * 3, 0]
}

function heatColor(heat: number): Rgb {
  const t192 = scale8(heat, 191)
  const ramp = (t192 & 0x3f) << 2
  if (t192 & 0x80) return [255, 255, ramp]
  if (t192 & 0x40) return [255, ramp, 0]
  return [ramp, 0, 0]
}

function sampleTable(pal: number[], index: number): Rgb {
  const e = u8(index) >> 4
  const f = (u8(index) & 0x0f) << 4
  const c0 = pal[e]
  const c1 = pal[(e + 1) & 15]
  return [lerp8((c0 >> 16) & 255, (c1 >> 16) & 255, f), lerp8((c0 >> 8) & 255, (c1 >> 8) & 255, f), lerp8(c0 & 255, c1 & 255, f)]
}

export class LedSim {
  readonly n: number
  private fb: Uint8Array
  private heat: Uint8Array
  private phase = 0 // uint32, 24.8 fixed point
  private rng = (0x1234abcd ^ (Date.now() * 2654435761)) >>> 0
  private candle = 200
  private aux = 0
  private step = 0
  private ballPos = new Float64Array(K_BALLS)
  private ballVel = new Float64Array(K_BALLS)
  private ballTrack = -1
  private last: string | null = null
  private lastBg: string | null = null
  // Resolved once per frame, like render().
  private ix = 128
  private pal = 0
  private c1: Rgb = [0, 0, 0]
  private c2: Rgb = [0, 0, 0]

  constructor(n: number) {
    this.n = Math.max(1, n)
    this.fb = new Uint8Array(this.n * 3)
    this.heat = new Uint8Array(this.n)
  }

  /** One firmware frame (Leds::render minus the hooks: the caller passes the effect showing). */
  frame(p: SimParams): void {
    this.ix = u8(p.intensity)
    this.pal = Math.max(0, PALETTE_IDS.indexOf(p.palette))
    this.c1 = rgbOf(p.color)
    this.c2 = rgbOf(p.color2)
    const speed = Math.max(1, Math.min(255, Math.round(p.speed)))
    this.phase = (this.phase + speed * 8) >>> 0
    this.render(p.effect, speed, false, p)
  }

  /** The framebuffer as `out` ring dots: hue at full value, lit-ness = the
   * brightest channel. Fewer dots than LEDs pool each dot's stretch of the strip
   * (brightest LED wins), so a one-LED comet head never falls between samples
   * and motion keeps the strip's real pace. */
  dots(out: number = this.n): Dot[] {
    const res: Dot[] = new Array(out)
    for (let i = 0; i < out; i++) {
      const a = Math.floor((i * this.n) / out)
      const b = Math.max(a + 1, Math.floor(((i + 1) * this.n) / out))
      let best = a
      let m = -1
      for (let j = a; j < b && j < this.n; j++) {
        const v = Math.max(this.fb[j * 3], this.fb[j * 3 + 1], this.fb[j * 3 + 2])
        if (v > m) {
          m = v
          best = j
        }
      }
      if (m <= 0) {
        res[i] = { c: '#000000', a: 0 }
        continue
      }
      const k = 255 / m
      const r = this.fb[best * 3], g = this.fb[best * 3 + 1], bl = this.fb[best * 3 + 2]
      res[i] = { c: `rgb(${Math.round(r * k)},${Math.round(g * k)},${Math.round(bl * k)})`, a: m / 255 }
    }
    return res
  }

  // ---- firmware helpers --------------------------------------------------
  private random8(lim?: number): number {
    let r = this.rng
    r = (r ^ (r << 13)) >>> 0
    r = (r ^ (r >>> 17)) >>> 0
    r = (r ^ (r << 5)) >>> 0
    this.rng = r
    const v = r & 255
    return lim === undefined ? v : (v * u8(lim)) >> 8
  }
  private set(i: number, r: number, g: number, b: number) {
    if (i < 0 || i >= this.n) return
    this.fb[i * 3] = u8(r)
    this.fb[i * 3 + 1] = u8(g)
    this.fb[i * 3 + 2] = u8(b)
  }
  private add(i: number, r: number, g: number, b: number) {
    if (i < 0 || i >= this.n) return
    this.fb[i * 3] = qadd8(this.fb[i * 3], u8(r))
    this.fb[i * 3 + 1] = qadd8(this.fb[i * 3 + 1], u8(g))
    this.fb[i * 3 + 2] = qadd8(this.fb[i * 3 + 2], u8(b))
  }
  private fadeBy(amount: number) {
    const keep = 256 - u8(amount)
    for (let i = 0; i < this.fb.length; i++) this.fb[i] = (this.fb[i] * keep) >> 8
  }
  private palColor(index: number): Rgb {
    return this.pal === 0 ? wheel(index) : sampleTable(PALETTES[PALETTE_IDS[this.pal]], index)
  }
  private ixMore(base: number) {
    return Math.min(255, div(base * this.ix, 128))
  }
  private ixFade(base: number) {
    return Math.min(255, div(base * 128, this.ix || 1))
  }
  private ixSpawns(base: number) {
    let n = 0
    for (let acc = div(base * this.ix, 128); acc > 0; acc -= 256) n += acc >= 256 || this.random8() < acc ? 1 : 0
    return n
  }

  // ---- Leds::renderEffect ------------------------------------------------
  private render(effect: string, speed: number, nested: boolean, p: SimParams): void {
    const n = this.n
    if (effect !== (nested ? this.lastBg : this.last)) {
      if (nested) this.lastBg = effect
      else this.last = effect
      this.fb.fill(0)
      this.heat.fill(0)
      this.candle = 200
      this.aux = 0
      this.step = 0
      for (let k = 0; k < K_BALLS; k++) {
        this.ballPos[k] = 0
        this.ballVel[k] = 4.4 - 0.5 * k
      }
      if (!nested) this.ballTrack = -1
    }
    const ph = this.phase
    const hi = (ph >>> 8) & 255
    const ix = this.ix
    const [r, g, b] = this.c1
    const [r2, g2, b2] = this.c2

    switch (effect) {
      case 'static':
        for (let i = 0; i < n; i++) this.set(i, r, g, b)
        return
      case 'rainbow': {
        const span = 16 << div(ix, 29)
        for (let i = 0; i < n; i++) this.set(i, ...this.palColor(hi + div(i * span, n)))
        return
      }
      case 'breathe': {
        const lvl = 16 + ((sin8(hi) * 239) >> 8)
        for (let i = 0; i < n; i++) this.set(i, (r * lvl) >> 8, (g * lvl) >> 8, (b * lvl) >> 8)
        return
      }
      case 'colorloop': {
        let [cr, cg, cb] = this.palColor(hi)
        if (ix < 128) {
          const w = 128 - ix
          cr = lerp8(cr, 255, w); cg = lerp8(cg, 255, w); cb = lerp8(cb, 255, w)
        }
        for (let i = 0; i < n; i++) this.set(i, cr, cg, cb)
        return
      }
      case 'theater': {
        const w = 2 + ((ix * ix + 4096) >> 14)
        const tick = (ph >>> 9) & 0xffff
        if (tick !== this.step) {
          this.step = tick
          this.aux = u8((this.aux + 1) % w)
        }
        const off = this.aux % w
        for (let i = 0; i < n; i++) i % w === off ? this.set(i, r, g, b) : this.set(i, 0, 0, 0)
        return
      }
      case 'scan': {
        this.fadeBy(90)
        const size = 1 + ((ix * ix * n) >> 18)
        const start = div(sin8(hi) * (n - size), 255)
        for (let j = 0; j < size; j++) this.set(start + j, r, g, b)
        return
      }
      case 'running': {
        const k = Math.max(1, (ix * ix + 8192) >> 14)
        for (let i = 0; i < n; i++) {
          const s = sin8(div(i * 256 * k, n) - hi)
          this.set(i, (r * s) >> 8, (g * s) >> 8, (b * s) >> 8)
        }
        return
      }
      case 'sine': {
        const k = Math.max(1, (ix * ix + 4096) >> 13)
        for (let i = 0; i < n; i++) {
          const s = sin8(div(i * 256 * k, n) + hi)
          this.set(i, (r * s) >> 8, (g * s) >> 8, (b * s) >> 8)
        }
        return
      }
      case 'gradient': {
        for (let i = 0; i < n; i++) {
          const t = u8(div(i * 256, n) + hi)
          const tri = this.ixFade(t < 128 ? t * 2 : (255 - t) * 2)
          this.set(i, lerp8(r, r2, tri), lerp8(g, g2, tri), lerp8(b, b2, tri))
        }
        return
      }
      case 'sinelon': {
        this.fadeBy(Math.min(255, div(5120, 256 - ix)))
        const pos = div(sin8(hi) * (n - 1), 255)
        this.add(pos, ...this.palColor(ph >>> 7))
        return
      }
      case 'twinkle': {
        const fade = div(28 * speed, 50)
        this.fadeBy(fade < 1 ? 1 : fade > 255 ? 255 : fade)
        for (let k = this.ixSpawns(50); k > 0; k--) {
          const c = this.palColor(this.random8())
          this.set(this.random8(n), ...c)
        }
        return
      }
      case 'sparkle': {
        for (let i = 0; i < n; i++) this.set(i, (r * 40) >> 8, (g * 40) >> 8, (b * 40) >> 8)
        if (this.aux === 0) {
          this.step = (this.random8() * n) >> 8
          this.aux = Math.min(255, div(10 + (255 - speed) * 2, FRAME_MS))
        } else {
          this.aux--
        }
        this.set(this.step, 255, 255, 255)
        return
      }
      case 'fire': {
        const cool = Math.min(255, div((20 + div(speed, 3)) * 16, n) + 2)
        for (let i = 0; i < n; i++) this.heat[i] = qsub8(this.heat[i], this.random8(cool))
        for (let k = n - 1; k >= 2; k--) this.heat[k] = div(this.heat[k - 1] + this.heat[k - 2] + this.heat[k - 2], 3)
        for (let s = this.ixSpawns(120); s > 0; s--) {
          const y = this.random8(n < 7 ? n : 7)
          this.heat[y] = qadd8(this.heat[y], this.random8(95) + 160)
        }
        for (let i = 0; i < n; i++) this.set(i, ...heatColor(this.heat[i]))
        return
      }
      case 'candle': {
        const depth = this.ixMore(155)
        const target = u8(255 - depth + this.random8(depth))
        const sh = speed > 252 ? 1 : speed > 99 ? 2 : speed > 49 ? 3 : 4
        this.candle = u8((this.candle * ((1 << sh) - 1) + target) >> sh)
        for (let i = 0; i < n; i++) this.set(i, (r * this.candle) >> 8, (g * this.candle) >> 8, (b * this.candle) >> 8)
        return
      }
      case 'meteor': {
        const decay = this.ixFade(40)
        this.fadeBy(qadd8(decay, this.random8(decay)))
        this.set((ph >>> 8) % n, r, g, b)
        return
      }
      case 'bouncing': {
        this.fadeBy(120)
        const dt = (FRAME_MS / 1000) * (speed / 50)
        const balls = 1 + div(ix * K_BALLS, 256)
        for (let k = 0; k < balls; k++) {
          this.ballVel[k] -= 9.8 * dt
          this.ballPos[k] += this.ballVel[k] * dt
          if (this.ballPos[k] < 0) {
            this.ballPos[k] = 0
            this.ballVel[k] = -this.ballVel[k] * 0.9
            if (this.ballVel[k] < 0.6) this.ballVel[k] = 4.4 - 0.5 * k
          }
          this.add(Math.trunc(this.ballPos[k] * (n - 1)), r, g, b)
        }
        return
      }
      case 'wipe': {
        const c: Rgb[] = [this.c1, this.c2]
        const w = (ix + 1) * 2
        const len = 128 * n + w
        let q = ph % (2 * len)
        const pass = q >= len ? 1 : 0
        q -= pass * len
        const nw = c[pass], od = c[pass ^ 1]
        for (let i = 0; i < n; i++) {
          const d = q - i * 128
          const t = d <= 0 ? 0 : d >= w ? 256 : div(d * 256, w)
          this.set(i, od[0] + (((nw[0] - od[0]) * t) >> 8), od[1] + (((nw[1] - od[1]) * t) >> 8), od[2] + (((nw[2] - od[2]) * t) >> 8))
        }
        return
      }
      case 'dualscan': {
        this.fadeBy(80)
        const size = 1 + ((ix * ix * n) >> 18)
        const start = div(sin8(hi) * (n - size), 255)
        for (let j = start; j < start + size; j++) {
          this.add(j, r, g, b)
          this.add(n - 1 - j, r2, g2, b2)
        }
        return
      }
      case 'juggle': {
        this.fadeBy(this.ixFade(40))
        for (let k = 0; k < 3; k++) {
          const pos = scale8(sin8((ph >>> 8) * (k + 2)), n - 1)
          this.add(pos, ...this.palColor(k * 85 + hi))
        }
        return
      }
      case 'multicomet': {
        this.fadeBy(Math.min(255, div(6144, 256 - ix)))
        for (let k = 0; k < 3; k++) {
          const pos = (div((ph >>> 8) * (k + 1), 2) + k * div(n, 3)) % n
          this.add(pos, ...this.palColor(k * 85))
        }
        return
      }
      case 'glitter': {
        for (let i = 0; i < n; i++) {
          const [cr, cg, cb] = this.palColor(hi + div(i * 256, n))
          this.set(i, (cr * 180) >> 8, (cg * 180) >> 8, (cb * 180) >> 8)
        }
        for (let s = this.ixSpawns(60); s > 0; s--) this.set(this.random8(n), 255, 255, 255)
        return
      }
      case 'dissolve': {
        const converts = this.ixSpawns(256 * (div(n, 12) + 1))
        for (let k = 0; k < converts; k++) this.heat[this.random8(n)] = this.aux ^ 1
        for (let i = 0; i < n; i++) this.heat[i] ? this.set(i, r2, g2, b2) : this.set(i, r, g, b)
        this.step = (this.step + 1) & 0xffff
        if (this.step * FRAME_MS > (255 - speed + 15) * 24) {
          this.aux ^= 1
          this.step = 0
        }
        return
      }
      case 'ripple': {
        this.fadeBy(40)
        const stepV = 0.5 * (speed / 50)
        const waves = 1 + div(ix * K_BALLS, 256)
        for (let k = 0; k < waves; k++) {
          if (this.ballVel[k] <= 0 || this.ballVel[k] > n / 2) {
            this.ballPos[k] = this.random8(n)
            this.ballVel[k] = 0.01
          }
          const center = Math.trunc(this.ballPos[k])
          const radius = Math.trunc(this.ballVel[k])
          const fade = 255 - scale8(Math.trunc((this.ballVel[k] * 512) / n), 255)
          const [cr, cg, cb] = this.palColor(center * 5)
          this.add((center + radius) % n, (cr * fade) >> 8, (cg * fade) >> 8, (cb * fade) >> 8)
          this.add((center - radius + n) % n, (cr * fade) >> 8, (cg * fade) >> 8, (cb * fade) >> 8)
          this.ballVel[k] += stepV
        }
        return
      }
      case 'drip': {
        this.fadeBy(60)
        const accel = 0.02 * (speed / 50)
        const drips = 1 + (ix >> 6)
        for (let k = 0; k < drips; k++) {
          this.ballVel[k] += accel
          this.ballPos[k] -= this.ballVel[k]
          if (this.ballPos[k] <= 0) {
            this.set(0, 255, 255, 255)
            this.set(1, (r * 128) >> 8, (g * 128) >> 8, (b * 128) >> 8)
            this.ballPos[k] = n - 1 - this.random8(div(n, 2))
            this.ballVel[k] = 0
          }
          this.add(Math.trunc(this.ballPos[k]), r, g, b)
        }
        return
      }
      case 'lightning': {
        this.fadeBy(120)
        if (this.aux === 0) {
          if (this.step > 0) this.step--
          else {
            this.aux = u8(1 + this.random8(div(ix, 20) + 1))
            this.candle = 0
          }
        }
        if (this.aux) {
          const was = this.candle
          this.candle = u8(this.candle - 1)
          if (was === 0) {
            this.aux--
            this.candle = 1 + this.random8(3)
            const start = this.random8(n)
            const len = 2 + this.random8(div(n, 3))
            for (let j = 0; j < len; j++) this.set((start + j) % n, 255, 255, 255)
            if (this.aux === 0) this.step = div(this.random8(255 - speed) * 100, FRAME_MS) & 0xffff
          }
        }
        return
      }
      case 'fireworks': {
        this.fadeBy(48)
        for (let s = this.ixSpawns(50); s > 0; s--) {
          const center = this.random8(n)
          const [cr, cg, cb] = this.palColor(this.random8())
          this.add(center, cr, cg, cb)
          this.add((center + 1) % n, cr >> 1, cg >> 1, cb >> 1)
          this.add((center - 1 + n) % n, cr >> 1, cg >> 1, cb >> 1)
        }
        return
      }
      case 'plasma': {
        const dip = scale8(sin8(ph >>> 10), 255 - ix)
        for (let i = 0; i < n; i++) {
          const x = u8(div(i * 256, n))
          const v = (sin8(x * 2 + hi) + sin8(x * 3 - hi * 2)) >> 1
          const bri = 255 - scale8(dip, 255 - v)
          const [cr, cg, cb] = this.palColor(v)
          this.set(i, scale8(cr, bri), scale8(cg, bri), scale8(cb, bri))
        }
        return
      }
      case 'heartbeat': {
        const w = Math.min(96, this.ixFade(32))
        let lvl = 24
        if (hi < w) lvl = sin8(div(hi * 128, w))
        else if (hi >= 96 && hi < 96 + w) lvl = sin8(div((hi - 96) * 128, w))
        for (let i = 0; i < n; i++) this.set(i, (r * lvl) >> 8, (g * lvl) >> 8, (b * lvl) >> 8)
        return
      }
      case 'strobe': {
        const on = hi < 32
        for (let i = 0; i < n; i++) on ? this.set(i, r, g, b) : this.set(i, 0, 0, 0)
        return
      }
      case 'police': {
        const phaseA = ((ph >>> 9) & 1) === 1
        const half = div(n, 2)
        for (let i = 0; i < n; i++) {
          const left = i < half
          if (left === phaseA) this.set(i, left ? 255 : 0, 0, left ? 0 : 255)
          else this.set(i, 0, 0, 0)
        }
        return
      }
      case 'chase': {
        for (let i = 0; i < n; i++) this.set(i, (r2 * 40) >> 8, (g2 * 40) >> 8, (b2 * 40) >> 8)
        const w = ix <= 128 ? 1 + div(ix, 64) : 3 + div((ix - 128) * n, 256)
        const pos = (ph >>> 8) % n
        for (let j = 0; j < w; j++) this.set((pos + j) % n, r, g, b)
        return
      }
      case 'railway': {
        const ramp = ix >> 1
        const u = hi & 127
        let pos = u >= ramp ? 255 : u8(div(u * 255, ramp))
        if (hi & 128) pos = 255 - pos
        for (let i = 0; i < n; i++) {
          const s = sin8(div(i * 256, n) - hi)
          const scale = 100 + ((s * 155) >> 8)
          const t = i & 1 ? pos : 255 - pos
          this.set(i, (lerp8(r2, r, t) * scale) >> 8, (lerp8(g2, g, t) * scale) >> 8, (lerp8(b2, b, t) * scale) >> 8)
        }
        return
      }
      case 'pacifica': {
        for (let i = 0; i < n; i++) {
          const x = i * (120 + ix)
          const a = sin8(div(x, 62) + (ph >>> 8))
          const c = sin8(div(x * 5, 248) - (ph >>> 7))
          const d = sin8(div(x * 3, 248) + (ph >>> 9))
          this.set(i, ...sampleTable(PALETTES.ocean, div(a + c + d, 3)))
          const cap = sin8(div(x * 9, 248) - (ph >>> 5))
          if (cap > 236) {
            const w = (cap - 236) * 8
            this.add(i, w, w, w)
          }
        }
        return
      }
      case 'aurora': {
        for (let i = 0; i < n; i++) {
          const x = i * (ix + 32)
          const a = sin8(div(x * 3, 160) + (ph >>> 8))
          const c = sin8(div(x, 80) - (ph >>> 9))
          const [cr, cg, cb] = sampleTable(PALETTES.aurora, div(a + c, 2))
          const w = sin8(div(x, 32) + (ph >>> 7))
          const bri = 40 + ((w * 215) >> 8)
          this.set(i, (cr * bri) >> 8, (cg * bri) >> 8, (cb * bri) >> 8)
        }
        return
      }
      case 'pride': {
        for (let i = 0; i < n; i++) {
          const [cr, cg, cb] = wheel((ph >>> 8) + i * 2)
          const bri = 60 + ((sin8(i * 7 + (ph >>> 6)) * 195) >> 8)
          this.set(i, (cr * bri) >> 8, (cg * bri) >> 8, (cb * bri) >> 8)
        }
        return
      }
      case 'colorwaves': {
        for (let i = 0; i < n; i++) {
          const [cr, cg, cb] = this.palColor((ph >>> 8) + ((i * 3 * ix) >> 7))
          const bri = 60 + ((sin8(i * 7 + (ph >>> 6)) * 195) >> 8)
          this.set(i, (cr * bri) >> 8, (cg * bri) >> 8, (cb * bri) >> 8)
        }
        return
      }
      case 'bpm': {
        const beat = sin8(ph >>> 6)
        for (let i = 0; i < n; i++) {
          const [cr, cg, cb] = this.palColor((ph >>> 8) + i * 3)
          const bri = Math.max(40, qsub8(beat, u8(i * 2)))
          this.set(i, (cr * bri) >> 8, (cg * bri) >> 8, (cb * bri) >> 8)
        }
        return
      }
      case 'ball': {
        const bg = p.ball.bg === 'ball' ? 'static' : p.ball.bg
        if (bg === 'off') this.fb.fill(0)
        else if (bg === 'static') for (let i = 0; i < n; i++) this.set(i, r2, g2, b2)
        else this.render(bg, speed, true, p)
        const bgBright = u8(p.ball.bgBright)
        if (bgBright < 255) for (let i = 0; i < this.fb.length; i++) this.fb[i] = scale8(this.fb[i], bgBright)

        let pf = p.ball.angle * (p.ball.dir === 'ccw' ? -1 : 1) + p.ball.align / 360
        pf -= Math.floor(pf)
        if (this.ballTrack < 0) this.ballTrack = pf
        const alpha = Math.max(0.03, speed / 255)
        let delta = pf - this.ballTrack
        delta -= Math.round(delta)
        this.ballTrack += delta * alpha
        this.ballTrack -= Math.floor(this.ballTrack)

        const posf = this.ballTrack * n
        const size = Math.max(1, p.ball.size)
        const br = scale8(r, p.ball.bright), bgc = scale8(g, p.ball.bright), bb = scale8(b, p.ball.bright)
        for (let i = 0; i < n; i++) {
          let d = Math.abs(i - posf)
          d = Math.min(d, n - d)
          let t = 1 - d / size
          if (t <= 0) continue
          t = t * t * (3 - 2 * t)
          const cr = this.fb[i * 3], cg = this.fb[i * 3 + 1], cb = this.fb[i * 3 + 2]
          this.set(i, Math.trunc(cr + (br - cr) * t), Math.trunc(cg + (bgc - cg) * t), Math.trunc(cb + (bb - cb) * t))
        }
        return
      }
      default: // 'off'
        this.fb.fill(0)
    }
  }
}
