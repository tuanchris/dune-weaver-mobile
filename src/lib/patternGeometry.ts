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
 */
export function buildPath(points: Point[], size: number, opts?: { step?: number; pad?: number }): string {
  const step = Math.max(1, Math.floor(opts?.step ?? 1))
  const pad = opts?.pad
  const n = points.length
  if (n === 0) return ''
  let d = ''
  for (let i = 0; i < n; i += step) {
    const [sx, sy] = toScreen(points[i], size, pad)
    d += (d ? 'L' : 'M') + sx.toFixed(1) + ' ' + sy.toFixed(1)
  }
  // Ensure the exact end point is included when stepping overshoots.
  if ((n - 1) % step !== 0) {
    const [sx, sy] = toScreen(points[n - 1], size, pad)
    d += 'L' + sx.toFixed(1) + ' ' + sy.toFixed(1)
  }
  return d
}
