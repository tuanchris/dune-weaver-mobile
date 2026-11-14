import { create } from 'zustand'
import { board } from '../api/board'
import { translateStatus, isActive, isBusy, type Status } from '../api/status'
import { useBoards } from './useBoards'
import { log } from './useAppLog'

// Poll fast while the table is doing something, slow when it's idle. A
// decorative table is idle most of its life, and every poll is a full TCP
// connection to a single-client board (the firmware sends Connection: close, so
// keep-alive is a no-op) — see the firmware repo's POLLING.md. A user action
// snaps back to the fast rate immediately via refresh().
const POLL_ACTIVE_MS = 1000
const POLL_IDLE_MS = 8000
// Board-load backoff — the lever that actually targets the failure mode. When
// the table reports heap pressure (heap_largest below the firmware's WARN
// floor), poll slowly regardless of motion state so we stop competing for the
// last few KB against whatever is straining it (e.g. a big /sd/ transfer). The
// single-client server is only load-stressed when heap is tight, so that's the
// signal to ease off. Mirrors the HA integration.
const HEAP_LARGEST_WARN = 20000
const POLL_LOWHEAP_MS = 30000
// Per-request timeout for /sand_status. A busy single-threaded board answers
// erratically while streaming a pattern (seen on one table in a row: 2.3s, 14s,
// 0.1s), so a short timeout wrongly reports a working board offline. Generous,
// and paired with the slow-response backoff + disconnect grace below.
const POLL_TIMEOUT_MS = 12000
// Consecutive failed/timed-out polls to tolerate before showing the table
// offline. A single slow /sand_status mid-pattern is normal, not a disconnect —
// keep the last status (still "connected") until several in a row fail.
const DISCONNECT_AFTER = 3

interface StatusStore {
  status: Status | null
  base: string | null
  /** Point the poller at a board base URL (or null to stop). Restarts the loop. */
  setBase: (base: string | null) => void
  /** Force an immediate poll (e.g. right after an action) for snappy feedback. */
  refresh: () => Promise<void>
  /** Pause polling but keep the last status on screen — for long uploads: the
   * board's web server is single-threaded, so poll traffic queues against (and
   * slows) an in-flight transfer. Balance with resume(). */
  suspend: () => void
  /** Restart polling after suspend(). No-op when no board is active. */
  resume: () => void
}

let timer: ReturnType<typeof setTimeout> | null = null
let generation = 0 // bumps on every setBase to invalidate in-flight loops
let failCount = 0 // consecutive failed polls, for unreachable backoff
let lowHeap = false // last poll saw the board under heap pressure

// A rectangular table's size, or a round table's config name (its model, so its
// size: lib/tableSize.ts), read once per app session and again after the
// table restarts (a new config only takes effect on a restart: one booted on
// FluidNC's defaults reported 1000 x 1000, and the app kept drawing squares
// after it came back as 725 x 305). Read only while idle (`$/` reads 503 while
// moving); a failed read retries a minute later, the saved value standing meanwhile.
const travelRead = new Set<string>()
const travelTried = new Map<string, number>()
const lastUptime = new Map<string, number>()
function noteUptime(base: string, uptime: number | null) {
  if (uptime == null) return
  const prev = lastUptime.get(base)
  lastUptime.set(base, uptime)
  if (prev != null && uptime < prev) {
    travelRead.delete(base)
    travelTried.delete(base)
  }
}
async function learnTable(base: string, rect: boolean) {
  if (travelRead.has(base) || Date.now() - (travelTried.get(base) ?? 0) < 60_000) return
  travelTried.set(base, Date.now())
  try {
    if (rect) useBoards.getState().setTravel(base, await board.travel(base))
    else useBoards.getState().setModel(base, await board.configName(base))
    travelRead.add(base)
  } catch (e) {
    log.warn('table', `Couldn't read the table ${rect ? 'size' : 'model'}: ${(e as Error)?.message ?? e}`)
  }
}

async function pollOnce(base: string, gen: number, set: (p: Partial<StatusStore>) => void, get: () => StatusStore) {
  if (gen !== generation) return
  const started = Date.now()
  try {
    const raw = await board.status(base, POLL_TIMEOUT_MS)
    if (gen !== generation) return
    const status = translateStatus(raw)
    if (get().status?.connected === false) log.info('table', `Reachable again: ${base}`)
    failCount = 0
    lowHeap = typeof raw.heap_largest === 'number' && raw.heap_largest < HEAP_LARGEST_WARN
    set({ status })
    // Backfill the stable identity onto the saved board (no-op when unchanged)
    // so boards added by bare IP still dedupe against discovery and relocate.
    if (status.mac || status.hostname) {
      useBoards.getState().noteIdentity(base, status.mac, status.hostname)
    }
    noteUptime(base, status.uptime)
    if (!isBusy(status)) void learnTable(base, status.cartesian)
  } catch (e) {
    if (gen !== generation) return
    failCount++
    const prev = get().status
    // Disconnect grace: keep the last status (still shown as connected) through
    // a few slow/failed polls; only declare the table offline after several in a
    // row. One 14s /sand_status while a pattern streams is normal, not a drop.
    if (failCount >= DISCONNECT_AFTER) {
      // Log the TRANSITION only — a table that stays offline would otherwise
      // fill the diagnostics ring at one line per second.
      if (prev?.connected) log.warn('table', `Unreachable: ${base} (${(e as Error)?.message ?? e})`)
      set({ status: prev ? { ...prev, connected: false } : null })
    }
  } finally {
    if (gen === generation) {
      let wait: number
      if (get().status?.connected === true) {
        // Reachable: heap pressure backs off hardest; otherwise fast while
        // active, slow while idle. Normally start-anchored so updates land on a
        // true cadence. But when a poll was SLOW (the board's single-threaded
        // server struggling mid-pattern), the gap before the next poll grows
        // with how long this one took — so we poll it LESS often and give it
        // room to recover, instead of hammering it back-to-back (which would
        // pile up and make it worse).
        const target = lowHeap ? POLL_LOWHEAP_MS : isActive(get().status) ? POLL_ACTIVE_MS : POLL_IDLE_MS
        const elapsed = Date.now() - started
        wait = Math.max(target - elapsed, elapsed)
      } else {
        // Unreachable: exponential backoff (2s, 4s, 5s cap) so a down board
        // isn't polled-and-aborted every second — the fleet's main abort source.
        wait = Math.min(5000, 1000 * 2 ** failCount)
      }
      timer = setTimeout(() => pollOnce(base, gen, set, get), wait)
    }
  }
}

export const useStatus = create<StatusStore>((set, get) => ({
  status: null,
  base: null,

  setBase: (base) => {
    generation++
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    set({ base, status: null })
    if (base) {
      const gen = generation
      pollOnce(base, gen, set, get)
    }
  },

  refresh: async () => {
    const base = get().base
    if (!base) return
    if (timer) {
      // The loop is running: re-arm it now (bumping generation to retire the
      // sleeping timer). This both fetches fresh status AND recomputes the
      // cadence, so a user action that just made the table active snaps back to
      // the fast rate instead of waiting out an idle-length gap.
      clearTimeout(timer)
      timer = null
      generation++
      pollOnce(base, generation, set, get)
      return
    }
    // Suspended (no loop, e.g. mid-upload): a plain one-shot so callers still
    // get fresh status without covertly restarting polling.
    try {
      const raw = await board.status(base, POLL_TIMEOUT_MS)
      set({ status: translateStatus(raw) })
    } catch {
      // next scheduled poll will reconcile
    }
  },

  suspend: () => {
    generation++ // invalidates any in-flight pollOnce
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  },

  resume: () => {
    const base = get().base
    if (!base) return
    generation++
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    pollOnce(base, generation, set, get)
  },
}))
