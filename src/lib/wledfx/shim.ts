// WLED effect compatibility layer, a LINE-FOR-LINE port of the firmware's
// FluidNC/src/WledFx/WledFx.{h,cpp}: WLED 0.15's Segment API plus FastLED's
// lib8tion / noise / color helpers, so the ported effects (fx_*.ts) mirror the
// firmware's fx_*.cpp and the LED previews animate the same frames the strip
// shows. Change one side, change both; tools/fx_parity.py (firmware repo)
// checks they still agree, frame for frame.
//
// Ported from WLED v0.15.3 (EUPL-1.2, redistributed under GPLv3 per its
// Article 5) and FastLED 3.6.0 (MIT).
//
// C semantics made explicit: uint8 = u8(), uint16 = u16(), int8 = i8(),
// int16 = i16(), uint32 = u32(), int32 = `| 0`, integer division = div(),
// float = Math.fround (f32) after every float operation.
/* eslint-disable @typescript-eslint/naming-convention */

export const u8 = (v: number): number => v & 0xff
export const u16 = (v: number): number => v & 0xffff
export const u32 = (v: number): number => v >>> 0
export const i8 = (v: number): number => (v << 24) >> 24
export const i16 = (v: number): number => (v << 16) >> 16
export const div = (a: number, b: number): number => Math.trunc(a / b)
export const f32 = Math.fround
/** C's `(int)floatValue` for a float in int range. */
export const ftoi = (v: number): number => Math.trunc(v)
/** C's roundf (half away from zero). */
export const roundf = (v: number): number => f32(v < 0 ? -Math.round(-v) : Math.round(v))
export const sqrtf = (v: number): number => f32(Math.sqrt(v))
export const ceilf = (v: number): number => f32(Math.ceil(v))
export const fabsf = (v: number): number => f32(Math.abs(v))

export const FRAMETIME = 33 // Leds frame_ms default; WLED's is 1000/42
export const NUM_COLORS = 3
export const DEFAULT_C1 = 128
export const DEFAULT_C2 = 128
export const DEFAULT_C3 = 16

// ---- lib8tion (FastLED 3.6.0, C paths, FASTLED_SCALE8_FIXED / BLEND_FIXED = 1)
export const scale8 = (i: number, scale: number): number => (u8(i) * (1 + u8(scale))) >> 8
export const scale8_video = (i: number, scale: number): number => ((u8(i) * u8(scale)) >> 8) + (u8(i) && u8(scale) ? 1 : 0)
export const scale16by8 = (i: number, scale: number): number => u16((u16(i) * (1 + u8(scale))) >> 8)
export const scale16 = (i: number, scale: number): number => Math.floor((u16(i) * (1 + u16(scale))) / 65536)
export const qadd8 = (i: number, j: number): number => Math.min(255, u8(i) + u8(j))
export const qsub8 = (i: number, j: number): number => Math.max(0, u8(i) - u8(j))
export const qmul8 = (i: number, j: number): number => Math.min(255, u8(i) * u8(j))
export const add8 = (i: number, j: number): number => u8(i + j)
export const sub8 = (i: number, j: number): number => u8(i - j)
export const mul8 = (i: number, j: number): number => u8(u8(i) * u8(j))
export const avg8 = (i: number, j: number): number => (u8(i) + u8(j)) >> 1
export const avg7 = (i: number, j: number): number => i8((i8(i) >> 1) + (i8(j) >> 1) + (i8(i) & 1))
export const avg15 = (i: number, j: number): number => i16((i16(i) >> 1) + (i16(j) >> 1) + (i16(i) & 1))
export const abs8 = (i: number): number => u8(Math.abs(i8(i)))
export function blend8(a: number, b: number, amountOfB: number): number {
  a = u8(a); b = u8(b); amountOfB = u8(amountOfB)
  let partial = u16((a << 8) | b)
  partial = u16(partial + b * amountOfB)
  partial = u16(partial - a * amountOfB)
  return partial >> 8
}
export const lerp8by8 = (a: number, b: number, frac: number): number =>
  u8(b) > u8(a) ? u8(u8(a) + scale8(u8(b) - u8(a), frac)) : u8(u8(a) - scale8(u8(a) - u8(b), frac))
export const lerp16by16 = (a: number, b: number, frac: number): number =>
  u16(b) > u16(a) ? u16(u16(a) + scale16(u16(b) - u16(a), frac)) : u16(u16(a) - scale16(u16(a) - u16(b), frac))
export const lerp15by16 = (a: number, b: number, frac: number): number =>
  i16(b) > i16(a) ? i16(i16(a) + scale16(u16(i16(b) - i16(a)), frac)) : i16(i16(a) - scale16(u16(i16(a) - i16(b)), frac))
export const map8 = (inp: number, rangeStart: number, rangeEnd: number): number => u8(scale8(inp, u8(rangeEnd - rangeStart)) + rangeStart)
export function sqrt16(x: number): number {
  x = u16(x)
  if (x <= 1) return x
  let low = 1
  let hi: number
  let mid: number
  if (x > 7904) hi = 255
  else hi = (x >> 5) + 8
  do {
    mid = (low + hi) >> 1
    if (u16(mid * mid) > x) {
      hi = u8(mid - 1)
    } else {
      if (mid === 255) return 255
      low = u8(mid + 1)
    }
  } while (hi >= low)
  return u8(low - 1)
}
export function ease8InOutQuad(i: number): number {
  i = u8(i)
  const j = i & 0x80 ? 255 - i : i
  const jj2 = u8(scale8(j, j) << 1)
  return i & 0x80 ? 255 - jj2 : jj2
}
export function ease16InOutQuad(i: number): number {
  i = u16(i)
  const j = i & 0x8000 ? 65535 - i : i
  const jj2 = u16(scale16(j, j) << 1)
  return i & 0x8000 ? 65535 - jj2 : jj2
}
export function ease8InOutCubic(i: number): number {
  const ii = scale8(i, i)
  const iii = scale8(ii, i)
  const r1 = u16(3 * ii - 2 * iii)
  return r1 & 0x100 ? 255 : u8(r1)
}
export function ease8InOutApprox(i: number): number {
  i = u8(i)
  if (i < 64) i = u8(i / 2)
  else if (i > 255 - 64) {
    i = 255 - i
    i = u8(i / 2)
    i = 255 - i
  } else {
    i -= 64
    i += u8(i / 2)
    i += 32
  }
  return u8(i)
}
export const triwave8 = (inp: number): number => { inp = u8(inp); if (inp & 0x80) inp = 255 - inp; return u8(inp << 1) }
export const triwave16 = (inp: number): number => { inp = u16(inp); return inp < 0x8000 ? u16(inp * 2) : u16(0xffff - (inp - 0x8000) * 2) }
export const quadwave8 = (inp: number): number => ease8InOutQuad(triwave8(inp))
export const cubicwave8 = (inp: number): number => ease8InOutCubic(triwave8(inp))
export const squarewave8 = (inp: number, pulsewidth = 128): number => (u8(inp) < u8(pulsewidth) || u8(pulsewidth) === 255 ? 255 : 0)

// RNG: FastLED's 16-bit LCG, one generator for every effect.
let rand16seed = 1337
export function random8(min?: number, lim?: number): number {
  rand16seed = u16(rand16seed * 2053 + 13849)
  const r = u8(u8(rand16seed & 0xff) + u8(rand16seed >> 8))
  if (min === undefined) return r
  if (lim === undefined) return (r * u8(min)) >> 8 // random8(lim)
  return u8(((r * u8(lim - min)) >> 8) + min)
}
export function random16(min?: number, lim?: number): number {
  rand16seed = u16(rand16seed * 2053 + 13849)
  const r = rand16seed
  if (min === undefined) return r
  if (lim === undefined) return Math.floor((r * u16(min)) / 65536) // random16(lim)
  return u16(Math.floor((r * u16(lim - min)) / 65536) + min)
}
export const random16_set_seed = (seed: number): void => { rand16seed = u16(seed) }
export const random16_get_seed = (): number => rand16seed
export const random16_add_entropy = (e: number): void => { rand16seed = u16(rand16seed + e) }
/** Arduino random(howbig) / random(howsmall, howbig). */
export function random(a: number, b?: number): number {
  if (b !== undefined) return a >= b ? a : a + random(b - a)
  if (a <= 0) return 0
  const hi = random16()
  const lo = random16()
  return u32((hi << 16) | lo) % u32(a)
}

// Arduino helpers
export function map(x: number, in_min: number, in_max: number, out_min: number, out_max: number): number {
  if (in_max === in_min) return out_min
  return div((x - in_min) * (out_max - out_min), in_max - in_min) + out_min
}
export const constrain = (amt: number, low: number, high: number): number => (amt < low ? low : amt > high ? high : amt)
export const mapf = (x: number, in_min: number, in_max: number, out_min: number, out_max: number): number =>
  f32(f32(f32(f32(x - in_min) * f32(out_max - out_min)) / f32(in_max - in_min)) + out_min)
export const MIN = Math.min
export const MAX = Math.max
export const qsuba = (x: number, b: number): number => (x > b ? x - b : 0)

// ---- WLED integer trig (wled_math.cpp)
export function sin16_t(theta: number): number {
  theta = u16(theta)
  let scale = 1
  if (theta > 0x7fff) {
    theta = 0xffff - theta
    scale = -1
  }
  const precal = u32(theta * (0x7fff - theta))
  const numerator = precal * (4 * 0x7fff) // < 2^53: exact
  const denominator = (1342095361 - precal) | 0
  const result = i16(Math.trunc(numerator / denominator))
  return i16(result * scale)
}
export const cos16_t = (theta: number): number => sin16_t(u16(theta) + 0x4000)
export function sin8_t(theta: number): number {
  let s = sin16_t(u8(theta) * 257)
  s += 0x7fff + 128
  return Math.min(s, 0xffff) >> 8
}
export const cos8_t = (theta: number): number => sin8_t(u8(u8(theta) + 64))
const M_TWOPI_F = f32(6.283185307179586)
const M_PI_F = f32(3.141592653589793)
const M_PI_2_F = f32(1.5707963267948966)
const M_PI_4_F = f32(0.7853981633974483)
const SIN_SCALE = f32(0xffff / M_TWOPI_F)
export function sin_approx(theta: number): number {
  const scaled = u16(ftoi(f32(theta * SIN_SCALE)))
  return f32(sin16_t(scaled) / 0x7fff)
}
export function cos_approx(theta: number): number {
  const scaled = u16(ftoi(f32(theta * SIN_SCALE)))
  return f32(sin16_t(scaled + 0x4000) / 0x7fff)
}
export function tan_approx(x: number): number {
  const c = cos_approx(x)
  if (c === 0) return 0
  return f32(sin_approx(x) / c)
}
export const sin_t = sin_approx
export const cos_t = cos_approx
export const tan_t = tan_approx
export function atan2_t(y: number, x: number): number {
  const abs_y = fabsf(y)
  const abs_x = fabsf(x)
  let r = f32(f32(abs_x - abs_y) / f32(f32(abs_y + abs_x) + f32(1e-10)))
  let angle: number
  if (x < 0) {
    r = -r
    angle = f32(M_PI_2_F + M_PI_4_F)
  } else angle = f32(M_PI_2_F - M_PI_4_F)
  const add = f32(f32(f32(f32(0.1963) * f32(r * r)) - f32(0.9817)) * r)
  angle = f32(angle + add)
  return y < 0 ? -angle : angle
}
export function acos_t(x: number): number {
  const negate = x < 0 ? 1 : 0
  const xabs = fabsf(x)
  let ret = f32(-0.0187293)
  ret = f32(ret * xabs)
  ret = f32(ret + f32(0.074261))
  ret = f32(ret * xabs)
  ret = f32(ret - f32(0.2121144))
  ret = f32(ret * xabs)
  ret = f32(ret + M_PI_2_F)
  ret = f32(ret * sqrtf(f32(1 - xabs)))
  ret = f32(ret - f32(2 * negate * ret))
  return f32(f32(negate * M_PI_F) + ret)
}
export const asin_t = (x: number): number => f32(M_PI_2_F - acos_t(x))
export function atan_t(x: number): number {
  const A = 0.0776509570923569
  const Bc = -0.287434475393028
  const C = 0.7853981633974483 - A - Bc
  const neg = x < 0
  x = fabsf(x)
  let res: number
  if (x > 5) res = f32(M_PI_2_F - f32(1 / x))
  else if (x > 1) {
    const xx = f32(x * x)
    res = f32(f32(f32(f32(f32(f32(-0.003445) * xx) * xx) + f32(f32(f32(0.05375) * xx) * x)) + f32(f32(-0.326175) * xx)) + f32(f32(f32(0.974207) * x) + f32(0.089494)))
  } else {
    const xx = f32(x * x)
    res = f32(((A * xx + Bc) * xx + C) * x)
  }
  return neg ? -res : res
}
export function floor_t(x: number): number {
  let val = ftoi(x)
  if (x < 0) val--
  return val
}
export const fmod_t = (num: number, denom: number): number => f32(num - f32(ftoi(f32(num / denom)) * denom))

// ---- beats (time = the effect clock, strip.now)
export const strip = { now: 0, isMatrix: false, paletteBlend: 0, getBrightness: () => 255, getActiveSegmentsNum: () => 1, getCurrSegmentId: () => 0, getMaxSegments: () => 1, getFrameTime: () => FRAMETIME }
/** uint32 (now - timebase) * bpm * 280 >> 16, wrapping like the C. */
const beatMul = (t: number, m: number): number => {
  // (t * m) mod 2^32 without losing precision past 2^53
  const lo = (t & 0xffff) * m
  const hi = ((t >>> 16) * m) & 0xffff
  return u32(lo + hi * 65536)
}
export const beat88 = (bpm88: number, timebase = 0): number => u16(beatMul(u32(strip.now - timebase), u16(bpm88) * 280) >>> 16)
export function beat16(bpm: number, timebase = 0): number {
  bpm = u16(bpm)
  if (bpm < 256) bpm = u16(bpm << 8)
  return beat88(bpm, timebase)
}
export const beat8 = (bpm: number, timebase = 0): number => beat16(bpm, timebase) >> 8
export function beatsin88_t(bpm88: number, lowest = 0, highest = 65535, timebase = 0, phase_offset = 0): number {
  const beat = beat88(bpm88, timebase)
  const beatsin = u16(sin16_t(beat + phase_offset) + 32768)
  return u16(lowest + scale16(beatsin, u16(highest - lowest)))
}
export function beatsin16_t(bpm: number, lowest = 0, highest = 65535, timebase = 0, phase_offset = 0): number {
  const beat = beat16(bpm, timebase)
  const beatsin = u16(sin16_t(beat + phase_offset) + 32768)
  return u16(lowest + scale16(beatsin, u16(highest - lowest)))
}
export function beatsin8_t(bpm: number, lowest = 0, highest = 255, timebase = 0, phase_offset = 0): number {
  const beat = beat8(bpm, timebase)
  const beatsin = sin8_t(beat + phase_offset)
  return u8(lowest + scale8(beatsin, u8(highest - lowest)))
}
export const millis = (): number => strip.now
export const micros = (): number => u32(strip.now * 1000)

// ---- noise (FastLED noise.cpp, FASTLED_NOISE_FIXED = 1)
const p = [
  151, 160, 137, 91, 90, 15, 131, 13, 201, 95, 96, 53, 194, 233, 7, 225, 140, 36, 103, 30, 69, 142, 8, 99, 37, 240, 21, 10, 23, 190, 6, 148,
  247, 120, 234, 75, 0, 26, 197, 62, 94, 252, 219, 203, 117, 35, 11, 32, 57, 177, 33, 88, 237, 149, 56, 87, 174, 20, 125, 136, 171, 168, 68, 175,
  74, 165, 71, 134, 139, 48, 27, 166, 77, 146, 158, 231, 83, 111, 229, 122, 60, 211, 133, 230, 220, 105, 92, 41, 55, 46, 245, 40, 244, 102, 143, 54,
  65, 25, 63, 161, 1, 216, 80, 73, 209, 76, 132, 187, 208, 89, 18, 169, 200, 196, 135, 130, 116, 188, 159, 86, 164, 100, 109, 198, 173, 186, 3, 64,
  52, 217, 226, 250, 124, 123, 5, 202, 38, 147, 118, 126, 255, 82, 85, 212, 207, 206, 59, 227, 47, 16, 58, 17, 182, 189, 28, 42, 223, 183, 170, 213,
  119, 248, 152, 2, 44, 154, 163, 70, 221, 153, 101, 155, 167, 43, 172, 9, 129, 22, 39, 253, 19, 98, 108, 110, 79, 113, 224, 232, 178, 185, 112, 104,
  218, 246, 97, 228, 251, 34, 242, 193, 238, 210, 144, 12, 191, 179, 162, 241, 81, 51, 145, 235, 249, 14, 239, 107, 49, 192, 214, 31, 181, 199, 106, 157,
  184, 84, 204, 176, 115, 121, 50, 45, 127, 4, 150, 254, 138, 236, 205, 93, 222, 114, 67, 29, 24, 72, 243, 141, 128, 195, 78, 66, 215, 61, 156, 180,
  151,
]
const P = (x: number): number => p[u8(x)]
function grad16_3(hash: number, x: number, y: number, z: number): number {
  hash &= 15
  let u = hash < 8 ? x : y
  let v = hash < 4 ? y : hash === 12 || hash === 14 ? x : z
  if (hash & 1) u = i16(-u)
  if (hash & 2) v = i16(-v)
  return avg15(u, v)
}
function grad16_2(hash: number, x: number, y: number): number {
  hash &= 7
  let u: number, v: number
  if (hash < 4) { u = x; v = y } else { u = y; v = x }
  if (hash & 1) u = i16(-u)
  if (hash & 2) v = i16(-v)
  return avg15(u, v)
}
function grad16_1(hash: number, x: number): number {
  hash &= 15
  let u: number, v: number
  if (hash > 8) { u = x; v = x } else if (hash < 4) { u = x; v = 1 } else { u = 1; v = x }
  if (hash & 1) u = i16(-u)
  if (hash & 2) v = i16(-v)
  return avg15(u, v)
}
function grad8_3(hash: number, x: number, y: number, z: number): number {
  hash &= 0xf
  let u = hash & 8 ? y : x
  let v = hash < 4 ? y : hash === 12 || hash === 14 ? x : z
  if (hash & 1) u = i8(-u)
  if (hash & 2) v = i8(-v)
  return avg7(u, v)
}
function grad8_2(hash: number, x: number, y: number): number {
  let u: number, v: number
  if (hash & 4) { u = y; v = x } else { u = x; v = y }
  if (hash & 1) u = i8(-u)
  if (hash & 2) v = i8(-v)
  return avg7(u, v)
}
function grad8_1(hash: number, x: number): number {
  let u: number, v: number
  if (hash & 8) { u = x; v = x } else if (hash & 4) { u = 1; v = x } else { u = x; v = 1 }
  if (hash & 1) u = i8(-u)
  if (hash & 2) v = i8(-v)
  return avg7(u, v)
}
function lerp7by8(a: number, b: number, frac: number): number {
  a = i8(a); b = i8(b)
  if (b > a) return i8(a + scale8(u8(b - a), frac))
  return i8(a - scale8(u8(a - b), frac))
}
const LERP = lerp15by16
export function inoise16_raw(x: number, y?: number, z?: number): number {
  x = u32(x)
  if (y === undefined) {
    const X = (x >>> 16) & 0xff
    const A = P(X), AA = P(A), Bv = P(X + 1), BA = P(Bv)
    let u = x & 0xffff
    const xx = i16((u >> 1) & 0x7fff)
    const N = 0x8000
    u = ease16InOutQuad(u)
    return LERP(grad16_1(P(AA), xx), grad16_1(P(BA), i16(xx - N)), u)
  }
  y = u32(y)
  if (z === undefined) {
    const X = (x >>> 16) & 0xff, Y = (y >>> 16) & 0xff
    const A = u8(P(X) + Y), AA = P(A), AB = P(A + 1)
    const Bv = u8(P(X + 1) + Y), BA = P(Bv), BB = P(Bv + 1)
    let u = x & 0xffff, v = y & 0xffff
    const xx = i16((u >> 1) & 0x7fff), yy = i16((v >> 1) & 0x7fff)
    const N = 0x8000
    u = ease16InOutQuad(u); v = ease16InOutQuad(v)
    const X1 = LERP(grad16_2(P(AA), xx, yy), grad16_2(P(BA), i16(xx - N), yy), u)
    const X2 = LERP(grad16_2(P(AB), xx, i16(yy - N)), grad16_2(P(BB), i16(xx - N), i16(yy - N)), u)
    return LERP(X1, X2, v)
  }
  z = u32(z)
  const X = (x >>> 16) & 0xff, Y = (y >>> 16) & 0xff, Z = (z >>> 16) & 0xff
  const A = u8(P(X) + Y), AA = u8(P(A) + Z), AB = u8(P(A + 1) + Z)
  const Bv = u8(P(X + 1) + Y), BA = u8(P(Bv) + Z), BB = u8(P(Bv + 1) + Z)
  let u = x & 0xffff, v = y & 0xffff, w = z & 0xffff
  const xx = i16((u >> 1) & 0x7fff), yy = i16((v >> 1) & 0x7fff), zz = i16((w >> 1) & 0x7fff)
  const N = 0x8000
  u = ease16InOutQuad(u); v = ease16InOutQuad(v); w = ease16InOutQuad(w)
  const X1 = LERP(grad16_3(P(AA), xx, yy, zz), grad16_3(P(BA), i16(xx - N), yy, zz), u)
  const X2 = LERP(grad16_3(P(AB), xx, i16(yy - N), zz), grad16_3(P(BB), i16(xx - N), i16(yy - N), zz), u)
  const X3 = LERP(grad16_3(P(AA + 1), xx, yy, i16(zz - N)), grad16_3(P(BA + 1), i16(xx - N), yy, i16(zz - N)), u)
  const X4 = LERP(grad16_3(P(AB + 1), xx, i16(yy - N), i16(zz - N)), grad16_3(P(BB + 1), i16(xx - N), i16(yy - N), i16(zz - N)), u)
  const Y1 = LERP(X1, X2, v)
  const Y2 = LERP(X3, X4, v)
  return LERP(Y1, Y2, w)
}
export function inoise16(x: number, y?: number, z?: number): number {
  if (y === undefined) return u32((inoise16_raw(x) + 17308) << 1) & 0xffff
  if (z === undefined) return u16(Math.floor(u32((inoise16_raw(x, y) + 17308) * 484) / 256))
  return u16(Math.floor(u32((inoise16_raw(x, y, z) + 19052) * 440) / 256))
}
export function inoise8_raw(x: number, y?: number, z?: number): number {
  x = u16(x)
  if (y === undefined) {
    const X = x >> 8
    const A = P(X), AA = P(A), Bv = P(X + 1), BA = P(Bv)
    let u = u8(x)
    const xx = i8((u8(x) >> 1) & 0x7f)
    const N = 0x80
    u = ease8InOutQuad(u)
    return lerp7by8(grad8_1(P(AA), xx), grad8_1(P(BA), i8(xx - N)), u)
  }
  y = u16(y)
  if (z === undefined) {
    const X = x >> 8, Y = y >> 8
    const A = u8(P(X) + Y), AA = P(A), AB = P(A + 1)
    const Bv = u8(P(X + 1) + Y), BA = P(Bv), BB = P(Bv + 1)
    let u = u8(x), v = u8(y)
    const xx = i8((u8(x) >> 1) & 0x7f), yy = i8((u8(y) >> 1) & 0x7f)
    const N = 0x80
    u = ease8InOutQuad(u); v = ease8InOutQuad(v)
    const X1 = lerp7by8(grad8_2(P(AA), xx, yy), grad8_2(P(BA), i8(xx - N), yy), u)
    const X2 = lerp7by8(grad8_2(P(AB), xx, i8(yy - N)), grad8_2(P(BB), i8(xx - N), i8(yy - N)), u)
    return lerp7by8(X1, X2, v)
  }
  z = u16(z)
  const X = x >> 8, Y = y >> 8, Z = z >> 8
  const A = u8(P(X) + Y), AA = u8(P(A) + Z), AB = u8(P(A + 1) + Z)
  const Bv = u8(P(X + 1) + Y), BA = u8(P(Bv) + Z), BB = u8(P(Bv + 1) + Z)
  let u = u8(x), v = u8(y), w = u8(z)
  const xx = i8((u8(x) >> 1) & 0x7f), yy = i8((u8(y) >> 1) & 0x7f), zz = i8((u8(z) >> 1) & 0x7f)
  const N = 0x80
  u = ease8InOutQuad(u); v = ease8InOutQuad(v); w = ease8InOutQuad(w)
  const X1 = lerp7by8(grad8_3(P(AA), xx, yy, zz), grad8_3(P(BA), i8(xx - N), yy, zz), u)
  const X2 = lerp7by8(grad8_3(P(AB), xx, i8(yy - N), zz), grad8_3(P(BB), i8(xx - N), i8(yy - N), zz), u)
  const X3 = lerp7by8(grad8_3(P(AA + 1), xx, yy, i8(zz - N)), grad8_3(P(BA + 1), i8(xx - N), yy, i8(zz - N)), u)
  const X4 = lerp7by8(grad8_3(P(AB + 1), xx, i8(yy - N), i8(zz - N)), grad8_3(P(BB + 1), i8(xx - N), i8(yy - N), i8(zz - N)), u)
  const Y1 = lerp7by8(X1, X2, v)
  const Y2 = lerp7by8(X3, X4, v)
  return lerp7by8(Y1, Y2, w)
}
export function inoise8(x: number, y?: number, z?: number): number {
  const n = i8(inoise8_raw(x, y, z) + 64)
  return qadd8(n, n)
}

// ---- colors
export const RGBW32 = (r: number, g: number, b: number, w = 0): number => u32((u8(w) << 24) | (u8(r) << 16) | (u8(g) << 8) | u8(b))
export const R = (c: number): number => (c >>> 16) & 0xff
export const G = (c: number): number => (c >>> 8) & 0xff
export const B = (c: number): number => c & 0xff
export const W = (c: number): number => (c >>> 24) & 0xff
export const RED = 0xff0000, GREEN = 0x00ff00, BLUE = 0x0000ff, WHITE = 0xffffff, BLACK = 0x000000
export const YELLOW = 0xffff00, CYAN = 0x00ffff, MAGENTA = 0xff00ff, PURPLE = 0x400080, ORANGE = 0xff3000
export const PINK = 0xff1493, GREY = 0x808080, GRAY = 0x808080, DARKGREY = 0x333333, DARKGRAY = 0x333333
export const ULTRAWHITE = 0xffffffff, DARKSLATEGRAY = 0x2f4f4f, DARKSLATEGREY = 0x2f4f4f

/** FastLED's CRGB. A MUTABLE object (C++ copies by value): `.clone()` where
 * the C++ copies one, or two names end up sharing a pixel. */
export class CRGB {
  r: number
  g: number
  b: number
  constructor(r: number | CHSV = 0, g?: number, b?: number) {
    if (r instanceof CHSV) {
      this.r = 0; this.g = 0; this.b = 0
      hsv2rgb_rainbow(r, this)
    } else if (g === undefined) { // CRGB(uint32_t colorcode)
      this.r = (r >>> 16) & 0xff; this.g = (r >>> 8) & 0xff; this.b = r & 0xff
    } else {
      this.r = u8(r); this.g = u8(g); this.b = u8(b ?? 0)
    }
  }
  static readonly Black = 0x000000; static readonly White = 0xffffff; static readonly Red = 0xff0000; static readonly Green = 0x008000
  static readonly Blue = 0x0000ff; static readonly Yellow = 0xffff00; static readonly Orange = 0xffa500; static readonly DarkOrange = 0xff8c00
  static readonly OrangeRed = 0xff4500; static readonly Gray = 0x808080; static readonly Grey = 0x808080; static readonly DarkGray = 0xa9a9a9
  static readonly Purple = 0x800080; static readonly Magenta = 0xff00ff; static readonly Cyan = 0x00ffff; static readonly Aqua = 0x00ffff
  static readonly Pink = 0xffc0cb; static readonly HotPink = 0xff69b4; static readonly DeepPink = 0xff1493; static readonly Gold = 0xffd700
  static readonly Navy = 0x000080; static readonly DarkBlue = 0x00008b; static readonly Teal = 0x008080; static readonly Lime = 0x00ff00
  static readonly LimeGreen = 0x32cd32; static readonly DarkGreen = 0x006400; static readonly Brown = 0xa52a2a; static readonly Maroon = 0x800000
  static readonly DarkRed = 0x8b0000; static readonly Violet = 0xee82ee; static readonly Indigo = 0x4b0082; static readonly SkyBlue = 0x87ceeb
  static readonly LightBlue = 0xadd8e6; static readonly DeepSkyBlue = 0x00bfff; static readonly Amethyst = 0x9966cc; static readonly FairyLight = 0xffe42d
  static readonly Salmon = 0xfa8072; static readonly Crimson = 0xdc143c; static readonly Coral = 0xff7f50; static readonly Tomato = 0xff6347
  static readonly Turquoise = 0x40e0d0; static readonly Seashell = 0xfff5ee; static readonly Snow = 0xfffafa; static readonly SeaGreen = 0x2e8b57
  static readonly Chartreuse = 0x7fff00; static readonly DarkViolet = 0x9400d3; static readonly MidnightBlue = 0x191970

  clone(): CRGB { return new CRGB(this.r, this.g, this.b) }
  /** `c = other` (assignment copies in C++). */
  set(o: CRGB | number): this { if (typeof o === 'number') { this.r = (o >>> 16) & 0xff; this.g = (o >>> 8) & 0xff; this.b = o & 0xff } else { this.r = o.r; this.g = o.g; this.b = o.b } return this }
  get red(): number { return this.r } set red(v: number) { this.r = u8(v) }
  get green(): number { return this.g } set green(v: number) { this.g = u8(v) }
  get blue(): number { return this.b } set blue(v: number) { this.b = u8(v) }
  at(i: number): number { return i === 0 ? this.r : i === 1 ? this.g : this.b }
  setAt(i: number, v: number): void { if (i === 0) this.r = u8(v); else if (i === 1) this.g = u8(v); else this.b = u8(v) }
  setRGB(r: number, g: number, b: number): this { this.r = u8(r); this.g = u8(g); this.b = u8(b); return this }
  setHSV(h: number, s: number, v: number): this { hsv2rgb_rainbow(new CHSV(h, s, v), this); return this }
  setHue(h: number): this { hsv2rgb_rainbow(new CHSV(h, 255, 255), this); return this }
  /** += */ add(o: CRGB): this { this.r = qadd8(this.r, o.r); this.g = qadd8(this.g, o.g); this.b = qadd8(this.b, o.b); return this }
  /** -= */ sub(o: CRGB): this { this.r = qsub8(this.r, o.r); this.g = qsub8(this.g, o.g); this.b = qsub8(this.b, o.b); return this }
  /** /= */ divBy(d: number): this { this.r = div(this.r, d); this.g = div(this.g, d); this.b = div(this.b, d); return this }
  /** >>= */ shr(d: number): this { this.r >>= d; this.g >>= d; this.b >>= d; return this }
  /** *= */ mulBy(d: number): this { this.r = qmul8(this.r, d); this.g = qmul8(this.g, d); this.b = qmul8(this.b, d); return this }
  nscale8_video(s: number): this { nscale8x3_video(this, s); return this }
  /** %= */ mod(s: number): this { nscale8x3_video(this, s); return this }
  fadeLightBy(f: number): this { nscale8x3_video(this, 255 - u8(f)); return this }
  nscale8(s: number | CRGB): this {
    if (typeof s === 'number') nscale8x3(this, s)
    else { this.r = scale8(this.r, s.r); this.g = scale8(this.g, s.g); this.b = scale8(this.b, s.b) }
    return this
  }
  fadeToBlackBy(f: number): this { nscale8x3(this, 255 - u8(f)); return this }
  /** |= */ or(o: CRGB | number): this {
    if (typeof o === 'number') { if (o > this.r) this.r = o; if (o > this.g) this.g = o; if (o > this.b) this.b = o }
    else { if (o.r > this.r) this.r = o.r; if (o.g > this.g) this.g = o.g; if (o.b > this.b) this.b = o.b }
    return this
  }
  /** &= */ and(o: CRGB): this { if (o.r < this.r) this.r = o.r; if (o.g < this.g) this.g = o.g; if (o.b < this.b) this.b = o.b; return this }
  /** explicit operator bool */ any(): boolean { return this.r !== 0 || this.g !== 0 || this.b !== 0 }
  /** (uint32_t) / RGBW32(c.r,c.g,c.b,0) */ u32(): number { return ((this.r << 16) | (this.g << 8) | this.b) >>> 0 }
  neg(): CRGB { return new CRGB(255 - this.r, 255 - this.g, 255 - this.b) }
  getLuma(): number { return u8(scale8(this.r, 54) + scale8(this.g, 183) + scale8(this.b, 18)) }
  getAverageLight(): number { return u8(scale8(this.r, 85) + scale8(this.g, 85) + scale8(this.b, 85)) }
  maximizeBrightness(limit = 255): void {
    let m = this.r
    if (this.g > m) m = this.g
    if (this.b > m) m = this.b
    if (m > 0) {
      const factor = u16(div(limit * 256, m))
      this.r = u8(div(this.r * factor, 256)); this.g = u8(div(this.g * factor, 256)); this.b = u8(div(this.b * factor, 256))
    }
  }
}
export const crgbEq = (a: CRGB, b: CRGB): boolean => a.r === b.r && a.g === b.g && a.b === b.b
export const crgbAdd = (a: CRGB, b: CRGB): CRGB => new CRGB(qadd8(a.r, b.r), qadd8(a.g, b.g), qadd8(a.b, b.b))
export const crgbSub = (a: CRGB, b: CRGB): CRGB => new CRGB(qsub8(a.r, b.r), qsub8(a.g, b.g), qsub8(a.b, b.b))
export const crgbMul = (a: CRGB, d: number): CRGB => new CRGB(qmul8(a.r, d), qmul8(a.g, d), qmul8(a.b, d))
export const crgbMod = (a: CRGB, d: number): CRGB => a.clone().nscale8_video(d)
export const crgbOr = (a: CRGB, b: CRGB): CRGB => a.clone().or(b)
/** A color argument: CRGB or packed 0xRRGGBB, as C++ overloads take either. */
export type Color = CRGB | number
export const toU32 = (c: Color): number => (typeof c === 'number' ? u32(c) : c.u32())

function nscale8x3(c: CRGB, scale: number): void {
  const s = u8(scale) + 1
  c.r = (c.r * s) >> 8; c.g = (c.g * s) >> 8; c.b = (c.b * s) >> 8
}
function nscale8x3_video(c: CRGB, scale: number): void {
  scale = u8(scale)
  const nz = scale !== 0 ? 1 : 0
  c.r = c.r === 0 ? 0 : ((c.r * scale) >> 8) + nz
  c.g = c.g === 0 ? 0 : ((c.g * scale) >> 8) + nz
  c.b = c.b === 0 ? 0 : ((c.b * scale) >> 8) + nz
}

export class CHSV {
  hue: number
  sat: number
  val: number
  constructor(h = 0, s = 0, v = 0) { this.hue = u8(h); this.sat = u8(s); this.val = u8(v) }
  get h(): number { return this.hue } set h(v: number) { this.hue = u8(v) }
  get s(): number { return this.sat } set s(v: number) { this.sat = u8(v) }
  get v(): number { return this.val } set v(x: number) { this.val = u8(x) }
}

export function hsv2rgb_rainbow(hsv: CHSV, rgb: CRGB): void {
  const hue = hsv.hue
  const sat = hsv.sat
  let val = hsv.val
  const offset8 = u8((hue & 0x1f) << 3)
  const third = scale8(offset8, div(256, 3))
  let r: number, g: number, b: number
  if (!(hue & 0x80)) {
    if (!(hue & 0x40)) {
      if (!(hue & 0x20)) { r = 255 - third; g = third; b = 0 } else { r = 171; g = 85 + third; b = 0 }
    } else if (!(hue & 0x20)) {
      const twothirds = scale8(offset8, div(256 * 2, 3))
      r = 171 - twothirds; g = 170 + third; b = 0
    } else { r = 0; g = 255 - third; b = third }
  } else if (!(hue & 0x40)) {
    if (!(hue & 0x20)) {
      const twothirds = scale8(offset8, div(256 * 2, 3))
      r = 0; g = 171 - twothirds; b = 85 + twothirds
    } else { r = third; g = 0; b = 255 - third }
  } else if (!(hue & 0x20)) { r = 85 + third; g = 0; b = 171 - third } else { r = 170 + third; g = 0; b = 85 - third }
  r = u8(r); g = u8(g); b = u8(b)
  if (sat !== 255) {
    if (sat === 0) { r = 255; b = 255; g = 255 } else {
      let desat = 255 - sat
      desat = scale8_video(desat, desat)
      const satscale = 255 - desat
      r = scale8(r, satscale); g = scale8(g, satscale); b = scale8(b, satscale)
      r = u8(r + desat); g = u8(g + desat); b = u8(b + desat)
    }
  }
  if (val !== 255) {
    val = scale8_video(val, val)
    if (val === 0) { r = 0; g = 0; b = 0 } else { r = scale8(r, val); g = scale8(g, val); b = scale8(b, val) }
  }
  rgb.r = r; rgb.g = g; rgb.b = b
}

export const NOBLEND = 0
export const LINEARBLEND = 1
export const LINEARBLEND_NOWRAP = 2
export function fill_solid(leds: CRGB[], numToFill: number, color: CRGB): void {
  for (let i = 0; i < numToFill; ++i) leds[i] = color.clone()
}
export function fill_gradient_RGB(leds: CRGB[], startpos: number, startcolor: CRGB, endpos: number, endcolor: CRGB): void {
  if (endpos < startpos) { [startpos, endpos] = [endpos, startpos]; [startcolor, endcolor] = [endcolor, startcolor] }
  const rd = i16((endcolor.r - startcolor.r) << 7), gd = i16((endcolor.g - startcolor.g) << 7), bd = i16((endcolor.b - startcolor.b) << 7)
  const pixeldistance = u16(endpos - startpos)
  const divisor = pixeldistance ? i16(pixeldistance) : 1
  const rdel = i16(i16(div(rd, divisor)) * 2), gdel = i16(i16(div(gd, divisor)) * 2), bdel = i16(i16(div(bd, divisor)) * 2)
  let r88 = u16(startcolor.r << 8), g88 = u16(startcolor.g << 8), b88 = u16(startcolor.b << 8)
  for (let i = startpos; i <= endpos; ++i) {
    leds[i] = new CRGB(r88 >> 8, g88 >> 8, b88 >> 8)
    r88 = u16(r88 + rdel); g88 = u16(g88 + gdel); b88 = u16(b88 + bdel)
  }
}
export function fill_gradient_RGB_n(leds: CRGB[], numLeds: number, ...c: CRGB[]): void {
  if (c.length === 2) fill_gradient_RGB(leds, 0, c[0], numLeds - 1, c[1])
  else if (c.length === 3) {
    const half = div(numLeds, 2), last = numLeds - 1
    fill_gradient_RGB(leds, 0, c[0], half, c[1])
    fill_gradient_RGB(leds, half, c[1], last, c[2])
  } else {
    const onethird = div(numLeds, 3), twothirds = div(numLeds * 2, 3), last = numLeds - 1
    fill_gradient_RGB(leds, 0, c[0], onethird, c[1])
    fill_gradient_RGB(leds, onethird, c[1], twothirds, c[2])
    fill_gradient_RGB(leds, twothirds, c[2], last, c[3])
  }
}

export class CRGBPalette16 {
  entries: CRGB[]
  /** From 16 packed colors, or 1-4 CRGB (FastLED's gradient constructors). */
  constructor(...a: Array<CRGB | readonly number[]>) {
    this.entries = Array.from({ length: 16 }, () => new CRGB())
    if (a.length === 0) return
    if (Array.isArray(a[0])) { const t = a[0] as readonly number[]; for (let i = 0; i < 16; i++) this.entries[i] = new CRGB(t[i]); return }
    const c = a as CRGB[]
    if (c.length === 1) fill_solid(this.entries, 16, c[0])
    else fill_gradient_RGB_n(this.entries, 16, ...c)
  }
  at(i: number): CRGB { return this.entries[u8(i) & 15] }
  clone(): CRGBPalette16 { const p2 = new CRGBPalette16(); p2.entries = this.entries.map((e) => e.clone()); return p2 }
}
export function ColorFromPalette(pal: CRGBPalette16, index: number, brightness = 255, blendType = LINEARBLEND): CRGB {
  index = u8(index); brightness = u8(brightness)
  if (blendType === LINEARBLEND_NOWRAP) index = map8(index, 0, 239)
  const hi4 = index >> 4
  const lo4 = index & 0x0f
  let entry = pal.entries[hi4]
  const blend = lo4 && blendType !== NOBLEND
  let red1 = entry.r, green1 = entry.g, blue1 = entry.b
  if (blend) {
    entry = hi4 === 15 ? pal.entries[0] : pal.entries[hi4 + 1]
    const f2 = u8(lo4 << 4)
    const f1 = 255 - f2
    red1 = u8(scale8(red1, f1) + scale8(entry.r, f2))
    green1 = u8(scale8(green1, f1) + scale8(entry.g, f2))
    blue1 = u8(scale8(blue1, f1) + scale8(entry.b, f2))
  }
  if (brightness !== 255) {
    if (brightness) {
      brightness = u8(brightness + 1)
      if (red1) red1 = u8(scale8(red1, brightness) + 1)
      if (green1) green1 = u8(scale8(green1, brightness) + 1)
      if (blue1) blue1 = u8(scale8(blue1, brightness) + 1)
    } else { red1 = 0; green1 = 0; blue1 = 0 }
  }
  return new CRGB(red1, green1, blue1)
}
export function HeatColor(temperature: number): CRGB {
  const t192 = scale8_video(temperature, 191)
  const heatramp = u8((t192 & 0x3f) << 2)
  if (t192 & 0x80) return new CRGB(255, 255, heatramp)
  if (t192 & 0x40) return new CRGB(255, heatramp, 0)
  return new CRGB(heatramp, 0, 0)
}
export function nblend(existing: CRGB, overlay: CRGB, amountOfOverlay: number): CRGB {
  amountOfOverlay = u8(amountOfOverlay)
  if (amountOfOverlay === 0) return existing
  if (amountOfOverlay === 255) return existing.set(overlay)
  existing.r = blend8(existing.r, overlay.r, amountOfOverlay)
  existing.g = blend8(existing.g, overlay.g, amountOfOverlay)
  existing.b = blend8(existing.b, overlay.b, amountOfOverlay)
  return existing
}
export const blend = (p1: CRGB, p2: CRGB, amountOfP2: number): CRGB => nblend(p1.clone(), p2, amountOfP2)
export function nblendPaletteTowardPalette(current: CRGBPalette16, target: CRGBPalette16, maxChanges: number): void {
  let changes = 0
  for (let i = 0; i < 48; ++i) {
    const e = current.entries[div(i, 3)], t = target.entries[div(i, 3)]
    const k = i % 3
    let a = e.at(k)
    const b = t.at(k)
    if (a === b) continue
    if (a < b) { ++a; ++changes }
    if (a > b) { --a; ++changes; if (a > b) --a }
    e.setAt(k, a)
    if (changes >= maxChanges) break
  }
}

export function color_blend(c1: number, c2: number, blend: number, b16 = false): number {
  c1 = u32(c1); c2 = u32(c2); blend = u16(blend)
  if (blend === 0) return c1
  const blendmax = b16 ? 0xffff : 0xff
  if (blend === blendmax) return c2
  const shift = b16 ? 16 : 8
  // products reach 2^24: Math.floor(x / 2^shift) keeps them exact past int32
  const mix = (a: number, b: number) => Math.floor((b * blend + a * (blendmax - blend)) / (1 << shift))
  return RGBW32(mix(R(c1), R(c2)), mix(G(c1), G(c2)), mix(B(c1), B(c2)), mix(W(c1), W(c2)))
}
export function color_add(c1: number, c2: number, fast = false): number {
  c1 = u32(c1); c2 = u32(c2)
  if (c1 === BLACK) return c2
  if (c2 === BLACK) return c1
  if (fast) return RGBW32(qadd8(R(c1), R(c2)), qadd8(G(c1), G(c2)), qadd8(B(c1), B(c2)), qadd8(W(c1), W(c2)))
  const r = R(c1) + R(c2), g = G(c1) + G(c2), b = B(c1) + B(c2), w = W(c1) + W(c2)
  const m = Math.max(r, g, b, w)
  if (m < 256) return RGBW32(r, g, b, w)
  return RGBW32(div(r * 255, m), div(g * 255, m), div(b * 255, m), div(w * 255, m))
}
export function color_fade(c1: number, amount: number, video = false): number {
  c1 = u32(c1); amount = u8(amount)
  if (c1 === BLACK || amount + (video ? 1 : 0) === 0) return BLACK
  const r = R(c1), g = G(c1), b = B(c1), w = W(c1)
  const sc = (x: number) => (video ? ((x * amount) >> 8) + (x && amount ? 1 : 0) : (x * amount) >> 8)
  return u32((sc(w) << 24) | (sc(r) << 16) | (sc(g) << 8) | sc(b))
}
export function get_random_wheel_index(pos: number): number {
  let r = 0, x = 0, y = 0, d = 0
  while (d < 42) {
    r = random8()
    x = u8(Math.abs(u8(pos) - r))
    y = 255 - x
    d = Math.min(x, y)
  }
  return r
}
const gammaT = [
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3,
  3, 3, 3, 3, 4, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12, 13, 13, 13, 14, 14, 15, 15, 16, 16, 17, 17, 18, 18, 19, 19, 20, 20,
  21, 21, 22, 22, 23, 24, 24, 25, 25, 26, 27, 27, 28, 29, 29, 30, 31, 32, 32, 33, 34, 35, 35, 36, 37, 38, 39, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 50, 51, 52, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63,
  64, 66, 67, 68, 69, 70, 72, 73, 74, 75, 77, 78, 79, 81, 82, 83, 85, 86, 87, 89, 90, 92, 93, 95, 96, 98, 99, 101, 102, 104, 105, 107, 109, 110, 112, 114, 115, 117, 119, 120, 122, 124, 126, 127, 129, 131, 133, 135, 137, 138, 140, 142,
  144, 146, 148, 150, 152, 154, 156, 158, 160, 162, 164, 167, 169, 171, 173, 175, 177, 180, 182, 184, 186, 189, 191, 193, 196, 198, 200, 203, 205, 208, 210, 213, 215, 218, 220, 223, 225, 228, 231, 233, 236, 239, 241, 244, 247, 249, 252, 255,
]
export const gamma8 = (b: number): number => gammaT[u8(b)]
export const gamma32 = (c: number): number => c // WLED gamma-corrects colors; our strip never has

// ---- the segment (one per strip: no segments, mirroring or grouping here)
/** Heap guard, as the firmware's kMaxData: past it an effect falls back to mode_static. */
const kMaxData = 4096
const pxIndex = (i: number): number => i & 0xffff // WLED's virtual-strip tag (indexToVStrip): one strip here

export class Segment {
  speed = 128
  intensity = 128
  custom1 = DEFAULT_C1
  custom2 = DEFAULT_C2
  custom3 = DEFAULT_C3
  check1 = false
  check2 = false
  check3 = false
  colors = [0, 0, 0]
  palette = 0
  call = 0
  step = 0 // uint32: keep it with u32()
  aux0 = 0 // uint16: keep it with u16()
  aux1 = 0
  /** SEGENV.data, zeroed by allocateData. View structs through `dataView`. */
  data: Uint8Array | null = null
  dataView: DataView | null = null
  _dataLen = 0
  next_time = 0
  _w = 1
  _h = 1
  _px: Uint32Array = new Uint32Array(1)
  _currentPalette = new CRGBPalette16()

  is2D(): boolean { return this._h > 1 }
  virtualWidth(): number { return this._w }
  virtualHeight(): number { return this._h }
  virtualLength(): number { return this._w * this._h }
  length(): number { return this._w * this._h }
  width(): number { return this._w }
  height(): number { return this._h }
  nrOfVStrips(): number { return 1 }
  isActive(): boolean { return true }
  currentColor(slot: number): number { return slot < NUM_COLORS ? this.colors[slot] : 0 }

  allocateData(len: number): boolean {
    if (len === 0) return false
    if (this.data && this._dataLen >= len) {
      if (this.call === 0) this.data.fill(0, 0, len)
      return true
    }
    this.deallocateData()
    if (len > kMaxData) return false
    this.data = new Uint8Array(len)
    this.dataView = new DataView(this.data.buffer)
    this._dataLen = len
    return true
  }
  deallocateData(): void { this.data = null; this.dataView = null; this._dataLen = 0 }

  /** setPixelColor(i, uint32 | CRGB) or (i, r, g, b[, w]); a float i (normalized 0..1) is the anti-aliased overload. */
  setPixelColor(i: number, c: Color | number, g?: number, b?: number, w = 0): void {
    const col = g !== undefined ? RGBW32(c as number, g, b ?? 0, w) : toU32(c)
    i = pxIndex(Math.trunc(i)) // C's int parameter
    if (i >= this.virtualLength()) return
    this._px[i] = col & 0xffffff
  }
  /** WLED's setPixelColor(float i, col, aa): call it explicitly (JS can't tell 1 from 1.0). */
  setPixelColorF(i: number, c: Color, aa = true): void {
    const col = toU32(c)
    const vStrip = ftoi(f32(i / 10))
    i = f32(i - ftoi(i))
    if (i < 0 || i > 1) return
    const fC = f32(i * (this.virtualLength() - 1))
    if (aa) {
      const iL = u32(roundf(f32(fC - f32(0.49))))
      const iR = u32(roundf(f32(fC + f32(0.49))))
      const dL = f32(f32(fC - iL) * f32(fC - iL))
      const dR = f32(f32(iR - fC) * f32(iR - fC))
      let cIL = this.getPixelColor(iL | (vStrip << 16))
      let cIR = this.getPixelColor(iR | (vStrip << 16))
      if (iR !== iL) {
        cIL = color_blend(col, cIL, u8(ftoi(f32(dL * 255))))
        this.setPixelColor(iL | (vStrip << 16), cIL)
        cIR = color_blend(col, cIR, u8(ftoi(f32(dR * 255))))
        this.setPixelColor(iR | (vStrip << 16), cIR)
      } else this.setPixelColor(iL | (vStrip << 16), col)
    } else this.setPixelColor(ftoi(roundf(fC)) | (vStrip << 16), col)
  }
  getPixelColor(i: number): number {
    i = pxIndex(Math.trunc(i))
    if (i >= this.virtualLength()) return 0
    return this._px[i]
  }
  blendPixelColor(n: number, color: Color, blend: number): void { this.setPixelColor(n, color_blend(this.getPixelColor(n), toU32(color), blend)) }
  addPixelColor(n: number, color: Color, fast = false): void { this.setPixelColor(n, color_add(this.getPixelColor(n), toU32(color), fast)) }
  fadePixelColor(n: number, fade: number): void { this.setPixelColor(n, color_fade(this.getPixelColor(n), fade, true)) }

  fill(c: Color): void { this._px.fill(toU32(c) & 0xffffff, 0, this.virtualLength()) }
  fade_out(rate: number): void {
    rate = u8((256 - u8(rate)) >> 1)
    const mappedRate = div(256, rate + 1)
    for (let i = 0; i < this.virtualLength(); i++) {
      let color = this._px[i]
      if (color === this.colors[1]) continue
      for (let b = 0; b < 32; b += 8) {
        const c2 = (this.colors[1] >>> b) & 0xff
        const c1 = (color >>> b) & 0xff
        let delta = div((c2 - c1) * mappedRate, 256)
        if (delta === 0) delta += c2 === c1 ? 0 : c2 > c1 ? 1 : -1
        color = u32(color & ~(0xff << b))
        color = u32(color | (((c1 + delta) & 0xff) << b))
      }
      this._px[i] = color & 0xffffff
    }
  }
  fadeToBlackBy(fadeBy: number): void {
    fadeBy = u8(fadeBy)
    if (fadeBy === 0) return
    for (let i = 0; i < this.virtualLength(); i++) this._px[i] = color_fade(this._px[i], 255 - fadeBy)
  }
  blur(blur_amount: number, smear = false): void {
    blur_amount = u8(blur_amount)
    if (blur_amount === 0) return
    if (this.is2D()) { this.blur2D(blur_amount, smear); return }
    const keep = smear ? 255 : 255 - blur_amount
    const seep = blur_amount >> (1 + (smear ? 1 : 0))
    const vlength = this.virtualLength()
    let carryover = BLACK, lastnew = BLACK, last = BLACK, curnew = BLACK
    for (let i = 0; i < vlength; i++) {
      const cur = this.getPixelColor(i)
      const part = color_fade(cur, seep)
      curnew = color_fade(cur, keep)
      if (i > 0) {
        if (carryover) curnew = color_add(curnew, carryover, true)
        const prev = color_add(lastnew, part, true)
        if (last !== prev) this.setPixelColor(i - 1, prev)
      } else this.setPixelColor(i, curnew)
      lastnew = curnew
      last = cur
      carryover = part
    }
    this.setPixelColor(vlength - 1, curnew)
  }
  color_wheel(pos: number): number {
    if (this.palette) return this.color_from_palette(pos, false, true, 0)
    pos = 255 - u8(pos)
    if (pos < 85) return RGBW32(255 - pos * 3, 0, pos * 3, 0)
    if (pos < 170) { pos -= 85; return RGBW32(0, pos * 3, 255 - pos * 3, 0) }
    pos -= 170
    return RGBW32(pos * 3, 255 - pos * 3, 0, 0)
  }
  color_from_palette(i: number, mapping: boolean, wrap: boolean, mcol: number, pbri = 255): number {
    i = u16(i); mcol = u8(mcol); pbri = u8(pbri)
    const color = gamma32(this.currentColor(mcol))
    if (this.palette === 0 && mcol < NUM_COLORS) return pbri === 255 ? color : color_fade(color, pbri, true)
    let paletteIndex = i
    if (mapping && this.virtualLength() > 1) paletteIndex = div(i * 255, this.virtualLength() - 1)
    if (!wrap && strip.paletteBlend !== 3) paletteIndex = scale8(paletteIndex, 240)
    const c = ColorFromPalette(this._currentPalette, paletteIndex, pbri, strip.paletteBlend === 3 ? NOBLEND : LINEARBLEND)
    return RGBW32(c.r, c.g, c.b, 0)
  }
  gamma8(b: number): number { return gamma8(b) }

  // 2D (FX_2Dfcn.cpp)
  XY(x: number, y: number): number { return u16((x % this._w) + (y % this._h) * this._w) }
  /** setPixelColorXY(x, y, uint32 | CRGB) or (x, y, r, g, b[, w]). */
  setPixelColorXY(x: number, y: number, c: Color | number, g?: number, b?: number, w = 0): void {
    const col = g !== undefined ? RGBW32(c as number, g, b ?? 0, w) : toU32(c)
    x = Math.trunc(x); y = Math.trunc(y) // C's int parameters
    if (x < 0 || y < 0 || x >= this._w || y >= this._h) return
    this._px[x + y * this._w] = col & 0xffffff
  }
  /** WLED's setPixelColorXY(float x, float y, col, aa). */
  setPixelColorXYF(x: number, y: number, c: Color, aa = true): void {
    const col = toU32(c)
    if (x < 0 || x > 1 || y < 0 || y > 1) return
    const cols = this._w, rows = this._h
    const fX = f32(x * (cols - 1))
    const fY = f32(y * (rows - 1))
    if (aa) {
      const xL = u32(roundf(f32(fX - f32(0.49)))), xR = u32(roundf(f32(fX + f32(0.49))))
      const yT = u32(roundf(f32(fY - f32(0.49)))), yB = u32(roundf(f32(fY + f32(0.49))))
      const dL = f32(f32(fX - xL) * f32(fX - xL)), dR = f32(f32(xR - fX) * f32(xR - fX))
      const dT = f32(f32(fY - yT) * f32(fY - yT)), dB = f32(f32(yB - fY) * f32(yB - fY))
      const cXLYT = this.getPixelColorXY(xL, yT), cXRYT = this.getPixelColorXY(xR, yT)
      const cXLYB = this.getPixelColorXY(xL, yB), cXRYB = this.getPixelColorXY(xR, yB)
      const k = (v: number) => u8(ftoi(f32(v * 255)))
      if (xL !== xR && yT !== yB) {
        this.setPixelColorXY(xL, yT, color_blend(col, cXLYT, k(sqrtf(f32(dL * dT)))))
        this.setPixelColorXY(xR, yT, color_blend(col, cXRYT, k(sqrtf(f32(dR * dT)))))
        this.setPixelColorXY(xL, yB, color_blend(col, cXLYB, k(sqrtf(f32(dL * dB)))))
        this.setPixelColorXY(xR, yB, color_blend(col, cXRYB, k(sqrtf(f32(dR * dB)))))
      } else if (xR !== xL && yT === yB) {
        this.setPixelColorXY(xR, yT, color_blend(col, cXLYT, k(dL)))
        this.setPixelColorXY(xR, yT, color_blend(col, cXRYT, k(dR)))
      } else if (xR === xL && yT !== yB) {
        this.setPixelColorXY(xR, yT, color_blend(col, cXLYT, k(dT)))
        this.setPixelColorXY(xL, yB, color_blend(col, cXLYB, k(dB)))
      } else this.setPixelColorXY(xL, yT, col)
    } else this.setPixelColorXY(u16(ftoi(roundf(fX))), u16(ftoi(roundf(fY))), col)
  }
  getPixelColorXY(x: number, y: number): number {
    x = Math.trunc(x); y = Math.trunc(y)
    if (x < 0 || y < 0 || x >= this._w || y >= this._h) return 0
    return this._px[x + y * this._w]
  }
  blendPixelColorXY(x: number, y: number, color: Color, blend: number): void { this.setPixelColorXY(x, y, color_blend(this.getPixelColorXY(x, y), toU32(color), blend)) }
  addPixelColorXY(x: number, y: number, color: Color, fast = false): void { this.setPixelColorXY(x, y, color_add(this.getPixelColorXY(x, y), toU32(color), fast)) }
  fadePixelColorXY(x: number, y: number, fade: number): void { this.setPixelColorXY(x, y, color_fade(this.getPixelColorXY(x, y), fade, true)) }
  private blurLine(n: number, get: (k: number) => number, put: (k: number, c: number) => void, blur_amount: number, smear: boolean, seepShift: number): void {
    const keep = smear ? 255 : 255 - blur_amount
    const seep = blur_amount >> seepShift
    let carryover = BLACK, lastnew = BLACK, last = BLACK, curnew = BLACK
    for (let k = 0; k < n; k++) {
      const cur = get(k)
      const part = color_fade(cur, seep)
      curnew = color_fade(cur, keep)
      if (k > 0) {
        if (carryover) curnew = color_add(curnew, carryover, true)
        const prev = color_add(lastnew, part, true)
        if (last !== prev) put(k - 1, prev)
      } else put(k, curnew)
      lastnew = curnew
      last = cur
      carryover = part
    }
    put(n - 1, curnew)
  }
  blurRow(row: number, blur_amount: number, smear = false): void {
    blur_amount = u8(blur_amount)
    if (blur_amount === 0 || row >= this._h) return
    this.blurLine(this._w, (x) => this.getPixelColorXY(x, row), (x, c) => this.setPixelColorXY(x, row, c), blur_amount, smear, 1)
  }
  blurCol(col: number, blur_amount: number, smear = false): void {
    blur_amount = u8(blur_amount)
    if (blur_amount === 0 || col >= this._w) return
    this.blurLine(this._h, (y) => this.getPixelColorXY(col, y), (y, c) => this.setPixelColorXY(col, y, c), blur_amount, smear, 1)
  }
  blurRows(blur_amount: number, smear = false): void { for (let r = 0; r < this._h; r++) this.blurRow(r, blur_amount, smear) }
  blurCols(blur_amount: number, smear = false): void { for (let c = 0; c < this._w; c++) this.blurCol(c, blur_amount, smear) }
  /** Note the C++ blur2D carries `lastnew`/`last` across rows (they are declared outside the row loop). */
  blur2D(blur_amount: number, smear = false): void {
    blur_amount = u8(blur_amount)
    if (blur_amount === 0) return
    const cols = this._w, rows = this._h
    const keep = smear ? 255 : 255 - blur_amount
    const seep = blur_amount >> (1 + (smear ? 1 : 0))
    let lastnew = BLACK, last = BLACK
    for (let row = 0; row < rows; row++) {
      let carryover = BLACK, curnew = BLACK
      for (let x = 0; x < cols; x++) {
        const cur = this.getPixelColorXY(x, row)
        const part = color_fade(cur, seep)
        curnew = color_fade(cur, keep)
        if (x > 0) {
          if (carryover) curnew = color_add(curnew, carryover, true)
          const prev = color_add(lastnew, part, true)
          if (last !== prev) this.setPixelColorXY(x - 1, row, prev)
        } else this.setPixelColorXY(x, row, curnew)
        lastnew = curnew
        last = cur
        carryover = part
      }
      this.setPixelColorXY(cols - 1, row, curnew)
    }
    for (let col = 0; col < cols; col++) {
      let carryover = BLACK, curnew = BLACK
      for (let y = 0; y < rows; y++) {
        const cur = this.getPixelColorXY(col, y)
        const part = color_fade(cur, seep)
        curnew = color_fade(cur, keep)
        if (y > 0) {
          if (carryover) curnew = color_add(curnew, carryover, true)
          const prev = color_add(lastnew, part, true)
          if (last !== prev) this.setPixelColorXY(col, y - 1, prev)
        } else this.setPixelColorXY(col, y, curnew)
        lastnew = curnew
        last = cur
        carryover = part
      }
      this.setPixelColorXY(col, rows - 1, curnew)
    }
  }
  moveX(delta: number, wrap = false): void {
    delta = i8(delta)
    const cols = this._w, rows = this._h
    if (!delta || Math.abs(delta) >= cols) return
    const nc = new Uint32Array(cols)
    for (let y = 0; y < rows; y++) {
      if (delta > 0) {
        for (let x = 0; x < cols - delta; x++) nc[x] = this.getPixelColorXY(x + delta, y)
        for (let x = cols - delta; x < cols; x++) nc[x] = this.getPixelColorXY(wrap ? x + delta - cols : x, y)
      } else {
        for (let x = cols - 1; x >= -delta; x--) nc[x] = this.getPixelColorXY(x + delta, y)
        for (let x = -delta - 1; x >= 0; x--) nc[x] = this.getPixelColorXY(wrap ? x + delta + cols : x, y)
      }
      for (let x = 0; x < cols; x++) this.setPixelColorXY(x, y, nc[x])
    }
  }
  moveY(delta: number, wrap = false): void {
    delta = i8(delta)
    const cols = this._w, rows = this._h
    if (!delta || Math.abs(delta) >= rows) return
    const nc = new Uint32Array(rows)
    for (let x = 0; x < cols; x++) {
      if (delta > 0) {
        for (let y = 0; y < rows - delta; y++) nc[y] = this.getPixelColorXY(x, y + delta)
        for (let y = rows - delta; y < rows; y++) nc[y] = this.getPixelColorXY(x, wrap ? y + delta - rows : y)
      } else {
        for (let y = rows - 1; y >= -delta; y--) nc[y] = this.getPixelColorXY(x, y + delta)
        for (let y = -delta - 1; y >= 0; y--) nc[y] = this.getPixelColorXY(x, wrap ? y + delta + rows : y)
      }
      for (let y = 0; y < rows; y++) this.setPixelColorXY(x, y, nc[y])
    }
  }
  move(dir: number, delta: number, wrap = false): void {
    delta = u8(delta)
    if (delta === 0) return
    switch (u8(dir)) {
      case 0: this.moveX(delta, wrap); break
      case 1: this.moveX(delta, wrap); this.moveY(delta, wrap); break
      case 2: this.moveY(delta, wrap); break
      case 3: this.moveX(-delta, wrap); this.moveY(delta, wrap); break
      case 4: this.moveX(-delta, wrap); break
      case 5: this.moveX(-delta, wrap); this.moveY(-delta, wrap); break
      case 6: this.moveY(-delta, wrap); break
      case 7: this.moveX(delta, wrap); this.moveY(-delta, wrap); break
    }
  }
  drawCircle(cx: number, cy: number, radius: number, c: Color, soft = false): void {
    const col = toU32(c)
    cx = u16(cx); cy = u16(cy); radius = u8(radius)
    if (radius === 0) return
    const S = (x: number, y: number, v: number) => this.setPixelColorXY(u16(x), u16(y), v)
    const Gx = (x: number, y: number) => this.getPixelColorXY(u16(x), u16(y))
    if (soft) {
      const rsq = radius * radius
      let x = 0, y = radius, oldFade = 0
      while (x < y) {
        const yf = sqrtf(rsq - x * x)
        const fade = u32(ftoi(f32(f32(0xffff) * f32(ceilf(yf) - yf))))
        if (oldFade > fade) y--
        oldFade = fade
        S(cx + x, cy + y, color_blend(col, Gx(cx + x, cy + y), fade, true))
        S(cx - x, cy + y, color_blend(col, Gx(cx - x, cy + y), fade, true))
        S(cx + x, cy - y, color_blend(col, Gx(cx + x, cy - y), fade, true))
        S(cx - x, cy - y, color_blend(col, Gx(cx - x, cy - y), fade, true))
        S(cx + y, cy + x, color_blend(col, Gx(cx + y, cy + x), fade, true))
        S(cx - y, cy + x, color_blend(col, Gx(cx - y, cy + x), fade, true))
        S(cx + y, cy - x, color_blend(col, Gx(cx + y, cy - x), fade, true))
        S(cx - y, cy - x, color_blend(col, Gx(cx - y, cy - x), fade, true))
        S(cx + x, cy + y - 1, color_blend(Gx(cx + x, cy + y - 1), col, fade, true))
        S(cx - x, cy + y - 1, color_blend(Gx(cx - x, cy + y - 1), col, fade, true))
        S(cx + x, cy - y + 1, color_blend(Gx(cx + x, cy - y + 1), col, fade, true))
        S(cx - x, cy - y + 1, color_blend(Gx(cx - x, cy - y + 1), col, fade, true))
        S(cx + y - 1, cy + x, color_blend(Gx(cx + y - 1, cy + x), col, fade, true))
        S(cx - y + 1, cy + x, color_blend(Gx(cx - y + 1, cy + x), col, fade, true))
        S(cx + y - 1, cy - x, color_blend(Gx(cx + y - 1, cy - x), col, fade, true))
        S(cx - y + 1, cy - x, color_blend(Gx(cx - y + 1, cy - x), col, fade, true))
        x++
      }
    } else {
      let d = 3 - 2 * radius
      let y = radius, x = 0
      while (y >= x) {
        S(cx + x, cy + y, col); S(cx - x, cy + y, col); S(cx + x, cy - y, col); S(cx - x, cy - y, col)
        S(cx + y, cy + x, col); S(cx - y, cy + x, col); S(cx + y, cy - x, col); S(cx - y, cy - x, col)
        x++
        if (d > 0) { y--; d += 4 * (x - y) + 10 } else d += 4 * x + 6
      }
    }
  }
  fillCircle(cx: number, cy: number, radius: number, c: Color, soft = false): void {
    const col = toU32(c)
    cx = u16(cx); cy = u16(cy); radius = u8(radius)
    if (radius === 0) return
    if (soft) this.drawCircle(cx, cy, radius, col, soft)
    const cols = this._w, rows = this._h
    for (let y = -radius; y <= radius; y++) {
      for (let x = -radius; x <= radius; x++) {
        if (x * x + y * y <= radius * radius && cx + x >= 0 && cy + y >= 0 && cx + x < cols && cy + y < rows) this.setPixelColorXY(u16(cx + x), u16(cy + y), col)
      }
    }
  }
  drawLine(x0: number, y0: number, x1: number, y1: number, c: Color, soft = false): void {
    const col = toU32(c)
    x0 = u16(x0); y0 = u16(y0); x1 = u16(x1); y1 = u16(y1)
    const cols = this._w, rows = this._h
    if (x0 >= cols || x1 >= cols || y0 >= rows || y1 >= rows) return
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1
    const dy = Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1
    if (dx + dy === 0) { this.setPixelColorXY(x0, y0, col); return }
    if (soft) {
      const steep = dy > dx
      if (steep) { [x0, y0] = [y0, x0]; [x1, y1] = [y1, x1] }
      if (x0 > x1) { [x0, x1] = [x1, x0]; [y0, y1] = [y1, y0] }
      const gradient = x1 - x0 === 0 ? 1 : f32(f32(y1 - y0) / f32(x1 - x0))
      let intersectY = f32(y0)
      for (let x = x0; x <= x1; x++) {
        const keep = u32(ftoi(f32(f32(0xffff) * f32(intersectY - ftoi(intersectY)))))
        const seep = 0xffff - keep
        let y = ftoi(intersectY)
        let xx = x
        if (steep) [xx, y] = [y, xx]
        this.setPixelColorXY(xx, y, color_blend(col, this.getPixelColorXY(xx, y), keep, true))
        const x2 = xx + (steep ? 1 : 0), y2 = y + (steep ? 0 : 1)
        this.setPixelColorXY(x2, y2, color_blend(col, this.getPixelColorXY(x2, y2), seep, true))
        intersectY = f32(intersectY + gradient)
      }
    } else {
      let err = div(dx > dy ? dx : -dy, 2)
      for (;;) {
        this.setPixelColorXY(x0, y0, col)
        if (x0 === x1 && y0 === y1) break
        const e2 = err
        if (e2 > -dx) { err -= dy; x0 = u16(x0 + sx) }
        if (e2 < dy) { err += dx; y0 = u16(y0 + sy) }
      }
    }
  }
  wu_pixel(x: number, y: number, c: CRGB): void {
    x = u32(x); y = u32(y)
    const xx = x & 0xff, yy = y & 0xff, ix = 255 - xx, iy = 255 - yy
    const WU = (a: number, b: number) => u8((a * b + a + b) >> 8)
    const wu = [WU(ix, iy), WU(xx, iy), WU(ix, yy), WU(xx, yy)]
    for (let i = 0; i < 4; i++) {
      const wx = (x >>> 8) + (i & 1)
      const wy = (y >>> 8) + ((i >> 1) & 1)
      const led = new CRGB(this.getPixelColorXY(wx, wy))
      const old = led.clone()
      led.r = qadd8(led.r, (c.r * wu[i]) >> 8)
      led.g = qadd8(led.g, (c.g * wu[i]) >> 8)
      led.b = qadd8(led.b, (c.b * wu[i]) >> 8)
      if (!crgbEq(led, old)) this.setPixelColorXY(wx, wy, led)
    }
  }
  nscale8(scale: number): void { for (let i = 0; i < this._w * this._h; i++) this._px[i] = color_fade(this._px[i], scale) }
}

/** The segment the running effect draws on (WLED's SEGMENT / SEGENV). */
export let SEGMENT = new Segment()
export const setSegment = (s: Segment): void => { SEGMENT = s }
// WLED's macros, as functions (they read the live segment)
export const SEGLEN = (): number => SEGMENT.virtualLength()
export const SEG_W = (): number => SEGMENT.virtualWidth()
export const SEG_H = (): number => SEGMENT.virtualHeight()
export const SEGCOLOR = (x: number): number => SEGMENT.currentColor(x)
export const SEGPALETTE = (): CRGBPalette16 => SEGMENT._currentPalette
export const PALETTE_SOLID_WRAP = (): boolean => strip.paletteBlend === 1 || strip.paletteBlend === 3
export const PALETTE_MOVING_WRAP = (): boolean => !(strip.paletteBlend === 2 || (strip.paletteBlend === 0 && SEGMENT.speed === 0))
export const indexToVStrip = (index: number, stripNr: number): number => index | ((stripNr + 1) << 16)

export function mode_static(): number {
  SEGMENT.fill(SEGCOLOR(0))
  return 350
}
export type ModeFn = () => number
