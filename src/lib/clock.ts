import { board } from '../api/board'

/**
 * A POSIX TZ string for the device's current UTC offset, e.g. UTC+7 -> "LCL-7"
 * (POSIX inverts the sign: the offset is what you ADD to local to get UTC).
 * Offset-only, so it has no DST rule — a DST zone is corrected on the next sync
 * (the app re-syncs on startup). Half-hour zones (e.g. +5:30) are handled.
 */
export function devicePosixTz(): string {
  const offMin = new Date().getTimezoneOffset() // west-positive minutes; -420 at UTC+7
  const posix = offMin / 60 // POSIX offset value in hours (=-7 at UTC+7)
  const hh = Math.trunc(Math.abs(posix))
  const mm = Math.abs(offMin) % 60
  const sign = posix < 0 ? '-' : posix > 0 ? '+' : ''
  const mmStr = mm ? `:${String(mm).padStart(2, '0')}` : ''
  return `LCL${sign}${hh}${mmStr}`
}

/**
 * Push the device's clock to the table if they differ: the unix epoch when the
 * table isn't synced or has drifted >60s, and the timezone when it differs.
 * Best-effort — failures (older firmware without /sand_time, offline) are
 * swallowed. Quiet hours only fire once the table clock is synced.
 */
export async function syncClock(base: string): Promise<void> {
  try {
    const t = await board.time(base)
    const deviceEpoch = Math.floor(Date.now() / 1000)
    const tz = devicePosixTz()
    const opts: { epoch?: number; tz?: string } = {}
    if (!t.synced || Math.abs(deviceEpoch - t.epoch) > 60) opts.epoch = deviceEpoch
    if ((t.tz || '') !== tz) opts.tz = tz
    if (opts.epoch != null || opts.tz != null) await board.syncTime(base, opts)
  } catch {
    // best-effort
  }
}
