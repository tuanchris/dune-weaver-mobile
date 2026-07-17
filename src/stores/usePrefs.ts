import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import type { ClearMode } from '../api/board'
import { patternKey } from './useLibrary'

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
  favorites: string[]
}

interface PrefsStore {
  /** Remembered Pre-Execution Action for running a pattern (Browse detail sheet). */
  clearMode: ClearMode
  setClearMode: (m: ClearMode) => void
  /** Saved playback preferences, keyed by playlist filename. */
  playlistPrefs: Record<string, PlaylistPref>
  setPlaylistPref: (name: string, pref: PlaylistPref) => void
  /** Favorited patterns, keyed by patternKey (subfolder kept, e.g.
   * "custom_patterns/x.thr"). Local to this app — a FluidNC table has no
   * backend to hold them — and shared across tables, like previews. */
  favorites: Record<string, true>
  toggleFavorite: (name: string) => void
  hydrate: () => Promise<void>
}

export const usePrefs = create<PrefsStore>((set, get) => {
  const save = () => {
    const { clearMode, playlistPrefs, favorites } = get()
    AsyncStorage.setItem(
      KEY,
      JSON.stringify({ clearMode, playlistPrefs, favorites: Object.keys(favorites) } satisfies Persisted),
    ).catch(() => {})
  }
  return {
    clearMode: 'adaptive',
    playlistPrefs: {},
    favorites: {},
    setClearMode: (clearMode) => {
      set({ clearMode })
      save()
    },
    setPlaylistPref: (name, pref) => {
      set({ playlistPrefs: { ...get().playlistPrefs, [name]: pref } })
      save()
    },
    toggleFavorite: (name) => {
      const key = patternKey(name)
      const favorites = { ...get().favorites }
      if (favorites[key]) delete favorites[key]
      else favorites[key] = true
      set({ favorites })
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
            favorites: Object.fromEntries((data.favorites ?? []).map((k) => [k, true as const])),
          })
        }
      } catch {
        // keep defaults
      }
    },
  }
})
