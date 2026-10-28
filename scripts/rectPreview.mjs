// Build-time preview images for G-code (rectangular-table) patterns.
//
// Drawn the way dune-weaver-viewer draws its thumbnails (mac/Shared/ThrPath.swift):
// the finished pattern, inset to 96% so grooves along the edge stay inside the
// table's border, stroked at max(1, width/600) px with round caps and joins.
// The table's surface and the groove colour come from the app's theme (the
// tile's frame, and Image tintColor), so the image is only the grooves: one ink
// on transparent, which follows light and dark like an SF Symbol does.
//
// Written as an 8-bit palette PNG (Apple's format for art that doesn't need full
// colour: 256 alphas of black, so one byte a pixel) with an sRGB chunk, at
// PREVIEW_WIDTH: the widest frame a pattern is shown in (Browse's detail view,
// 360 pt) at @3x. No dependencies: zlib comes with Node.
import zlib from 'node:zlib'
import { gcodeExtent, PREVIEW_INSET, PREVIEW_WIDTH, previewStroke } from '../src/lib/gcodeGeometry.mjs'
const SS = 3 // supersamples per pixel, per axis: 9 coverage levels for antialiasing

/** Points in mm (y up) -> PNG bytes, `size` = the canvas [W, H] in mm. */
export function rectPreviewPng(pts, size = gcodeExtent(pts)) {
  if (!size) throw new Error('empty pattern')
  const [W, H] = size
  const w = PREVIEW_WIDTH
  const h = Math.round((w * H) / W)
  const sw = w * SS
  const sh = h * SS
  const cov = new Uint8Array(sw * sh)
  // Uniform scale (never stretched), centred, inset like the viewer.
  const s = Math.min(sw / W, sh / H) * PREVIEW_INSET
  const ox = (sw - W * s) / 2
  const oy = (sh - H * s) / 2
  const at = ([x, y]) => [ox + x * s, oy + (H - y) * s]

  // A round pen: stamping a disc along the path gives round caps and joins.
  const r = (previewStroke(w) * SS) / 2
  const R = Math.ceil(r)
  const pen = []
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) if (dx * dx + dy * dy <= r * r) pen.push(dx, dy)
  const stamp = (px, py) => {
    const cx = Math.round(px)
    const cy = Math.round(py)
    for (let i = 0; i < pen.length; i += 2) {
      const x = cx + pen[i]
      const y = cy + pen[i + 1]
      if (x >= 0 && x < sw && y >= 0 && y < sh) cov[y * sw + x] = 1
    }
  }
  let prev = null
  for (const p of pts) {
    const b = at(p)
    if (!prev) stamp(b[0], b[1])
    else {
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - prev[0], b[1] - prev[1]) / 0.5))
      for (let i = 1; i <= n; i++) stamp(prev[0] + ((b[0] - prev[0]) * i) / n, prev[1] + ((b[1] - prev[1]) * i) / n)
    }
    prev = b
  }

  // Box-filter the supersamples down: each pixel's alpha is its coverage.
  const rows = Buffer.alloc((w + 1) * h)
  for (let y = 0; y < h; y++) {
    rows[y * (w + 1)] = 0 // filter: none
    for (let x = 0; x < w; x++) {
      let n = 0
      for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) n += cov[(y * SS + j) * sw + x * SS + i]
      rows[y * (w + 1) + 1 + x] = Math.round((255 * n) / (SS * SS))
    }
  }
  return png(w, h, rows)
}

// ---- PNG: 8-bit palette, index = alpha of black -----------------------------

const CRC = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
function crc32(buf) {
  let c = -1
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const out = Buffer.alloc(body.length + 8)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), body.length + 4)
  return out
}
function png(w, h, rows) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 3 // colour type: palette
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('sRGB', Buffer.from([0])), // sRGB colour space, perceptual intent
    chunk('PLTE', Buffer.alloc(256 * 3)), // every entry black
    chunk('tRNS', Buffer.from(Array.from({ length: 256 }, (_, i) => i))), // entry i = alpha i
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
