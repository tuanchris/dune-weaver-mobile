// npm run check-text: the text generator (src/lib/sandText) on every font, both
// table shapes and every layout, lines and inlay. The path stays on the table,
// starts and ends at its edge, and exports a valid .thr (no step bows off its
// line, continuous θ, ρ ≤ 1) or G-code (inside the travel, a feed first); text
// reads the way the app draws it; an inlaid letter is never passed once drawn.
import assert from 'node:assert/strict'
import * as T from '../src/lib/sandText/index.mjs'
import { parseThr, toXY } from '../src/lib/thrGeometry.mjs'

const TEXTS = [
  'Hello',
  'Welcome to\nDune Weaver\nsand tables',
  'Happy birthday Maya!\nLove, Mom & Dad',
  'Top\n\nBottom',
  'I\nlove\nyou',
  'Crème brûlée 1234567890 ?!&$@#',
  'I \u2764\ufe0f you \ud83d\ude0a\n\u2b50 Merry \ud83c\udf84',
  'x'.repeat(T.MAX_CHARS),
]
// A DW Pro, a DW Mini Pro (its ball a bigger share of the table), DWCX and one of its squares.
const FRAMES = [{ round: true }, { round: true, diameter: 250, ball: 10 }, { round: false, W: 725, H: 305 }, { round: false, W: 305, H: 305 }]
const EPS = 1e-9
let n = 0

const LAYOUTS = [
  ...['edge', 'beside'].flatMap((join) => ['same', 'fill'].flatMap((rowSize) => [1, 0.3].map((size) => ({ style: 'lines', join, rowSize, size })))),
  ...['spiral', 'lanes'].flatMap((host) => ['solid', 'outline'].flatMap((letters) => [0, 0.4, 1].map((rake) => ({ style: 'inlay', host, letters, rake, rowSize: 'fill' })))),
  // Several text blocks, each its own font, size and place.
  { style: 'inlay', rake: 0.4, texts: [{ text: 'Top', font: 'serif', size: 0.4, place: { x: -0.3, y: 0.5, rot: 15 } }, { text: 'Bottom \u2665', size: 0.45, place: { x: 0.2, y: -0.5, rot: -20 } }] },
  // The text moved and turned (kept on the table), on both backgrounds.
  ...['spiral', 'lanes'].map((host) => ({ style: 'inlay', host, letters: 'solid', rake: 0.5, size: 0.5, place: { x: 0.7, y: -0.6, rot: 35 } })),
  { style: 'inlay', letters: 'solid', rake: 0.3, symbols: [{ ch: '\u2b50', x: 0.5, y: -0.7, size: 0.2, rot: 30 }, { ch: '\u2665', x: -0.8, y: 0.3, size: 0.3, rot: -120 }] },
]

// Symbols: centred, the larger side 1, each ring closed and at least a triangle.
for (const [ch, sym] of Object.entries(T.SYMBOLS)) {
  assert.ok(sym.label && Math.abs(Math.max(sym.w, sym.h) - 1) < 0.01, `symbol ${ch}: not unit size`)
  for (const region of sym.regions) for (const ring of region) assert.ok(ring.length >= 6 && ring.length % 2 === 0 && ring.every((v) => Number.isFinite(v) && Math.abs(v) <= 0.51), `symbol ${ch}: malformed ring`)
}
// Every symbol, placed alone or typed, draws.
for (const ch of T.SYMBOL_IDS) {
  assert.ok(T.layoutText({ text: '', frame: FRAMES[0], style: 'inlay', symbols: [{ ch, x: 0, y: 0, size: 0.4 }] })?.visits?.length, `symbol ${ch}: nothing drawn`)
  assert.deepEqual(T.layoutText({ text: ch, frame: FRAMES[0] }).missing, [], `symbol ${ch}: missing when typed`)
}

for (const font of T.FONT_IDS) {
  const f = T.FONTS[font]
  for (const [ch, g] of Object.entries(f.glyphs)) {
    if (f.outline) {
      // [advance, regions]: each region [outline, ...holes], each ring closed and at least a triangle.
      assert.ok(Number.isFinite(g[0]) && Array.isArray(g[1]), `${font} ${ch}: malformed`)
      for (const region of g[1]) for (const ring of region) assert.ok(ring.length >= 6 && ring.length % 2 === 0 && ring.every(Number.isFinite), `${font} ${ch}: malformed ring`)
      continue
    }
    // [advance, points…], starting on the joining line; it ends on it too unless
    // the next letter joins it higher (Script's b, o, v, w).
    assert.ok(g.length >= 5 && g.length % 2 === 1 && g.every(Number.isFinite), `${font} ${ch}: malformed`)
    const endsHigh = font === 'script' && 'bovw'.includes(ch[0])
    if (!endsHigh) assert.ok(Math.abs(g[g.length - 1]) < 0.02, `${font} ${ch}: ends off the joining line`)
  }
  for (const frame of FRAMES) for (const text of TEXTS) for (const layout of LAYOUTS) {
    const what = `${font} ${frame.round ? 'round' : `${frame.W}x${frame.H}`} ${JSON.stringify(layout)} ${JSON.stringify(text.slice(0, 20))}`
    const L = T.layoutText({ text, font, frame, ...layout })
    assert.ok(L && L.path.length > 1 && L.capHeight > 0, `${what}: nothing drawn`)
    const inside = frame.round ? ([x, y]) => Math.hypot(x, y) <= 1 + EPS : ([x, y]) => Math.abs(x) <= frame.W / 2 + EPS && Math.abs(y) <= frame.H / 2 + EPS
    const onEdge = frame.round ? ([x, y]) => Math.abs(Math.hypot(x, y) - 1) < 1e-6 : ([x, y]) => Math.abs(Math.abs(x) - frame.W / 2) < 1e-6 || Math.abs(Math.abs(y) - frame.H / 2) < 1e-6
    assert.ok(L.path.every((p) => p.every(Number.isFinite) && inside(p)), `${what}: leaves the table`)
    if (layout.style === 'inlay' && layout.host !== 'lanes') {
      // The spiral: from the centre (a rectangle's core) out; to the edge when it rakes the whole table.
      const core = frame.round ? 0 : Math.abs(frame.W - frame.H) / 2
      assert.ok(Math.abs(Math.hypot(...L.path[0]) - core) < 1e-6, `${what}: the spiral doesn't start at the centre`)
      if (layout.rake >= 1) assert.ok(onEdge(L.path[L.path.length - 1]), `${what}: the spiral doesn't end at the edge`)
    } else assert.ok(onEdge(L.path[0]) && onEdge(L.path[L.path.length - 1]), `${what}: doesn't start and end at the edge`)
    if (frame.round) {
      const pts = parseThr(T.toThr(L.path))
      for (let i = 1; i < pts.length; i++) {
        assert.ok(pts[i][1] >= 0 && pts[i][1] <= 1, `${what}: ρ out of range`)
        assert.ok(Math.abs(pts[i][0] - pts[i - 1][0]) < Math.PI, `${what}: θ jumps`)
      }
      // The table moves in θ/ρ: halfway through a step it is at the mean θ and ρ, which must be on the step's line.
      const xy = ([t, r]) => [r * Math.cos(t), r * Math.sin(t)]
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [xy(pts[i - 1]), xy(pts[i])]
        const m = xy([(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2])
        assert.ok(Math.hypot(m[0] - (a[0] + b[0]) / 2, m[1] - (a[1] + b[1]) / 2) < 0.0012, `${what}: a step bows off its line`)
      }
    } else {
      const lines = T.toGcode(L.path, frame.W, frame.H).trim().split('\n')
      assert.equal(lines[0], 'G1 F5000')
      for (const l of lines.slice(1)) {
        const [, x, y] = l.match(/^G1 X([\d.]+) Y([\d.]+)$/) ?? []
        assert.ok(+x >= 0 && +x <= frame.W && +y >= 0 && +y <= frame.H, `${what}: ${l} outside the travel`)
      }
    }
    n++
  }
}

// Inlay: once a letter is drawn, the host's later lanes keep half a ball clear of it (sand-weaver's rule).
for (const host of ['spiral', 'lanes']) for (const [font, letters, rake, frame] of [['geometric', 'solid', 0, FRAMES[0]], ['serif', 'outline', 1, FRAMES[0]], ['sandskrit', 'solid', 0.3, FRAMES[2]], ['brush', 'solid', 1, FRAMES[3]], ['slab', 'solid', 0.5, FRAMES[1]]]) {
  const symbols = [{ ch: '\ud83d\ude0a', x: 0.3, y: -0.7, size: 0.25, rot: 45 }, { ch: '\u2b50', x: -0.6, y: 0.6, size: 0.15, rot: 200 }]
  const L = T.layoutText({ text: 'Hello \u2665\nDune Weaver', font, frame, style: 'inlay', letters, rake, host, symbols })
  const zone = 0.5 * T.ballOf(frame)
  const inVisit = new Uint8Array(L.path.length)
  // A visit leaves the lane at its vertex and comes back to it: only what lies between is the letter.
  for (const v of L.visits) for (let i = v.from + 1; i < v.to; i++) inVisit[i] = 1
  // Distance from q to segment a–b: a lane is one long straight step.
  const toSegment = (q, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2)) : 0
    return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy)
  }
  for (const v of L.visits) {
    for (let i = v.to; i + 1 < L.path.length; i++) {
      if (inVisit[i] || inVisit[i + 1]) continue
      assert.ok(v.outline.every((q) => toSegment(q, L.path[i], L.path[i + 1]) >= zone * 0.95), `${host} ${font} ${letters} rake ${rake}: a lane passes a letter drawn before it`)
    }
  }
  n++
}

// Rows read top to bottom and left to right as the app draws a .thr (y down the screen).
const L = T.layoutText({ text: 'A\nB', frame: { round: true } })
const [first] = toXY(parseThr(T.toThr(L.path)))
assert.ok(first[0] < 0 && first[1] < 0, 'the first row should start at the left, above the centre')
// What no font has is reported, and the rest still draws.
assert.deepEqual(T.layoutText({ text: 'a;b', frame: { round: true } }).missing, [';'])
assert.equal(T.layoutText({ text: ' \n\n ', frame: { round: true } }), null)
assert.equal(T.textRows('1\n2\n3\n4\n5\n6\n7\n8\n9\n10').length, T.MAX_LINES)

console.log(`check-text: ${n} layouts OK`)
