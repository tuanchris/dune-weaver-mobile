// Persisted per-table copy of the table's runtime log (/sand_log). The board
// only keeps ~8 KB in RAM and loses it on every reboot; the app harvests it
// whenever it can reach the table (lib/tableLogSync.ts) so the history
// survives table restarts and reaches back further than the on-board ring.
// Keyed by the saved board's id (stable across DHCP moves). Local only —
// shown/shared from Settings → Diagnostics, never uploaded.
//
// Lines are stored as { ts, text }: text is the raw firmware line (keeping
// its `[+N]` seconds-since-boot prefix — useful for boot-relative timing) and
// ts is that uptime resolved to epoch ms at collection time (boot anchored to
// wall clock via status.uptime), so the viewer shows a real timestamp AND the
// uptime. ts is null for lines collected before v2 and for restart markers.

import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'

const STORAGE_KEY = 'dw.tableLog.v2'
const LEGACY_KEY = 'dw.tableLog.v1'
/** Lines kept per table (~150 KB worst case at ~75 B/line). */
const MAX_LINES = 2000
/** Tables kept; least-recently-collected beyond this are pruned. */
const MAX_TABLES = 8

export interface TableLogEntry {
  /** Epoch ms, best-effort (±~2 s: boot-to-wall-clock anchor precision). */
  ts: number | null
  text: string
}

export interface TableLog {
  entries: TableLogEntry[]
  /** Newest raw `[+N] …` line as fetched — the merge cursor for the next collection. */
  lastRaw: string | null
  /** Uptime seconds of the newest collected line; -1 before the first collection. */
  lastUptime: number
  /** Epoch ms of the last successful collection. */
  updatedAt: number
}

interface TableLogStore {
  /** Saved board id -> collected log. */
  logs: Record<string, TableLog>
  hydrated: boolean
  hydrate: () => Promise<void>
  /** Replace a table's log (already merged; capped here). Persists. */
  setLog: (id: string, log: Pick<TableLog, 'entries' | 'lastRaw' | 'lastUptime'>) => void
  clear: (id: string) => void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist(logs: Record<string, TableLog>) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(logs)).catch(() => undefined)
  }, 2000)
}

/** `[+123] msg` -> 123; -1 for lines without an uptime prefix (markers). */
function uptimeOf(line: string): number {
  const m = /^\[\+(\d+)\]/.exec(line)
  return m ? Number(m[1]) : -1
}

/** v1 stored plain raw lines; keep them (untimestamped) and derive the merge
 * cursor from the newest prefixed line so collection continues seamlessly. */
function migrateV1(v1: Record<string, { lines: string[]; updatedAt: number }>): Record<string, TableLog> {
  const logs: Record<string, TableLog> = {}
  for (const [id, { lines, updatedAt }] of Object.entries(v1)) {
    let lastRaw: string | null = null
    let lastUptime = -1
    for (let i = lines.length - 1; i >= 0; i--) {
      const u = uptimeOf(lines[i])
      if (u >= 0) {
        lastRaw = lines[i]
        lastUptime = u
        break
      }
    }
    logs[id] = { entries: lines.map((text) => ({ ts: null, text })), lastRaw, lastUptime, updatedAt }
  }
  return logs
}

export const useTableLog = create<TableLogStore>((set, get) => ({
  logs: {},
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return
    try {
      let persisted: Record<string, TableLog> | null = null
      const raw = await AsyncStorage.getItem(STORAGE_KEY)
      if (raw) {
        persisted = JSON.parse(raw) as Record<string, TableLog>
      } else {
        const legacy = await AsyncStorage.getItem(LEGACY_KEY)
        if (legacy) {
          persisted = migrateV1(JSON.parse(legacy))
          schedulePersist(persisted)
          AsyncStorage.removeItem(LEGACY_KEY).catch(() => undefined)
        }
      }
      // Persisted wins only where the session hasn't collected yet — a fetch
      // can land before hydration finishes.
      if (persisted) set({ logs: { ...persisted, ...get().logs } })
    } catch {
      // corrupt/absent -> start empty
    }
    set({ hydrated: true })
  },

  setLog: (id, log) => {
    const logs = {
      ...get().logs,
      [id]: { ...log, entries: log.entries.slice(-MAX_LINES), updatedAt: Date.now() },
    }
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
