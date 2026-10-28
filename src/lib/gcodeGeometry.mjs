// G-code geometry, shared by the app (lib/gcode.ts) and the build script that
// bundles G-code patterns and renders their previews (scripts/gen-pattern-geometry.mjs).
// Plain ESM .mjs like thrGeometry.mjs, so both Node and Metro import it.

const NUM = '([-+]?\\d*\\.?\\d+)'
const X_RE = new RegExp('X' + NUM)
const Y_RE = new RegExp('Y' + NUM)

/** G-code text -> every move's [x, y] endpoint in machine mm (y up). Arcs count
 * as straight lines to their endpoint (Sandify emits only G1). With `ends`,
 * also the offset in the text where each move's line ends: the firmware's
 * progress is the share of the file executed, so that's where a move finishes. */
export function gcodePoints(text, ends) {
  const pts = []
  let x = 0
  let y = 0
  let rel = false
  let end = 0
  for (const raw of text.split('\n')) {
    end += raw.length + 1
    const line = raw.replace(/\(.*?\)|;.*$/g, '').toUpperCase()
    if (/\bG91\b/.test(line)) rel = true
    if (/\bG90\b/.test(line)) rel = false
    // G92 sets the position without moving, G28 homes: neither draws.
    if (/\bG(92|28)\b/.test(line)) continue
    const mx = X_RE.exec(line)
    const my = Y_RE.exec(line)
    if (!mx && !my) continue
    if (mx) x = rel ? x + Number(mx[1]) : Number(mx[1])
    if (my) y = rel ? y + Number(my[1]) : Number(my[1])
    pts.push([x, y])
    if (ends) ends.push(Math.min(end, text.length))
  }
  return pts
}

/** The drawing's own extent [W, H] in mm, from the machine origin: what a
 * preview frames when the table's size isn't known. Null for an empty file. */
export function gcodeExtent(pts) {
  let w = 0
  let h = 0
  for (const [x, y] of pts) {
    if (x > w) w = x
    if (y > h) h = y
  }
  return w > 0 && h > 0 ? [w, h] : null
}

/** Preview images are this many pixels wide: the widest frame a pattern is
 * shown in (Browse's detail view, 360 pt) at @3x. */
export const PREVIEW_WIDTH = 1080

/** Previews leave this much of the frame clear round the drawing, like
 * dune-weaver-viewer's thumbnails (ThrPath.inset), so grooves along the edge
 * stay inside the table's border. */
export const PREVIEW_INSET = 0.96

/** Preview stroke width for an image `width` units wide (dune-weaver-viewer). */
export function previewStroke(width) {
  return Math.max(1, width / 600)
}
