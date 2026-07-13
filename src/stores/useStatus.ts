import { create } from 'zustand'
import { board } from '../api/board'
import { translateStatus, type Status } from '../api/status'
import { useBoards } from './useBoards'
import { log } from './useAppLog'

const POLL_MS = 1000

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

async function pollOnce(base: string, gen: number, set: (p: Partial<StatusStore>) => void, get: () => StatusStore) {
  if (gen !== generation) return
  const started = Date.now()
  try {
    const raw = await board.status(base)
    if (gen !== generation) return
    const status = translateStatus(raw)
    if (get().status?.connected === false) log.info('table', `Reachable again: ${base}`)
    set({ status })
    // Backfill the stable identity onto the saved board (no-op when unchanged)
    // so boards added by bare IP still dedupe against discovery and relocate.
    if (status.mac || status.hostname) {
      useBoards.getState().noteIdentity(base, status.mac, status.hostname)
    }
  } catch (e) {
    if (gen !== generation) return
    const prev = get().status
    // Log the TRANSITION only — a table that stays offline would otherwise
    // fill the diagnostics ring at one line per second.
    if (prev?.connected) log.warn('table', `Unreachable: ${base} (${(e as Error)?.message ?? e})`)
    set({ status: prev ? { ...prev, connected: false } : null })
  } finally {
    if (gen === generation) {
      // Schedule the next poll relative to when this one *started*, so updates
      // land on a true ~1s cadence instead of 1s + request latency. Never
      // overlaps: if a request took longer than POLL_MS, poll again immediately.
      const wait = Math.max(0, POLL_MS - (Date.now() - started))
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
    try {
      const raw = await board.status(base)
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
