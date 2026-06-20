import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { ClearMode } from '../api/board'

const KEY = 'dw_prefs_v1'

interface Persisted {
  clearMode: ClearMode
}

interface PrefsStore {
  /** Remembered Pre-Execution Action for running a pattern (Browse detail sheet). */
  clearMode: ClearMode
  setClearMode: (m: ClearMode) => void
  hydrate: () => Promise<void>
}

export const usePrefs = create<PrefsStore>((set) => ({
  clearMode: 'none',
  setClearMode: (clearMode) => {
    set({ clearMode })
    AsyncStorage.setItem(KEY, JSON.stringify({ clearMode } satisfies Persisted)).catch(() => {})
  },
  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY)
      if (raw) {
        const data: Persisted = JSON.parse(raw)
        if (data.clearMode) set({ clearMode: data.clearMode })
      }
    } catch {
      // keep default
    }
  },
}))
