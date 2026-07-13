// Harvest the table's /sand_log into the app's persistent per-table store
// (useTableLog) whenever the app can talk to the table: the moment it becomes
// reachable, and every few minutes while it stays connected. /sand_log is a
// heap-free static-buffer route on the firmware side, so the periodic read is
// cheap even mid-pattern; failures (offline, the firmware's low-memory 503
// shedding) are silent — the next chance retries.

import { useEffect } from 'react'
import { board } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTableLog } from '../stores/useTableLog'

const SYNC_EVERY_MS = 5 * 60_000
/** Floor between collections even across reconnect flaps. */
const MIN_GAP_MS = 15_000

/** Marker line appended between boots in the stored history. */
export const RESTART_MARKER = '— table restarted —'

/** `[+123] msg` -> 123; -1 for lines without an uptime prefix (markers). */
function uptimeOf(line: string): number {
  const m = /^\[\+(\d+)\]/.exec(line)
  return m ? Number(m[1]) : -1
}

function lastUptime(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const u = uptimeOf(lines[i])
    if (u >= 0) return u
  }
  return -1
}

/**
 * Merge a fresh /sand_log dump into the stored history. Within one boot the
 * fetched tail is appended after the stored tail's last exact occurrence
 * (uptime prefixes make lines effectively unique); when the board's 8 KB
 * window has scrolled past our tail, only strictly-newer-uptime lines are
 * appended. A reboot (uptime went backwards) appends a marker + everything.
 */
export function mergeLogTail(stored: string[], fetched: string[]): string[] {
  if (fetched.length === 0) return stored
  if (stored.length === 0) return fetched
  if (lastUptime(fetched) < lastUptime(stored)) {
    return [...stored, RESTART_MARKER, ...fetched]
  }
  const last = stored[stored.length - 1]
  const idx = fetched.lastIndexOf(last)
  if (idx >= 0) {
    return idx + 1 < fetched.length ? [...stored, ...fetched.slice(idx + 1)] : stored
  }
  // Gap: our tail scrolled out of the board's window. Boundary-second lines
  // may drop/dup here; acceptable for a diagnostics trail.
  const cut = lastUptime(stored)
  return [...stored, ...fetched.filter((l) => uptimeOf(l) > cut)]
}

/** Fetch the table's log once and fold it into the store. Throws on fetch
 * failure so interactive callers (the Diagnostics sheet) can surface it. */
export async function collectTableLog(base: string): Promise<void> {
  const id = useBoards.getState().boards.find((b) => b.base === base)?.id
  if (!id) return // not a saved table (shouldn't happen — polling implies saved)
  const text = await board.sandLog(base)
  const fetched = text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0)
  const store = useTableLog.getState()
  const prev = store.logs[id]?.lines ?? []
  const merged = mergeLogTail(prev, fetched)
  // Stamp updatedAt even when nothing is new — "collected 2 min ago" should
  // reflect the last successful look, not the last new line.
  store.setLog(id, merged)
}

/**
 * Mount-once hook (App.tsx): rides the 1 s status poll. Collects immediately
 * when the active table becomes reachable (or the active table changes) and
 * every SYNC_EVERY_MS while it stays connected.
 */
export function useTableLogSync() {
  useEffect(() => {
    void useTableLog.getState().hydrate()
    const lastByBase: Record<string, number> = {}
    return useStatus.subscribe((s, prev) => {
      const base = s.base
      if (!base || !s.status?.connected) return
      const cameOnline = prev.status?.connected !== true || prev.base !== base
      const last = lastByBase[base] ?? 0
      const age = Date.now() - last
      if (age < MIN_GAP_MS) return
      if (!cameOnline && age < SYNC_EVERY_MS) return
      lastByBase[base] = Date.now()
      collectTableLog(base).catch(() => undefined) // background: next chance retries
    })
  }, [])
}
