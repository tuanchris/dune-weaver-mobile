// Browse's sand preview (components/SandView.tsx): dune-weaver-viewer's Sand page
// (web/index.html) on the phone, without its own controls. gen-sand.mjs puts this
// after the engine and clears.js, in one scope. The app sets window.SAND = {thr,
// table} before the page loads, drives it with sandPlayer.play() / .pause() / .seek(f) /
// .speed(x) and hears back {t: 'state', f, playing, phase} (and 'ready' / 'error')
// through ReactNativeWebView.postMessage. The table's clear pattern and the sand it
// leaves (<table>-from-<rim|centre>.thr / .bin) sit beside this page.

const post = (m) => window.ReactNativeWebView?.postMessage(JSON.stringify(m))
addEventListener('error', (e) => post({ t: 'error', message: e.message }))
addEventListener('unhandledrejection', (e) => post({ t: 'error', message: String(e.reason?.message ?? e.reason) }))

// file:// pages can't fetch; XHR reads them (status 0).
const load = (url, type) =>
  new Promise((ok, no) => {
    const x = new XMLHttpRequest()
    x.open('GET', url)
    x.responseType = type
    x.onload = () => (x.response && (x.status === 0 || x.status === 200) ? ok(x.response) : no(new Error(`${url}: HTTP ${x.status}`)))
    x.onerror = () => no(new Error(`${url} can't be read`))
    x.send()
  })

const PLAY_SECONDS = 30 // the whole drawing at 1×, as the Fast player
const { thr: source, table: model, size } = window.SAND
const sandCanvas = document.getElementById('sand')
const ballCanvas = document.getElementById('ball')
// Contrast (owner's call, 2026-11-16): the engine leaves its sand in grey ~48–173
// of 255, flat on a phone. Levels to 6–248: the still's pixels (the hub's and the
// phone's previews), and the live canvas, so the player matches them.
// brightness(b) contrast(c) is y = c·b·x + (1 − c)/2, the same line.
const LEVELS = { slope: 242 / 125, offset: 6 - 48 * (242 / 125) }
const levelsC = 1 - (2 * LEVELS.offset) / 255
sandCanvas.style.filter = `brightness(${LEVELS.slope / levelsC}) contrast(${levelsC})`
// Shaded at the screen's pixels, not the heightfield's 2048: the render runs per pixel.
// The app passes the view's size, since the page may lay out before it has one.
const px = Math.min(RES, Math.round((size || innerWidth || 360) * devicePixelRatio))
sandCanvas.width = sandCanvas.height = ballCanvas.width = ballCanvas.height = px
// The app's grid (clears.js APP_GRID: ~11 plow cells a ball, rendered at 1024), a
// phone's worth; the viewer's page runs 2048. The baked clears are made for it.
const sim = new SandSim(sandCanvas, APP_GRID.res)
configure(sim, model, BAKED_PROFILE, APP_GRID)

// The table's clear runs first, from the rim in when the drawing starts near the
// centre, else from the centre out; the drawing is shifted whole turns to start
// within half a turn of where the clear ends (the viewer's load()).
const drawing = toSim(parseThr(source).coords)
if (!drawing.length) throw new Error('No theta-rho points in this pattern.')
const stem = `${model}-from-${drawing[0].rho < 0.5 ? 'rim' : 'centre'}`
const clear = toSim(parseThr(await load(`${stem}.thr`, 'text')).coords)
const turns = 2 * Math.PI * Math.round((clear.at(-1).theta - drawing[0].theta) / (2 * Math.PI))
const head = clearPath(sim, clear)
const rest = resamplePath([clear.at(-1), ...drawing.map(({ theta, rho }) => ({ theta: theta + turns, rho }))], { maxSagitta: 0.0015 * (1024 / sim.resolution) }).subarray(2)
const path = new Float32Array(head.length + rest.length)
path.set(head)
path.set(rest, head.length)
const clearSegs = head.length / 2 - 1
const lengths = new Float64Array(path.length / 2)
for (let i = 1; i < lengths.length; i++) lengths[i] = lengths[i - 1] + Math.hypot(path[2 * i] - path[2 * i - 2], path[2 * i + 1] - path[2 * i - 1])
const startL = lengths[clearSegs]
const endL = lengths.at(-1)
sim.loadPath(path, { clearSand: true })

// The sand as the clear left it, baked; when it can't be used the clear is simulated
// once and kept, as the viewer does.
const snapAt = keptAt(clearSegs)
let snap = await load(`${stem}.bin`, 'arraybuffer').then(decode).catch(() => null)
if (snap?.cursor !== snapAt) snap = null
if (snap) restoreSnap(sim, snap)

const segAt = (L) => {
  let lo = 0
  let hi = lengths.length - 1
  while (lo < hi) {
    const m = (lo + hi + 1) >> 1
    if (lengths[m] <= L) lo = m
    else hi = m - 1
  }
  return lo
}

// The ball at path length L in the view's frame (the render shows the table turned 180°).
function ballAt(L) {
  const i = Math.max(0, Math.min(segAt(L), lengths.length - 2))
  const j = Math.min(i + 1, lengths.length - 1)
  const f = lengths[j] > lengths[i] ? Math.min(1, Math.max(0, (L - lengths[i]) / (lengths[j] - lengths[i]))) : 0
  const s = sim.pathScale
  return [-(path[2 * i] + (path[2 * j] - path[2 * i]) * f) * s, -(path[2 * i + 1] + (path[2 * j + 1] - path[2 * i + 1]) * f) * s]
}

// The viewer's steel ball: the room reflected dark in the middle, the LED ring a
// bright band near the rim, a glint and a soft shadow in the sand.
const ballCtx = ballCanvas.getContext('2d')
let ballBox = null
function showBall([bx, by]) {
  if (ballBox) ballCtx.clearRect(...ballBox)
  const r = (sim.ballRadiusWorld * px) / 2
  const x = ((bx + 1) * px) / 2
  const y = ((1 - by) * px) / 2
  const fill = (paint, cx, cy, cr) => {
    ballCtx.fillStyle = paint
    ballCtx.beginPath()
    ballCtx.arc(cx, cy, cr, 0, 2 * Math.PI)
    ballCtx.fill()
  }
  const shadow = ballCtx.createRadialGradient(x, y + r * 0.15, r * 0.6, x, y + r * 0.15, r * 1.35)
  shadow.addColorStop(0, 'rgb(0 0 0 / .45)')
  shadow.addColorStop(1, 'rgb(0 0 0 / 0)')
  fill(shadow, x, y + r * 0.15, r * 1.35)
  const steel = ballCtx.createRadialGradient(x - r * 0.2, y - r * 0.2, 0, x, y, r)
  for (const [at, c] of [[0, '#4a4d52'], [0.45, '#5d6066'], [0.72, '#a9adb3'], [0.86, '#f4f5f6'], [0.93, '#9a958d'], [1, '#2a2826']]) steel.addColorStop(at, c)
  fill(steel, x, y, r)
  const glint = ballCtx.createRadialGradient(x - r * 0.38, y - r * 0.38, 0, x - r * 0.38, y - r * 0.38, r * 0.3)
  glint.addColorStop(0, 'rgb(255 255 255 / .95)')
  glint.addColorStop(1, 'rgb(255 255 255 / 0)')
  fill(glint, x - r * 0.38, y - r * 0.38, r * 0.3)
  ballBox = [x - 2 * r, y - 2 * r, 4 * r, 4 * r]
}

let targetL = startL
let playing = false
let rate = 1
let last = performance.now()
let shownKey = ''
let sent = ''
let sentAt = 0

function seekTo(L) {
  targetL = Math.max(startL, Math.min(endL, L))
  if (segAt(targetL) < sim.cursor) {
    sim.replay()
    if (snap) restoreSnap(sim, snap)
  }
}

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1)
  last = now
  const t0 = performance.now()
  const target = Math.min(segAt(targetL), snap ? Infinity : snapAt)
  let caughtUp = sim.cursor >= target
  // Engine time per frame: smooth while playing, faster to the finished sand otherwise.
  const budget = playing ? 25 : 100
  while (!caughtUp && performance.now() - t0 < budget) caughtUp = sim.advance(Math.min(512, target - sim.cursor)) === 0 || sim.cursor >= target
  // Playback waits for the engine rather than skipping sand it hasn't simulated.
  if (playing && caughtUp) {
    targetL = Math.min(endL, targetL + ((endL - startL) / PLAY_SECONDS) * rate * dt)
    if (targetL >= endL) playing = false
  }
  if (!snap && sim.cursor === snapAt) snap = takeSnap(sim)
  const ballL = Math.min(targetL, lengths[sim.cursor] ?? endL)
  // Shade only when something moved: the render is the heavy part on a phone.
  const key = `${sim.cursor}:${ballL}`
  if (key !== shownKey) {
    shownKey = key
    sim.draw()
    showBall(ballAt(ballL))
  }
  const shown = Math.min(lengths[sim.cursor] ?? endL, endL)
  const f = endL > startL ? Math.max(0, shown - startL) / (endL - startL) : 1
  const phase = sim.cursor < clearSegs ? 'clearing' : caughtUp ? 'ready' : 'simulating'
  const state = `${playing}:${phase}`
  if (state !== sent || now - sentAt > 100) {
    sent = state
    sentAt = now
    post({ t: 'state', f, playing, phase })
  }
  requestAnimationFrame(frame)
}

// A STILL (window.SAND.still = {size, type, quality}): the finished sand, clear
// and pattern simulated to the end at full speed, cut to the disc (transparent
// round it) and scaled to `size` px, as a data URL — the pattern previews
// (scripts/gen-sand-previews.mjs and, on the phone, the preview renderer). No ball,
// no playback. Resolves window.sandStill and posts {t: 'still', data}.
async function renderStill({ size: out = 540, type = 'image/webp', quality = 0.8 }) {
  const target = segAt(endL)
  while (sim.cursor < target) {
    const t0 = performance.now()
    let moved = 1
    while (moved && sim.cursor < target && performance.now() - t0 < 200) moved = sim.advance(Math.min(512, target - sim.cursor))
    if (!moved) break
    // Yield, so the page stays responsive (and a phone's watchdog stays quiet).
    await new Promise((r) => setTimeout(r, 0))
  }
  sim.draw()
  const c = document.createElement('canvas')
  c.width = c.height = out
  const g = c.getContext('2d')
  g.imageSmoothingQuality = 'high'
  g.beginPath()
  g.arc(out / 2, out / 2, out / 2, 0, 2 * Math.PI)
  g.clip()
  g.drawImage(sandCanvas, 0, 0, out, out)
  const img = g.getImageData(0, 0, out, out)
  const d = img.data // clamped: rounds and clips to 0–255
  for (let i = 0; i < d.length; i += 4) for (let k = i; k < i + 3; k++) d[k] = d[k] * LEVELS.slope + LEVELS.offset
  g.putImageData(img, 0, 0)
  return c.toDataURL(type, quality)
}
if (window.SAND.still) {
  window.sandStill = renderStill(window.SAND.still)
  window.sandStill.then((data) => post({ t: 'still', data }), (e) => post({ t: 'error', message: String(e?.message ?? e) }))
}

window.sandPlayer = {
  play() {
    if (targetL >= endL) seekTo(startL)
    playing = true
  },
  pause() {
    playing = false
  },
  seek(f) {
    seekTo(startL + f * (endL - startL))
  },
  speed(x) {
    rate = x
  },
}
post({ t: 'ready' })
if (!window.SAND.still) requestAnimationFrame(frame)
