// Shared theta-rho geometry helpers. Single source of truth used by BOTH the
// build script (scripts/gen-pattern-geometry.mjs, native ESM) and the app
// (Metro resolves .mjs from sourceExts). Keep it dependency-free.
//
// Pattern files are theta-rho: lines of "<theta> <rho>" (theta in radians,
// possibly many full turns / unwound; rho 0..1). We DECIMATE by uniform index
// stride so the point-index <-> progress-fraction mapping stays linear (the
// board reports `progress` as a fraction). We store decimated theta-rho (which
// preserves the winding); xy is derived only for on-screen rendering.

export const MAX_POINTS = 15000
export const ROUND = 3 // decimal places for derived x/y

/** Parse .thr text into [[theta, rho], ...] numbers (skips comments/blanks). */
export function parseThr(text) {
  const pts = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const sp = line.split(/\s+/)
    if (sp.length < 2) continue
    const theta = Number(sp[0])
    const rho = Number(sp[1])
    if (!Number.isFinite(theta) || !Number.isFinite(rho)) continue
    pts.push([theta, rho])
  }
  return pts
}

/** The trimmed valid "<theta> <rho>" lines, original strings preserved. */
export function dataLines(text) {
  const out = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const sp = line.split(/\s+/)
    if (sp.length < 2) continue
    if (!Number.isFinite(Number(sp[0])) || !Number.isFinite(Number(sp[1]))) continue
    out.push(line)
  }
  return out
}

/** Uniform-stride decimation to <= max items. Generic over arrays. */
export function decimate(arr, max = MAX_POINTS) {
  if (arr.length <= max) return arr
  const stride = Math.ceil(arr.length / max)
  const out = []
  for (let i = 0; i < arr.length; i += stride) out.push(arr[i])
  // Always include the final element so the path closes where it ends.
  if (out[out.length - 1] !== arr[arr.length - 1]) out.push(arr[arr.length - 1])
  return out
}

/** Polar [[theta,rho],...] -> unit-circle [[x,y],...], rounded to ROUND dp. */
export function toXY(pts) {
  const r = 10 ** ROUND
  return pts.map(([theta, rho]) => {
    const x = Math.round(rho * Math.cos(theta) * r) / r
    const y = Math.round(rho * Math.sin(theta) * r) / r
    return [x, y]
  })
}

/** .thr text -> decimated unit-circle xy points, for rendering. */
export function thrToXY(text, max = MAX_POINTS) {
  return toXY(decimate(parseThr(text), max))
}

/**
 * .thr text -> decimated .thr text (plain "<theta> <rho>" lines, original
 * strings preserved). Used to bundle/store the pushable copy of a pattern.
 */
export function decimateThrText(text, max = MAX_POINTS) {
  const lines = decimate(dataLines(text), max)
  return lines.join('\n') + '\n'
}
