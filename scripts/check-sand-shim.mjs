// Checks src/lib/floatLinearShim.mjs: renders one bundled pattern's sand still (the page
// the phone runs, assets/sand) in headless Chrome three ways and compares them:
//   normal         the GPU filters the R32F heightfield itself
//   hidden         OES_texture_float_linear hidden, as on the phones that lack it:
//                  must come out FLAT (the bug: no clear, no grooves)
//   hidden + shim  must match normal
// Needs Chrome and playwright-core (here, else ../dune-weaver-viewer). Run: npm run check-sand-shim
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { FLOAT_LINEAR_SHIM } from '../src/lib/floatLinearShim.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
let chromium
for (const dir of [root, path.join(root, '../dune-weaver-viewer')]) {
  try {
    ;({ chromium } = createRequire(path.join(dir, 'package.json'))('playwright-core'))
    break
  } catch {}
}
if (!chromium) throw new Error('playwright-core not found (here or in ../dune-weaver-viewer)')

const sandDir = path.join(root, 'assets/sand')
const index = fs.readFileSync(path.join(sandDir, 'index.js'), 'utf8')
const PAGE = JSON.parse(index.match(/^export const PAGE = (".*")$/m)?.[1] ?? 'null')
if (!PAGE) throw new Error('assets/sand/index.js has no PAGE: run npm run gen-sand')
const thr = fs.readFileSync(path.join(root, 'assets/thr/1-1-ibex.thr'), 'utf8')
const SIZE = 768

// What a GPU without the extension does: getExtension answers null and never enables it.
const HIDE = `(() => {
  const P = WebGL2RenderingContext.prototype
  const get = P.getExtension
  P.getExtension = function (name) { return name === 'OES_texture_float_linear' ? null : get.call(this, name) }
})();`

const browser = await chromium.launch({ channel: 'chrome', args: ['--use-gl=angle', '--ignore-gpu-blocklist'] })
async function still(scripts) {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 })
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
    for (const s of scripts) await page.addInitScript({ content: s })
    await page.addInitScript((sand) => (window.SAND = sand), { thr, table: 'DWP', size: SIZE, still: { size: 512, type: 'image/png' } })
    await page.goto('http://sand.local/index.html')
    await page.waitForFunction(() => window.sandStill || null, null, { timeout: 120_000 }).catch(() => {
      throw pageError ?? new Error('the page never started')
    })
    const url = await page.evaluate(() => window.sandStill)
    // Grey levels inside the disc.
    return await page.evaluate(async (src) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const g = c.getContext('2d')
      g.drawImage(img, 0, 0)
      const d = g.getImageData(0, 0, c.width, c.height).data
      const grey = []
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] === 255) grey.push((d[i] + d[i + 1] + d[i + 2]) / 3)
      return grey
    }, url)
  } finally {
    await page.close()
  }
}
const sd = (a) => {
  const m = a.reduce((s, v) => s + v, 0) / a.length
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / a.length)
}
const meanDiff = (a, b) => a.reduce((s, v, i) => s + Math.abs(v - b[i]), 0) / a.length

try {
  const normal = await still([])
  const hidden = await still([HIDE])
  const fixed = await still([HIDE, FLOAT_LINEAR_SHIM])
  const r = { normalSd: sd(normal), hiddenSd: sd(hidden), fixedSd: sd(fixed), fixedVsNormal: meanDiff(fixed, normal), hiddenVsNormal: meanDiff(hidden, normal) }
  console.log(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +v.toFixed(2)])))
  const fails = []
  if (!(r.hiddenSd < r.normalSd / 4)) fails.push('hidden is not flat: the check no longer reproduces the bug')
  if (!(r.fixedVsNormal < 2)) fails.push(`shim differs from normal by ${r.fixedVsNormal.toFixed(2)} grey levels on average`)
  if (fails.length) {
    for (const f of fails) console.log(`FAIL ${f}`)
    process.exitCode = 1
  } else console.log('ok: flat without the extension, normal with the shim')
} finally {
  await browser.close()
}
