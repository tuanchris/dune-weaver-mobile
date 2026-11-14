// Inlay style: sand-weaver's inlays (experiments/region-program/inlays.js) for text.
// A host rakes the sand round the letters: a spiral out from the centre (the default),
// or straight lanes; each letter is drawn inside that fill right after the host's last
// pass within `ZONE` of it, so nothing passes it once drawn and the ball's moves
// between letters lie under the host's later passes. Letters are units:
//   region: a filled part (outline + holes): a letter's own lanes across the host's,
//           joined along its own rims, then its outline once round (crisp edge); a
//           symbol's lanes follow its shape (contour/, sand-weaver's contour fill);
//   ring:   one outline (or hole) traced twice round from its door (sand-weaver rule 51);
//   stroke: a single-line word, out to one end along its line and back to the other.
// Lanes: a band across the table round the text, from BAND balls beyond it (`rake` 0)
// through that share of the open sand above and below it, to the whole table (`rake` 1).
// Spiral: a disc BAND balls beyond the furthest unit (`rake` 0) out to the edge (`rake` 1).
// Units are in the frame's units (unit disc, or mm), as seen on the table (y up).

/** Lanes this many balls apart (sand-weaver's fills: 0.25–0.5). */
const PITCH = 0.3
/**
 * A letter is drawn after the host's last pass within this many balls of it. At half a
 * ball the passes after it plow its far side (the sim, 2026-11-14: every letter's lower
 * right worn on the lanes host); at one ball the edge stays crisp, and the move in and
 * out is still short.
 */
const ZONE = 1
/** A band reaches this many balls beyond the text (a stamp label's 1.2). */
const BAND = 1.2
/** The host's lanes run at 45°, the letters' across them. */
const ANGLE = Math.PI / 4

import { generateContourFill } from './contour/contourFill.mjs'

const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

/** Along a closed ring from crossing a to crossing b, the shorter way round (sand-weaver's ringRoute). */
function ringRoute(a, b, ring) {
  const forward = (p, q) => {
    if (p.edge === q.edge && q.u >= p.u) return [p.point, q.point]
    const out = [p.point]
    let e = p.edge
    for (let n = 0; n <= ring.length; n++) {
      e = (e + 1) % ring.length
      out.push(ring[e])
      if (e === q.edge) break
    }
    out.push(q.point)
    return out
  }
  const len = (path) => path.reduce((s, p, i) => (i ? s + dist(path[i - 1], p) : 0), 0)
  const f = forward(a, b)
  const r = forward(b, a).reverse()
  return len(f) <= len(r) ? f : r
}

/**
 * A letter part filled with lanes at angle `phi`, `pitch` apart, entered and left at
 * vertex `door` of its outline (rings[0]); then the outline once round. Every join
 * runs along a rim: a lane's ends lie on the outline, and the gap between two pieces
 * of one lane is bounded by a single rim (a hole, or a notch of the outline).
 */
function fillRegion(rings, phi, pitch, door) {
  const c = Math.cos(phi)
  const s = Math.sin(phi)
  const local = rings.map((r) => r.map(([x, y]) => [x * c + y * s, -x * s + y * c]))
  let lo = Infinity
  let hi = -Infinity
  for (const r of local) for (const [, t] of r) {
    lo = Math.min(lo, t)
    hi = Math.max(hi, t)
  }
  const count = Math.floor((hi - lo) / pitch)
  const first = (lo + hi - (count - 1) * pitch) / 2
  const start = { ring: 0, edge: door, u: 0, point: rings[0][door] }
  const path = [start.point]
  let prev = start
  const go = (to) => {
    path.push(...(prev.ring === to.ring ? ringRoute(prev, to, rings[prev.ring]) : [prev.point, to.point]).slice(1))
    prev = to
  }
  for (let k = 0; k < count; k++) {
    const t = first + k * pitch
    const hits = []
    local.forEach((r, ri) => {
      for (let e = 0; e < r.length; e++) {
        const a = r[e]
        const b = r[(e + 1) % r.length]
        if (a[1] <= t === b[1] <= t) continue
        const u = (t - a[1]) / (b[1] - a[1])
        hits.push({ s: a[0] + (b[0] - a[0]) * u, ring: ri, edge: e, u, point: lerp(rings[ri][e], rings[ri][(e + 1) % r.length], u) })
      }
    })
    hits.sort((a, b) => a.s - b.s)
    const segs = []
    for (let i = 0; i + 1 < hits.length; i += 2) segs.push([hits[i], hits[i + 1]])
    if (k % 2) segs.reverse()
    for (const [a, b] of segs) {
      const [from, to] = k % 2 ? [b, a] : [a, b]
      go(from)
      path.push(to.point)
      prev = to
    }
  }
  go(start)
  const outline = rings[0]
  for (let i = 1; i <= outline.length; i++) path.push(outline[(door + i) % outline.length])
  return path
}

/** Nearest point of a polyline (closed when `closed`) to p: its segment index and point. */
function nearest(line, p, closed) {
  let best = { d: Infinity, i: 0, q: line[0] }
  const n = closed ? line.length : line.length - 1
  for (let i = 0; i < n; i++) {
    const a = line[i]
    const b = line[(i + 1) % line.length]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0
    const q = [a[0] + dx * t, a[1] + dy * t]
    const d = dist(p, q)
    if (d < best.d) best = { d, i, q }
  }
  return best
}

/**
 * A symbol part filled with lanes that follow its shape (sand-weaver's contour fill:
 * level lines of a smoothed distance from its outline and holes, drawn as spirals from
 * the deepest, the outline last). Kept per shape and pitch in the part's OWN frame (its
 * outline's centre, unturned by `rot`), so typing, moving or turning never refills it;
 * only a new size does.
 */
const contours = new Map()
function contourCandidates(table, pitch, ball, rot = 0, fill) {
  // Into the part's own frame, and the fill back out of it.
  const pts = table[0]
  const c = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
  const a = (rot * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  // A turn clockwise as seen on the table (y up): out = turn(p), in = unturn(p).
  const unturn = ([x, y]) => [(x - c[0]) * cos - (y - c[1]) * sin, (x - c[0]) * sin + (y - c[1]) * cos]
  const turn = ([x, y]) => [c[0] + x * cos + y * sin, c[1] - x * sin + y * cos]
  const rings = table.map((r) => r.map(unturn))
  const found = contourLocal(rings, pitch, ball, fill)
  return found?.map((f) => ({ path: f.path.map(turn), entry: turn(f.entry), exit: turn(f.exit) }))
}
function contourLocal(rings, pitch, ball, fill) {
  const clean = (ring) => {
    const r = ring.filter((p, i) => !i || dist(p, ring[i - 1]) > 1e-12)
    if (r.length > 1 && dist(r[0], r[r.length - 1]) < 1e-12) r.pop()
    return r
  }
  const key = `${pitch}|${JSON.stringify(fill ?? {})}|${rings.map((r) => r.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join(';')).join('|')}`
  if (!contours.has(key)) {
    let found = null
    try {
      const region = { polygon: clean(rings[0]), holes: rings.slice(1).map(clean).filter((r) => r.length >= 3), ...(fill ? { fill } : {}) }
      // table 2 makes sand-weaver's ball (diameter = 2·ball/table) this frame's ball.
      found = generateContourFill(region, { pitch, spacing: pitch / ball, step: ball / 4, table: 2, ball }, {}).candidates
    } catch {
      found = null // degenerate (a sliver): the straight lanes instead
    }
    if (contours.size > 300) contours.delete(contours.keys().next().value)
    contours.set(key, found)
  }
  return contours.get(key)
}

/** Along a closed ring from a to b (points on it), the shorter way round. */
function alongRing(ring, a, b) {
  const p = nearest(ring, a, true)
  const q = nearest(ring, b, true)
  const forward = [p.q]
  for (let i = p.i; i !== q.i; i = (i + 1) % ring.length) forward.push(ring[(i + 1) % ring.length])
  forward.push(q.q)
  const backward = [p.q]
  for (let i = p.i; i !== q.i; i = (i - 1 + ring.length) % ring.length) backward.push(ring[i])
  backward.push(q.q)
  const len = (path) => path.reduce((s, pt, i) => (i ? s + dist(path[i - 1], pt) : 0), 0)
  return len(forward) <= len(backward) ? forward : backward
}

/** The visit, from host vertex v back to it: in to the unit's door, its drawing, out again. */
function visit(unit, v, pitch) {
  if (unit.kind === 'region' && unit.contour) {
    const found = contourCandidates(unit.rings, pitch, pitch / PITCH, unit.rot, unit.fill)
    if (found?.length) {
      // In at the outline's point nearest v (a short step, like the straight fill's door),
      // along the outline to its point nearest the fill's start and straight in to it: a
      // straight line from the door crossed out of concave letters (a u) and over finished
      // ones. The fill's last lap retraces the whole outline, so the way in disappears under
      // it. Then the fill, and along the outline (still on top) to the point nearest v and out.
      const outline = unit.rings[0]
      const door = nearest(outline, v, true).q
      const len = (path) => path.reduce((s, pt, i, all) => (i ? s + dist(all[i - 1], pt) : 0), 0)
      const wayIn = (c) => alongRing(outline, door, nearest(outline, c.entry, true).q)
      const cost = (c) => {
        const w = wayIn(c)
        return len(w) + dist(w[w.length - 1], c.entry) + len(alongRing(outline, c.exit, v))
      }
      const best = found.reduce((a, c) => (cost(c) < cost(a) ? c : a))
      return [v, ...wayIn(best), ...best.path, ...alongRing(outline, best.exit, v), v]
    }
  }
  if (unit.kind === 'region') {
    // The door is a vertex of the outline (the fill's routes start there).
    const ring = unit.rings[0]
    let door = 0
    for (let i = 1; i < ring.length; i++) if (dist(ring[i], v) < dist(ring[door], v)) door = i
    return [v, ...fillRegion(unit.rings, ANGLE + Math.PI / 2, pitch, door), v]
  }
  if (unit.kind === 'ring') {
    const ring = unit.ring
    const { i, q } = nearest(ring, v, true)
    const round = [...ring.slice(i + 1), ...ring.slice(0, i + 1), q]
    return [v, q, ...round, ...round, v]
  }
  // stroke: to the nearer end, back past the door to the far end, back to the door.
  const line = unit.line
  const { i, q } = nearest(line, v, false)
  const head = [q, ...line.slice(0, i + 1).reverse()]
  const tail = [q, ...line.slice(i + 1)]
  const [near, far] = head.length <= tail.length ? [head, tail] : [tail, head]
  return [v, ...near, ...near.slice(0, -1).reverse(), ...far.slice(1), ...far.slice(0, -1).reverse(), v]
}

/** Points no further apart than `step` (for measuring how near a lane comes). */
function dense(pts, step, closed) {
  const out = []
  const n = closed ? pts.length : pts.length - 1
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const k = Math.max(1, Math.ceil(dist(a, b) / step))
    for (let j = 0; j < k; j++) out.push(lerp(a, b, j / k))
  }
  if (!closed) out.push(pts[pts.length - 1])
  return out
}

/**
 * The whole inlay pattern. frame: { round: true } | { round: false, W, H };
 * ball: the ball's diameter in frame units; units: the letters (see top);
 * top/bottom: the text's extent (y); rake: 0 (a band BAND balls round the text) .. 1 (the whole table).
 * Starts and ends on the table's edge (the host's first and last lanes are its corners).
 * Returns { path, visits: [{ from, to, outline }] } (each letter's visit, as path indices).
 */
export function inlayPath({ units, frame, ball, top, bottom, rake = 0, host = 'spiral', zone: zoneBalls = ZONE }) {
  const pitch = PITCH * ball
  const zone = zoneBalls * ball
  if (host === 'spiral') return spiralInlay({ units, frame, ball, pitch, zone, rake })
  const d = [Math.cos(ANGLE), Math.sin(ANGLE)]
  const n = [Math.sin(ANGLE), -Math.cos(ANGLE)] // the sweep: across the lanes, top left to bottom right
  const band = rake < 1
  // rake: the share of the open sand between the text and the table's top or bottom edge, whichever is further.
  const rim = frame.round ? 1 : frame.H / 2
  const reach = BAND * ball + Math.max(0, rake) * Math.max(0, rim - top, rim + bottom)
  const yLo = band ? bottom - reach : -Infinity
  const yHi = band ? top + reach : Infinity

  // A lane (v = c) inside the host: the interval of u where u·d + c·n is on the table and in the band.
  const span = (c) => {
    let lo = -Infinity
    let hi = Infinity
    const clip = (a, b0, b1) => {
      // a·u + b ∈ [b0, b1] → u range (a ≠ 0)
      if (Math.abs(a) < 1e-12) return
      const u0 = b0 / a
      const u1 = b1 / a
      lo = Math.max(lo, Math.min(u0, u1))
      hi = Math.min(hi, Math.max(u0, u1))
    }
    const px = c * n[0]
    const py = c * n[1]
    if (frame.round) {
      if (Math.abs(c) >= 1) return null
      const r = Math.sqrt(1 - c * c)
      lo = -r
      hi = r
    } else {
      clip(d[0], -frame.W / 2 - px, frame.W / 2 - px)
      clip(d[1], -frame.H / 2 - py, frame.H / 2 - py)
    }
    if (band) clip(d[1], yLo - py, yHi - py)
    return hi - lo > 1e-9 ? [lo, hi] : null
  }
  // The host's extent across the lanes, from its boundary (the table's edge, the band's corners).
  const edge = []
  if (frame.round) for (let i = 0; i < 1440; i++) edge.push([Math.cos((i * Math.PI) / 720), Math.sin((i * Math.PI) / 720)])
  else {
    const { W, H } = frame
    for (let i = 0; i <= 400; i++) {
      const t = i / 400
      edge.push([-W / 2 + W * t, -H / 2], [-W / 2 + W * t, H / 2], [-W / 2, -H / 2 + H * t], [W / 2, -H / 2 + H * t])
    }
  }
  if (band) {
    const x = (y) => (frame.round ? Math.sqrt(Math.max(0, 1 - y * y)) : frame.W / 2)
    for (const y of [yLo, yHi]) for (let i = 0; i <= 400; i++) edge.push([-x(y) + (2 * x(y) * i) / 400, y])
  }
  const vs = edge.filter(([, y]) => y >= yLo - 1e-12 && y <= yHi + 1e-12).map((p) => p[0] * n[0] + p[1] * n[1])
  const vMin = Math.min(...vs)
  const vMax = Math.max(...vs)
  const lanes = []
  for (let c = vMin + pitch / 2; c < vMax; c += pitch) {
    const s = span(c)
    if (s) lanes.push({ c, s, visits: [] })
  }

  // Each unit goes on the last lane within the zone, where that lane leaves the zone.
  for (const unit of units) {
    const closed = unit.kind !== 'stroke'
    const outline = unit.kind === 'region' ? unit.rings[0] : unit.kind === 'ring' ? unit.ring : unit.line
    const pts = dense(outline, zone / 2, closed)
    const v = pts.map(([x, y]) => x * n[0] + y * n[1])
    const last = Math.max(...v) + zone
    let k = -1
    for (let i = 0; i < lanes.length; i++) if (lanes[i].c <= last) k = i
    if (k < 0) continue
    const lane = lanes[k]
    let uLo = Infinity
    let uHi = -Infinity
    pts.forEach(([x, y], i) => {
      const gap = lane.c - v[i]
      if (Math.abs(gap) > zone) return
      const w = Math.sqrt(zone * zone - gap * gap)
      const u = x * d[0] + y * d[1]
      uLo = Math.min(uLo, u - w)
      uHi = Math.max(uHi, u + w)
    })
    const forward = k % 2 === 0
    const u = Math.min(lane.s[1], Math.max(lane.s[0], forward ? uHi : uLo))
    lane.visits.push({ u, unit, outline })
  }

  const at = (c, u) => [u * d[0] + c * n[0], u * d[1] + c * n[1]]
  const path = []
  const visits = []
  lanes.forEach((lane, k) => {
    const forward = k % 2 === 0
    const [a, b] = forward ? lane.s : [lane.s[1], lane.s[0]]
    path.push(at(lane.c, a))
    lane.visits.sort((p, q) => (forward ? p.u - q.u : q.u - p.u))
    for (const { u, unit, outline } of lane.visits) {
      const from = path.length
      path.push(...visit(unit, at(lane.c, u), pitch))
      visits.push({ from, to: path.length - 1, outline })
    }
    path.push(at(lane.c, b))
  })
  // A band's first or last lane can end on the band's edge: along it to the table's edge.
  const toEdge = ([x, y]) => {
    const e = frame.round ? Math.sqrt(Math.max(0, 1 - y * y)) : frame.W / 2
    return Math.abs(Math.abs(x) - e) < 1e-9 ? null : [x < 0 ? -e : e, y]
  }
  const head = toEdge(path[0])
  const tail = toEdge(path[path.length - 1])
  if (head) {
    path.unshift(head)
    for (const v of visits) {
      v.from++
      v.to++
    }
  }
  if (tail) path.push(tail)
  return { path, visits }
}

const outlineOf = (unit) => (unit.kind === 'region' ? unit.rings[0] : unit.kind === 'ring' ? unit.ring : unit.line)

/**
 * The spiral host: one line from the centre outwards, `pitch` apart, out to the table's
 * edge (rake 1) or, below that, BAND balls beyond the furthest unit plus `rake` of the
 * rest. On a rectangle it's a rectangular spiral: a core along the long side, each side
 * stepping out a pitch a turn, so it meets both edges at once. Each unit is visited from
 * the host's LAST point within `zone` of it, so nothing passes it once it's drawn; every
 * later turn is further out. Starts at the centre.
 */
function spiralInlay({ units, frame, ball, pitch, zone, rake }) {
  const round = frame.round
  const wide = round || frame.W >= frame.H
  const core = round ? 0 : Math.abs(frame.W - frame.H) / 2
  const full = round ? 1 : Math.min(frame.W, frame.H) / 2
  // How far out a point is in the spiral's terms: radius, or distance from the rectangle's core.
  const offset = ([x, y]) => (round ? Math.hypot(x, y) : wide ? Math.max(Math.abs(x) - core, Math.abs(y)) : Math.max(Math.abs(x), Math.abs(y) - core))
  const outlines = units.map(outlineOf)
  let cover = 0
  for (const o of outlines) for (const p of o) cover = Math.max(cover, offset(p))
  cover = Math.min(full, cover + BAND * ball)
  const R = Math.min(full, cover + Math.max(0, Math.min(1, rake)) * (full - cover))
  // The path keeps the spiral's corners; the zone test runs on points zone/2 apart along it.
  const bend = 0.02
  const step = zone / 2

  const corners = []
  if (round) {
    const end = (2 * Math.PI * R) / pitch
    for (let t = 0; ; ) {
      const r = (pitch * t) / (2 * Math.PI)
      corners.push([r * Math.cos(t), r * Math.sin(t)])
      if (t >= end) break
      t = Math.min(end, t + bend / Math.max(r, bend))
    }
  } else {
    // Sides in turn (right, top, left, bottom), each a quarter pitch further out than the one before.
    const r = (i) => Math.min(R, (i * pitch) / 4)
    const xy = wide ? (p) => p : ([a, b]) => [b, a]
    corners.push(xy([core, 0]))
    for (let i = 1; ; i += 4) {
      corners.push(xy([core + r(i - 1), r(i)]), xy([-core - r(i + 1), r(i)]), xy([-core - r(i + 1), -r(i + 2)]), xy([core + r(i + 3), -r(i + 2)]))
      if (r(i + 3) >= R) break
    }
  }
  // Samples along the corners' segments: [segment, point].
  const host = []
  for (let k = 0; k + 1 < corners.length; k++) {
    const n = Math.max(1, Math.ceil(dist(corners[k], corners[k + 1]) / step))
    for (let j = 0; j < n; j++) host.push([k, lerp(corners[k], corners[k + 1], j / n)])
  }
  host.push([corners.length - 1, corners[corners.length - 1]])

  // The last host point within `zone` of each unit (a grid of zone-sized cells over the units).
  const K = 1 << 16
  const cellOf = (v) => Math.floor(v / zone) + K / 2
  const grid = new Map()
  const near = outlines.map((o, u) => dense(o, zone / 2, units[u].kind !== 'stroke'))
  near.forEach((pts, u) => {
    for (const [x, y] of pts) {
      const key = cellOf(x) * K + cellOf(y)
      if (!grid.has(key)) grid.set(key, [])
      grid.get(key).push(x, y, u)
    }
  })
  const last = units.map(() => -1)
  host.forEach(([, [x, y]], i) => {
    const cx = cellOf(x)
    const cy = cellOf(y)
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const list = grid.get((cx + dx) * K + cy + dy)
      if (list) for (let j = 0; j < list.length; j += 3) if (Math.hypot(list[j] - x, list[j + 1] - y) <= zone) last[list[j + 2]] = i
    }
  })
  // The visit starts where the host LEAVES the zone: between that last point and the next.
  const gap = (p, u) => Math.min(...near[u].map((q) => dist(p, q)))
  const at = new Map()
  last.forEach((i, u) => {
    // Never within the zone (a unit beyond the host): from the host's nearest point.
    if (i < 0) i = nearestIndex(host.map(([, p]) => p), outlines[u][0])
    let t = 0
    const a = host[i][1]
    const b = host[i + 1]?.[1]
    if (b && gap(a, u) <= zone) {
      let lo = 0
      let hi = 1
      for (let k = 0; k < 14; k++) {
        const m = (lo + hi) / 2
        if (gap(lerp(a, b, m), u) <= zone) lo = m
        else hi = m
      }
      t = hi
    }
    if (!at.has(i)) at.set(i, [])
    at.get(i).push({ u, t, p: b ? lerp(a, b, t) : a })
  })

  const path = []
  const visits = []
  host.forEach(([k, p], i) => {
    const corner = i === 0 || host[i - 1][0] !== k
    if (corner) path.push(corners[k])
    const here = at.get(i)
    if (!here) return
    if (!corner) path.push(p)
    for (const { u, p: v } of here.sort((x, y) => x.t - y.t)) {
      const from = path.length
      path.push(...visit(units[u], v, pitch))
      visits.push({ from, to: path.length - 1, outline: outlines[u] })
    }
  })
  return { path, visits }
}

function nearestIndex(pts, p) {
  let best = 0
  for (let i = 1; i < pts.length; i++) if (dist(pts[i], p) < dist(pts[best], p)) best = i
  return best
}
