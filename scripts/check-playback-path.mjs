// Checks src/lib/playbackPath.ts (the path the Fast preview and the Now Playing
// drawing follow) on real bundled patterns, round and rectangular:
//   npm run check-playback
// The module is transpiled with the repo's TypeScript and its app imports stubbed
// (the file comes off disk instead of expo-file-system), so this runs in plain Node.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { gcodePoints } from '../src/lib/gcodeGeometry.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lib = (f) => pathToFileURL(path.join(ROOT, 'src/lib', f)).href
const stubs = `
import fs from 'node:fs'
import { gcodeExtent, gcodePoints, PREVIEW_INSET } from '${lib('gcodeGeometry.mjs')}'
const isGcode = (n) => /\\.(gcode|gc|nc)$/i.test(n)
const toScreen = (p, size, pad = 0.06) => { const c = size / 2, r = c * (1 - pad); return [c + p[0] * r, c + p[1] * r] }
const rectToScreen = (size, w, h) => {
  const bw = w * PREVIEW_INSET, bh = h * PREVIEW_INSET, s = Math.min(bw / size[0], bh / size[1])
  const ox = (w - bw) / 2 + (bw - size[0] * s) / 2, oy = (h - bh) / 2 + (bh - size[1] * s) / 2
  return (x, y) => [ox + x * s, oy + (size[1] - y) * s]
}
class File { constructor(u) { this.u = u } async text() { return fs.readFileSync(this.u, 'utf8') } }
const useLibrary = { getState: () => ({ resolveThr: async (n) => ({ uri: '${ROOT}/assets/' + (isGcode(n) ? 'gcode/' : 'thr/') + n }) }) }
`
const src = stubs + fs.readFileSync(path.join(ROOT, 'src/lib/playbackPath.ts'), 'utf8').replace(/^import .*$/gm, '')
const out = path.join(ROOT, 'node_modules/.cache/check-playback-path.mjs')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
const { playbackPath, reveal, locate } = await import(pathToFileURL(out).href)

let fail = 0
const check = (ok, msg) => { if (!ok) { fail++; console.log('FAIL', msg) } }
// flowsnake reaches y 320 on the 307 mm table: it must still fit the preview.
const CASES = [
  ['hero-star.gcode', 341, 141.5],
  ['circle-packer.gcode', 341, 141.5],
  ['flowsnake.gcode', 341, 141.5],
  // maze retraces its walls: the tip must still land on the ball.
  ['maze.gcode', 341, 141.5],
  ['hero_5loop1.thr', 236, 236],
  ['clear_from_in.thr', 236, 236],
]
for (const [name, w, h] of CASES) {
  const p = await playbackPath(name, w, h)
  check(!!p, `${name}: no path`)
  if (!p) continue
  const moves = name.endsWith('.gcode') ? gcodePoints(fs.readFileSync(path.join(ROOT, 'assets/gcode', name), 'utf8')).length : null
  console.log(`${name.padEnd(22)} ${p.xs.length} points${moves ? ` (of ${moves} moves)` : ''}, ${p.total.toFixed(0)} pt long`)
  // Simplifying keeps the shape: not collapsed to a few points.
  check(p.xs.length > (moves ? moves * 0.1 : 1000), `${name}: only ${p.xs.length} points kept`)
  let off = 0
  for (let i = 0; i < p.xs.length; i++) if (p.xs[i] < -0.5 || p.xs[i] > w + 0.5 || p.ys[i] < -0.5 || p.ys[i] > h + 0.5) off++
  check(off === 0, `${name}: ${off} points off the preview`)
  for (const by of ['length', 'file']) {
    let prev = -1
    for (let f = 0; f <= 1.0001; f += 0.01) {
      const r = reveal(p, f, by)
      check(r.index >= prev, `${name}: the ball went back (by ${by}, at ${f.toFixed(2)})`)
      prev = r.index
    }
    check(reveal(p, 1, by).index === p.xs.length - 1, `${name}: the end isn't reached by ${by}`)
  }
  // The Now Playing tip follows the polled ball: put the ball on a move's end,
  // with the progress the firmware reports there, and the tip must land on it.
  if (moves) {
    const text = fs.readFileSync(path.join(ROOT, 'assets/gcode', name), 'utf8')
    const ends = []
    const pts = gcodePoints(text, ends)
    let worst = 0
    for (let k = 1; k < pts.length; k += Math.ceil(pts.length / 200)) {
      const r = reveal(p, locate(p, ends[k] / text.length, pts[k]), 'length')
      const [sx, sy] = p.place(pts[k][0], pts[k][1])
      worst = Math.max(worst, Math.hypot(r.x - sx, r.y - sy))
    }
    check(worst < 1, `${name}: the tip lands ${worst.toFixed(2)} pt from the ball`)
  }
  // Without a ball, it's where the file share puts it.
  const f = reveal(p, 0.5, 'file')
  const g = reveal(p, locate(p, 0.5, null), 'length')
  check(Math.hypot(f.x - g.x, f.y - g.y) < 0.01, `${name}: locate without a ball strays from the file share`)
}
console.log(fail ? `${fail} check(s) FAILED` : 'all checks pass')
process.exit(fail ? 1 : 0)
