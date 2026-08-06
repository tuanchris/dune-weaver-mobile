import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Asset } from 'expo-asset'
import { File } from 'expo-file-system'
// @ts-ignore - shared plain-ESM module (Metro resolves .mjs; allowJs covers TS)
import { thrToXY } from '../lib/thrGeometry.mjs'
import { THR, PREVIEW } from '../../assets/pattern-manifest'
import { board } from '../api/board'
import { isBusy } from '../api/status'
import { isDemoBase } from '../api/demoBoard'
import { useStatus } from './useStatus'

// Bases whose listing fetch was deferred because the table was mid-pattern, and
// the `force` flag to use when it retries once the table goes idle
// (lib/catalogRefresh.ts drives the retry). A real board's web server is
// single-threaded, so a catalog read while it's drawing competes with the
// status poll and the running job — we hold it until the board is free.
const deferredForce = new Set<string>()

/** Is THIS board (and it's the one we're polling) mid-pattern? Demo bypasses —
 * its listings are in-memory, no server contention. */
function tableBusy(base: string): boolean {
  if (isDemoBase(base)) return false
  const st = useStatus.getState()
  return st.base === base && isBusy(st.status)
}

/** Consume a deferred forced-refresh flag for a base (returns it, clears it). */
export function consumeDeferredForce(base: string): boolean {
  const had = deferredForce.has(base)
  deferredForce.delete(base)
  return had
}

const KEY = 'dw_library_v1'
// On-table listings (patterns + playlists) cached per board base, so a relaunch
// or a table switch shows the last-known catalog instantly and we only hit the
// board on an explicit pull-to-refresh (see loadTable/loadPlaylists).
const TABLE_KEY = 'dw_table_cache_v1'

export type Point = [number, number]

/** A user-imported pattern. Bundled defaults come from the manifest, not here. */
export interface LibraryPattern {
  id: string
  name: string // "X.thr" (the SD filename)
  thrUri: string // file:// in the document dir; already decimated theta-rho
  sizeBytes: number
  addedAt: number
  /**
   * file:// of the rasterized preview image in the document dir, persisted so we
   * generate it once (see <PreviewGenerator/>) — the imported-pattern equivalent
   * of the bundled webps, stored as app data instead of in the bundle.
   */
  previewUri?: string
}

const THR_MAP = THR as Record<string, number>

/** Resolve any pattern reference to its bare "<name>.thr" filename key. */
export function bareName(name: string | null | undefined): string {
  if (!name) return ''
  return name.startsWith('/') ? name.split('/').pop()! : name
}

/**
 * Normalize any pattern reference — an absolute SD path the firmware reports
 * (e.g. "/sd/patterns/custom_patterns/x.thr" or "/patterns/x.thr"), a manifest
 * path, or a bare name — to the key relative to /patterns ("custom_patterns/x.thr"
 * or "x.thr"). This is the key the PREVIEW manifest is bundled under, so it keeps
 * subfolders (unlike bareName, which collapses to the filename).
 */
export function patternKey(name: string | null | undefined): string {
  let s = (name ?? '').trim()
  s = s.replace(/^\/+/, '') // leading slashes
  s = s.replace(/^sd\//i, '') // /sd/ mount prefix
  s = s.replace(/^patterns\//i, '') // /patterns root
  return s
}

export type PreviewSource =
  | { kind: 'webp'; module: number }
  | { kind: 'svg' } // render from geometry (imported, or on-table w/o bundled webp)

/**
 * How to show a thumbnail for a pattern. Depends only on the static bundle, so
 * it's a plain function (not a store selector) — no re-render churn.
 *  - bundled default with a webp -> show the image
 *  - everything else -> render from geometry (handles imports + unbundled)
 */
export function previewSource(name: string | null | undefined): PreviewSource {
  const key = bareName(name)
  // Metro's dev asset server URL-decodes '+' to a space and then can't find the
  // '+'-named webp ("Asset not found"), so render those few patterns from live
  // geometry instead of their bundled preview.
  if (key.includes('+')) return { kind: 'svg' }
  const mod = (PREVIEW as Record<string, number>)[key]
  return mod != null ? { kind: 'webp', module: mod } : { kind: 'svg' }
}

/**
 * True when the app holds this pattern's .thr in its bundle — i.e. its shape can
 * be drawn live from geometry (<PolarPattern>) with no preview image at all.
 */
export function hasBundledThr(name: string | null | undefined): boolean {
  const key = bareName(name)
  return !!key && key in THR_MAP
}

/**
 * Every pattern the app ships a bundled preview for — the ~100 DEFAULT
 * (top-level) patterns, keyed by filename. Custom pattern previews are no longer
 * bundled (they live in app storage), so they surface in Browse once the
 * on-table manifest loads / they're imported, not from this list.
 */
export function previewNames(): string[] {
  return Object.keys(PREVIEW as Record<string, number>)
}

interface Persisted {
  patterns: LibraryPattern[]
}

/** Last-known on-table listings for one board base. */
interface TableCacheEntry {
  patterns?: string[]
  playlists?: string[]
  /** ETag of the last /sand_patterns manifest, sent as If-None-Match on refresh
   * so an unchanged catalog is a cheap 304 instead of a full re-download. */
  patternsEtag?: string | null
  /** A pattern catalog imported from a file (the card's index.json), kept
   * SEPARATE from the board-fetched `patterns` so the two sources survive each
   * other — flipping `catalogSource` back and forth needs no re-import/refetch. */
  importedPatterns?: string[]
  /** Which list the On-Table view reflects. 'imported' FREEZES the catalog:
   * loadTable never touches the board (the weak-Wi-Fi escape hatch). Absent =
   * 'board' (normal stale-while-revalidate fetch). */
  catalogSource?: 'board' | 'imported'
}
type TableCache = Record<string, TableCacheEntry>

/** The pattern list a cache entry currently exposes to the On-Table view. */
function activeCatalog(entry: TableCacheEntry | undefined): string[] {
  if (!entry) return []
  return entry.catalogSource === 'imported'
    ? entry.importedPatterns ?? []
    : entry.patterns ?? []
}

function persistTableCache(cache: TableCache) {
  AsyncStorage.setItem(TABLE_KEY, JSON.stringify(cache)).catch(() => {})
}

interface LibraryStore {
  patterns: LibraryPattern[]
  hydrated: boolean
  xyCache: Record<string, Point[]>
  loading: Record<string, true>
  /** On-table listings for the CURRENTLY-selected board (`tableBase`). Backed by
   * a per-board persisted cache so a relaunch/switch shows them instantly. */
  tablePatterns: string[]
  tablePlaylists: string[]
  /** Which board base `tablePatterns`/`tablePlaylists` currently reflect. */
  tableBase: string | null
  tableLoading: boolean
  playlistsLoading: boolean
  /** Per-board cache of the last-fetched listings (persisted). */
  tableCache: TableCache

  hydrate: () => Promise<void>
  addImported: (name: string, thrUri: string, sizeBytes: number, xy?: Point[]) => LibraryPattern
  remove: (id: string) => void
  /** Record the persisted preview image file for an imported pattern. */
  setPreviewUri: (name: string, uri: string) => void
  /**
   * Point the on-table view at `base` (populating from cache instantly), and
   * fetch the pattern manifest from the board ONLY on `force` (pull-to-refresh)
   * or the first time we've ever seen this board. Skips the board read while the
   * table is mid-pattern and defers it to the next idle (catalogRefresh.ts).
   */
  loadTable: (base: string | null, force?: boolean) => Promise<void>
  /** Same contract as loadTable, for the playlist listing (/sand_playlists). */
  loadPlaylists: (base: string | null, force?: boolean) => Promise<void>
  /** Optimistically reflect a push/delete without re-reading the manifest. */
  addTablePattern: (name: string) => void
  removeTablePattern: (name: string) => void

  /** Replace this board's IMPORTED catalog from a picked file and switch its
   * source to 'imported' (freezing board reads). `keys` are raw pattern refs;
   * they're normalized + deduped here. */
  importTableCatalog: (base: string, keys: string[]) => void
  /** Flip a board between the board-fetched catalog and the imported one.
   * Switching to 'board' kicks a normal SWR load; 'imported' restores the
   * stored imported list with no network. */
  setCatalogSource: (base: string, source: 'board' | 'imported') => void
  /** The catalog source for a board base ('board' when unset). */
  catalogSource: (base: string | null | undefined) => 'board' | 'imported'
  /** Count of patterns in this board's imported catalog (0 if none). */
  importedCatalogCount: (base: string | null | undefined) => number

  /** True if we hold this pattern locally (bundled default or imported). */
  has: (name: string | null | undefined) => boolean
  imported: (name: string | null | undefined) => LibraryPattern | undefined
  /** Cached animation geometry, or null (triggers no load — pair with ensureXY). */
  getXY: (name: string | null | undefined) => Point[] | null
  setXY: (name: string, xy: Point[]) => void
  /** Lazily load + cache geometry from the decimated .thr (bundled or imported). */
  ensureXY: (name: string | null | undefined) => Promise<void>
  /** Resolve a local file:// uri + byte size to push this pattern to a board. */
  resolveThr: (name: string) => Promise<{ uri: string; size: number } | null>
}

function persist(patterns: LibraryPattern[]) {
  const data: Persisted = { patterns }
  AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => {})
}

function makeId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** Merge a listing patch into the per-board cache and persist. */
function writeCache(
  get: () => LibraryStore,
  set: (partial: Partial<LibraryStore>) => void,
  base: string,
  patch: TableCacheEntry
) {
  const tableCache: TableCache = { ...get().tableCache, [base]: { ...get().tableCache[base], ...patch } }
  set({ tableCache })
  persistTableCache(tableCache)
}

export const useLibrary = create<LibraryStore>((set, get) => ({
  patterns: [],
  hydrated: false,
  xyCache: {},
  loading: {},
  tablePatterns: [],
  tablePlaylists: [],
  tableBase: null,
  tableLoading: false,
  playlistsLoading: false,
  tableCache: {},

  setPreviewUri: (name, uri) => {
    const key = bareName(name)
    const patterns = get().patterns.map((p) => (p.name === key ? { ...p, previewUri: uri } : p))
    set({ patterns })
    persist(patterns)
  },

  loadTable: async (base, force) => {
    if (!base) return
    const s = get()
    const cached = s.tableCache[base]
    // Switch the view to this board from cache (instant, no network). The
    // pattern list follows the active source (imported vs board-fetched).
    if (s.tableBase !== base) {
      set({ tableBase: base, tablePatterns: activeCatalog(cached), tablePlaylists: cached?.playlists ?? [] })
    }
    // Imported catalog: FROZEN. Never read /sand_patterns — this is the whole
    // point over weak Wi-Fi. Switch the source back to 'board' to refetch.
    if (cached?.catalogSource === 'imported') return
    // SWR: hit the board only on an explicit refresh, or the first time ever
    // (no cached patterns for this base). Otherwise the cached list stands.
    if (!force && cached?.patterns !== undefined) return
    if (get().tableLoading) return
    // Don't read the manifest while the table is mid-pattern — though the
    // firmware doesn't block motion for it, the read still contends with the
    // status poll on the board's single-threaded server. Defer to the next idle
    // (lib/catalogRefresh.ts); the cached list (shown above) stands meanwhile.
    if (tableBusy(base)) { if (force) deferredForce.add(base); return }
    set({ tableLoading: true })
    try {
      // Conditional GET: send the cached ETag so an unchanged catalog returns a
      // tiny 304 (keep the cache) instead of re-streaming the whole manifest —
      // cheap even while HA is polling, and only the real changes cost a full
      // read. The firmware only ETags the prebuilt manifest; the live-listing
      // fallback has no ETag (res.etag null) and always sends the full list.
      const res = await board.patternsConditional(base, cached?.patternsEtag)
      if (!res.notModified) {
        // Normalize to keys relative to /patterns (strip /sd//patterns/ prefixes)
        // so on-table names dedupe against the bundled manifest and don't surface
        // a bogus "patterns" folder. Dedupe after normalizing.
        const patterns = [...new Set(res.list.map((p) => patternKey(p)))]
        // Only publish to the view if this is still the selected board (guards a
        // fetch that resolves after the user switched tables).
        if (get().tableBase === base) set({ tablePatterns: patterns })
        writeCache(get, set, base, { patterns, patternsEtag: res.etag })
      }
      // notModified -> the cached list already stands (shown at the view switch).
    } catch {
      // keep whatever we had; a later manual refresh can retry
    } finally {
      set({ tableLoading: false })
    }
  },

  loadPlaylists: async (base, force) => {
    if (!base) return
    const s = get()
    const cached = s.tableCache[base]
    if (s.tableBase !== base) {
      set({ tableBase: base, tablePatterns: activeCatalog(cached), tablePlaylists: cached?.playlists ?? [] })
    }
    if (!force && cached?.playlists !== undefined) return
    if (get().playlistsLoading) return
    // Same as loadTable: hold the listing read until the table is idle so it
    // doesn't compete with the running job. Deferred retry in catalogRefresh.ts.
    if (tableBusy(base)) { if (force) deferredForce.add(base); return }
    set({ playlistsLoading: true })
    try {
      const playlists = await board.playlists(base)
      if (get().tableBase === base) set({ tablePlaylists: playlists })
      writeCache(get, set, base, { playlists })
    } catch {
      // keep the cached list; a later pull-to-refresh retries
    } finally {
      set({ playlistsLoading: false })
    }
  },

  addTablePattern: (name) => {
    set((s) => (s.tablePatterns.includes(name) ? s : { tablePatterns: [...s.tablePatterns, name] }))
    const base = get().tableBase
    if (!base) return
    // Write the mutation back to whichever list the view is showing, so a
    // push/delete survives relaunch under both sources.
    const field = get().tableCache[base]?.catalogSource === 'imported' ? 'importedPatterns' : 'patterns'
    writeCache(get, set, base, { [field]: get().tablePatterns })
  },

  removeTablePattern: (name) => {
    set((s) => ({ tablePatterns: s.tablePatterns.filter((p) => p !== name) }))
    const base = get().tableBase
    if (!base) return
    const field = get().tableCache[base]?.catalogSource === 'imported' ? 'importedPatterns' : 'patterns'
    writeCache(get, set, base, { [field]: get().tablePatterns })
  },

  importTableCatalog: (base, keys) => {
    const patterns = [...new Set(keys.map((k) => patternKey(k)).filter(Boolean))]
    writeCache(get, set, base, { importedPatterns: patterns, catalogSource: 'imported' })
    if (get().tableBase === base) set({ tablePatterns: patterns })
  },

  setCatalogSource: (base, source) => {
    writeCache(get, set, base, { catalogSource: source })
    if (get().tableBase === base) set({ tablePatterns: activeCatalog(get().tableCache[base]) })
    // Back to board: revalidate through the normal SWR path (cheap 304 if the
    // cached list is still current). Imported: nothing to fetch.
    if (source === 'board') void get().loadTable(base)
  },

  catalogSource: (base) => (base ? get().tableCache[base]?.catalogSource ?? 'board' : 'board'),

  importedCatalogCount: (base) => (base ? get().tableCache[base]?.importedPatterns?.length ?? 0 : 0),

  hydrate: async () => {
    // Load the per-board listing cache alongside the imported library so the
    // launch effect can populate the on-table view from disk without a fetch.
    try {
      const rawCache = await AsyncStorage.getItem(TABLE_KEY)
      if (rawCache) set({ tableCache: JSON.parse(rawCache) as TableCache })
    } catch {
      // ignore — a missing/corrupt cache just means the first load fetches
    }
    try {
      const raw = await AsyncStorage.getItem(KEY)
      if (raw) {
        const data: Persisted = JSON.parse(raw)
        set({ patterns: data.patterns || [], hydrated: true })
        return
      }
    } catch {
      // ignore
    }
    set({ hydrated: true })
  },

  addImported: (name, thrUri, sizeBytes, xy) => {
    const key = bareName(name)
    const entry: LibraryPattern = { id: makeId(), name: key, thrUri, sizeBytes, addedAt: Date.now() }
    // Replace any existing import with the same name.
    const patterns = [...get().patterns.filter((p) => p.name !== key), entry]
    set({ patterns })
    persist(patterns)
    if (xy) get().setXY(key, xy)
    return entry
  },

  remove: (id) => {
    const target = get().patterns.find((p) => p.id === id)
    const patterns = get().patterns.filter((p) => p.id !== id)
    set({ patterns })
    persist(patterns)
    if (target) {
      for (const uri of [target.thrUri, target.previewUri]) {
        if (!uri) continue
        try {
          const f = new File(uri)
          if (f.exists) f.delete()
        } catch {
          // ignore
        }
      }
      set((s) => {
        const xy = { ...s.xyCache }
        delete xy[target.name]
        return { xyCache: xy }
      })
    }
  },

  has: (name) => {
    const key = bareName(name)
    if (!key) return false
    return hasBundledThr(key) || get().patterns.some((p) => p.name === key)
  },

  imported: (name) => {
    const key = bareName(name)
    return get().patterns.find((p) => p.name === key)
  },

  getXY: (name) => get().xyCache[patternKey(name)] ?? null,

  setXY: (name, xy) => {
    const key = patternKey(name)
    set((s) => ({ xyCache: { ...s.xyCache, [key]: xy } }))
  },

  ensureXY: async (name) => {
    const key = patternKey(name)
    if (!key) return
    const s = get()
    if (s.xyCache[key] || s.loading[key]) return
    set((st) => ({ loading: { ...st.loading, [key]: true } }))
    try {
      // Only render geometry we hold locally — a bundled default or an imported
      // full-res .thr. We NEVER read pattern content back from the firmware, so a
      // custom on-table pattern with no local copy stays unresolved (it shows its
      // ingested preview image if one exists, else a placeholder).
      const resolved = await s.resolveThr(key)
      if (!resolved) return
      // Imported files are full-resolution on disk; bundled defaults are already
      // decimated. thrToXY decimates as needed so the render path stays bounded.
      const text = await new File(resolved.uri).text()
      const xy = thrToXY(text) as Point[]
      get().setXY(key, xy)
    } catch {
      // leave uncached -> placeholder
    } finally {
      set((st) => {
        const loading = { ...st.loading }
        delete loading[key]
        return { loading }
      })
    }
  },

  resolveThr: async (name) => {
    const key = bareName(name)
    const imp = get().patterns.find((p) => p.name === key)
    if (imp) {
      const f = new File(imp.thrUri)
      if (!f.exists) return null
      return { uri: imp.thrUri, size: imp.sizeBytes || f.size }
    }
    const mod = THR_MAP[key]
    if (mod == null) return null
    const asset = Asset.fromModule(mod)
    await asset.downloadAsync()
    const uri = asset.localUri ?? asset.uri
    return { uri, size: new File(uri).size }
  },
}))
