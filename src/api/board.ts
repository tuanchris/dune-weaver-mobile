// Direct HTTP client for the FluidNC board. Native fetch -> no CORS, no proxy.
// Read routes return JSON; action routes (/sand_*) return plain text "ok"
// (do NOT JSON.parse them); /command?plain=... is fire-and-forget.

import { fetch as binaryFetch } from 'expo/fetch' // WinterCG fetch: typed-array bodies (RN's can't)
import type { RawStatus, RawTime } from './status'
import { demoBoard, isDemoBase } from './demoBoard'
import { log } from '../stores/useAppLog'

/** Diagnostics trail for failed requests. The 1s status poll is excluded —
 * useStatus logs its connect/disconnect TRANSITIONS instead, so an offline
 * table doesn't flood the ring buffer once a second. */
function logHttpFail(path: string, e: unknown): void {
  if (path.startsWith('/sand_status')) return
  log.error('http', `${path.split('?')[0]}: ${(e as Error)?.message ?? String(e)}`)
}

/** GET/POST /updatefw response. "ready"/"busy" = probe (no file); "ok" =
 * flashed, board reboots ~1s later; "failed" = rejected or bad image. */
export interface UpdateFwResponse {
  status: 'ready' | 'busy' | 'ok' | 'failed'
  fw?: string
}

// ---- WiFi (firmware >= v0.1.8) ----
// The captive-portal routes are registered in EVERY mode, so the app can
// reconfigure a table over the LAN (STA) or while joined to its hotspot.

/** "sta" = on home Wi-Fi; "fallback" = setup hotspot after a failed/absent
 * home join; "standalone" = deliberate hotspot mode ($WiFi/Mode=AP). */
export type WifiMode = 'sta' | 'fallback' | 'standalone'

export interface WifiStatus {
  mode: WifiMode
  /** The saved home-network SSID ("" if none configured). */
  sta_ssid: string
  /** The hotspot name the table broadcasts when in AP/fallback mode. */
  ap_ssid: string
  /** This boot's STA join failure reason ("" if none). */
  fail: string
}

export interface WifiNetwork {
  ssid: string
  rssi: number
  secure: boolean
}

export type WifiScanResult = { status: 'scanning' } | { status: 'ok'; aps: WifiNetwork[] }

/** POST /wifi_save + /wifi_standalone reply. "busy" = the write is idle-gated
 * (boot auto-home / a running pattern) — retry shortly. `reboot` = the table
 * restarts ~0.5s after replying. */
export interface WifiWriteResult {
  status: 'ok' | 'busy' | 'error'
  reboot: boolean
  message?: string
}

/** Clear-before-run modes accepted by the firmware's $Sand/Run command. */
export type ClearMode = 'none' | 'adaptive' | 'in' | 'out' | 'sideway' | 'random'
export const CLEAR_MODES: { mode: ClearMode; label: string }[] = [
  { mode: 'none', label: 'No clear' },
  { mode: 'adaptive', label: 'Adaptive' },
  { mode: 'in', label: 'From center' },
  { mode: 'out', label: 'From edge' },
  { mode: 'sideway', label: 'Sideways' },
  { mode: 'random', label: 'Random' },
]

// ---- LED catalog (mirrors the firmware's Leds.cpp enum tables) ----
// `uses` drives the LED UI: show the Color / Color2 / Palette controls only for
// effects that actually read them ("auto-hue" effects take a palette, a couple
// are fixed-color and take nothing).

/** What inputs an effect reads, so the UI can hide irrelevant controls. */
export interface LedInputs {
  color?: boolean
  color2?: boolean
  palette?: boolean
  /** ball effect: rotation direction (cw/ccw) and start alignment (0..359°). */
  direction?: boolean
  align?: boolean
}

export interface LedEffectDef {
  name: string
  label: string
  uses: LedInputs
}

/** All LED effects, in the firmware's order. */
export const LED_EFFECTS: LedEffectDef[] = [
  { name: 'off', label: 'Off', uses: {} },
  { name: 'static', label: 'Static', uses: { color: true } },
  { name: 'rainbow', label: 'Rainbow', uses: { palette: true } },
  { name: 'breathe', label: 'Breathe', uses: { color: true } },
  { name: 'colorloop', label: 'Color loop', uses: { palette: true } },
  { name: 'theater', label: 'Theater', uses: { color: true } },
  { name: 'scan', label: 'Scan', uses: { color: true } },
  { name: 'running', label: 'Running', uses: { color: true } },
  { name: 'sine', label: 'Sine', uses: { color: true } },
  { name: 'gradient', label: 'Gradient', uses: { color: true, color2: true } },
  { name: 'sinelon', label: 'Sinelon', uses: { palette: true } },
  { name: 'twinkle', label: 'Twinkle', uses: { palette: true } },
  { name: 'sparkle', label: 'Sparkle', uses: { color: true } },
  { name: 'fire', label: 'Fire', uses: { palette: true } },
  { name: 'candle', label: 'Candle', uses: { color: true } },
  { name: 'meteor', label: 'Meteor', uses: { color: true } },
  { name: 'bouncing', label: 'Bouncing', uses: { color: true } },
  { name: 'wipe', label: 'Wipe', uses: { color: true, color2: true } },
  { name: 'dualscan', label: 'Dual scan', uses: { color: true, color2: true } },
  { name: 'juggle', label: 'Juggle', uses: { palette: true } },
  { name: 'multicomet', label: 'Multi-comet', uses: { palette: true } },
  { name: 'glitter', label: 'Glitter', uses: { palette: true } },
  { name: 'dissolve', label: 'Dissolve', uses: { color: true, color2: true } },
  { name: 'ripple', label: 'Ripple', uses: { palette: true } },
  { name: 'drip', label: 'Drip', uses: { color: true } },
  { name: 'lightning', label: 'Lightning', uses: {} },
  { name: 'fireworks', label: 'Fireworks', uses: { palette: true } },
  { name: 'plasma', label: 'Plasma', uses: { palette: true } },
  { name: 'heartbeat', label: 'Heartbeat', uses: { color: true } },
  { name: 'strobe', label: 'Strobe', uses: { color: true } },
  { name: 'police', label: 'Police', uses: {} },
  { name: 'chase', label: 'Chase', uses: { color: true, color2: true } },
  { name: 'railway', label: 'Railway', uses: { color: true, color2: true } },
  { name: 'pacifica', label: 'Pacifica', uses: {} },
  { name: 'aurora', label: 'Aurora', uses: {} },
  { name: 'pride', label: 'Pride', uses: {} },
  { name: 'colorwaves', label: 'Color waves', uses: { palette: true } },
  { name: 'bpm', label: 'BPM', uses: { palette: true } },
  { name: 'ball', label: 'Ball', uses: { color: true, direction: true, align: true } },
]

/** Palettes that recolor the auto-hue effects ($LED/Palette=). */
export const LED_PALETTES = ['rainbow', 'ocean', 'lava', 'forest', 'party', 'cloud', 'heat', 'sunset'] as const

/** Look up an effect's input requirements by name (defaults to none). */
export function ledEffectInputs(name: string): LedInputs {
  return LED_EFFECTS.find((e) => e.name === name)?.uses ?? {}
}

/** Normalize a hex color to bare RRGGBB (no leading '#'), as the firmware wants. */
function hexRRGGBB(hex: string): string {
  return hex.replace(/^#/, '').toUpperCase()
}

/** Clamp+round to the firmware's accepted integer range for a setting. */
function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

/** Normalize a user-entered host/URL into "http://host[:port]" (no trailing /). */
export function normalizeBase(input: string): string {
  let s = input.trim()
  if (!s) return ''
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`
  return s.replace(/\/+$/, '')
}

/** Percent-encode each path segment, preserving "/" (handles spaces/parens). */
function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/')
}

// ---- API password ($Sand/Password, firmware ≥ v0.1.11) ----
// When a table is locked, control routes need the key on every request (reads
// stay open). The per-table key lives on the saved board entry; useBoards
// injects the lookup at module load (board.ts can't import useBoards — the
// store already imports normalizeBase from here).
let lookupKey: (base: string) => string | undefined = () => undefined
export function registerKeyLookup(fn: (base: string) => string | undefined): void {
  lookupKey = fn
}
/** X-Sand-Key header for a base; {} when no key is saved. The header is sent
 * on every request (open routes and unlocked tables simply ignore it). */
function keyHeaders(base: string, override?: string): Record<string, string> {
  const k = override ?? lookupKey(base)
  return k ? { 'X-Sand-Key': k } : {}
}

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), ms)
  return { signal: c.signal, cancel: () => clearTimeout(t) }
}

async function getJson<T>(base: string, path: string, timeoutMs = 6000): Promise<T> {
  const { signal, cancel } = withTimeout(timeoutMs)
  try {
    const res = await fetch(`${base}${path}`, { signal, headers: keyHeaders(base) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } catch (e) {
    logHttpFail(path, e)
    throw e
  } finally {
    cancel()
  }
}

/** Fetch a small text file streamed from the SD card (e.g. a playlist). */
async function getText(base: string, path: string, timeoutMs = 8000): Promise<string> {
  const { signal, cancel } = withTimeout(timeoutMs)
  try {
    const res = await fetch(`${base}${encodePath(path)}`, { signal, headers: keyHeaders(base) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } catch (e) {
    logHttpFail(path, e)
    throw e
  } finally {
    cancel()
  }
}

/**
 * Human-readable message from an error response. /upload failures carry a JSON
 * body with `error.message` (and a `status` string) buried in a full directory
 * listing — extract the message instead of dumping the listing into a toast.
 */
function httpErrorMessage(status: number, text: string): string {
  try {
    const body = JSON.parse(text) as { status?: string; error?: { message?: string } }
    const msg = body.error?.message || body.status
    if (msg && msg !== 'Ok') return `HTTP ${status}: ${msg}`
  } catch {
    // not JSON — fall through to the raw text
  }
  return `HTTP ${status}: ${text.slice(0, 200)}`
}

/**
 * Fetch a binary file streamed from the SD card (e.g. a preview shard).
 * Callers should scale the timeout with the expected size — the board's
 * single-threaded server drains large files slowly.
 */
async function getBinary(base: string, path: string, timeoutMs = 30000): Promise<Uint8Array> {
  const { signal, cancel } = withTimeout(timeoutMs)
  try {
    const res = await fetch(`${base}${encodePath(path)}`, { signal, headers: keyHeaders(base) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return new Uint8Array(await res.arrayBuffer())
  } finally {
    cancel()
  }
}

/** Fire an action/command route. Returns when the request succeeds; ignores body. */
async function hit(base: string, path: string, timeoutMs = 6000, headers?: Record<string, string>): Promise<void> {
  const { signal, cancel } = withTimeout(timeoutMs)
  try {
    const res = await fetch(`${base}${path}`, { signal, headers: { ...keyHeaders(base), ...headers } })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(httpErrorMessage(res.status, text))
    }
  } catch (e) {
    logHttpFail(path, e)
    throw e
  } finally {
    cancel()
  }
}

function command(base: string, plain: string): Promise<void> {
  return hit(base, `/command?plain=${encodeURIComponent(plain)}`)
}

/**
 * POST a WiFi write (form-encoded, like the captive portal page). The firmware
 * replies JSON on EVERY status (400 validation, 503 busy, 500 error), so parse
 * the body instead of throwing on !ok. Throws only on network/timeout failures
 * — which for these routes can mean the reboot beat the reply out the door;
 * callers decide how to treat that (the portal treats it as the success path).
 */
async function postWifi(base: string, path: string, form?: Record<string, string>, timeoutMs = 10000): Promise<WifiWriteResult> {
  const { signal, cancel } = withTimeout(timeoutMs)
  try {
    const body = form
      ? Object.entries(form)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
          .join('&')
      : ''
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...keyHeaders(base) },
      body,
      signal,
    })
    const j = (await res.json()) as { status?: string; reboot?: number | string; message?: string }
    return {
      status: j.status === 'ok' ? 'ok' : j.status === 'busy' ? 'busy' : 'error',
      reboot: Number(j.reboot ?? 0) === 1,
      message: j.message,
    }
  } finally {
    cancel()
  }
}

/** UTF-8 byte length of a string (the firmware's `<path>S` size field). */
function utf8Len(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c < 0x80) n += 1
    else if (c < 0x800) n += 2
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++ } // surrogate pair -> 4 bytes
    else n += 3
  }
  return n
}

/**
 * Upload TEXT content to the SD card — both .thr patterns and .txt playlists
 * (both are plain text). Builds the multipart/form-data body by hand and sends
 * it as a string — RN's FormData file part needs an `{uri}` object that throws
 * "unsupported formdata part implementation" on this RN version; inlining the
 * text avoids that entirely. Same shape the firmware expects: the "<sdPath>S"
 * size field precedes the file part, whose filename is the full SD destination
 * path.
 */
async function uploadTextFile(
  base: string,
  sdPath: string,
  content: string,
  timeoutMs?: number,
  onProgress?: (fraction: number) => void
): Promise<void> {
  const size = utf8Len(content)
  // The board drains uploads slowly (single-threaded server, per-chunk delay,
  // SD writes) — scale the abort timeout with size (~25 KB/s floor) so a
  // multi-MB full-res pattern isn't cancelled mid-transfer.
  const timeout = timeoutMs ?? 30000 + Math.round(size / 25)
  const boundary = `----dwform${Date.now().toString(16)}`
  const head =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="${sdPath}S"\r\n\r\n` +
    `${size}\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${sdPath}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`
  const body = `${head}${content}\r\n--${boundary}--\r\n`
  // XHR instead of fetch: RN's fetch cannot report upload progress, XHR's
  // upload.onprogress can — and a multi-MB push takes tens of seconds, so the
  // UI needs it. Behavior otherwise matches the old fetch path.
  const attempt = (): Promise<{ ok: boolean; status: number; text: string }> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `${base}/upload`)
      xhr.timeout = timeout
      xhr.setRequestHeader('Content-Type', `multipart/form-data; boundary=${boundary}`)
      const sandKey = lookupKey(base)
      if (sandKey) xhr.setRequestHeader('X-Sand-Key', sandKey)
      if (onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total))
        }
      }
      xhr.onload = () => resolve({ ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status, text: xhr.responseText ?? '' })
      xhr.onerror = () => reject(new Error('network request failed'))
      xhr.ontimeout = () => reject(new Error('upload timed out'))
      xhr.send(body)
    })
  let r = await attempt()
  if (!r.ok) logHttpFail(`/upload ${sdPath}`, new Error(httpErrorMessage(r.status, r.text)))
  if (!r.ok && r.status !== 401 && r.status !== 507) {
    // Most likely a missing target folder (a fresh or computer-wiped SD card
    // has no /playlists or /patterns, and the firmware's fopen doesn't create
    // parents) — create the folders and retry once.
    await ensureSdDirs(base, sdPath)
    r = await attempt()
  }
  if (!r.ok) throw new Error(httpErrorMessage(r.status, r.text))
}

/**
 * Best-effort mkdir of every folder on sdPath's dirname ("/playlists/x.txt" ->
 * createdir "playlists" at "/"). Failures are ignored — including "already
 * exists", which the firmware reports as an HTTP 500 — because the retried
 * upload is the real test.
 */
async function ensureSdDirs(base: string, sdPath: string): Promise<void> {
  const segs = sdPath.split('/').filter(Boolean).slice(0, -1)
  let parent = '/'
  for (const seg of segs) {
    const q = `path=${encodeURIComponent(parent)}&action=createdir&filename=${encodeURIComponent(seg)}&dontlist=yes`
    await hit(base, `/upload?${q}`).catch(() => undefined)
    parent += `${seg}/`
  }
}

/**
 * Probe /updatefw without a file: is the board willing to take an OTA update
 * right now? The firmware answers 409 while a pattern runs, so parse the JSON
 * on any status rather than throwing on !ok.
 */
async function updateProbe(base: string, timeoutMs = 6000): Promise<UpdateFwResponse> {
  const { signal, cancel } = withTimeout(timeoutMs)
  try {
    const res = await fetch(`${base}/updatefw`, { signal, headers: keyHeaders(base) })
    return (await res.json()) as UpdateFwResponse
  } finally {
    cancel()
  }
}

/**
 * Flash a firmware image over OTA (POST /updatefw). Same multipart shape as
 * /upload — a "firmware.binS" size field, then the file part — but the body is
 * BINARY, so it's built as a Uint8Array and sent via expo/fetch (RN's own
 * fetch only takes string/FormData bodies). On "ok" the board reboots ~1s
 * later; the caller then polls /sand_status until it's back.
 */
async function uploadFirmware(base: string, image: Uint8Array, timeoutMs = 180000): Promise<UpdateFwResponse> {
  const boundary = `----dwfw${Date.now().toString(16)}`
  const enc = new TextEncoder()
  const head = enc.encode(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="firmware.binS"\r\n\r\n` +
      `${image.length}\r\n` +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="firmware.bin"; filename="firmware.bin"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`
  )
  const tail = enc.encode(`\r\n--${boundary}--\r\n`)
  const body = new Uint8Array(head.length + image.length + tail.length)
  body.set(head, 0)
  body.set(image, head.length)
  body.set(tail, head.length + image.length)

  const { signal, cancel } = withTimeout(timeoutMs)
  try {
    const res = await binaryFetch(`${base}/updatefw`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, ...keyHeaders(base) },
      body,
      signal,
    })
    return (await res.json()) as UpdateFwResponse
  } finally {
    cancel()
  }
}

const realBoard = {
  // ---- Reads ----
  status: (base: string, timeoutMs = 4000) => getJson<RawStatus>(base, '/sand_status', timeoutMs),
  patterns: (base: string) => getJson<string[]>(base, '/sand_patterns'),
  playlists: (base: string) => getJson<string[]>(base, '/sand_playlists'),
  settings: (base: string) => getJson<Record<string, string>>(base, '/sand_settings'),

  // ---- Pattern / machine actions ----
  home: (base: string) => hit(base, '/sand_home'),
  stop: (base: string) => hit(base, '/sand_stop'),
  pause: (base: string) => hit(base, '/sand_pause'),
  resume: (base: string) => hit(base, '/sand_resume'),
  /**
   * Run a pattern. `file` is a bare filename like "star.thr". With a clear mode
   * other than "none", uses $Sand/Run (sequences a clear first); otherwise the
   * plain $SD/Run (which works even on configs without a playlist: section).
   */
  runPattern: (base: string, file: string, clear: ClearMode = 'none') => {
    const p = file.startsWith('/') ? file : `/patterns/${file}`
    return clear && clear !== 'none'
      ? command(base, `$Sand/Run=${p} clear=${clear}`)
      : command(base, `$SD/Run=${p}`)
  },
  setFeed: (base: string, mmPerMin: number) => command(base, `$THR/Feed=${Math.round(mmPerMin)}`),
  feedAdjust: (base: string, dir: 'up' | 'down' | 'reset') => hit(base, `/sand_feed?d=${dir}`),
  /**
   * Set the absolute base feed rate (motor mm/min) live — works mid-pattern.
   * Idle persists to $THR/Feed; running is in-memory for the current pattern.
   */
  setFeedLive: (base: string, mmPerMin: number) => hit(base, `/sand_feed?mm=${clampInt(mmPerMin, 10, 500)}`),

  // ---- Manual positioning (between patterns; needs Idle + homed, else HTTP 409) ----
  /** Jog the ball to the center (ρ=0). */
  moveToCenter: (base: string) => hit(base, '/sand_goto?rho=0'),
  /** Jog the ball to the perimeter (ρ=1). */
  moveToPerimeter: (base: string) => hit(base, '/sand_goto?rho=1'),
  /** Rotate the arm to an absolute angle (radians, continuous — same frame as
   * status.theta), parking the ball at the perimeter. Powers the crash-homing
   * align-orientation nudges. 409 while a previous jog is still finishing. */
  rotateTo: (base: string, thetaRad: number) => hit(base, `/sand_goto?theta=${thetaRad.toFixed(4)}&rho=1`),

  // ---- Playlists ----
  runPlaylist: (base: string, name: string) =>
    command(base, `$Playlist/Run=${name.replace(/\.txt$/i, '')}`),
  skip: (base: string) => command(base, '$Playlist/Skip'),
  stopPlaylist: (base: string) => command(base, '$Playlist/Stop'),
  /**
   * Raw text of a playlist file. Files are read from the SD card, which the
   * firmware now requires the explicit "/sd/" mount prefix for — a bare
   * "/playlists/..." resolves to the on-board flash filesystem instead.
   */
  playlistText: (base: string, filename: string) => getText(base, `/sd/playlists/${filename}`),
  /**
   * Raw text of the on-card pattern catalog (/patterns/index.json). Throws
   * "HTTP 404" when the card has none (firmware then live-lists /patterns).
   */
  patternManifest: (base: string) => getText(base, '/sd/patterns/index.json'),
  // ---- Diagnostics (all plain text / JSON, small) ----
  /** Rolling session log (last ~8 KB of runtime log lines; RAM-only). */
  sandLog: (base: string) => getText(base, '/sand_log'),
  /** Boot log; after a panic it still holds the PREVIOUS boot's log. */
  sandBootlog: (base: string) => getText(base, '/sand_bootlog'),
  /** Crash report from the coredump partition ({present:false} when clean). */
  sandCoredump: (base: string) => getJson<Record<string, unknown>>(base, '/sand_coredump'),

  /** The preview-bundle sidecar written by the SD Card Pattern Manager. */
  previewSidecar: (base: string) => getJson<unknown>(base, '/sd/patterns/previews/previews.json'),
  /** One preview-bundle shard (a STORE-mode zip of preview webps). */
  previewShard: (base: string, name: string, timeoutMs?: number) =>
    getBinary(base, `/sd/patterns/previews/${name}`, timeoutMs),
  setPlaylistMode: (base: string, mode: 'single' | 'loop') => command(base, `$Playlist/Mode=${mode}`),
  setPlaylistShuffle: (base: string, on: boolean) => command(base, `$Playlist/Shuffle=${on ? 'ON' : 'OFF'}`),
  setPlaylistPause: (base: string, seconds: number) => command(base, `$Playlist/PauseTime=${Math.round(seconds)}`),
  /** Measure the pause cadence from each pattern's start instead of its end. */
  setPlaylistPauseFromStart: (base: string, on: boolean) => command(base, `$Playlist/PauseFromStart=${on ? 'ON' : 'OFF'}`),
  /** Default clear sequenced before each pattern in a playlist. */
  setPlaylistClearPattern: (base: string, mode: ClearMode) => command(base, `$Playlist/ClearPattern=${mode}`),
  // ---- Custom clear patterns + speed ($Playlist/ClearIn|ClearOut|ClearSpeed, firmware ≥ v0.1.11) ----
  // Point the "from center" / "from edge" clears at any pattern file (full SD
  // path, e.g. "/patterns/spiral.thr"); "" restores the firmware's built-in
  // clear. Non-destructive — unlike the old web app, which overwrote the stock
  // clear files.
  setPlaylistClearIn: (base: string, sdPath: string) => command(base, `$Playlist/ClearIn=${sdPath}`),
  setPlaylistClearOut: (base: string, sdPath: string) => command(base, `$Playlist/ClearOut=${sdPath}`),
  /** Feed (motor mm/min) for clear moves; 0 = same as the pattern feed ($THR/Feed). */
  setPlaylistClearSpeed: (base: string, mmPerMin: number) => command(base, `$Playlist/ClearSpeed=${Math.max(0, Math.round(mmPerMin))}`),
  /** Re-home every n patterns while a playlist runs (0 = never). */
  setPlaylistAutoHome: (base: string, every: number) => command(base, `$Playlist/AutoHome=${Math.max(0, Math.round(every))}`),
  /** Homing mode: 'sensor' (homes both axes via sensors) or 'crash' (drives to a
   * physical stop, then zeroes theta/rho). Idle-gated by the firmware. */
  // ---- API password ($Sand/Password, firmware ≥ v0.1.11) ----
  /** Set (1–32 chars) or clear ('') the table's API password. Idle-gated; on a
   * locked table the request must carry the CURRENT key (attached from the
   * saved board entry automatically). */
  setSandPassword: (base: string, pw: string) => command(base, `$Sand/Password=${pw}`),
  /** Probe whether `key` unlocks a locked table — throws "HTTP 401" when it
   * doesn't. ($G is a harmless modal-state query; on an OPEN table any key
   * "works", which is fine — the caller saves it and it's simply unused.) */
  testKey: (base: string, key: string) => hit(base, `/command?plain=${encodeURIComponent('$G')}`, 6000, { 'X-Sand-Key': key }),

  setHomingMode: (base: string, mode: 'sensor' | 'crash') => command(base, `$Sand/HomingMode=${mode}`),
  /** Sensor-homing angular offset in degrees, so the radial arm points East.
   * Idle-gated by the firmware. */
  setThetaOffset: (base: string, deg: number) => command(base, `$Sand/ThetaOffset=${Math.round(deg)}`),
  /** Playlist to auto-run on boot once the table reaches Idle ("" = off).
   * `name` is the bare playlist name. */
  setPlaylistAutostart: (base: string, name: string) => command(base, `$Playlist/Autostart=${name}`),
  // Boot-run options — separate from the manual-run $Playlist/* settings (applied
  // only to the on-boot auto-play, so the two never bleed into each other).
  setPlaylistAutostartMode: (base: string, mode: 'single' | 'loop') => command(base, `$Playlist/AutostartMode=${mode}`),
  setPlaylistAutostartShuffle: (base: string, on: boolean) => command(base, `$Playlist/AutostartShuffle=${on ? 'ON' : 'OFF'}`),
  setPlaylistAutostartPause: (base: string, seconds: number) => command(base, `$Playlist/AutostartPause=${Math.max(0, Math.round(seconds))}`),
  setPlaylistAutostartPauseFromStart: (base: string, on: boolean) => command(base, `$Playlist/AutostartPauseFromStart=${on ? 'ON' : 'OFF'}`),
  setPlaylistAutostartClear: (base: string, mode: ClearMode) => command(base, `$Playlist/AutostartClear=${mode}`),

  // ---- LEDs (only effective if the table has `leds:` configured) ----
  // Use the LIVE setter ($Sand/Led=) rather than the persisted $LED/* settings:
  // when idle it persists to NVS just the same, but while a pattern is RUNNING it
  // applies as an in-memory override that beats the Run/Idle state hook (which
  // would otherwise mask $LED/Effect) and is committed to NVS on return to idle.
  // This is what lets the user actually turn the ring on/off / recolor mid-pattern.
  setLedEffect: (base: string, effect: string) => command(base, `$Sand/Led=effect=${effect}`),
  setLedPalette: (base: string, palette: string) => command(base, `$Sand/Led=palette=${palette}`),
  setLedColor: (base: string, hex: string) => command(base, `$Sand/Led=color=${hexRRGGBB(hex)}`),
  setLedColor2: (base: string, hex: string) => command(base, `$Sand/Led=color2=${hexRRGGBB(hex)}`),
  setLedBrightness: (base: string, value: number) => command(base, `$Sand/Led=brightness=${clampInt(value, 0, 255)}`),
  setLedSpeed: (base: string, value: number) => command(base, `$Sand/Led=speed=${clampInt(value, 1, 255)}`),
  /** Ball effect: rotation direction. */
  setLedDirection: (base: string, dir: 'cw' | 'ccw') => command(base, `$Sand/Led=direction=${dir}`),
  /** Ball effect: start alignment in degrees (0..359). */
  setLedAlign: (base: string, deg: number) => command(base, `$Sand/Led=align=${clampInt(deg, 0, 359)}`),
  /** Ball effect: glow size in LEDs (1..200). */
  setLedBallSize: (base: string, leds: number) => command(base, `$Sand/Led=size=${clampInt(leds, 1, 200)}`),
  /** Ball effect: tracking-blob brightness (0..255), independent of master + bg. */
  setLedBallBright: (base: string, value: number) => command(base, `$Sand/Led=fgbright=${clampInt(value, 0, 255)}`),
  /** Ball effect: background brightness (0..255), independent of master + blob. */
  setLedBallBgBright: (base: string, value: number) => command(base, `$Sand/Led=bgbright=${clampInt(value, 0, 255)}`),
  /** Ball effect: background mode — "static" (solid Color2), "off", or any effect name. */
  setLedBallBg: (base: string, bg: string) => command(base, `$Sand/Led=bg=${bg}`),
  /** Effect to force while the table is moving (Run/Jog/Home); "none" = don't override. */
  setLedRunEffect: (base: string, effect: string) => command(base, `$LED/RunEffect=${effect}`),
  /** Effect to force while the table is Idle/Hold; "none" = don't override. */
  setLedIdleEffect: (base: string, effect: string) => command(base, `$LED/IdleEffect=${effect}`),

  // ---- Quiet hours ("Still Sands"; needs a set clock on the table) ----
  setQuietEnabled: (base: string, on: boolean) => command(base, `$Sands/Enabled=${on ? 'ON' : 'OFF'}`),
  /** Slots string, e.g. "21:00-08:00@daily" or comma-separated "HH:MM-HH:MM@days". */
  setQuietSlots: (base: string, slots: string) => command(base, `$Sands/Slots=${slots}`),
  /** Turn LEDs off during quiet hours. */
  setQuietLedOff: (base: string, on: boolean) => command(base, `$Sands/LedOff=${on ? 'ON' : 'OFF'}`),
  /** ON: finish the current pattern before pausing; OFF: feed-hold mid-pattern. */
  setQuietFinishPattern: (base: string, on: boolean) => command(base, `$Sands/FinishPattern=${on ? 'ON' : 'OFF'}`),

  // ---- Clock / timezone (the wall clock the quiet-hours schedule runs against) ----
  /** Read the table's clock: {epoch, synced, local, tz}. */
  time: (base: string) => getJson<RawTime>(base, '/sand_time'),
  /** Push a unix epoch and/or POSIX TZ to the table (app clock sync). */
  syncTime: (base: string, opts: { epoch?: number; tz?: string }) => {
    const p: string[] = []
    if (opts.epoch != null) p.push(`epoch=${Math.round(opts.epoch)}`)
    if (opts.tz) p.push(`tz=${encodeURIComponent(opts.tz)}`)
    return hit(base, `/sand_time?${p.join('&')}`)
  },

  // ---- WiFi (firmware >= v0.1.8; older builds 404 these routes) ----
  wifiStatus: (base: string) => getJson<WifiStatus>(base, '/wifi_status'),
  /** Async network scan. Answers {status:"scanning"} until done — poll ~1.5s.
   * The firmware's JSONencoder emits numbers as strings; coerce here. */
  wifiScan: async (base: string, rescan = false): Promise<WifiScanResult> => {
    const raw = await getJson<{ status: string; aps?: { ssid: string; rssi: number | string; secure: number | string }[] }>(
      base,
      `/wifi_scan${rescan ? '?rescan=1' : ''}`
    )
    if (raw.status !== 'ok') return { status: 'scanning' }
    return {
      status: 'ok',
      aps: (raw.aps ?? []).map((a) => ({ ssid: a.ssid, rssi: Number(a.rssi), secure: Number(a.secure) === 1 })),
    }
  },
  /** Save home-network credentials. On "ok" the table reboots into STA>AP:
   * it either joins the network or the fallback hotspot returns with `fail`. */
  wifiSave: (base: string, ssid: string, password: string) => postWifi(base, '/wifi_save', { ssid, password }),
  /** Switch to standalone hotspot mode ($WiFi/Mode=AP). Applies live from the
   * hotspot (reboot:false); from home Wi-Fi the table reboots (reboot:true). */
  wifiStandalone: (base: string) => postWifi(base, '/wifi_standalone'),

  // ---- System ----
  /** Clear an Alarm without homing ($X). */
  unlock: (base: string) => command(base, '$X'),
  /** Reboot the controller ($Bye); it needs ~25-30s to rejoin Wi-Fi. */
  reboot: (base: string) => command(base, '$Bye'),
  /** Ask whether an OTA firmware update can start ("ready" vs "busy"). */
  updateProbe,
  /** Flash a firmware image over OTA; the board reboots itself on success. */
  uploadFirmware,

  // ---- SD file ops (upload / delete) ----
  uploadTextFile,
  /** Delete a file on the SD card, e.g. dir "/playlists/", filename "Old.txt". */
  deleteSdFile: (base: string, dir: string, filename: string) =>
    hit(base, `/upload?path=${encodeURIComponent(dir)}&action=delete&filename=${encodeURIComponent(filename)}`),
}

/**
 * The board client used everywhere. Dispatches per-call by the FIRST argument
 * (the board base): a `DEMO_BASE` routes to the in-memory `demoBoard` simulator,
 * any real URL hits the firmware over HTTP. This keeps the demo table invisible
 * to every screen/store — they all just call `board.x(base, …)` as before.
 */
export const board: typeof realBoard = new Proxy(realBoard, {
  get(target, prop, receiver) {
    const realValue = Reflect.get(target, prop, receiver)
    if (typeof realValue !== 'function') return realValue
    const demoFn = (demoBoard as Record<string, unknown>)[prop as string]
    return (...args: unknown[]) => {
      if (isDemoBase(args[0] as string)) {
        return typeof demoFn === 'function'
          ? (demoFn as (...a: unknown[]) => unknown)(...args)
          : Promise.resolve() // action with no demo impl -> silent success
      }
      return (realValue as (...a: unknown[]) => unknown).apply(target, args)
    }
  },
})

/** Quick reachability test used when adding a board. */
export async function testBoard(base: string): Promise<boolean> {
  try {
    const s = await board.status(base, 4000)
    return typeof s?.state === 'string'
  } catch {
    return false
  }
}
