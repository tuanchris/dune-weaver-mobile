// Pattern rendering helpers. Geometry itself (decimated unit-circle xy points)
// is produced at runtime by useLibrary from the bundled/imported decimated
// .thr — see useLibrary.ensureXY / getXY. This module only maps those points
// to SVG coordinates and builds path strings.
//
// Points are [x, y] in math coordinates within the unit circle (y up =
// positive). SVG y grows downward, so screen mapping flips y.

export type Point = [number, number]

/**
 * Map a unit-circle point to screen coords for an SxS box with padding. Uses
 * dw's preview orientation (y grows DOWN — preview.py renders then rotates 180°,
 * netting x=cx+r·cosθ, y=cy+r·sinθ) so our SVG path + ball line up with the
 * bundled webp previews instead of being their vertical mirror.
 */
export function toScreen(p: Point, size: number, pad = 0.06): [number, number] {
  const c = size / 2
  const r = c * (1 - pad)
  return [c + p[0] * r, c + p[1] * r]
}

/**
 * Build an SVG path string from points. `step` subsamples for cheap thumbnails.
 * `from`/`to` (0..1) optionally render only a sub-range of the path — used to
 * draw the "already drawn" portion up to the progress fraction.
 */
export function buildPath(points: Point[], size: number, opts?: { step?: number; from?: number; to?: number; pad?: number }): string {
  const step = Math.max(1, Math.floor(opts?.step ?? 1))
  const pad = opts?.pad
  const n = points.length
  if (n === 0) return ''
  const start = Math.floor((opts?.from ?? 0) * (n - 1))
  const end = Math.ceil((opts?.to ?? 1) * (n - 1))
  let d = ''
  for (let i = start; i <= end; i += step) {
    const [sx, sy] = toScreen(points[i], size, pad)
    d += (d ? 'L' : 'M') + sx.toFixed(1) + ' ' + sy.toFixed(1)
  }
  // Ensure the exact end point is included when stepping overshoots.
  if ((end - start) % step !== 0) {
    const [sx, sy] = toScreen(points[end], size, pad)
    d += 'L' + sx.toFixed(1) + ' ' + sy.toFixed(1)
  }
  return d
}

/**
 * Convert the board's live position to screen xy. `theta` is in RADIANS — the
 * table's native theta-rho frame, the same unit as .thr files (the firmware
 * reports motors_to_cartesian output directly, no degree conversion). `rho` may
 * be signed; x=rho·cosθ, y=rho·sinθ maps (θ,−ρ) onto the same point as (θ+π,+ρ),
 * so it lands on the path either way.
 */
export function livePosition(theta: number, rho: number, size: number, pad = 0.06): [number, number] {
  const x = rho * Math.cos(theta)
  const y = rho * Math.sin(theta)
  return toScreen([x, y], size, pad)
}
