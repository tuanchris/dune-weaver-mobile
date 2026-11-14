// The path the ball takes, laid out on a preview, for the Fast playback views:
// Browse's preview player (components/PatternPlayer.tsx) and the Now Playing
// drawing (components/LiveDrawing.tsx). A port of dune-weaver-viewer's ThrPath
// (mac/Shared/ThrPath.swift): every point on screen with the path length up to
// it, so the ball can move at constant speed, and with where in the FILE it is,
// so the drawing can follow the table (the firmware's progress is the share of
// the file executed).
//  - .thr: the ball moves linearly in theta and rho, so a long move is a spiral
//    arc. Moves are subdivided in polar space (0.01 table radii a piece) before
//    projecting, rho is clamped to 0..1, orientation as dune-weaver's previews.
//  - G-code: straight moves between endpoints, in mm on the table.
// Then simplified to a quarter point on screen, which cuts a 150k-point
// pattern to ~20k without changing how it looks.
import { File } from 'expo-file-system'
import { bareName, useLibrary } from '../stores/useLibrary'
import { isGcode } from './gcode'
import { toScreen } from './patternGeometry'
import { rectToScreen } from '../components/RectTable'
// @ts-ignore - shared plain-ESM module (the build script uses it too)
import { gcodeExtent, gcodePoints, PREVIEW_INSET } from './gcodeGeometry.mjs'

export interface PlaybackPath {
  xs: Float64Array
  ys: Float64Array
  /** Path length up to each point, in screen points. */
  dist: Float64Array
  /** How far into the file (0..1) the table is when the ball reaches each point. */
  file: Float64Array
  total: number
  /** Table coordinates (mm for G-code, the unit disc for .thr) -> this preview. */
  place: (x: number, y: number) => [number, number]
}

/** Longest straight piece of a subdivided .thr move, in table radii (the viewer's). */
const THR_STEP = 0.01
/** How far the simplified path may stray from the true one, in screen points. */
const TOL = 0.25

/** .thr text -> unit-disc points (y down, as dune-weaver's previews), arcs kept,
 * each with its offset into the text. */
function thrPoints(text: string, xy: number[], at: number[]): void {
  let end = 0
  let prevEnd = 0
  let lastT = 0
  let lastR = 0
  let first = true
  for (const raw of text.split('\n')) {
    end += raw.length + 1
    const line = raw.split('#')[0].trim()
    if (!line) continue
    const sp = line.split(/\s+/)
    const theta = Number(sp[0])
    const r = Number(sp[1])
    if (sp.length < 2 || !Number.isFinite(theta) || !Number.isFinite(r)) continue
    const rho = Math.min(Math.max(r, 0), 1)
    const t0 = first ? theta : lastT
    const r0 = first ? rho : lastR
    const e0 = first ? end : prevEnd
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(theta - t0) * Math.max(r0, rho), Math.abs(rho - r0)) / THR_STEP))
    for (let j = first ? n : 1; j <= n; j++) {
      const s = j / n
      const t = t0 + (theta - t0) * s
      const p = r0 + (rho - r0) * s
      xy.push(p * Math.cos(t), p * Math.sin(t))
      at.push(e0 + (end - e0) * s)
    }
    lastT = theta
    lastR = rho
    prevEnd = end
    first = false
  }
}

/** Ramer-Douglas-Peucker over points [from, to] of interleaved x,y screen
 * points (iterative); marks the ones to keep. */
function simplifyRun(xy: number[], from: number, to: number, tol: number, keep: Uint8Array): void {
  keep[from] = keep[to] = 1
  const stack = [from, to]
  while (stack.length) {
    const j = stack.pop()!
    const i = stack.pop()!
    if (j <= i + 1) continue
    const ax = xy[2 * i]
    const ay = xy[2 * i + 1]
    const dx = xy[2 * j] - ax
    const dy = xy[2 * j + 1] - ay
    const len = Math.hypot(dx, dy)
    let best = -1
    let far = 0
    for (let k = i + 1; k < j; k++) {
      const px = xy[2 * k] - ax
      const py = xy[2 * k + 1] - ay
      const dd = len === 0 ? Math.hypot(px, py) : Math.abs(dx * py - dy * px) / len
      if (dd > far) {
        far = dd
        best = k
      }
    }
    if (far > tol) {
      keep[best] = 1
      stack.push(i, best, best, j)
    }
  }
}

/** Runs of CHUNK points: a long spiral is near RDP's worst case (a 117k-point
 * pattern took 1.2 s whole, 0.2 s in runs), and a cut keeps one extra point. */
const CHUNK = 1024

async function build(name: string, width: number, height: number): Promise<PlaybackPath | null> {
  const local = await useLibrary.getState().resolveThr(name)
  if (!local) return null
  const text = await new File(local.uri).text()
  // Let the spinner draw before the (up to a few hundred ms) crunch.
  await new Promise((r) => setTimeout(r, 0))
  const xy: number[] = []
  const at: number[] = []
  let place: PlaybackPath['place']
  if (isGcode(name)) {
    const pts = gcodePoints(text, at) as [number, number][]
    // Framed by the drawing's own extent, as its preview image is: a pattern that
    // runs past the table's travel (some reach y 320 on a 307 table) stays whole.
    const size = gcodeExtent(pts) as [number, number] | null
    if (!size) return null
    place = rectToScreen(size, width, height)
    for (const [x, y] of pts) xy.push(...place(x, y))
  } else {
    const unit: number[] = []
    thrPoints(text, unit, at)
    place = (x, y) => toScreen([x, y], width, 1 - PREVIEW_INSET)
    for (let i = 0; i < unit.length; i += 2) xy.push(...place(unit[i], unit[i + 1]))
  }
  const n = xy.length / 2
  if (n < 2) return null
  const keep = new Uint8Array(n)
  for (let s = 0; s < n - 1; s += CHUNK - 1) simplifyRun(xy, s, Math.min(n - 1, s + CHUNK - 1), TOL, keep)
  let m = 0
  for (let k = 0; k < n; k++) m += keep[k]
  const xs = new Float64Array(m)
  const ys = new Float64Array(m)
  const dist = new Float64Array(m)
  const file = new Float64Array(m)
  const size = Math.max(1, text.length)
  for (let k = 0, o = 0; k < n; k++) {
    if (!keep[k]) continue
    xs[o] = xy[2 * k]
    ys[o] = xy[2 * k + 1]
    file[o] = at[k] / size
    if (o > 0) dist[o] = dist[o - 1] + Math.hypot(xs[o] - xs[o - 1], ys[o] - ys[o - 1])
    o++
  }
  return { xs, ys, dist, file, total: dist[m - 1], place }
}

// The last few built, so reopening a pattern doesn't redo the work.
const cache = new Map<string, Promise<PlaybackPath | null>>()

/** The playback path for a pattern the app holds (bundled or imported), laid out
 * on a `width`×`height` preview (G-code framed by its own extent, like its
 * preview image). Null when the app has no copy of the pattern. */
export function playbackPath(name: string, width: number, height: number): Promise<PlaybackPath | null> {
  // The import's id too: a re-imported or updated file under the same name is a new path.
  const entry = useLibrary.getState().patterns.find((p) => p.name === bareName(name))?.id ?? ''
  const key = `${name}|${entry}|${width}|${height}`
  let p = cache.get(key)
  if (!p) {
    p = build(name, width, height)
      .catch((e) => {
        console.warn(`playback path for ${name} failed`, e)
        return null
      })
      // Keep only successes: a cached null would make "try again" fail without trying.
      .then((built) => {
        if (!built) cache.delete(key)
        return built
      })
    cache.set(key, p)
    if (cache.size > 6) cache.delete(cache.keys().next().value!)
  }
  return p
}

export interface Reveal {
  /** The last point fully drawn. */
  index: number
  /** Where the ball is: on the segment after `index`. */
  x: number
  y: number
}

/** How much of the path is drawn, and where the ball is, after `fraction` of the
 * path's LENGTH (constant speed: the preview player) or of the FILE (where the
 * table is: the Now Playing drawing). */
export function reveal(path: PlaybackPath, fraction: number, by: 'length' | 'file'): Reveal {
  const key = by === 'length' ? path.dist : path.file
  const last = key.length - 1
  const target = Math.max(0, Math.min(1, fraction)) * (by === 'length' ? path.total : 1)
  const lo = indexAt(key, target)
  if (lo >= last) return { index: last, x: path.xs[last], y: path.ys[last] }
  const span = key[lo + 1] - key[lo]
  const s = span > 0 ? Math.max(0, Math.min(1, (target - key[lo]) / span)) : 0
  return {
    index: lo,
    x: path.xs[lo] + (path.xs[lo + 1] - path.xs[lo]) * s,
    y: path.ys[lo] + (path.ys[lo + 1] - path.ys[lo]) * s,
  }
}

/** The last index whose (ascending) key is <= target; 0 when none is. */
function indexAt(key: Float64Array, target: number): number {
  let lo = 0
  let hi = key.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (key[mid] <= target) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** How much of the file either side of the reported progress `locate` searches. */
const NEAR = 0.02

/**
 * Where the table's ball is along the path, as a share of the path's LENGTH:
 * the point nearest `ball` (its polled position in table coordinates: mm, or
 * the unit disc), searched only within NEAR of `fraction` of the file, so a
 * path that crosses itself can't pull the drawing onto another pass. Where the
 * path retraces itself, the candidate nearer the file's estimate wins. Without
 * a ball, it's where the file share alone puts it.
 */
export function locate(path: PlaybackPath, fraction: number, ball?: readonly [number, number] | null): number {
  if (path.total <= 0) return 0
  const f = Math.max(0, Math.min(1, fraction))
  const r = reveal(path, f, 'file')
  const est = path.dist[r.index] + Math.hypot(r.x - path.xs[r.index], r.y - path.ys[r.index])
  if (!ball) return est / path.total
  const [px, py] = path.place(ball[0], ball[1])
  const last = path.xs.length - 1
  const from = indexAt(path.file, f - NEAR)
  const to = Math.min(last, indexAt(path.file, f + NEAR) + 1)
  let best = Infinity
  let at = est
  for (let i = from; i < to; i++) {
    const ax = path.xs[i]
    const ay = path.ys[i]
    const dx = path.xs[i + 1] - ax
    const dy = path.ys[i + 1] - ay
    const L = dx * dx + dy * dy
    const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0
    const d = Math.hypot(ax + dx * t - px, ay + dy * t - py)
    const cand = path.dist[i] + (path.dist[i + 1] - path.dist[i]) * t
    if (d < best - 0.5 || (d < best + 0.5 && Math.abs(cand - est) < Math.abs(at - est))) {
      best = Math.min(best, d)
      at = cand
    }
  }
  return at / path.total
}
