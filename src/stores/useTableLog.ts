// Persisted per-table copy of the table's runtime log (/sand_log). The board
// only keeps ~8 KB in RAM and loses it on every reboot; the app harvests it
// whenever it can reach the table (lib/tableLogSync.ts) so the history
// survives table restarts and reaches back further than the on-board ring.
// Keyed by the saved board's id (stable across DHCP moves). Local only —
// shown/shared from Settings → Diagnostics, never uploaded.

import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'

const STORAGE_KEY = 'dw.tableLog.v1'
/** Lines kept per table (~150 KB worst case at ~75 B/line). */
const MAX_LINES = 2000
/** Tables kept; least-recently-collected beyond this are pruned. */
const MAX_TABLES = 8

export interface TableLog {
  lines: string[]
  /** Epoch ms of the last successful collection. */
  updatedAt: number
}

interface TableLogStore {
  /** Saved board id -> collected log. */
  logs: Record<string, TableLog>
  hydrated: boolean
  hydrate: () => Promise<void>
  /** Replace a table's log (already merged; capped here). Persists. */
  setLog: (id: string, lines: string[]) => void
  clear: (id: string) => void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist(logs: Record<string, TableLog>) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(logs)).catch(() => undefined)
  }, 2000)
}

export const useTableLog = create<TableLogStore>((set, get) => ({
  logs: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY)
      // Persisted wins only where the session hasn't collected yet — a fetch
      // can land before hydration finishes.
      if (raw) set({ logs: { ...(JSON.parse(raw) as Record<string, TableLog>), ...get().logs } })
    } catch {
      // corrupt/absent -> start empty
    }
    set({ hydrated: true })
  },

  setLog: (id, lines) => {
    const logs = { ...get().logs, [id]: { lines: lines.slice(-MAX_LINES), updatedAt: Date.now() } }
    const ids = Object.keys(logs)
    if (ids.length > MAX_TABLES) {
      ids
        .sort((a, b) => logs[a].updatedAt - logs[b].updatedAt)
        .slice(0, ids.length - MAX_TABLES)
        .forEach((old) => delete logs[old])
    }
    set({ logs })
    schedulePersist(logs)
  },

  clear: (id) => {
    const logs = { ...get().logs }
    delete logs[id]
    set({ logs })
    schedulePersist(logs)
  },
}))
