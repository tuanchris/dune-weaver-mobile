// The text generator (Browse › Create): words written on the table in one
// continuous line. Two styles:
//   lines — the way SandSkrit (UnintelligibleMaker) and Sandify's Text do it: every
//           letter starts and ends on a joining line that runs under its row, so the
//           ball never lifts; rows are drawn back and forth (left to right, then right
//           to left), so each row starts on the side where the last one ended;
//   inlay — sand-weaver's inlays (inlay.mjs): a band or the whole table raked in lanes,
//           each letter drawn inside that fill, the moves between letters under it.
// Fonts: single-line (fonts.mjs: each glyph one line on the joining line) and outline
// (outlineFonts.mjs: closed outlines with holes). An outline letter on the joining line
// is reached by a tick from it and traced round, its other rings bridged in.
// Symbols (symbols.mjs: popular emoji, outlines) draw like outline letters, typed in
// the text (any font) or placed freely on the table (inlay only: `symbols`).
//
// Frames are as seen on the table: x right, y up, centred on the table. A round
// table is the unit disc; a rectangle is its travel in mm. Plain JS so
// scripts/check-text.mjs runs exactly what the app runs.
import { FONTS as LINE_FONTS } from './fonts.mjs'
import { OUTLINE_FONTS } from './outlineFonts.mjs'
import { SYMBOLS } from './symbols.mjs'
import { inlayPath } from './inlay.mjs'

// Outline fonts first (the strip's order), Geometric leading: it reads best inlaid.
const ORDER = ['geometric', 'serif', 'brush', 'slab', 'heavy', 'rounded', 'marker', 'hand']
export const FONTS = { ...Object.fromEntries(ORDER.map((id) => [id, OUTLINE_FONTS[id]])), ...OUTLINE_FONTS, ...LINE_FONTS }
export const FONT_IDS = Object.keys(FONTS)
export { SYMBOLS }
export const SYMBOL_IDS = Object.keys(SYMBOLS)

export const MAX_LINES = 8
/** A letter's fill: sand-weaver's contour fill with no smoothing (see rowOf). */
const LETTER_FILL = { smooth: 0 }
/**
 * The size a symbol reads well at, in balls across its larger side: below it its features
 * are narrower than the ball and blur (sand sim, DW Pro and Mini Pro, 2026-11-14). Bold
 * shapes read at 10, shapes with some detail at 14, faces, animals and busy pictures at 20.
 * It's advice (a warning), not a limit: the owner found it too big as a minimum. The hard
 * floor is MIN_SYMBOL_BALLS for every symbol.
 */
const MIN_SYMBOL_BALLS = 6
const SYMBOL_BALLS = { bold: 10, some: 14, detailed: 20 }
const BOLD = ['Heart', 'Star', 'Moon', 'Lightning', 'Cloud', 'Music']
const DETAILED = ['Smile', 'Tears of joy', 'Heart eyes', 'Sunglasses', 'Wink', 'Thumbs up', 'Cat', 'Dog', 'Bear', 'Panda', 'Fox', 'Turtle', 'Unicorn', 'Pumpkin', 'House', 'Globe', 'Dove', 'Crown', 'Rocket', 'Sunflower', 'Daisy', 'Blossom', 'Pine tree', 'Palm tree', 'Mushroom', 'Ghost', 'Fish']
export function symbolBalls(ch) {
  const label = SYMBOLS[ch]?.label
  return SYMBOL_BALLS[BOLD.includes(label) ? 'bold' : DETAILED.includes(label) ? 'detailed' : 'some']
}
const ballsToSize = (frame, balls) => (balls * ballOf(frame)) / (frame.round ? 2 : Math.min(frame.W, frame.H))
/** A placed symbol's smallest size on this table (its larger side's share of the table's smaller side): 6 balls. */
export const minSymbolSize = (frame) => ballsToSize(frame, MIN_SYMBOL_BALLS)
/** The size it reads well at on this table (symbolBalls); smaller, its details blur. */
export const goodSymbolSize = (frame, ch) => ballsToSize(frame, symbolBalls(ch))
export const MAX_CHARS = 160
/** The text block keeps this share of the table (the joining lines still reach the edge). */
const MARGIN = 0.9
/** Gap between the text and a join beside it, in em. */
const BESIDE_GAP = 0.35
/** How far a .thr step may bow from its straight line (the table moves in θ/ρ), unit disc. */
const BOW = 0.0005

/**
 * The ball's diameter in frame units. A round frame may say its sand `diameter` and
 * `ball` (mm; lib/tableSize.ts), else a DW Pro's 700 / 10 (sand-weaver's dwpro-v6); a
 * rectangle is in mm, its ball 10 mm unless it says (dwcx-v1).
 */
export const ballOf = (frame) => (frame.round ? (frame.ball ?? 10) / ((frame.diameter ?? 700) / 2) : (frame.ball ?? 10))

/** Text as the fonts can take it: accents dropped, typographic quotes made plain, rows trimmed, blank rows at the ends dropped. */
export function textRows(text) {
  const rows = String(text)
    // Emoji presentation selectors, joiners and skin tones: the symbol alone.
    .replace(/[\ufe0e\ufe0f\u200d]|\ud83c[\udffb-\udfff]/g, '')
    // Every coloured heart is the heart symbol.
    .replace(/\u2764|\u2661|\ud83d[\udc93-\udc9f]|\ud83d\udda4|\ud83e[\udde1\udd0d\udd0e]/g, '\u2665')
    .replace(/[\u2018\u2019\u201a\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u2033]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\t/g, ' ')
    .split(/\r?\n/)
    .map((r) => r.trim())
    .slice(0, MAX_LINES)
  while (rows.length && !rows[0]) rows.shift()
  while (rows.length && !rows[rows.length - 1]) rows.pop()
  return rows
}

/** A symbol typed in the text: an outline glyph, its larger side 1.2 em, just below the baseline to just above a capital. */
const inline = new Map()
function symbolGlyph(ch) {
  if (!inline.has(ch)) {
    const { w, h, regions } = SYMBOLS[ch]
    const k = 1.2
    const at = (r) => r.map((v, i) => (i % 2 ? v * k + (h * k) / 2 - 0.1 : v * k + (w * k) / 2 + 0.12))
    inline.set(ch, [w * k + 0.24, regions.map((region) => region.map(at))])
  }
  return inline.get(ch)
}

function glyphOf(font, ch, prev) {
  if (SYMBOLS[ch]) return symbolGlyph(ch)
  if (font.outline) return font.glyphs[ch] ?? null
  let c = font.upper ? ch.toUpperCase() : ch
  if (font.joinAfter && prev && font.joinAfter.includes(prev) && /[a-z]/.test(c) && font.glyphs[c + '*']) c += '*'
  // A character the font lacks borrows SandSkrit's (same em, same joining line).
  return font.glyphs[c] ?? FONTS.sandskrit.glyphs[c] ?? FONTS.sandskrit.glyphs[ch] ?? null
}

const ringOf = (flat) => {
  const r = []
  for (let i = 0; i < flat.length; i += 2) r.push([flat[i], flat[i + 1]])
  return r
}

/**
 * An outline glyph traced in one closed walk (em, at x 0): from its door (the outline
 * point nearest the joining line) round that outline, every other ring (holes, an i's
 * dot) bridged in from the nearest ring already reached, there and back.
 */
function glyphWalk(rings, outer) {
  let root = 0
  let door = 0
  let best = Infinity
  rings.forEach((r, k) => {
    if (!outer[k]) return
    r.forEach(([, y], i) => {
      if (Math.abs(y) < best) {
        best = Math.abs(y)
        root = k
        door = i
      }
    })
  })
  const links = rings.map(() => [])
  const reached = [root]
  const rest = rings.map((_, k) => k).filter((k) => k !== root)
  while (rest.length) {
    let link = null
    for (const a of reached) for (const b of rest) for (let i = 0; i < rings[a].length; i++) for (let j = 0; j < rings[b].length; j++) {
      const d = Math.hypot(rings[a][i][0] - rings[b][j][0], rings[a][i][1] - rings[b][j][1])
      if (!link || d < link.d) link = { d, a, b, i, j }
    }
    links[link.a].push(link)
    reached.push(link.b)
    rest.splice(rest.indexOf(link.b), 1)
  }
  const walk = (k, e) => {
    const r = rings[k]
    const out = []
    for (let t = 0; t <= r.length; t++) {
      const i = (e + t) % r.length
      out.push(r[i])
      if (t < r.length) for (const l of links[k]) if (l.i === i) out.push(...walk(l.b, l.j), r[i])
    }
    return out
  }
  return walk(root, door)
}

const walks = new Map()
function walkOf(fontId, ch, g) {
  const key = `${fontId}\u0000${ch}`
  if (!walks.has(key)) {
    const rings = g[1].flatMap((region) => region.map(ringOf))
    const outer = g[1].flatMap((region) => region.map((_, i) => i === 0))
    walks.set(key, rings.length ? glyphWalk(rings, outer) : null)
  }
  return walks.get(key)
}

/**
 * One row in em: the joining line from x 0 to the row's width with the letters on
 * it (`pts`), and the letters as inlay units (`units`): a single-line font's words,
 * an outline font's parts (each [outline, ...holes]).
 */
function rowOf(fontId, row, missing) {
  const font = FONTS[fontId]
  const pts = [[0, 0]]
  const units = []
  let word = null
  let x = 0
  let prev = ''
  const endWord = () => {
    if (word && word.length > 1) units.push({ kind: 'stroke', line: word })
    word = null
  }
  for (const ch of row) {
    const g = glyphOf(font, ch, prev)
    prev = ch
    if (!g) {
      missing.add(ch)
      continue
    }
    if (font.outline || SYMBOLS[ch]) {
      const w = walkOf(SYMBOLS[ch] ? 'symbol' : fontId, ch, g)
      if (w) {
        const at = w.map(([px, py]) => [x + px, py])
        pts.push([at[0][0], 0], ...at, [at[0][0], 0])
        // Letters: the EXACT contour (smooth 0: rings parallel to the stroke, crisp corners; the
        // smoothed one wobbled inside letters in the sim, 2026-11-14). Symbols: the smoothed one.
        for (const region of g[1]) units.push({ kind: 'region', contour: true, fill: SYMBOLS[ch] ? undefined : LETTER_FILL, rings: region.map((r) => ringOf(r).map(([px, py]) => [x + px, py])) })
      }
    } else {
      const at = []
      for (let i = 1; i < g.length; i += 2) at.push([x + g[i], g[i + 1]])
      pts.push(...at)
      if (ch === ' ') endWord()
      else (word ??= []).push(...at)
    }
    x += g[0]
  }
  endWord()
  pts.push([x, 0])
  return { pts, width: x, units }
}

/**
 * A placed symbol moved towards the centre (and, bigger than the table, shrunk) until
 * its outline lies on the table a ball in from the edge (the raking turns along the
 * edge, which must keep half a ball clear of it), or 2% if that's more.
 */
export function keepOnTable(frame, sym) {
  const S = SYMBOLS[sym.ch]
  if (!S) return sym
  const half = frame.round ? [1, 1] : [frame.W / 2, frame.H / 2]
  const side = frame.round ? 2 : Math.min(frame.W, frame.H)
  const turn = turned(sym.rot)
  const pts = S.regions.flatMap((region) => ringOf(region[0]).map(turn))
  const inset = Math.max(ballOf(frame), 0.02 * Math.min(half[0], half[1]))
  const fits = (x, y, size) =>
    pts.every(([px, py]) => {
      const X = x * half[0] + px * size * side
      const Y = y * half[1] + py * size * side
      return frame.round ? Math.hypot(X, Y) <= 1 - inset : Math.abs(X) <= half[0] - inset && Math.abs(Y) <= half[1] - inset
    })
  let size = sym.size
  while (size > 0.01 && !fits(0, 0, size)) size *= 0.95
  if (fits(sym.x, sym.y, size)) return size === sym.size ? sym : { ...sym, size }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 20; i++) {
    const t = (lo + hi) / 2
    if (fits(sym.x * t, sym.y * t, size)) lo = t
    else hi = t
  }
  return { ...sym, x: sym.x * lo, y: sym.y * lo, size }
}

/**
 * The text block placed on the table: `pts` (its outline, centred, unturned, in frame
 * units) turned by `rot`, centred at x, y (−1..1 of the half width / height), moved towards
 * the centre until it lies a ball inside the edge. Turning can't push a block off a disc
 * (it fits centred), but can off a rectangle: then `k` < 1 shrinks it.
 */
export function keepTextOnTable(frame, pts, { x = 0, y = 0, rot = 0 } = {}) {
  const half = frame.round ? [1, 1] : [frame.W / 2, frame.H / 2]
  const inset = ballOf(frame)
  const turn = turned(rot)
  const at = pts.map(turn)
  const fits = (t, k) =>
    at.every(([px, py]) => {
      const X = x * t * half[0] + px * k
      const Y = y * t * half[1] + py * k
      return frame.round ? Math.hypot(X, Y) <= 1 - inset : Math.abs(X) <= half[0] - inset && Math.abs(Y) <= half[1] - inset
    })
  let k = 1
  while (k > 0.05 && !fits(0, k)) k *= 0.97
  if (fits(1, k)) return { x, y, rot, k }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 20; i++) {
    const t = (lo + hi) / 2
    if (fits(t, k)) lo = t
    else hi = t
  }
  return { x: x * lo, y: y * lo, rot, k }
}

/** A symbol's turn: degrees clockwise as seen on the table (y up). */
function turned(rot = 0) {
  const a = (-rot * Math.PI) / 180
  const c = Math.cos(a)
  const s = Math.sin(a)
  return ([x, y]) => [x * c - y * s, x * s + y * c]
}

/** A row this many times bigger than the smallest is big enough (one short word would fill the table). */
const MAX_ROW_RATIO = 2

/**
 * Rows stacked in em at relative scales `k`, the block centred: each row's joining
 * line `y`, width `w` and points. Below a row: (spacing − 1) of its size; above the next: its capital.
 */
function stack(rows, k, spacing) {
  let y = 0
  const placed = rows.map((r, i) => {
    if (i) y -= (spacing - 1) * k[i - 1] + k[i]
    return { row: r, y, w: r.width * k[i], k: k[i], pts: r.pts.map(([x, py]) => [(x - r.width / 2) * k[i], y + py * k[i]]) }
  })
  let lo = Infinity
  let hi = -Infinity
  for (const r of placed) for (const [, py] of r.pts) {
    lo = Math.min(lo, py)
    hi = Math.max(hi, py)
  }
  const dy = -(lo + hi) / 2
  return placed.map((r) => ({ ...r, y: r.y + dy, pts: r.pts.map(([x, py]) => [x, py + dy]) }))
}

/** How far from the centre a join beside two rows runs (em). */
const besideX = (a, b) => Math.max(a.w, b.w) / 2 + BESIDE_GAP * Math.max(a.k, b.k)

/** The largest scale that keeps the letters (and joins beside them) inside the margin. */
function fitScale(em, frame, join) {
  const probe = em.flatMap((r) => r.pts)
  if (join === 'beside') {
    // The join between two rows runs beside the wider one, at both rows' heights.
    for (let i = 1; i < em.length; i++) {
      const x = besideX(em[i - 1], em[i])
      probe.push([x, em[i - 1].y], [x, em[i].y], [-x, em[i - 1].y], [-x, em[i].y])
    }
  }
  if (frame.round) return MARGIN / Math.max(...probe.map(([x, y]) => Math.hypot(x, y)))
  return Math.min((MARGIN * frame.W) / 2 / Math.max(...probe.map(([x]) => Math.abs(x))), (MARGIN * frame.H) / 2 / Math.max(...probe.map(([, y]) => Math.abs(y))))
}

/** Each row's own size, as wide as its place on the table allows (a disc narrows towards the top and bottom). */
function rowScales(rows, frame, spacing) {
  const cap = (k) => {
    const lo = Math.min(...k)
    return k.map((v) => Math.min(v, lo * MAX_ROW_RATIO))
  }
  const most = Math.max(...rows.map((r) => r.width))
  let k = cap(rows.map((r) => most / r.width))
  if (!frame.round) return k
  // Iterate on each row's box (cheap); the caller fits the letters themselves.
  const box = rows.map((r) => {
    const ys = r.pts.map(([, y]) => y)
    return { w: r.width, lo: Math.min(...ys), hi: Math.max(...ys) }
  })
  for (let it = 0; it < 16; it++) {
    let y = 0
    const at = box.map((b, i) => {
      if (i) y -= (spacing - 1) * k[i - 1] + k[i]
      return { half: (b.w * k[i]) / 2, top: y + b.hi * k[i], bottom: y + b.lo * k[i] }
    })
    const dy = -(Math.max(...at.map((a) => a.top)) + Math.min(...at.map((a) => a.bottom))) / 2
    const far = at.map((a) => Math.max(Math.abs(a.top + dy), Math.abs(a.bottom + dy)))
    const s = MARGIN / Math.max(...at.map((a, i) => Math.hypot(a.half, far[i])))
    const want = at.map((a, i) => (2 * Math.sqrt(Math.max(0.01, MARGIN * MARGIN - (far[i] * s) ** 2))) / s / box[i].w)
    k = cap(k.map((v, i) => (v + want[i]) / 2))
  }
  return k
}

/**
 * Lays text out on a table.
 * frame: { round: true, diameter?, ball? } (the unit disc; mm, for the ball's size in it) or { round: false, W, H, ball? } (mm).
 * size: 0..1 of the largest that fits. spacing: row pitch in em (capital height 1).
 * rowSize: 'same' (one size for every row) | 'fill' (each row as wide as its place allows, up to twice the smallest).
 * style: 'lines' | 'inlay'.
 * join (lines): 'edge' (every joining line runs edge to edge, rows joined along the edge)
 *     | 'beside' (rows joined beside the text; only the first and last reach the edge).
 * letters (inlay, outline fonts): 'solid' (filled across the host's lanes) | 'outline'.
 * rake (inlay): 0 (just round the text and symbols) .. 1 (the whole table).
 * host (inlay): 'spiral' (one line out from the centre; the default) | 'lanes' (straight, at 45°).
 * zone (inlay): a letter is drawn after the host's last pass within this many balls of it (default 1).
 * texts (inlay): [{ text, font, size, rowSize, place }] several text blocks, each its own; else
 *   text / font / size / rowSize / place make the one block.
 * place (inlay): { x, y, rot } where the text block goes (its centre, −1..1 of the half width /
 *   height) and its turn (degrees clockwise), kept on the table (keepTextOnTable). Lines ignore it.
 * symbols (inlay): [{ ch, x, y, size, rot }] placed freely: x, y −1..1 of the half width / height
 *   (right, up), size = its larger side's share of the table's smaller side (a disc's diameter),
 *   rot = degrees clockwise as seen on the table.
 * Returns null when there's nothing to draw.
 */
/**
 * One text block, inlaid: its letters as units turned and moved to `place` (kept on the
 * table), its joining line's points there (a lanes host's band follows them) and its
 * outline centred and unturned (Create's canvas moves that). Null when it writes nothing.
 */
function inlayBlock({ text, font: fontId = 'sandskrit', size = 1, rowSize = 'same', place }, frame, spacing, letters, missing) {
  if (!FONTS[fontId]) fontId = 'sandskrit'
  // A blank row keeps its place: it's a row of nothing, a capital high.
  const rows = textRows(text ?? '').map((r) => rowOf(fontId, r, missing))
  if (!rows.some((r) => r.width > 0 && r.pts.length > 2)) return null
  const k = rowSize === 'fill' ? rowScales(rows.map((r) => (r.width > 0 ? r : { ...r, width: 1 })), frame, spacing) : rows.map(() => 1)
  const em = stack(rows, k, spacing).filter((r) => r.row.width > 0)
  const s = fitScale(em, frame, 'edge') * Math.min(1, Math.max(0.05, size))
  // The letters in the frame, centred as the joining line's points are (stack).
  const local = []
  const joins = []
  for (const r of em) {
    const at = ([x, y]) => [(x - r.row.width / 2) * r.k * s, (r.y + y * r.k) * s]
    for (const u of r.row.units) {
      if (u.kind === 'stroke') local.push({ kind: 'stroke', line: u.line.map(at) })
      else if (letters === 'outline') for (const ring of u.rings) local.push({ kind: 'ring', ring: ring.map(at) })
      else local.push({ kind: 'region', contour: u.contour, fill: u.fill, rings: u.rings.map((ring) => ring.map(at)) })
    }
    for (const [x, y] of r.pts) joins.push([x * s, y * s])
  }
  const textPts = local.flatMap((u) => (u.kind === 'stroke' ? u.line : u.kind === 'ring' ? u.ring : u.rings[0]))
  const fit = keepTextOnTable(frame, textPts.length ? textPts : joins, place)
  const half = frame.round ? [1, 1] : [frame.W / 2, frame.H / 2]
  const turn = turned(fit.rot)
  const move = (p) => {
    const [px, py] = turn(p)
    return [fit.x * half[0] + px * fit.k, fit.y * half[1] + py * fit.k]
  }
  const units = local.map((u) =>
    u.kind === 'stroke' ? { ...u, line: u.line.map(move) } : u.kind === 'ring' ? { ...u, ring: u.ring.map(move) } : { ...u, rot: fit.rot, rings: u.rings.map((ring) => ring.map(move)) },
  )
  return { units, joins: joins.map(move), textPts, capHeight: s * Math.min(...em.map((r) => r.k)) * fit.k, rows: em.length }
}

export function layoutText({ text, font: fontId = 'sandskrit', frame, size = 1, spacing = 1.7, rowSize = 'same', style = 'lines', join = 'edge', letters = 'solid', rake = 0, host = 'spiral', zone, place, texts, symbols = [] }) {
  if (!FONTS[fontId]) fontId = 'sandskrit'
  const missing = new Set()
  const inlay = style === 'inlay'

  if (inlay) {
    // Every text block (one, or `texts`), then the free symbols, centred where they were put.
    const blocks = (texts ?? [{ text, font: fontId, size, rowSize, place }]).map((b) => inlayBlock(b, frame, spacing, letters, missing)).filter(Boolean)
    const placed = symbols.filter((sym) => SYMBOLS[sym.ch]).map((sym) => keepOnTable(frame, sym))
    if (!blocks.length && !placed.length) return null
    const units = blocks.flatMap((b) => b.units)
    let top = -Infinity
    let bottom = Infinity
    for (const b of blocks) for (const [, y] of b.joins) {
      top = Math.max(top, y)
      bottom = Math.min(bottom, y)
    }
    const half = frame.round ? [1, 1] : [frame.W / 2, frame.H / 2]
    const side = frame.round ? 2 : Math.min(frame.W, frame.H)
    for (const sym of placed) {
      const at = [sym.x * half[0], sym.y * half[1]]
      const scale = sym.size * side
      const turn = turned(sym.rot)
      const put = (p) => {
        const [x, y] = turn(p)
        return [at[0] + x * scale, at[1] + y * scale]
      }
      for (const region of SYMBOLS[sym.ch].regions) {
        const rings = region.map((r) => ringOf(r).map(put))
        if (letters === 'outline') for (const ring of rings) units.push({ kind: 'ring', ring })
        else units.push({ kind: 'region', contour: true, rot: sym.rot ?? 0, rings })
        for (const [, y] of rings[0]) {
          top = Math.max(top, y)
          bottom = Math.min(bottom, y)
        }
      }
    }
    const capHeight = blocks.length ? Math.min(...blocks.map((b) => b.capHeight)) : Infinity
    const rows = blocks.reduce((n, b) => n + b.rows, 0)
    const textPts = blocks[0]?.textPts ?? []
    // The design alone (Create's canvas): no host, no fills, no path.
    if (host === 'none') return { path: [], rows, missing: [...missing], capHeight, textPts, shapes: units.map((u) => (u.kind === 'stroke' ? { line: u.line } : { rings: u.kind === 'ring' ? [u.ring] : u.rings })) }
    const { path, visits } = inlayPath({ units, frame, ball: ballOf(frame), top, bottom, rake, host, zone })
    return { path, rows, missing: [...missing], capHeight, visits, textPts }
  }

  // A blank row keeps its place: it's a row of nothing, a capital high.
  const rows = textRows(text).map((r) => rowOf(fontId, r, missing))
  if (!rows.some((r) => r.width > 0 && r.pts.length > 2)) return null
  const k = rowSize === 'fill' ? rowScales(rows.map((r) => (r.width > 0 ? r : { ...r, width: 1 })), frame, spacing) : rows.map(() => 1)
  const em = stack(rows, k, spacing).filter((r) => r.row.width > 0)
  const s = fitScale(em, frame, join) * Math.min(1, Math.max(0.05, size))
  const capHeight = s * Math.min(...em.map((r) => r.k))

  const edgeX = (y) => (frame.round ? Math.sqrt(Math.max(0, 1 - y * y)) : frame.W / 2)
  const path = []
  const push = (p) => path.push(p)
  em.forEach((r, i) => {
    const y = r.y * s
    // Back and forth: even rows left to right, odd rows right to left (side = where it ends).
    const side = i % 2 ? -1 : 1
    const ink = r.pts.map(([x, py]) => [x * s, py * s])
    if (side < 0) ink.reverse()
    const first = i === 0
    const last = i === em.length - 1
    if (first || join === 'edge') push([-side * edgeX(y), y])
    for (const p of ink) push(p)
    if (last || join === 'edge') push([side * edgeX(y), y])
    if (last) return
    const next = em[i + 1]
    const ny = next.y * s
    if (join === 'edge') {
      // Along the edge to the next row's end on this side.
      if (frame.round) arc(path, Math.atan2(y, side * edgeX(y)), Math.atan2(ny, side * edgeX(ny)))
    } else {
      const x = side * besideX(r, next) * s
      push([x, y])
      push([x, ny])
    }
  })
  return { path, rows: em.length, missing: [...missing], capHeight }
}

/** Along the unit circle from angle a to b, the short way. */
function arc(path, a, b) {
  let d = b - a
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  const n = Math.max(1, Math.ceil(Math.abs(d) / 0.02))
  for (let k = 1; k <= n; k++) path.push([Math.cos(a + (d * k) / n), Math.sin(a + (d * k) / n)])
}

/** Distance from the centre to segment a–b. */
function nearCentre([ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const l2 = dx * dx + dy * dy
  const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0
  return Math.hypot(ax + dx * t, ay + dy * t)
}

/**
 * A straight path as the table draws it in θ/ρ: steps short enough not to bow more
 * than BOW (a step of length L at radius r bows about L²/8r), long ones far out.
 */
export function thrSteps(path) {
  const out = [path[0]]
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]
    const b = path[i]
    const near = nearCentre(a, b)
    // Through the very centre a step swings θ by up to half a turn: shorter steps there.
    const max = Math.min(0.03, Math.max(near < 0.002 ? 0.0005 : 0.002, Math.sqrt(8 * near * BOW)))
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / max)
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
  }
  return out
}

/**
 * A round table's .thr: θ continuous (never wrapped), ρ 0..1. θ is measured as the
 * app draws a .thr (x = ρ·cosθ right, y = ρ·sinθ down the screen), which is how the
 * table draws it seen from above (sand-weaver's DW Pro calibration).
 */
export function toThr(path) {
  const lines = []
  let last = null
  for (const [x, y] of thrSteps(path)) {
    const rho = Math.min(1, Math.hypot(x, y))
    let theta = Math.atan2(-y, x)
    // At the centre θ means nothing (the ball doesn't move as it turns): keep the last one,
    // or a path straight through the centre would swing θ half a turn in one step.
    if (last !== null && rho < 1e-4) theta = last
    else if (last !== null) theta = last + ((((theta - last) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI
    last = theta
    lines.push(`${theta.toFixed(5)} ${rho.toFixed(5)}`)
  }
  return lines.join('\n') + '\n'
}

/** A rectangular table's G-code: mm from the travel's lower-left corner, y up. FluidNC needs a feed before the first move. */
export function toGcode(path, W, H) {
  const clamp = (v, hi) => Math.min(hi, Math.max(0, v))
  const lines = ['G1 F5000']
  for (const [x, y] of path) lines.push(`G1 X${clamp(x + W / 2, W).toFixed(3)} Y${clamp(y + H / 2, H).toFixed(3)}`)
  return lines.join('\n') + '\n'
}
