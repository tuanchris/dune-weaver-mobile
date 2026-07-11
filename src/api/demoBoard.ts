// In-app DEMO TABLE — lets the app be explored with NO physical hardware
// (App Review, or users who don't own a table yet). It mirrors the `board`
// HTTP client's surface but is a pure in-memory simulator: a virtual table that
// "runs" patterns with advancing progress + a moving ball, accepts every action,
// and reports believable status / settings. Routing is by sentinel base URL
// (`DEMO_BASE`) — see the Proxy in `board.ts`, so no screen/store code changes.

import { PREVIEW } from '../../assets/pattern-manifest'
import type { RawStatus, RawTime } from './status'
import type { ClearMode, WifiMode, WifiScanResult, WifiStatus, WifiWriteResult } from './board'

/** Sentinel base for the demo table. Real bases are http(s) URLs, so this never
 *  collides; `isDemoBase` gates the dispatch. */
export const DEMO_BASE = 'demo://table'

export function isDemoBase(base: string | null | undefined): boolean {
  return base === DEMO_BASE
}

// Bundled pattern filenames (keys like "0-0-rotating-hearts.thr") — they have
// bundled previews, so the on-table list + playlists render real thumbnails.
const ALL_NAMES = Object.keys(PREVIEW)
const ON_TABLE = ALL_NAMES.slice(0, 30)

const PLAYLISTS: Record<string, string[]> = {
  'Demo Favorites.txt': ALL_NAMES.slice(0, 10),
  'Spirals & Stars.txt': ALL_NAMES.slice(10, 22),
}

/** A demo "pattern" takes this long to trace before looping / advancing. */
const RUN_MS = 80_000

type Machine = 'Idle' | 'Run' | 'Hold' | 'Home'

interface DemoState {
  machine: Machine
  file: string
  startMs: number // virtual run start (real ms; shifted to absorb pauses)
  pausedMs: number // real ms at which we entered Hold (to offset on resume)
  homeUntilMs: number // real ms until a simulated homing finishes
  feed: number
  playlist: { active: boolean; name: string; index: number; files: string[] }
  settings: Record<string, string>
}

function defaultSettings(): Record<string, string> {
  return {
    'LED/Effect': 'rainbow',
    'LED/Palette': 'party',
    'LED/Color': 'FFB060',
    'LED/Color2': '0040FF',
    'LED/Brightness': '160',
    'LED/Speed': '120',
    'LED/Direction': 'cw',
    'LED/Align': '0',
    'LED/BallSize': '3',
    'LED/BallBright': '255',
    'LED/BallBgBright': '40',
    'LED/BallBg': 'static',
    'LED/RunEffect': 'none',
    'LED/IdleEffect': 'none',
    'Sand/HomingMode': 'sensor',
    'Sand/ThetaOffset': '0',
    'Playlist/Mode': 'loop',
    'Playlist/Shuffle': 'OFF',
    'Playlist/PauseTime': '0',
    'Playlist/ClearPattern': 'none',
    'Playlist/AutoHome': '0',
    'Playlist/Autostart': '',
    'Playlist/AutostartMode': 'loop',
    'Playlist/AutostartShuffle': 'OFF',
    'Playlist/AutostartPause': '0',
    'Playlist/AutostartPauseFromStart': 'OFF',
    'Playlist/AutostartClear': 'none',
    'Sands/Enabled': 'OFF',
    'Sands/Slots': '',
  }
}

const S: DemoState = {
  machine: 'Idle',
  file: '',
  startMs: 0,
  pausedMs: 0,
  homeUntilMs: 0,
  feed: 200,
  playlist: { active: false, name: '', index: 0, files: [] },
  settings: defaultSettings(),
}

const wait = (ms = 120) => new Promise<void>((r) => setTimeout(r, ms))

/** Advance the virtual machine to "now": finish homing, loop a pattern, or step
 *  a playlist. Called at the top of status() so the sim moves on its own. */
function tick() {
  const now = Date.now()
  if (S.machine === 'Home') {
    if (now >= S.homeUntilMs) S.machine = 'Idle'
    return
  }
  if (S.machine !== 'Run') return
  if (now - S.startMs < RUN_MS) return
  // current pattern finished
  if (S.playlist.active && S.playlist.files.length) {
    S.playlist.index = (S.playlist.index + 1) % S.playlist.files.length
    S.file = S.playlist.files[S.playlist.index]
  }
  S.startMs = now // loop the single pattern, or start the next playlist item
}

function fraction(): number {
  if (S.machine !== 'Run' && S.machine !== 'Hold') return -1
  const ref = S.machine === 'Hold' ? S.pausedMs : Date.now()
  return Math.min(1, Math.max(0, (ref - S.startMs) / RUN_MS))
}

// Synthetic ball position: an in-and-out spiral so the Now Playing trace + live
// dot move convincingly. Not tied to the real .thr path (the drawn-progress arc
// already follows it), just believable motion.
function ballPos(p: number): { theta: number; rho: number } {
  if (p < 0) return { theta: 0, rho: 0 }
  return { theta: p * 16 * Math.PI, rho: Math.abs(Math.cos(p * Math.PI * 3)) * 0.9 }
}

function startRun(file: string) {
  S.machine = 'Run'
  S.file = file.replace(/^\/?(patterns\/)?/i, '')
  S.startMs = Date.now()
}

function nowTime(): RawTime {
  return { epoch: Math.floor(Date.now() / 1000), synced: true, local: 'Demo', tz: 'UTC' }
}

function buildStatus(): RawStatus {
  tick()
  const p = fraction()
  const { theta, rho } = ballPos(p)
  const active = S.machine === 'Run' || S.machine === 'Hold'
  return {
    state: S.machine,
    theta,
    rho,
    feed: S.feed,
    feed_override: 100,
    running: S.machine === 'Run',
    file: active ? S.file : '',
    progress: p < 0 ? -1 : Math.round(p * 100),
    playlist: {
      active: S.playlist.active,
      index: S.playlist.index,
      total: S.playlist.files.length,
      name: S.playlist.name,
      clearing: false,
      quiet: false,
      pause_remaining: -1,
      pause_total: -1,
    },
    led: { effect: S.settings['LED/Effect'], brightness: Number(S.settings['LED/Brightness']) || 0 },
    time: nowTime(),
    fw: DEMO_FW,
  }
}

// The demo table always claims the newest published firmware so demo mode
// (App Review!) never shows an update nag it can't act on.
const DEMO_FW = 'v99.0.0'

// Virtual WiFi state — writes flip it instantly (reboot:false), so the demo
// flow never enters the reboot-wait.
const DEMO_WIFI: { mode: WifiMode; ssid: string } = { mode: 'sta', ssid: 'Dune Cottage' }
const DEMO_APS = [
  { ssid: 'Dune Cottage', rssi: -46, secure: true },
  { ssid: 'Dune Cottage Guest', rssi: -52, secure: true },
  { ssid: 'Seaside 5G', rssi: -63, secure: true },
  { ssid: 'Corner Cafe', rssi: -74, secure: false },
]

const setKey = (k: string, v: string) => { S.settings[k] = v }
const ok = async () => { await wait(80) }

// Mirrors the `board` object's method names/signatures. The leading `base` arg
// is accepted (for a uniform Proxy dispatch) and ignored.
export const demoBoard = {
  // ---- Reads ----
  status: async (_base: string, _t?: number): Promise<RawStatus> => { await wait(60); return buildStatus() },
  patterns: async (): Promise<string[]> => { await wait(80); return ON_TABLE },
  playlists: async (): Promise<string[]> => { await wait(80); return Object.keys(PLAYLISTS) },
  settings: async (): Promise<Record<string, string>> => { await wait(80); return { ...S.settings } },
  time: async (): Promise<RawTime> => { await wait(40); return nowTime() },
  updateProbe: async (): Promise<{ status: 'ready'; fw: string }> => { await wait(40); return { status: 'ready', fw: DEMO_FW } },
  playlistText: async (_base: string, filename: string): Promise<string> => {
    await wait(80)
    return (PLAYLISTS[filename] ?? PLAYLISTS[`${filename}.txt`] ?? []).join('\n')
  },

  // ---- Machine actions ----
  home: async () => { S.machine = 'Home'; S.homeUntilMs = Date.now() + 4000; S.file = ''; S.playlist.active = false },
  stop: async () => { S.machine = 'Idle'; S.file = ''; S.playlist.active = false },
  pause: async () => { if (S.machine === 'Run') { S.pausedMs = Date.now(); S.machine = 'Hold' } },
  resume: async () => { if (S.machine === 'Hold') { S.startMs += Date.now() - S.pausedMs; S.machine = 'Run' } },
  runPattern: async (_base: string, file: string, _clear?: ClearMode) => { S.playlist.active = false; startRun(file) },
  setFeed: async (_base: string, mmPerMin: number) => { S.feed = Math.round(mmPerMin) },
  feedAdjust: async (_base: string, dir: 'up' | 'down' | 'reset') => {
    S.feed = dir === 'reset' ? 200 : Math.max(10, Math.min(500, S.feed + (dir === 'up' ? 20 : -20)))
  },
  setFeedLive: async (_base: string, mmPerMin: number) => { S.feed = Math.max(10, Math.min(500, Math.round(mmPerMin))) },
  moveToCenter: ok,
  moveToPerimeter: ok,

  // ---- Playlists ----
  runPlaylist: async (_base: string, name: string) => {
    const key = name.endsWith('.txt') ? name : `${name}.txt`
    const files = PLAYLISTS[key] ?? []
    S.playlist = { active: true, name: name.replace(/\.txt$/i, ''), index: 0, files }
    startRun(files[0] ?? '')
  },
  skip: async () => {
    if (S.playlist.active && S.playlist.files.length) {
      S.playlist.index = (S.playlist.index + 1) % S.playlist.files.length
      startRun(S.playlist.files[S.playlist.index])
    }
  },
  stopPlaylist: async () => { S.playlist.active = false; S.machine = 'Idle'; S.file = '' },
  setPlaylistMode: async (_b: string, mode: string) => setKey('Playlist/Mode', mode),
  setPlaylistShuffle: async (_b: string, on: boolean) => setKey('Playlist/Shuffle', on ? 'ON' : 'OFF'),
  setPlaylistPause: async (_b: string, s: number) => setKey('Playlist/PauseTime', String(Math.round(s))),
  setPlaylistPauseFromStart: ok,
  setPlaylistClearPattern: async (_b: string, m: ClearMode) => setKey('Playlist/ClearPattern', m),
  setPlaylistAutoHome: async (_b: string, n: number) => setKey('Playlist/AutoHome', String(Math.max(0, Math.round(n)))),
  setHomingMode: async (_b: string, m: 'sensor' | 'crash') => setKey('Sand/HomingMode', m),
  setThetaOffset: async (_b: string, deg: number) => setKey('Sand/ThetaOffset', String(Math.round(deg))),
  setPlaylistAutostart: async (_b: string, name: string) => setKey('Playlist/Autostart', name),
  setPlaylistAutostartMode: async (_b: string, m: string) => setKey('Playlist/AutostartMode', m),
  setPlaylistAutostartShuffle: async (_b: string, on: boolean) => setKey('Playlist/AutostartShuffle', on ? 'ON' : 'OFF'),
  setPlaylistAutostartPause: async (_b: string, s: number) => setKey('Playlist/AutostartPause', String(Math.max(0, Math.round(s)))),
  setPlaylistAutostartPauseFromStart: async (_b: string, on: boolean) => setKey('Playlist/AutostartPauseFromStart', on ? 'ON' : 'OFF'),
  setPlaylistAutostartClear: async (_b: string, m: ClearMode) => setKey('Playlist/AutostartClear', m),

  // ---- LEDs ----
  setLedEffect: async (_b: string, e: string) => setKey('LED/Effect', e),
  setLedPalette: async (_b: string, p: string) => setKey('LED/Palette', p),
  setLedColor: async (_b: string, hex: string) => setKey('LED/Color', hex.replace(/^#/, '').toUpperCase()),
  setLedColor2: async (_b: string, hex: string) => setKey('LED/Color2', hex.replace(/^#/, '').toUpperCase()),
  setLedBrightness: async (_b: string, v: number) => setKey('LED/Brightness', String(Math.round(v))),
  setLedSpeed: async (_b: string, v: number) => setKey('LED/Speed', String(Math.round(v))),
  setLedDirection: async (_b: string, d: 'cw' | 'ccw') => setKey('LED/Direction', d),
  setLedAlign: async (_b: string, deg: number) => setKey('LED/Align', String(Math.round(deg))),
  setLedBallSize: async (_b: string, n: number) => setKey('LED/BallSize', String(Math.round(n))),
  setLedBallBright: async (_b: string, v: number) => setKey('LED/BallBright', String(Math.round(v))),
  setLedBallBgBright: async (_b: string, v: number) => setKey('LED/BallBgBright', String(Math.round(v))),
  setLedBallBg: async (_b: string, bg: string) => setKey('LED/BallBg', bg),
  setLedRunEffect: async (_b: string, e: string) => setKey('LED/RunEffect', e),
  setLedIdleEffect: async (_b: string, e: string) => setKey('LED/IdleEffect', e),

  // ---- Quiet hours ----
  setQuietEnabled: async (_b: string, on: boolean) => setKey('Sands/Enabled', on ? 'ON' : 'OFF'),
  setQuietSlots: async (_b: string, slots: string) => setKey('Sands/Slots', slots),
  setQuietLedOff: ok,
  setQuietFinishPattern: ok,

  // ---- WiFi ----
  wifiStatus: async (): Promise<WifiStatus> => {
    await wait(60)
    return { mode: DEMO_WIFI.mode, sta_ssid: DEMO_WIFI.ssid, ap_ssid: 'DuneWeaver', fail: '' }
  },
  wifiScan: async (): Promise<WifiScanResult> => {
    await wait(900)
    return { status: 'ok', aps: DEMO_APS }
  },
  wifiSave: async (_b: string, ssid: string): Promise<WifiWriteResult> => {
    await wait(400)
    DEMO_WIFI.mode = 'sta'
    DEMO_WIFI.ssid = ssid
    return { status: 'ok', reboot: false }
  },
  wifiStandalone: async (): Promise<WifiWriteResult> => {
    await wait(400)
    DEMO_WIFI.mode = 'standalone'
    return { status: 'ok', reboot: false }
  },

  // ---- Clock / system / SD (no-ops that resolve) ----
  syncTime: ok,
  unlock: async () => { if (S.machine !== 'Run') S.machine = 'Idle' },
  reboot: ok,
  uploadTextFile: ok,
  deleteSdFile: ok,
}
