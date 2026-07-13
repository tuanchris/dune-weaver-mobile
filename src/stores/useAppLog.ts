// Local diagnostics log — a ring buffer of app + table events (connection
// changes, failed requests, Wi-Fi/update flows, JS crashes). Everything stays
// on-device; it leaves the phone only when the user explicitly shares it from
// Settings → Diagnostics. The tail is persisted so a report written after a
// restart still shows what led up to it.

import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogEntry {
  ts: number // epoch ms
  level: LogLevel
  tag: string // short source, e.g. "http", "table", "wifi", "crash"
  msg: string
}

const RING_MAX = 600 // in-memory ceiling
const PERSIST_MAX = 250 // tail written to AsyncStorage
const STORAGE_KEY = 'dw.appLog.v1'

interface AppLogStore {
  entries: LogEntry[]
  append: (level: LogLevel, tag: string, msg: string) => void
  clear: () => void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function schedulePersist(entries: LogEntry[]) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-PERSIST_MAX))).catch(() => undefined)
  }, 2000)
}

export const useAppLog = create<AppLogStore>((set, get) => ({
  entries: [],

  append: (level, tag, msg) => {
    const entries = [...get().entries, { ts: Date.now(), level, tag, msg }].slice(-RING_MAX)
    set({ entries })
    schedulePersist(entries)
  },

  clear: () => {
    set({ entries: [] })
    AsyncStorage.removeItem(STORAGE_KEY).catch(() => undefined)
  },
}))

/** Non-hook logger for stores/libs. Cheap no-op-ish when nothing listens. */
export const log = {
  info: (tag: string, msg: string) => useAppLog.getState().append('info', tag, msg),
  warn: (tag: string, msg: string) => useAppLog.getState().append('warn', tag, msg),
  error: (tag: string, msg: string) => useAppLog.getState().append('error', tag, msg),
}

/** "14:03:22" in the device's locale-less 24h form, plus date when not today. */
function stamp(ts: number): string {
  const d = new Date(ts)
  const hms = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`
  const today = new Date()
  const sameDay = d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate()
  return sameDay ? hms : `${d.getMonth() + 1}/${d.getDate()} ${hms}`
}

/** The whole log as shareable plain text (oldest first). */
export function appLogText(): string {
  return useAppLog
    .getState()
    .entries.map((e) => `[${stamp(e.ts)}] ${e.level.toUpperCase().padEnd(5)} ${e.tag}: ${e.msg}`)
    .join('\n')
}

/** Load the persisted tail and hook uncaught JS errors. Call once at startup. */
export async function initAppLog(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (raw) {
      const prev = JSON.parse(raw) as LogEntry[]
      if (Array.isArray(prev) && prev.length) {
        useAppLog.setState((s) => ({ entries: [...prev, ...s.entries].slice(-RING_MAX) }))
      }
    }
  } catch {
    // corrupted tail — start fresh
  }
  log.info('app', '— app started —')

  // Record uncaught JS errors, then defer to RN's own handler (redbox in dev,
  // crash in release) so behavior is unchanged.
  const prev = ErrorUtils.getGlobalHandler?.()
  ErrorUtils.setGlobalHandler?.((error: unknown, isFatal?: boolean) => {
    const e = error as Error
    log.error('crash', `${isFatal ? 'FATAL ' : ''}${e?.name ?? 'Error'}: ${e?.message ?? String(error)}${e?.stack ? `\n${e.stack.split('\n').slice(0, 6).join('\n')}` : ''}`)
    prev?.(error, isFatal)
  })
}
