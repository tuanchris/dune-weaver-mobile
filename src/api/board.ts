// Direct HTTP client for the FluidNC board. Native fetch -> no CORS, no proxy.
// Read routes return JSON; action routes (/sand_*) return plain text "ok"
// (do NOT JSON.parse them); /command?plain=... is fire-and-forget.

import { fetch as binaryFetch } from 'expo/fetch' // WinterCG fetch: typed-array bodies (RN's can't)
import type { RawStatus, RawTime } from './status'
import { demoBoard, isDemoBase } from './demoBoard'

/** GET/POST /updatefw response. "ready"/"busy" = probe (no file); "ok" =
 * flashed, board reboots ~1s later; "failed" = rejected or bad image. */
export interface UpdateFwResponse {
  status: 'ready' | 'busy' | 'ok' | 'failed'
  fw?: string
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

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), ms)
  return { signal: c.signal, cancel: () => clearTimeout(t) }
}

async function getJson<T>(base: string, path: string, timeoutMs = 6000): Promise<T> {
  const { signal, cancel } = withTimeout(timeoutMs)
  try {
    const res = await fetch(`${base}${path}`, { signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return (await res.json()) as T
  } finally {
    cancel()
  }
}

/** Fetch a small text file streamed from the SD card (e.g. a playlist). */
async function getText(base: string, path: string, timeoutMs = 8000): Promise<string> {
  const { signal, cancel } = withTimeout(timeoutMs)
  try {
    const res = await fetch(`${base}${encodePath(path)}`, { signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
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

/** Fire an action/command route. Returns when the request succeeds; ignores body. */
async function hit(base: string, path: string, timeoutMs = 6000): Promise<void> {
  const { signal, cancel } = withTimeout(timeoutMs)
  try {
    const res = await fetch(`${base}${path}`, { signal })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(httpErrorMessage(res.status, text))
    }
  } finally {
    cancel()
  }
}

function command(base: string, plain: string): Promise<void> {
  return hit(base, `/command?plain=${encodeURIComponent(plain)}`)
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
    const res = await fetch(`${base}/updatefw`, { signal })
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
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
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
  setPlaylistMode: (base: string, mode: 'single' | 'loop') => command(base, `$Playlist/Mode=${mode}`),
  setPlaylistShuffle: (base: string, on: boolean) => command(base, `$Playlist/Shuffle=${on ? 'ON' : 'OFF'}`),
  setPlaylistPause: (base: string, seconds: number) => command(base, `$Playlist/PauseTime=${Math.round(seconds)}`),
  /** Measure the pause cadence from each pattern's start instead of its end. */
  setPlaylistPauseFromStart: (base: string, on: boolean) => command(base, `$Playlist/PauseFromStart=${on ? 'ON' : 'OFF'}`),
  /** Default clear sequenced before each pattern in a playlist. */
  setPlaylistClearPattern: (base: string, mode: ClearMode) => command(base, `$Playlist/ClearPattern=${mode}`),
  /** Re-home every n patterns while a playlist runs (0 = never). */
  setPlaylistAutoHome: (base: string, every: number) => command(base, `$Playlist/AutoHome=${Math.max(0, Math.round(every))}`),
  /** Homing mode: 'sensor' (homes both axes via sensors) or 'crash' (drives to a
   * physical stop, then zeroes theta/rho). Idle-gated by the firmware. */
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
