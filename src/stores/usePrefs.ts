import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { ClearMode } from '../api/board'

const KEY = 'dw_prefs_v1'

export type PauseUnit = 'sec' | 'min' | 'hr'

/** Per-playlist playback options, remembered locally (the firmware only holds a
 * single global set, so we re-apply the right one when each playlist runs). */
export interface PlaylistPref {
  loop: boolean
  shuffle: boolean
  pauseTime: number
  pauseUnit: PauseUnit
  clearMode: ClearMode
}

interface Persisted {
  clearMode: ClearMode
  playlistPrefs: Record<string, PlaylistPref>
}

interface PrefsStore {
  /** Remembered Pre-Execution Action for running a pattern (Browse detail sheet). */
  clearMode: ClearMode
  setClearMode: (m: ClearMode) => void
  /** Saved playback preferences, keyed by playlist filename. */
  playlistPrefs: Record<string, PlaylistPref>
  setPlaylistPref: (name: string, pref: PlaylistPref) => void
  hydrate: () => Promise<void>
}

export const usePrefs = create<PrefsStore>((set, get) => {
  const save = () => {
    const { clearMode, playlistPrefs } = get()
    AsyncStorage.setItem(KEY, JSON.stringify({ clearMode, playlistPrefs } satisfies Persisted)).catch(() => {})
  }
  return {
    clearMode: 'adaptive',
    playlistPrefs: {},
    setClearMode: (clearMode) => {
      set({ clearMode })
      save()
    },
    setPlaylistPref: (name, pref) => {
      set({ playlistPrefs: { ...get().playlistPrefs, [name]: pref } })
      save()
    },
    hydrate: async () => {
      try {
        const raw = await AsyncStorage.getItem(KEY)
        if (raw) {
          const data: Partial<Persisted> = JSON.parse(raw)
          set({
            clearMode: data.clearMode ?? 'adaptive',
            playlistPrefs: data.playlistPrefs ?? {},
          })
        }
      } catch {
        // keep defaults
      }
    },
  }
})
