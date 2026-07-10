import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { File } from 'expo-file-system'

const KEY = 'dw_user_previews_v1'

/**
 * Normalize any pattern reference OR preview-image filename to a single lookup
 * key — the pattern's ".thr" filename — so an image is matched to its pattern by
 * NAME. The canonical export is "<pattern>.thr.webp" (e.g. star.thr -> the image
 * star.thr.webp), mirroring how the bundled PREVIEW manifest is keyed:
 *   "custom_patterns/Star.thr" (pattern) -> "star.thr"
 *   "Star.thr.webp"            (image)   -> "star.thr"
 *   "Star.webp" / "Star.png"   (image)   -> "star.thr"   (bare name tolerated)
 * Drops any folder + image extension, ensures a ".thr" suffix, and lowercases so
 * matching is case-insensitive (the on-disk casing of exports varies).
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
  /** Preview-bundle shard name -> content hash already ingested (see previewSync). */
  shardHashes?: Record<string, string>
}

interface PreviewStore {
  /** previewKey -> file:// uri of the ingested image in document storage. */
  map: Record<string, string>
  /** Preview-bundle shard name -> content hash already ingested from the table. */
  shardHashes: Record<string, string>
  hydrated: boolean
  hydrate: () => Promise<void>
  /** Add/replace ingested previews (keyed by previewKey). Persists. */
  addMany: (entries: { key: string; uri: string }[]) => void
  /** Record a preview-bundle shard as ingested at the given content hash. */
  setShardHash: (name: string, hash: string) => void
  /** Resolve a pattern name to an ingested preview uri, if one exists. */
  get: (name: string | null | undefined) => string | undefined
  /** Number of ingested previews held. */
  count: () => number
  /** Forget all ingested previews and delete their files. */
  clear: () => void
}

function persist(map: Record<string, string>, shardHashes: Record<string, string>) {
  const data: Persisted = { map, shardHashes }
  AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => {})
}

export const usePreviews = create<PreviewStore>((set, get) => ({
  map: {},
  shardHashes: {},
  hydrated: false,

  hydrate: async () => {
    try {
      const raw = await AsyncStorage.getItem(KEY)
      if (raw) {
        const data: Persisted = JSON.parse(raw)
        set({
          map: data.map || {},
          shardHashes: data.shardHashes || {},
          hydrated: true,
        })
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
    persist(map, get().shardHashes)
  },

  setShardHash: (name, hash) => {
    const shardHashes = { ...get().shardHashes, [name]: hash }
    set({ shardHashes })
    persist(get().map, shardHashes)
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
    // Also forget shard hashes, or the bundle sync would consider the
    // (now deleted) table previews already ingested and never refetch.
    set({ map: {}, shardHashes: {} })
    persist({}, {})
  },
}))
