// Vendored from sand-weaver experiments/region-program/contour-fill.js (2026-11-14 working copy)
// for the text generator: symbol (emoji) fills whose lanes follow the shape. Edit there first.

// A fill whose lanes follow the outline: every lane is a level line of a
// smooth, distance-like field, so it runs parallel to the nearest outline or
// hole and turns in curves where lanes from opposite sides meet. The boundary
// fill's exact inward distance turns those meetings into sharp creases and
// connects its rings with radial bridges, both visible in the sand
// (ghost-pumpkin scratch build, 2026-10-04). Here:
//
// - Field. Unit normals of the signed distance blurred by σ = smooth × depth
//   (0.75–6 balls), so deep creases round off more than shallow ones; then a
//   least-squares potential φ whose gradient follows them, pinned to the exact
//   distance outside the part (the heat method's second step). Near the outline
//   |∇φ| ≈ 1: lanes keep their pitch and run parallel to it.
// - Rings. φ's level lines at the pitch. An outer ring bounds a component of
//   {φ ≥ c}; an inner ring encircles a hole. Outer rings form a tree from the
//   outline to each peak of φ; inner rings a forest from each hole outwards.
// - Path. Each tree is drawn deepest first, like an outward spiral: a ring's
//   children, then the ring. The last child's lap ramps over its final
//   `rampBall` balls onto the ring outside it, so a chain of rings is one spiral
//   with no bridge. Hole echoes are drawn first, from the hole out, then the
//   outline's tree, ending with the outline itself. Between subtrees the ball
//   retraces its last lap, which is still on top, and travels only over sand
//   this fill has not drawn yet, which the later laps re-cut. Where no such way
//   exists, it travels along the part's edge instead (contour-route-edge).
import {isolines} from './contours.mjs';
import {sampleDistance} from './distance.mjs';

const EPS = 1e-12;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pathLength = points => points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0);
const signedArea = ring => ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const ccw = ring => signedArea(ring) < 0 ? [...ring].reverse() : [...ring];
const insideRing = (p, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
};
// Nearest point on a closed ring: {point, edge, u, d}.
function nearestOnRing(p, ring) {
  let best = {d: Infinity};
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    const u = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
    const q = [a[0] + u * dx, a[1] + u * dy], d = distance(p, q);
    if (d < best.d) best = {point: q, edge: i, u, d};
  }
  return best;
}
// Douglas-Peucker on a closed ring.
function simplifyRing(ring, tolerance) {
  const open = path => {
    if (path.length <= 2) return path;
    const a = path[0], b = path.at(-1), dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
    let far = -1, error = -1;
    for (let i = 1; i < path.length - 1; i++) {
      const u = l2 ? Math.max(0, Math.min(1, ((path[i][0] - a[0]) * dx + (path[i][1] - a[1]) * dy) / l2)) : 0;
      const d = Math.hypot(path[i][0] - a[0] - u * dx, path[i][1] - a[1] - u * dy);
      if (d > error) { error = d; far = i; }
    }
    if (error <= tolerance) return [a, b];
    return [...open(path.slice(0, far + 1)).slice(0, -1), ...open(path.slice(far))];
  };
  const middle = ring.length >> 1;
  return [...open(ring.slice(0, middle + 1)).slice(0, -1), ...open([...ring.slice(middle), ring[0]]).slice(0, -1)];
}

export function validateContour(region) {
  const fill = region.fill || {}, label = `${region.id || 'Region'} contour`;
  const smooth = fill.smooth ?? .5, rampBall = fill.rampBall ?? 4, centre = fill.centre ?? null;
  if (!Number.isFinite(smooth) || smooth < 0 || smooth > 2) throw new Error(`${label}: smooth must be 0–2 (blur radius per ball of depth; 0 is the exact distance).`);
  if (!Number.isFinite(rampBall) || rampBall < .5 || rampBall > 20) throw new Error(`${label}: rampBall must be 0.5–20 ball diameters.`);
  if (centre !== null && !(Array.isArray(centre) && centre.length === 2 && centre.every(Number.isFinite))) throw new Error(`${label}: centre must be an [x, y] point.`);
  if (centre && (!insideRing(centre, region.polygon) || (region.holes || []).some(hole => insideRing(centre, hole)))) throw new Error(`${label}: centre must lie inside the part.`);
  return {smooth, rampBall, centre};
}

// Three box blurs approximate a Gaussian of σ cells (clamped edges).
function gaussian(src, n, sigma) {
  const passes = 3, ideal = Math.sqrt(12 * sigma * sigma / passes + 1);
  let low = Math.floor(ideal); if (low % 2 === 0) low--;
  const m = Math.round((12 * sigma * sigma - passes * low * low - 4 * passes * low - 3 * passes) / (-4 * low - 4));
  let a = Float64Array.from(src), b = new Float64Array(n * n);
  const line = new Float64Array(n + 1);
  for (let pass = 0; pass < passes; pass++) {
    const r = ((pass < m ? low : low + 2) - 1) / 2, w = 2 * r + 1;
    for (const horizontal of [true, false]) {
      for (let k = 0; k < n; k++) {
        const at = i => horizontal ? k * n + i : i * n + k;
        line[0] = 0;
        for (let i = 0; i < n; i++) line[i + 1] = line[i] + a[at(i)];
        const value = i => i < 0 ? i * a[at(0)] : i >= n ? line[n] + (i - n + 1) * a[at(n - 1)] : line[i + 1];   // prefix sum through index i, clamped
        for (let i = 0; i < n; i++) b[at(i)] = (value(i + r) - value(i - r - 1)) / w;
      }
      [a, b] = [b, a];
    }
  }
  return a;
}

// φ: least squares ∇φ ≈ unit normals of the depth-blurred distance, φ = d outside.
function smoothField(sampled, diameter, smooth) {
  const {field: d, n, gridStep: h} = sampled;
  if (!smooth) return {phi: d, iterations: 0};
  const smin = .75 * diameter, smax = 6 * diameter, levels = 7;
  const sigmas = Array.from({length: levels}, (_, k) => smin * (smax / smin) ** (k / (levels - 1)));
  const gx = sigmas.map(() => new Float32Array(n * n)), gy = sigmas.map(() => new Float32Array(n * n));
  sigmas.forEach((sigma, k) => {
    const b = gaussian(d, n, sigma / h);
    for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
      const i = y * n + x; gx[k][i] = b[i + 1] - b[i - 1]; gy[k][i] = b[i + n] - b[i - n];
    }
  });
  const X = new Float64Array(n * n), Y = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) {
    const sigma = Math.max(smin, Math.min(smax, smooth * Math.max(d[i], 0)));
    const t = Math.log(sigma / smin) / Math.log(smax / smin) * (levels - 1), k = Math.min(levels - 2, Math.floor(t)), f = t - k;
    const x = gx[k][i] * (1 - f) + gx[k + 1][i] * f, y = gy[k][i] * (1 - f) + gy[k + 1][i] * f, l = Math.hypot(x, y);
    if (l > EPS) { X[i] = x / l; Y[i] = y / l; }
  }
  // Normal equations over the inside cells (the masked graph Laplacian); outside, φ = d.
  const unknown = Uint8Array.from(d, v => v > 0 ? 1 : 0), rhs = new Float64Array(n * n), degree = new Float64Array(n * n);
  const edge = (i, j, g) => {   // φj − φi = g
    if (!unknown[i] && !unknown[j]) return;
    if (unknown[i]) { degree[i]++; rhs[i] -= g; if (!unknown[j]) rhs[i] += d[j]; }
    if (unknown[j]) { degree[j]++; rhs[j] += g; if (!unknown[i]) rhs[j] += d[i]; }
  };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    if (x + 1 < n) edge(i, i + 1, h * (X[i] + X[i + 1]) / 2);
    if (y + 1 < n) edge(i, i + n, h * (Y[i] + Y[i + n]) / 2);
  }
  const apply = (v, out) => {
    for (let i = 0; i < n * n; i++) {
      if (!unknown[i]) { out[i] = 0; continue; }
      let s = degree[i] * v[i];
      if (unknown[i - 1]) s -= v[i - 1];
      if (unknown[i + 1]) s -= v[i + 1];
      if (unknown[i - n]) s -= v[i - n];
      if (unknown[i + n]) s -= v[i + n];
      out[i] = s;
    }
  };
  const phi = Float64Array.from(d), r = new Float64Array(n * n), p = new Float64Array(n * n), q = new Float64Array(n * n);
  apply(phi, q);
  for (let i = 0; i < n * n; i++) r[i] = unknown[i] ? rhs[i] - q[i] : 0;
  p.set(r);
  let rr = r.reduce((s, v) => s + v * v, 0), iterations = 0;
  const tolerance = rhs.reduce((s, v, i) => s + (unknown[i] ? v * v : 0), 0) * 1e-16;
  for (; iterations < 4000 && rr > tolerance; iterations++) {
    apply(p, q);
    let pq = 0; for (let i = 0; i < n * n; i++) pq += p[i] * q[i];
    if (Math.abs(pq) < 1e-300) break;
    const alpha = rr / pq;
    let next = 0;
    for (let i = 0; i < n * n; i++) { phi[i] += alpha * p[i]; r[i] -= alpha * q[i]; next += r[i] * r[i]; }
    const beta = next / rr;
    for (let i = 0; i < n * n; i++) p[i] = r[i] + beta * p[i];
    rr = next;
  }
  return {phi, iterations};
}

// With a centre, the rings nest round that point instead of the field's peaks
// (skeleton witch v4: "center on the nose"): t = φ / (φ + |p − centre|) is 0 on
// the outline and 1 only at the centre, and φ = t × the outline's mean distance
// from the centre, so lanes average the pitch. They are closer on the outline's
// near sides and wider on its far ones, by the ratio of those distances.
function centredField(phi, sampled, centre, polygon, x0, y0) {
  const {n, gridStep: h} = sampled, perimeter = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], k = Math.max(1, Math.ceil(distance(a, b) / h));
    for (let j = 0; j < k; j++) perimeter.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]);
  }
  const scale = perimeter.reduce((sum, p) => sum + distance(p, centre), 0) / perimeter.length, out = new Float64Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x;
    out[i] = phi[i] <= 0 ? phi[i] : scale * phi[i] / (phi[i] + distance([x0 + x * h, y0 + y * h], centre));
  }
  return {phi: out, scale};
}

export function generateContourFill(region, {pitch, spacing, step, table, ball}, geometry) {
  const {smooth, rampBall, centre} = validateContour(region), diameter = 2 * ball / table;
  const sampled = sampleDistance(region, pitch, step), {n, gridStep: h, center} = sampled;
  const x0 = center[0] - (n - 1) / 2 * h, y0 = center[1] - (n - 1) / 2 * h;
  let {phi, iterations} = smoothField(sampled, diameter, smooth), scale = null;
  if (centre) ({phi, scale} = centredField(phi, sampled, centre, region.polygon, x0, y0));
  const sample = ([px, py]) => {
    const u = Math.max(0, Math.min(n - 1.000001, (px - x0) / h)), v = Math.max(0, Math.min(n - 1.000001, (py - y0) / h));
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, at = (a, b) => phi[b * n + a];
    return (at(i, j) * (1 - fu) + at(i + 1, j) * fu) * (1 - fv) + (at(i, j + 1) * (1 - fu) + at(i + 1, j + 1) * fu) * fv;
  };
  let top = 0;
  for (let i = 0; i < n * n; i++) if (sampled.field[i] > 0) top = Math.max(top, phi[i]);

  // Rings. Level 0 is the exact outline and holes.
  const nodes = [], tolerance = .03 * diameter, minArea = (.3 * diameter) ** 2;
  const node = (ring, level, c, kind) => { const k = {id: nodes.length, ring: ccw(ring), level, c, kind, children: [], parent: null}; k.area = signedArea(k.ring); nodes.push(k); return k; };
  const root = node(region.polygon, 0, 0, 'outer'), holes = (region.holes || []).map(hole => node(hole, 0, 0, 'inner'));
  const byLevel = [[root, ...holes]], lanes = [{index: 0, t: 0, segments: [root, ...holes].map(k => ({path: [...k.ring, k.ring[0]], level: 0, index: 0, contour: k.id}))}];
  let skipped = 0;
  for (let level = 1, c = pitch; c < top; level++, c += pitch) {
    if (level > 1500) throw new Error(`Region ${region.id || ''} exceeds 1,500 contour levels. Increase spacing.`);
    const current = [];
    for (const raw of isolines(phi, n, c, h)) {
      const ring = simplifyRing(raw.map(p => [p[0] + center[0], p[1] + center[1]]), tolerance);
      if (ring.length < 3 || Math.abs(signedArea(ring)) < minArea) { skipped++; continue; }
      // Outer when {φ ≥ c} lies inside the ring: probe left of the first edge.
      const a = ring[0], b = ring[1], l = distance(a, b) || 1, probe = [(a[0] + b[0]) / 2 - (b[1] - a[1]) / l * .3 * h, (a[1] + b[1]) / 2 + (b[0] - a[0]) / l * .3 * h];
      const outer = (sample(probe) > c) === (signedArea(ring) > 0);
      current.push(node(ring, level, c, outer ? 'outer' : 'inner'));
    }
    if (!current.length) break;
    byLevel.push(current);
    lanes.push({index: level, t: c, segments: current.map(k => ({path: [...k.ring, k.ring[0]], level: c, index: level, contour: k.id}))});
  }
  // Outer tree: the smallest outer ring one level out that contains the ring.
  // Inner forest: the smallest inner ring one level in (further from the hole) that encloses it.
  for (let level = 1; level < byLevel.length; level++) for (const k of byLevel[level]) {
    if (k.kind !== 'outer') continue;
    let parent = null;
    for (let up = level - 1; up >= 0 && !parent; up--) for (const o of byLevel[up]) if (o.kind === 'outer' && insideRing(k.ring[0], o.ring) && (!parent || o.area < parent.area)) parent = o;
    k.parent = parent || root; k.parent.children.push(k);
  }
  for (let level = 0; level + 1 < byLevel.length; level++) for (const k of byLevel[level]) {
    if (k.kind !== 'inner') continue;
    let parent = null;
    for (const o of byLevel[level + 1]) if (o.kind === 'inner' && insideRing(k.ring[0], o.ring) && (!parent || o.area < parent.area)) parent = o;
    if (parent) { k.parent = parent; parent.children.push(k); }
  }
  const innerRoots = nodes.filter(k => k.kind === 'inner' && !k.parent);
  const leaves = nodes.filter(k => !k.children.length).length;

  // Travel grid: inside the part, off finished sand.
  const finished = new Uint8Array(n * n), pending = [];
  const fillRing = ring => {
    const ys = ring.map(p => p[1]), lo = Math.max(0, Math.ceil((Math.min(...ys) - y0) / h)), hi = Math.min(n - 1, Math.floor((Math.max(...ys) - y0) / h));
    for (let y = lo; y <= hi; y++) {
      const yy = y0 + y * h, xs = [];
      for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; if ((a[1] > yy) !== (b[1] > yy)) xs.push(a[0] + (b[0] - a[0]) * (yy - a[1]) / (b[1] - a[1])); }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil((xs[k] - x0) / h)); x <= Math.min(n - 1, Math.floor((xs[k + 1] - x0) / h)); x++) finished[y * n + x] = 1;
    }
  };
  // Chamfer distance in cells from finished sand; travel keeps `clear` cells off it.
  const near = new Float64Array(n * n);
  let clear = 0;
  const measure = () => {
    for (let i = 0; i < n * n; i++) near[i] = finished[i] ? 0 : 1e9;
    for (const sign of [1, -1]) for (let k = 0; k < n * n; k++) {
      const i = sign > 0 ? k : n * n - 1 - k, x = i % n;
      for (const [dx, dy, w] of [[-1, 0, 1], [0, -1, 1], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2]]) {
        const xx = x + sign * dx, j = i + sign * (dy * n + dx);
        if (xx >= 0 && xx < n && j >= 0 && j < n * n && near[j] + w < near[i]) near[i] = near[j] + w;
      }
    }
  };
  // `edge`: the last resort when no way crosses unfinished sand. Anywhere inside the part, along its
  // edge band (within 0.75 pitch of the outline or a hole, which the outline lap or the drawing's
  // lines go over later) at twice the cost of unfinished sand, across finished lanes at 30 times.
  // It was a straight line across holes and finished rings (neo-geo v2: a 30 cm seam in the black).
  let edge = false;
  const open = i => edge ? sampled.field[i] > 0 : sampled.field[i] > .25 * pitch && near[i] > clear;
  const weight = i => !edge || near[i] > 0 ? 1 : sampled.field[i] <= .75 * pitch ? 2 : 30;
  const cellOf = p => Math.round((p[1] - y0) / h) * n + Math.round((p[0] - x0) / h);
  const nearestOpen = p => {
    const cx = Math.round((p[0] - x0) / h), cy = Math.round((p[1] - y0) / h);
    for (let r = 0; r < 24; r++) {
      let best = -1, bd = Infinity;
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= n || y >= n || Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== r || !open(y * n + x)) continue;
        const dd = Math.hypot(x0 + x * h - p[0], y0 + y * h - p[1]); if (dd < bd) { bd = dd; best = y * n + x; }
      }
      if (best >= 0) return best;
    }
    return -1;
  };
  const sight = (a, b) => {   // every sample of a→b on open cells (on an edge route, none across finished lanes)
    const k = Math.ceil(distance(a, b) / (h / 3));
    for (let i = 0; i <= k; i++) { const c = cellOf([a[0] + (b[0] - a[0]) * i / k, a[1] + (b[1] - a[1]) * i / k]); if (!open(c) || weight(c) > 2) return false; }
    return true;
  };
  // Dijkstra over open cells (8-connected), then string pulling.
  // Half a ball off finished sand where the corridor allows, then a quarter, then none.
  function route(a, b) {
    for (const k of pending.splice(0)) fillRing(k.ring);
    measure();
    for (const ball of [.5, .25, 0]) {
      clear = ball * diameter / h;
      const way = routeOnce(a, b);
      if (way) return way;
    }
    edge = true;
    const way = routeOnce(a, b);
    edge = false;
    if (way) way.edge = true;
    return way;
  }
  // The step from a point to its nearest open cell stays in the part (within a pitch of it): the
  // nearest open cell can lie across a hole when the point's own side is finished.
  const xy = i => [x0 + (i % n) * h, y0 + Math.floor(i / n) * h];
  const inPart = (a, b) => { const k = Math.ceil(distance(a, b) / (h / 3)); for (let i = 0; i <= k; i++) if (sampled.field[cellOf([a[0] + (b[0] - a[0]) * i / k, a[1] + (b[1] - a[1]) * i / k])] < -pitch) return false; return true; };
  function routeOnce(a, b) {
    const s = nearestOpen(a), t = nearestOpen(b);
    if (s < 0 || t < 0 || !inPart(a, xy(s)) || !inPart(xy(t), b)) return null;
    const cost = new Float64Array(n * n).fill(Infinity), from = new Int32Array(n * n).fill(-1), heap = [[0, s]];
    cost[s] = 0;
    const push = item => { heap.push(item); let i = heap.length - 1; while (i) { const j = (i - 1) >> 1; if (heap[j][0] <= heap[i][0]) break; [heap[i], heap[j]] = [heap[j], heap[i]]; i = j; } };
    const pop = () => { const topItem = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[i], heap[m]] = [heap[m], heap[i]]; i = m; } } return topItem; };
    while (heap.length) {
      const [c, i] = pop();
      if (i === t) break;
      if (c > cost[i]) continue;
      const x = i % n, y = (i - x) / n;
      for (const [dx, dy, w] of [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]]) {
        const xx = x + dx, yy = y + dy, j = yy * n + xx;
        if (xx < 0 || yy < 0 || xx >= n || yy >= n || !open(j)) continue;
        const cj = c + w * weight(j);
        if (cj >= cost[j]) continue;
        cost[j] = cj; from[j] = i; push([cj, j]);
      }
    }
    if (!Number.isFinite(cost[t])) return null;
    const cells = [];
    for (let i = t; i >= 0; i = from[i]) cells.push([x0 + (i % n) * h, y0 + Math.floor(i / n) * h]);
    cells.reverse();
    const pulled = [cells[0]];
    for (let i = 0; i < cells.length - 1;) {
      let j = cells.length - 1;
      while (j > i + 1 && !sight(cells[i], cells[j])) j--;
      pulled.push(cells[j]); i = j;
    }
    return [a, ...pulled, b];
  }

  function makeCandidate(variant, direction, reference) {
    const path = [], roles = [], events = [];
    let lastLap = null, travelLength = 0, retraceLength = 0, travels = 0, failedRoutes = 0, edgeRoutes = 0, wideRamps = 0, maxRampGap = 0;
    const append = (points, role, metadata = {}) => {
      for (const p of points) {
        if (!path.length) { path.push([...p]); roles.push(role); events.push({kind: role, ...metadata}); continue; }
        const a = path.at(-1), d = distance(a, p);
        if (d < EPS) continue;
        if (role === 'connector') travelLength += d;
        if (role === 'retrace') retraceLength += d;
        const count = Math.max(1, Math.ceil(d / step));
        for (let i = 1; i <= count; i++) { path.push(i === count ? [...p] : [a[0] + (p[0] - a[0]) * i / count, a[1] + (p[1] - a[1]) * i / count]); roles.push(role); events.push({kind: role, ...metadata}); }
      }
    };
    // From the end of the last closed lap: retrace it (still on top) to its
    // vertex nearest the target, then cross unfinished sand.
    const travelTo = target => {
      travels++;
      if (lastLap) {
        const m = lastLap.length - 1;
        let best = 0; for (let i = 1; i < m; i++) if (distance(lastLap[i], target) < distance(lastLap[best], target)) best = i;
        const forward = lastLap.slice(0, best + 1), backward = lastLap.slice(best).reverse();   // the lap ends where it began
        append(pathLength(forward) <= pathLength(backward) ? forward : backward, 'retrace');
      }
      const from = path.at(-1), way = route(from, target);
      if (!way) failedRoutes++;
      else if (way.edge) edgeRoutes++;
      append(way ? way.slice(1) : [target], 'connector');
    };
    // A closed lap of k's ring from the point nearest `at`; with `onto`, its
    // last rampBall balls blend onto that ring's nearest points.
    const lap = (k, at, onto) => {
      const ring = direction > 0 ? k.ring : [...k.ring].reverse(), near = nearestOnRing(at, ring), m = ring.length;
      const points = [near.point];
      for (let i = 1; i <= m; i++) points.push(ring[(near.edge + i) % m]);
      points.push(near.point);
      let drawn = points;
      if (onto) {
        const total = pathLength(points), L = Math.min(rampBall * diameter, total / 2);
        // Dense samples in the ramp so the blend is smooth.
        const dense = [points[0]];
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1], b = points[i], c = Math.max(1, Math.ceil(distance(a, b) / step));
          for (let j = 1; j <= c; j++) dense.push([a[0] + (b[0] - a[0]) * j / c, a[1] + (b[1] - a[1]) * j / c]);
        }
        let run = pathLength(dense);
        drawn = dense.map((p, i) => {
          if (i) run -= distance(dense[i - 1], p);
          if (run > L) return p;
          const u = 1 - run / L, q = nearestOnRing(p, onto.ring);
          maxRampGap = Math.max(maxRampGap, q.d);
          return [p[0] + u * (q.point[0] - p[0]), p[1] + u * (q.point[1] - p[1])];
        });
        const gap = nearestOnRing(points.at(-1), onto.ring).d;
        if (gap > 1.75 * pitch) wideRamps++;
      }
      append(drawn, k.level ? 'fill' : 'boundary', {lane: k.level, contour: k.id});
      lastLap = onto ? null : points;
      pending.push(k);
    };
    const order = (kids, from, ring) => {
      // Greedy from the current point; the child nearest the ring outside goes last (it ramps onto it).
      if (kids.length < 2) return kids;
      const rest = [...kids];
      let last = null;
      if (ring) { last = rest.reduce((best, k) => { const d = Math.min(...k.ring.filter((_, i) => i % 4 === 0).map(p => nearestOnRing(p, ring).d)); return !best || d < best.d ? {k, d} : best; }, null).k; rest.splice(rest.indexOf(last), 1); }
      const out = [];
      let at = from;
      while (rest.length) {
        const next = rest.reduce((best, k) => { const d = nearestOnRing(at, k.ring).d; return !best || d < best.d ? {k, d} : best; }, null).k;
        out.push(next); rest.splice(rest.indexOf(next), 1); at = nearestOnRing(at, next.ring).point;
      }
      return last ? [...out, last] : out;
    };
    const draw = (k, onto) => {
      if (!k.children.length) {
        const start = path.length ? nearestOnRing(path.at(-1), k.ring).point : nearestOnRing(reference, k.ring).point;
        if (path.length) travelTo(start);
        lap(k, start, onto);
        return;
      }
      for (const [i, kid] of order(k.children, path.length ? path.at(-1) : reference, k.ring).entries()) draw(kid, i === k.children.length - 1 ? k : null);
      lap(k, path.at(-1), onto);
    };
    for (const k of order(innerRoots, reference, null)) draw(k, null);
    draw(root, null);
    // fill.endAt: on along the outline's lap, the last and still on top, the shorter way to its vertex
    // nearest the point, so the fill finishes there (fills.js then steps onto it).
    if (at && lastLap) {
      let best = 0;
      for (let i = 1; i < lastLap.length - 1; i++) if (distance(lastLap[i], at) < distance(lastLap[best], at)) best = i;
      const forward = lastLap.slice(0, best + 1), backward = lastLap.slice(best).reverse();   // the lap ends where it began
      append(pathLength(forward) <= pathLength(backward) ? forward : backward, 'retrace');
    }
    // Retained for the reviewer: the grid starts clean for the next candidate.
    finished.fill(0); pending.length = 0;
    return {id: `${region.id || 'region'}:contour:${variant}`, path, roles, events, entry: path[0], exit: path.at(-1), length: pathLength(path),
      boundaryLength: path.slice(1).reduce((sum, p, i) => sum + (roles[i + 1] !== 'fill' ? distance(path[i], p) : 0), 0),
      interiorBridges: 0, roundedTurns: 0, sharpTurns: 0, travels, travelLength, retraceLength, failedRoutes, edgeRoutes, wideRamps, maxRampGap, firstDirection: direction > 0 ? 'forward' : 'reverse'};
  }
  // Four starting references on the outline, as the boundary fill's entries.
  const perimeter = pathLength([...region.polygon, region.polygon[0]]), references = [];
  for (let k = 0; k < 4; k++) {
    let remaining = perimeter * (k + .125) / 4;
    for (let i = 0; i < region.polygon.length; i++) {
      const a = region.polygon[i], b = region.polygon[(i + 1) % region.polygon.length], d = distance(a, b);
      if (remaining <= d) { references.push([a[0] + (b[0] - a[0]) * remaining / d, a[1] + (b[1] - a[1]) * remaining / d]); break; }
      remaining -= d;
    }
  }
  // fill.endAt (fills.js): two more, starting from the outline's point nearest it, so they finish near it, and every
  // candidate runs on along its outline to it (snoopy bike v8: the head's rings ended 70 mm across them from the ear).
  const at = region.fill?.endAt;
  if (at) {
    let best = null;
    for (let i = 0; i < region.polygon.length; i++) {
      const a = region.polygon[i], b = region.polygon[(i + 1) % region.polygon.length], dx = b[0] - a[0], dy = b[1] - a[1];
      const u = Math.max(0, Math.min(1, ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))), q = [a[0] + u * dx, a[1] + u * dy];
      if (!best || distance(q, at) < distance(best, at)) best = q;
    }
    references.push(best, best);
  }
  const candidates = references.map((reference, i) => makeCandidate(i, i % 2 ? -1 : 1, reference));
  // Local lane spacing is pitch / |∇φ| inside the part.
  const gradients = [];
  for (let y = 1; y < n - 1; y++) for (let x = 1; x < n - 1; x++) {
    const i = y * n + x; if (sampled.field[i] <= pitch) continue;
    gradients.push(Math.hypot(phi[i + 1] - phi[i - 1], phi[i + n] - phi[i - n]) / (2 * h));
  }
  gradients.sort((a, b) => a - b);
  const quantile = q => gradients[Math.min(gradients.length - 1, Math.floor(q * gradients.length))] || 1;
  const worst = key => Math.max(...candidates.map(c => c[key]));
  const diagnostics = [{code: 'contour-field', message: 'Lanes are level lines of a smoothed distance from the outline and holes: parallel to the nearest edge, rounding where lanes from opposite sides meet. Spacing widens toward each peak of the field.',
    smooth, rampBall, gridSize: n, gridPitchMm: h * table / 2, solverIterations: iterations, levels: byLevel.length - 1, rings: nodes.length, leaves, holeChains: innerRoots.length, skippedTinyRings: skipped,
    localSpacingBall: [pitch / quantile(.98) / diameter, pitch / quantile(.02) / diameter].map(v => Math.round(v * 1000) / 1000),
    ...(centre ? {centre, centreScaleBall: Math.round(scale / diameter * 100) / 100} : {})},
    {code: 'contour-spiral', message: 'Each chain of rings is one spiral: a lap ramps onto the ring outside it, with no bridge. Between subtrees the ball retraces its last lap and travels only over sand this fill draws later.',
      travels: worst('travels'), travelMm: worst('travelLength') * table / 2, retraceMm: worst('retraceLength') * table / 2, maxRampGapBall: Math.round(worst('maxRampGap') / diameter * 100) / 100}];
  if (worst('failedRoutes')) diagnostics.push({code: 'contour-route-failed', message: 'Some travel found no way over unfinished sand and goes straight, across finished lanes.', count: worst('failedRoutes')});
  if (worst('edgeRoutes')) diagnostics.push({code: 'contour-route-edge', message: 'Some travel found no way over unfinished sand and runs along the part\'s edge instead, crossing finished lanes only where the edge cannot reach.', count: worst('edgeRoutes')});
  if (worst('wideRamps')) diagnostics.push({code: 'contour-wide-ramp', message: 'Some ramps end more than 1.75 lane pitches from the ring outside; the step shows.', count: worst('wideRamps')});
  if (spacing < 1) diagnostics.push({code: 'controlled-overlap', message: 'Contour pitch is smaller than the ball diameter. Later laps intentionally overwrite part of the preceding groove.', pitchBallDiameters: spacing});
  return {...region, spacing, pitch, pitchMm: spacing * ball, levelPitch: pitch, lanes, candidates, diagnostics,
    field: {type: 'contour', smooth, rampBall, levels: byLevel.length - 1, rings: nodes.length, leaves, gridSize: n}};
}
