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

/** Storage key for a playlist's options ON A GIVEN TABLE — so the same-named
 * playlist can have different shuffle/pause/etc. per table. The `\u001F` unit
 * separator never appears in a base URL or a playlist filename. */
export function playlistPrefKey(base: string, name: string): string {
  return `${base}\u001F${name}`
}

interface Persisted {
  clearMode: ClearMode
  playlistPrefs: Record<string, PlaylistPref>
  favorites: string[]
  favSynced?: Record<string, string[]>
  previewNagDismissedCount?: number
  showPrereleaseFirmware?: boolean
}

interface PrefsStore {
  /** Remembered before-drawing clear for running a pattern (Browse detail sheet). */
  clearMode: ClearMode
  setClearMode: (m: ClearMode) => void
  /** Saved playback preferences, keyed per table + playlist filename
   * (playlistPrefKey). Legacy entries keyed by bare filename (pre per-table)
   * remain as a fallback — see playlistPref. */
  playlistPrefs: Record<string, PlaylistPref>
  setPlaylistPref: (base: string, name: string, pref: PlaylistPref) => void
  /** This table's saved options for a playlist, falling back to the legacy
   * global-by-name pref (pre per-table keying) so nothing is lost on update. */
  playlistPref: (base: string | null, name: string) => PlaylistPref | undefined
  /** Favorited patterns, keyed by patternKey (subfolder kept, e.g.
   * "custom_patterns/x.thr"). Local to this app — a FluidNC table has no
   * backend to hold them — and shared across tables, like previews. */
  favorites: Record<string, true>
  toggleFavorite: (name: string) => void
  /** Per saved-board id: the favorites snapshot last reconciled into that
   * table's Favorites playlist (lib/favoritesPlaylist.ts). The baseline that
   * distinguishes "newly favorited here" from "removed on the table". */
  favSynced: Record<string, string[]>
  setFavSynced: (boardId: string, keys: string[]) => void
  /** How many patterns were missing a thumbnail when the user last dismissed
   * Browse's "sync previews" banner (0 = never dismissed). The banner only comes
   * back if MORE patterns lose their thumbnails — a sync that fills in some but
   * not all of them lowers the count, so the nag stays gone. Global, like the
   * previews themselves. */
  previewNagDismissedCount: number
  dismissPreviewNag: (missing: number) => void
  /** Show -rc/-pre firmware builds in the version picker. Off by default —
   * betas are for testers — but the picker always shows the build that's
   * actually on the table, so a tester on an rc can still see where they are. */
  showPrereleaseFirmware: boolean
  setShowPrereleaseFirmware: (v: boolean) => void
  hydrate: () => Promise<void>
}

export const usePrefs = create<PrefsStore>((set, get) => {
  const save = () => {
    const { clearMode, playlistPrefs, favorites, favSynced, previewNagDismissedCount, showPrereleaseFirmware } = get()
    AsyncStorage.setItem(
      KEY,
      JSON.stringify({
        clearMode,
        playlistPrefs,
        favorites: Object.keys(favorites),
        favSynced,
        previewNagDismissedCount,
        showPrereleaseFirmware,
      } satisfies Persisted),
    ).catch(() => {})
  }
  return {
    clearMode: 'adaptive',
    playlistPrefs: {},
    favorites: {},
    favSynced: {},
    previewNagDismissedCount: 0,
    showPrereleaseFirmware: false,
    setClearMode: (clearMode) => {
      set({ clearMode })
      save()
    },
    setPlaylistPref: (base, name, pref) => {
      set({ playlistPrefs: { ...get().playlistPrefs, [playlistPrefKey(base, name)]: pref } })
      save()
    },
    playlistPref: (base, name) => {
      const prefs = get().playlistPrefs
      // Per-table key first; fall back to the legacy global-by-name entry.
      return (base ? prefs[playlistPrefKey(base, name)] : undefined) ?? prefs[name]
    },
    toggleFavorite: (name) => {
      const key = patternKey(name)
      const favorites = { ...get().favorites }
      if (favorites[key]) delete favorites[key]
      else favorites[key] = true
      set({ favorites })
      save()
    },
    setFavSynced: (boardId, keys) => {
      set({ favSynced: { ...get().favSynced, [boardId]: keys } })
      save()
    },
    dismissPreviewNag: (missing) => {
      set({ previewNagDismissedCount: Math.max(0, missing) })
      save()
    },
    setShowPrereleaseFirmware: (showPrereleaseFirmware) => {
      set({ showPrereleaseFirmware })
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
            favSynced: data.favSynced ?? {},
            previewNagDismissedCount: data.previewNagDismissedCount ?? 0,
            showPrereleaseFirmware: data.showPrereleaseFirmware ?? false,
          })
        }
      } catch {
        // keep defaults
      }
    },
  }
})
