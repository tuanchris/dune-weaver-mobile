// Harvest the table's /sand_log into the app's persistent per-table store
// (useTableLog) whenever the app can talk to the table: the moment it becomes
// reachable, and every few minutes while it stays connected. /sand_log is a
// heap-free static-buffer route on the firmware side, so the periodic read is
// cheap even mid-pattern; failures (offline, the firmware's low-memory 503
// shedding) are silent — the next chance retries.
//
// The firmware stamps lines with `[+N]` (seconds since boot). At collection
// time we anchor boot to wall clock (Date.now() − status.uptime·1000) and
// store each new line with an absolute epoch-ms timestamp ALONGSIDE the raw
// `[+N]` text — the viewer shows both (wall clock for "when", uptime for
// boot-relative timing), and times stay meaningful across reboots.

import { useEffect } from 'react'
import { board } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTableLog, TableLog, TableLogEntry } from '../stores/useTableLog'

const SYNC_EVERY_MS = 5 * 60_000
/** Floor between collections even across reconnect flaps. */
const MIN_GAP_MS = 15_000

/** Marker line appended between boots in the stored history. */
export const RESTART_MARKER = '— table restarted —'

/** `[+123] msg` -> 123; -1 for lines without an uptime prefix. */
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

type MergeInput = Pick<TableLog, 'entries' | 'lastRaw' | 'lastUptime'>

/**
 * Merge a fresh /sand_log dump into the stored history. Within one boot the
 * fetched tail is appended after the last exact occurrence of the stored merge
 * cursor (uptime prefixes make raw lines effectively unique); when the board's
 * 8 KB window has scrolled past our cursor, only strictly-newer-uptime lines
 * are appended. A reboot (uptime went backwards) appends a marker + everything.
 * New lines get `ts` = bootEpochMs + uptime·1000 (the raw `[+N]` prefix stays
 * in the text); timestamps are clamped monotonic because bootEpochMs is
 * re-estimated per collection (±~2 s jitter).
 */
export function mergeLogTail(stored: MergeInput, fetched: string[], bootEpochMs: number): MergeInput {
  if (fetched.length === 0) return stored
  const fetchedLast = lastUptime(fetched)

  let fresh: string[]
  let rebooted = false
  if (stored.entries.length === 0) {
    fresh = fetched
  } else if (fetchedLast >= 0 && fetchedLast < stored.lastUptime) {
    rebooted = true
    fresh = fetched
  } else if (stored.lastRaw) {
    const idx = fetched.lastIndexOf(stored.lastRaw)
    if (idx >= 0) {
      fresh = fetched.slice(idx + 1)
    } else {
      // Gap: our cursor scrolled out of the board's window. Boundary-second
      // lines may drop/dup here; acceptable for a diagnostics trail.
      fresh = fetched.filter((l) => uptimeOf(l) > stored.lastUptime)
    }
  } else {
    fresh = fetched.filter((l) => uptimeOf(l) > stored.lastUptime)
  }
  if (fresh.length === 0 && !rebooted) return stored

  let prevTs = 0
  for (let i = stored.entries.length - 1; i >= 0; i--) {
    const t = stored.entries[i].ts
    if (t != null) {
      prevTs = t
      break
    }
  }
  const appended: TableLogEntry[] = fresh.map((line) => {
    const u = uptimeOf(line)
    if (u < 0) return { ts: null, text: line }
    const ts = Math.max(bootEpochMs + u * 1000, prevTs)
    prevTs = ts
    return { ts, text: line }
  })

  return {
    entries: [
      ...stored.entries,
      ...(rebooted ? [{ ts: null, text: RESTART_MARKER } satisfies TableLogEntry] : []),
      ...appended,
    ],
    lastRaw: fresh.length > 0 ? fresh[fresh.length - 1] : stored.lastRaw,
    lastUptime: fetchedLast >= 0 ? fetchedLast : stored.lastUptime,
  }
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
  // Anchor boot to wall clock from the (≤1 s old) status poll. When it isn't
  // available for this base (poller pointed elsewhere, old firmware, demo),
  // fall back to treating the newest fetched line as "just now".
  const st = useStatus.getState()
  const uptime = st.base === base && st.status?.connected ? st.status.uptime : null
  const bootEpochMs = Date.now() - Math.max(0, uptime ?? lastUptime(fetched)) * 1000
  const store = useTableLog.getState()
  const prev = store.logs[id] ?? { entries: [], lastRaw: null, lastUptime: -1 }
  const merged = mergeLogTail(prev, fetched, bootEpochMs)
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
