import { create } from 'zustand'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Asset } from 'expo-asset'
import { File } from 'expo-file-system'
// @ts-ignore - shared plain-ESM module (Metro resolves .mjs; allowJs covers TS)
import { parseThr, toXY } from '../lib/thrGeometry.mjs'
import { THR, GEOM, PREVIEW } from '../../assets/pattern-manifest'
import { board } from '../api/board'
import { useBoards } from './useBoards'
import { isSdBusy } from '../lib/sd'

const KEY = 'dw_library_v1'

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
const GEOM_MAP = GEOM as Record<string, number>

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
  const mod = (PREVIEW as Record<string, number>)[key]
  return mod != null ? { kind: 'webp', module: mod } : { kind: 'svg' }
}

/** True if a bundled default exists for this name. */
export function isBundled(name: string | null | undefined): boolean {
  return bareName(name) in (THR as Record<string, number>)
}

/** All bundled default pattern filenames. */
export function bundledNames(): string[] {
  return Object.keys(THR as Record<string, number>)
}

/**
 * Every pattern the app ships a bundled preview for, keyed by its path relative
 * to /patterns (e.g. "custom_patterns/x.thr") — the full ~1080 library mirrored
 * from the dw repo. Used so the whole catalog is browsable with images even
 * before the on-table manifest loads.
 */
export function previewNames(): string[] {
  return Object.keys(PREVIEW as Record<string, number>)
}

interface Persisted {
  patterns: LibraryPattern[]
}

interface LibraryStore {
  patterns: LibraryPattern[]
  hydrated: boolean
  xyCache: Record<string, Point[]>
  loading: Record<string, true>
  /** Patterns currently on the table's SD card. Fetched once (see loadTable). */
  tablePatterns: string[]
  tableLoaded: boolean
  tableLoading: boolean

  hydrate: () => Promise<void>
  addImported: (name: string, thrUri: string, sizeBytes: number, xy?: Point[]) => LibraryPattern
  remove: (id: string) => void
  /** Record the persisted preview image file for an imported pattern. */
  setPreviewUri: (name: string, uri: string) => void
  /**
   * Fetch the on-table pattern manifest (the full recursive catalog incl.
   * custom_patterns/). No-op if already loaded (unless force) or a load is in
   * flight — we read it once at startup. /sand_patterns is motion-safe, so this
   * is fine to run even while a pattern is playing.
   */
  loadTable: (base: string | null, force?: boolean) => Promise<void>
  /** Optimistically reflect a push/delete without re-reading the manifest. */
  addTablePattern: (name: string) => void
  removeTablePattern: (name: string) => void

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

export const useLibrary = create<LibraryStore>((set, get) => ({
  patterns: [],
  hydrated: false,
  xyCache: {},
  loading: {},
  tablePatterns: [],
  tableLoaded: false,
  tableLoading: false,

  setPreviewUri: (name, uri) => {
    const key = bareName(name)
    const patterns = get().patterns.map((p) => (p.name === key ? { ...p, previewUri: uri } : p))
    set({ patterns })
    persist(patterns)
  },

  loadTable: async (base, force) => {
    if (!base) return
    const s = get()
    if (s.tableLoading) return
    if (!force && s.tableLoaded) return
    // NOTE: /sand_patterns is NOT motion-gated by the firmware (it skips the
    // block-during-motion gate), so the manifest is safe to read even while a
    // pattern runs — unlike file CONTENT reads/writes, which we still guard.
    set({ tableLoading: true })
    try {
      const list = await board.patterns(base)
      set({ tablePatterns: list, tableLoaded: true })
    } catch {
      // keep whatever we had; a later manual refresh can retry
    } finally {
      set({ tableLoading: false })
    }
  },

  addTablePattern: (name) => {
    set((s) => (s.tablePatterns.includes(name) ? s : { tablePatterns: [...s.tablePatterns, name] }))
  },

  removeTablePattern: (name) => {
    set((s) => ({ tablePatterns: s.tablePatterns.filter((p) => p !== name) }))
  },

  hydrate: async () => {
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
    return key in THR_MAP || get().patterns.some((p) => p.name === key)
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
      const resolved = await s.resolveThr(key)
      let text: string
      if (resolved) {
        text = await new File(resolved.uri).text()
      } else if (GEOM_MAP[key] != null) {
        // Bundled compact geometry for a nested custom pattern.
        const asset = Asset.fromModule(GEOM_MAP[key])
        await asset.downloadAsync()
        text = await new File(asset.localUri ?? asset.uri).text()
      } else {
        // Last resort — read the theta-rho off the SD card. Skip while the table
        // is running (content reads are motion-gated).
        const base = useBoards.getState().getActiveBase()
        if (!base || isSdBusy()) return
        text = await board.patternText(base, key)
      }
      const xy = toXY(parseThr(text)) as Point[]
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
