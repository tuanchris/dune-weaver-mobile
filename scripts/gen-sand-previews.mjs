// Renders SAND previews: each .thr in a folder on each table the sand engine knows
// (DWP / DWG / DWMP: their size and ball), after that table's clear — the last
// frame of Browse's sand player, made by the very page the phone runs
// (assets/sand, the still mode of scripts/sand-page.js) in headless Chrome.
// Writes <out>/<table>/<stem>.webp (512 px, transparent round the disc). The
// Pattern Hub's previews are made with it (the website's scripts/hub-sand-previews.ts
// exports the files and uploads the result); the app shows them from the hub.
//
// ≈6 s a render with 3 at once on this Mac's GPU. Incremental: a render is kept
// while the engine's KEY (assets/sand/index.js) is unchanged, so re-run it after
// `npm run gen-sand` (a new engine, clear or ball) or when files are added:
//   npm run gen-sand-previews -- --in <dir> --out <dir> [--tables <stem → tables json>] [--jobs 3] [--only <substring>] [--px 512]
// Without --tables every file renders on all three tables.
// Needs Chrome and playwright-core (resolved here, else from ../dune-weaver-viewer).
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const arg = (flag, dflt) => {
  const i = process.argv.indexOf(flag)
  return i > 0 ? process.argv[i + 1] : dflt
}
const JOBS = Number(arg('--jobs', 3))
const ONLY = arg('--only', '')
const IN = arg('--in')
const OUT = arg('--out')
if (!IN || !OUT) throw new Error('Usage: npm run gen-sand-previews -- --in <dir of .thr> --out <dir> [--tables <json>] [--jobs 3]')
const WANT = arg('--tables') ? JSON.parse(fs.readFileSync(arg('--tables'), 'utf8')) : null
const TABLES = ['DWP', 'DWG', 'DWMP']
const OUT_PX = Number(arg('--px', 512)) // the bundled ink previews' size (--px for a closer look)
const RENDER_PX = Math.max(1024, OUT_PX) // shaded at (at least) twice that, then scaled down

const requireFrom = (dir) => createRequire(path.join(dir, 'package.json'))
let chromium
for (const dir of [root, path.join(root, '../dune-weaver-viewer')]) {
  try {
    ;({ chromium } = requireFrom(dir)('playwright-core'))
    break
  } catch {}
}
if (!chromium) throw new Error('playwright-core not found (here or in ../dune-weaver-viewer)')

const sandDir = path.join(root, 'assets/sand')
const index = fs.readFileSync(path.join(sandDir, 'index.js'), 'utf8')
const KEY = index.match(/^export const KEY = '(\w+)'/m)?.[1]
const PAGE = JSON.parse(index.match(/^export const PAGE = (".*")$/m)?.[1] ?? 'null')
if (!KEY || !PAGE) throw new Error('assets/sand/index.js has no KEY / PAGE: run npm run gen-sand')

const thrDir = path.resolve(IN)
const files = fs.readdirSync(thrDir).filter((f) => f.endsWith('.thr')).sort()
const out = path.resolve(OUT)
const stampFile = path.join(out, 'stamp.json')
const stamp = fs.existsSync(stampFile) ? JSON.parse(fs.readFileSync(stampFile, 'utf8')) : null
// Another engine's renders are stale: drop them (only the table folders, never the rest of <out>).
if (stamp?.key !== KEY) for (const t of TABLES) fs.rmSync(path.join(out, t), { recursive: true, force: true })
for (const t of TABLES) fs.mkdirSync(path.join(out, t), { recursive: true })
fs.writeFileSync(stampFile, JSON.stringify({ key: KEY }) + '\n')

const stem = (f) => f.replace(/\.thr$/, '')
const target = (t, f) => path.join(out, t, `${stem(f)}.webp`)
const jobs = TABLES.flatMap((t) => files.filter((f) => f.includes(ONLY) && (WANT?.[stem(f)] ?? TABLES).includes(t)).map((f) => ({ t, f })))
  .filter(({ t, f }) => !fs.existsSync(target(t, f)))

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--ignore-gpu-blocklist'] })
let done = 0
const failed = []
const t0 = Date.now()
async function render({ t, f }) {
  const page = await browser.newPage({ viewport: { width: RENDER_PX, height: RENDER_PX }, deviceScaleFactor: 1 })
  try {
    let pageError = null
    page.on('pageerror', (e) => (pageError = e))
    await page.route('http://sand.local/**', (route) => {
      const name = decodeURIComponent(new URL(route.request().url()).pathname.slice(1))
      if (name === 'index.html') return route.fulfill({ contentType: 'text/html', body: PAGE })
      const file = path.join(sandDir, name)
      if (!/^[\w-]+\.(bin|thr)$/.test(name) || !fs.existsSync(file)) return route.fulfill({ status: 404 })
      return route.fulfill({ contentType: 'application/octet-stream', body: fs.readFileSync(file) })
    })
    const thr = fs.readFileSync(path.join(thrDir, f), 'utf8')
    await page.addInitScript((sand) => (window.SAND = sand), { thr, table: t, size: RENDER_PX, still: { size: OUT_PX, type: 'image/webp', quality: 0.8 } })
    await page.goto('http://sand.local/index.html')
    await page.waitForFunction(() => window.sandStill || null, null, { timeout: Number(process.env.START_TIMEOUT_MS ?? 60_000) }).catch(() => {
      throw pageError ?? new Error('the page never started')
    })
    const data = await page.evaluate(() => window.sandStill)
    if (!data.startsWith('data:image/webp;base64,')) throw new Error(`not a webp: ${data.slice(0, 30)}`)
    fs.writeFileSync(target(t, f), Buffer.from(data.split(',')[1], 'base64'))
  } catch (e) {
    failed.push(`${t} ${f}: ${e.message}`)
  } finally {
    await page.close()
    done++
    const min = (Date.now() - t0) / 60000
    console.log(`${done}/${jobs.length} ${t} ${f} (${min.toFixed(1)} min, ~${((min / done) * (jobs.length - done)).toFixed(0)} min left)`)
  }
}
try {
  const queue = [...jobs]
  await Promise.all(Array.from({ length: Math.min(JOBS, queue.length) }, async () => {
    while (queue.length) await render(queue.shift())
  }))
} finally {
  await browser.close()
}

console.log(`${out}: ${jobs.length - failed.length} rendered, ${failed.length} failed`)
for (const f of failed) console.log(`  ${f}`)
if (failed.length) process.exitCode = 1
