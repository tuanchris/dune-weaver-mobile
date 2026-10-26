// Mirror local favorites into a "Favorites" playlist on the table. Hearting a
// pattern adds it to /playlists/Favorites.txt on the active table (created on
// first favorite); un-hearting removes it. Favorites are still LOCAL truth
// (usePrefs, shared across tables) — this keeps a table-side playlist in step
// so favorites are runnable as a playlist from the table itself.
//
// Reconcile, don't overwrite: tables can already carry a hand-made
// Favorites.txt (or gain entries from the web tools), so the sync only ADDS
// newly-favorited keys and only REMOVES keys it previously synced itself
// (per-board baseline in usePrefs.favSynced). Entries it didn't create are
// preserved, and a favorite deleted on the table isn't force-re-added.
//
// Writes wait for a moment when the table is reachable and the SD is safe to
// touch (not mid-job, not preview-syncing) — same rule as every SD write; a
// busy/offline table just means the reconcile runs on a later kick. Rapid
// heart-taps coalesce through a debounce; failures log to diagnostics and
// retry on the next opportunity.

import { useEffect } from 'react'
import { board } from '../api/board'
import { isBusy } from '../api/status'
import { log } from '../stores/useAppLog'
import { useLibrary } from '../stores/useLibrary'
import { useBoards } from '../stores/useBoards'
import { usePrefs } from '../stores/usePrefs'
import { usePreviews } from '../stores/usePreviews'
import { useStatus } from '../stores/useStatus'
import { parsePlaylist } from './playlists'

export const FAVORITES_PLAYLIST = 'Favorites.txt'
const DEBOUNCE_MS = 1500
/** Re-attempt cadence while a pending diff is blocked (table busy, preview
 * sync streaming, write failed). Cheap: everything short of the actual HTTP
 * round-trip is in-memory checks. */
const RETRY_MS = 15_000

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n')

let inFlight = false

/** 'idle' = nothing to sync; 'done' = synced; 'deferred' = a diff is pending
 * but the table can't take it right now (or the write failed) — try later. */
export type ReconcileResult = 'idle' | 'done' | 'deferred'

/** One reconcile attempt against the active table; quietly bails when the
 * table isn't in a state to take SD writes. Exported for tests/manual kicks. */
export async function reconcileFavoritesPlaylist(): Promise<ReconcileResult> {
  if (inFlight) return 'deferred'
  const st = useStatus.getState()
  const base = st.base
  if (!base) return 'idle'
  const boardId = useBoards.getState().boards.find((b) => b.base === base)?.id
  if (!boardId) return 'idle'

  const prefs = usePrefs.getState()
  const favs = Object.keys(prefs.favorites)
  const baseline = prefs.favSynced[boardId] ?? []
  if (sameSet(favs, baseline)) return 'idle'

  if (!st.status?.connected || isBusy(st.status)) return 'deferred'
  if (usePreviews.getState().syncing) return 'deferred'

  inFlight = true
  try {
    let current: string[] = []
    try {
      current = parsePlaylist(await board.playlistText(base, FAVORITES_PLAYLIST))
    } catch (e) {
      // No Favorites playlist on this card yet -> start from empty (created below).
      if (!/404/.test((e as Error)?.message ?? '')) throw e
    }

    const favSet = new Set(favs)
    const baselineSet = new Set(baseline)
    // Remove only what WE synced and the user has since un-hearted.
    const removes = new Set(baseline.filter((k) => !favSet.has(k)))
    const kept = current.filter((k) => !removes.has(k))
    const keptSet = new Set(kept)
    // Add only NEW favorites — a favorite in the baseline but missing from the
    // file was removed on the table; re-adding it would fight that edit.
    const adds = favs.filter((k) => !keptSet.has(k) && !baselineSet.has(k))
    const next = [...kept, ...adds]

    if (next.join('\n') !== current.join('\n')) {
      const content = next.length ? next.map((k) => `/patterns/${k}`).join('\n') + '\n' : '\n'
      await board.uploadTextFile(base, `/playlists/${FAVORITES_PLAYLIST}`, content)
    }
    useLibrary.getState().setPlaylistCover(base, FAVORITES_PLAYLIST, next)
    prefs.setFavSynced(boardId, favs)
    return 'done'
  } catch (e) {
    // Offline / busy 503 / low memory — diagnostics get the raw cause; the
    // caller's retry (or the next toggle/reconnect kick) tries again.
    log.warn('favsync', `Favorites playlist sync failed: ${(e as Error)?.message ?? e}`)
    return 'deferred'
  } finally {
    inFlight = false
  }
}

/**
 * Mount-once hook (App.tsx): kicks a debounced reconcile when favorites
 * change, when the active table becomes reachable-and-idle, and once on mount
 * (catch-up for toggles made while offline/busy). A deferred attempt re-arms
 * itself every RETRY_MS until the pending diff lands — without this, a diff
 * blocked once (e.g. by a preview-bundle sync in flight) never synced.
 */
export function useFavoritesPlaylistSync() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const kick = (delayMs: number = DEBOUNCE_MS) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        if ((await reconcileFavoritesPlaylist()) === 'deferred') kick(RETRY_MS)
      }, delayMs)
    }
    const unsubPrefs = usePrefs.subscribe((s, prev) => {
      if (s.favorites !== prev.favorites) kick()
    })
    const unsubStatus = useStatus.subscribe((s, prev) => {
      const ready = !!s.base && s.status?.connected === true && !isBusy(s.status)
      const wasReady = !!prev.base && prev.status?.connected === true && !isBusy(prev.status)
      if (ready && (!wasReady || prev.base !== s.base)) kick()
    })
    kick()
    return () => {
      if (timer) clearTimeout(timer)
      unsubPrefs()
      unsubStatus()
    }
  }, [])
}
