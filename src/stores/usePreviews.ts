import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { File, Directory, Paths } from 'expo-file-system'

const KEY = 'dw_user_previews_v1'
/** Subfolder under the app's document dir where preview images are copied. */
const SUBDIR = 'userPreviews'

/** Basename of a uri or path ("…/userPreviews/star.thr.webp" -> "star.thr.webp"). */
function fileNameOf(uriOrName: string): string {
  return uriOrName.split('/').pop() ?? uriOrName
}

/**
 * Absolute file:// uri for a stored preview FILENAME under the CURRENT app
 * container. iOS rotates the container UUID on every app update — the Documents
 * *contents* survive but their absolute path changes, so a persisted absolute
 * uri goes dead after an update (image loads blank while the key still exists).
 * We persist only the filename and rebuild the uri here on every hydrate, which
 * self-heals: the file is still in Documents, just at a new absolute path.
 */
function resolvePreviewUri(fileName: string): string {
  return new File(new Directory(Paths.document, SUBDIR), fileName).uri
}

/**
 * Normalize any pattern reference OR preview-image filename to a single lookup
 * key — the pattern's ".thr" filename — so an image is matched to its pattern by
 * NAME. The canonical export is "<pattern>.thr.webp" (e.g. star.thr -> the image
 * star.thr.webp), mirroring how the bundled PREVIEW manifest is keyed:
 *   "custom_patterns/Star.thr" (pattern) -> "star.thr"
 *   "Star.thr.webp"            (image)   -> "star.thr"
 *   "Star.webp" / "Star.png"   (image)   -> "star.thr"   (bare name tolerated)
 * Drops any folder + image extension, ensures a ".thr" suffix, and lowercases so
 * matching is case-insensitive (the on-disk casing of exports varies). Matching
 * by BASENAME is what makes previews cross-table: the same pattern filed under a
 * different folder on another table still resolves to the same image.
 */
export function previewKey(name: string | null | undefined): string {
  let s = (name ?? '').trim()
  if (!s) return ''
  s = s.split('/').pop() ?? s // basename only — match by file name
  s = s.replace(/\.(webp|png|jpe?g)$/i, '') // image extension, if present
  if (!/\.thr$/i.test(s)) s += '.thr' // normalize to the pattern's .thr filename
  return s.toLowerCase()
}

interface Persisted {
  map: Record<string, string>
  /**
   * Preview-bundle shard CONTENT hashes already ingested (see previewSync),
   * regardless of which table or shard-name they came from — so a second table
   * carrying the same patterns (identical bundle → identical hashes) is a no-op
   * instead of a full re-download.
   */
  ingestedShards?: Record<string, true>
  /**
   * LEGACY (≤ v1.0.5): shard NAME -> hash, keyed per shard-name and thus global
   * across tables. Migrated into ingestedShards on hydrate. Kept in the type so
   * old persisted blobs parse.
   */
  shardHashes?: Record<string, string>
}

interface PreviewStore {
  /** previewKey -> ABSOLUTE file:// uri of the ingested image (in memory only;
   * rebuilt from the persisted filename each hydrate, see resolvePreviewUri). */
  map: Record<string, string>
  /** Set of preview-bundle shard CONTENT hashes already ingested (any table). */
  ingestedShards: Record<string, true>
  hydrated: boolean
  hydrate: () => Promise<void>
  /** True while a preview-bundle shard sync is streaming from the table. Motion
   * is blocked during this (the board's single-threaded SD can't serve heavy
   * shard reads and a running pattern at once). Not persisted. */
  syncing: boolean
  setSyncing: (v: boolean) => void
  /** Add/replace ingested previews (keyed by previewKey). Persists. */
  addMany: (entries: { key: string; uri: string }[]) => void
  /** True if a shard with this content hash has already been ingested. */
  hasShard: (hash: string) => boolean
  /** Record a preview-bundle shard content hash as ingested. */
  markShard: (hash: string) => void
  /** Resolve a pattern name to an ingested preview uri, if one exists. */
  get: (name: string | null | undefined) => string | undefined
  /** Number of ingested previews held. */
  count: () => number
  /** Forget all ingested previews and delete their files. */
  clear: () => void
}

function persist(map: Record<string, string>, ingestedShards: Record<string, true>) {
  // Persist FILENAMES, not the absolute (container-specific) uris — see
  // resolvePreviewUri. The map is rebuilt to absolute uris on hydrate.
  const stored: Record<string, string> = {}
  for (const [k, uri] of Object.entries(map)) stored[k] = fileNameOf(uri)
  const data: Persisted = { map: stored, ingestedShards }
  AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => {})
}

export const usePreviews = create<PreviewStore>((set, get) => ({
  map: {},
  ingestedShards: {},
  hydrated: false,
  syncing: false,
  setSyncing: (v) => set({ syncing: v }),

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY)
      if (raw) {
        const data: Persisted = JSON.parse(raw)
        // Migrate legacy name->hash map into the content-hash set: its VALUES
        // are the hashes we've already fetched, so seed them so an upgrade
        // doesn't re-download everything on the next sync.
        const ingested: Record<string, true> = { ...(data.ingestedShards || {}) }
        for (const h of Object.values(data.shardHashes || {})) if (h) ingested[h] = true
        // Rebuild absolute uris under the CURRENT container. Tolerates legacy
        // blobs that stored full absolute uris (fileNameOf extracts the basename)
        // as well as the new filename-only format.
        const map: Record<string, string> = {}
        for (const [k, v] of Object.entries(data.map || {})) {
          if (v) map[k] = resolvePreviewUri(fileNameOf(v))
        }
        set({ map, ingestedShards: ingested, hydrated: true })
        return
      }
    } catch {
      // ignore
    }
    set({ hydrated: true })
  },

  addMany: (entries) => {
    if (entries.length === 0) return
    const map = { ...get().map }
    for (const { key, uri } of entries) {
      if (!key) continue
      // Replacing an existing key — delete the old file it pointed at.
      const prev = map[key]
      if (prev && prev !== uri) {
        try {
          const f = new File(prev)
          if (f.exists) f.delete()
        } catch {
          // ignore
        }
      }
      map[key] = uri
    }
    set({ map })
    persist(map, get().ingestedShards)
  },

  hasShard: (hash) => !!get().ingestedShards[hash],

  markShard: (hash) => {
    if (!hash || get().ingestedShards[hash]) return
    const ingestedShards = { ...get().ingestedShards, [hash]: true as const }
    set({ ingestedShards })
    persist(get().map, ingestedShards)
  },

  get: (name) => get().map[previewKey(name)],

  count: () => Object.keys(get().map).length,

  clear: () => {
    const map = get().map
    for (const uri of Object.values(map)) {
      try {
        const f = new File(uri)
        if (f.exists) f.delete()
      } catch {
        // ignore
      }
    }
    // Also forget ingested shard hashes, or the bundle sync would consider the
    // (now deleted) table previews already ingested and never refetch.
    set({ map: {}, ingestedShards: {} })
    persist({}, {})
  },
}))
