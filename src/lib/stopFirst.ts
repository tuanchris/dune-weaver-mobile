// "Stop the table first, then go" — for the two actions that REBOOT the board:
// changing its Wi-Fi (/wifi_save replies, then resets ~0.5 s later) and flashing
// firmware (/updatefw, and updateBlocked() refuses while a job is up anyway).
//
// A reboot ends whatever is drawing, so these used to be locked out until the
// owner went and stopped the table by hand — a dead end that just moved the work
// around. Instead the app does the stop itself, once the confirm dialog has said
// plainly that the pattern will end.
//
// Stopping a PLAYLIST takes two calls: $Playlist/Stop retires the queue (without
// it the run simply advances to the next pattern after the current one dies),
// then /sand_stop ends the pattern in flight.

import { board } from '../api/board'
import { isActive, isBusy, type Status } from '../api/status'
import { useStatus } from '../stores/useStatus'

/** How long to wait for motion to drain before giving up on a clean stop. */
const DRAIN_TIMEOUT_MS = 12_000
const POLL_MS = 500

/** Is there anything a reboot would interrupt? */
export function needsStopFirst(s: Status | null): boolean {
  return isActive(s)
}

/** One line for a confirm dialog, or '' when the table is already idle. */
export function stopFirstWarning(s: Status | null): string {
  if (!needsStopFirst(s)) return ''
  return s?.playlist
    ? 'The playlist is running — this stops it first, and the pattern on the table now will be left unfinished. '
    : 'The table is running — this stops it first, and the pattern will be left unfinished. '
}

/**
 * Stop the table and wait for it to settle, so a reboot doesn't land mid-motion.
 * No-op when nothing is running. Throws only if the stop REQUEST fails — a
 * drain that runs past the timeout resolves anyway, since the caller's own
 * busy-gate (updateBlocked / the Wi-Fi idle gate) is the real backstop and
 * failing here would strand the user with a stopped table and no update.
 */
export async function stopAndSettle(base: string): Promise<void> {
  const status = useStatus.getState().status
  if (!needsStopFirst(status)) return

  // Retire the queue before killing the pattern, or the playlist just advances.
  if (status?.playlist) {
    await board.stopPlaylist(base).catch(() => {})
  }
  await board.stop(base)

  const deadline = Date.now() + DRAIN_TIMEOUT_MS
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS))
    try {
      await useStatus.getState().refresh()
      if (!isBusy(useStatus.getState().status)) return
    } catch {
      // Unreachable mid-stop: keep waiting for the deadline rather than
      // treating a dropped poll as a failed stop.
    }
  }
}
