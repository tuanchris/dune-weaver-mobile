// Board status types + translation to the app's view model.
// Mirrors fluidncAdapter.translateStatus from the web app.

export interface RawStatus {
  state: string // Idle | Run | Hold | Home | Jog | Alarm | ...
  theta: number // radians (table's native theta-rho frame, same as .thr)
  rho: number // radial position, may be signed (~ -1..1)
  feed: number // mm/min
  feed_override: number // percent
  running: boolean
  file: string
  progress: number // -1 idle; else 0..100 (older builds may report 0..1)
  playlist: {
    active: boolean
    index: number
    total: number
    name: string
    clearing: boolean
    quiet: boolean
  }
  /** Only present when the table has LEDs configured (`has_led`). */
  led?: {
    effect: string
    brightness: number
  }
}

export interface Status {
  currentFile: string | null
  isRunning: boolean
  isPaused: boolean
  isHoming: boolean
  isClearing: boolean
  percentage: number | null
  speed: number
  feedOverride: number
  theta: number
  rho: number
  playlist: { index: number; total: number; name: string | null } | null
  /** Still Sands quiet hours currently suppressing motion. */
  isQuiet: boolean
  /** LED state, or null if the table has no LEDs configured. */
  led: { effect: string; brightness: number } | null
  state: string
  connected: boolean
}

export function translateStatus(raw: RawStatus): Status {
  const state = raw.state || 'Idle'
  const isPaused = state === 'Hold'
  const isHoming = state === 'Home'

  // progress is a 0..1 fraction (-1 = idle). Clamp defensively in case a
  // firmware build reports 0..100 instead.
  const percentage =
    raw.progress < 0
      ? null
      : raw.progress <= 1
        ? Math.round(raw.progress * 100)
        : Math.round(raw.progress)

  const plActive = raw.playlist?.active ?? false

  return {
    currentFile: raw.file || null,
    isRunning: raw.running === true && !isPaused,
    isPaused,
    isHoming,
    isClearing: raw.playlist?.clearing ?? false,
    percentage,
    speed: raw.feed,
    feedOverride: raw.feed_override,
    theta: raw.theta,
    rho: raw.rho,
    playlist: plActive
      ? { index: raw.playlist.index, total: raw.playlist.total, name: raw.playlist.name || null }
      : null,
    isQuiet: raw.playlist?.quiet ?? false,
    led: raw.led ? { effect: raw.led.effect, brightness: raw.led.brightness } : null,
    state,
    connected: true,
  }
}

/** Is the table doing something we should show the Now Playing bar for? */
export function isActive(s: Status | null): boolean {
  if (!s) return false
  return s.isRunning || s.isPaused || s.isHoming || s.isClearing || !!s.currentFile || !!s.playlist
}

/**
 * Is the table mid-job? The firmware is single-threaded and streams the running
 * pattern straight off the SD card, so touching ANY SD file (read or write)
 * while it's running/paused/clearing/homing can stall or corrupt the job. Used
 * to gate every SD file operation. A paused job still holds the file open, so
 * Hold counts as busy too.
 */
export function isBusy(s: Status | null): boolean {
  if (!s) return false
  return s.isRunning || s.isPaused || s.isClearing || s.isHoming
}
