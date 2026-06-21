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
    /** Seconds left in the between-patterns pause, counting down live; -1 when
     * not in that pause. Absent on older firmware. */
    pause_remaining?: number
    /** Full length of the current between-patterns pause in seconds (fixed for
     * its duration; already accounts for PauseFromStart); -1 when not pausing. */
    pause_total?: number
  }
  /** Only present when the table has LEDs configured (`has_led`). */
  led?: {
    effect: string
    brightness: number
  }
  /** Wall clock — same shape as /sand_time. `synced:false` means the clock isn't
   * set, so quiet hours won't fire (the app should push the device time). */
  time?: RawTime
}

/** The table's wall clock (from /sand_time or status.time). */
export interface RawTime {
  epoch: number // unix seconds
  synced: boolean // true once the clock has been set (NTP or app push)
  local: string // formatted local time on the table
  tz: string // effective POSIX TZ
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
  /** Seconds left in the between-patterns pause, or null when not pausing. */
  pauseRemaining: number | null
  /** Full length of the current between-patterns pause in seconds, or null. */
  pauseTotal: number | null
  /** Still Sands quiet hours currently suppressing motion. */
  isQuiet: boolean
  /** LED state, or null if the table has no LEDs configured. */
  led: { effect: string; brightness: number } | null
  /** Table wall clock, or null on firmware that doesn't report it. */
  clock: RawTime | null
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
  const rawPause = raw.playlist?.pause_remaining ?? -1
  const pauseRemaining = rawPause >= 0 ? rawPause : null
  const rawPauseTotal = raw.playlist?.pause_total ?? -1
  const pauseTotal = rawPauseTotal > 0 ? rawPauseTotal : null

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
    pauseRemaining,
    pauseTotal,
    isQuiet: raw.playlist?.quiet ?? false,
    led: raw.led ? { effect: raw.led.effect, brightness: raw.led.brightness } : null,
    clock: raw.time ?? null,
    state,
    connected: true,
  }
}

/** Is the table doing something we should show the Now Playing bar for? */
export function isActive(s: Status | null): boolean {
  if (!s) return false
  // pauseRemaining keeps the bar up during the between-patterns gap, where the
  // firmware reports state=Idle with no file (and may drop playlist.active).
  return s.isRunning || s.isPaused || s.isHoming || s.isClearing || s.pauseRemaining != null || !!s.currentFile || !!s.playlist
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
