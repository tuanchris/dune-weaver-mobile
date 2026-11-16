import { useEffect, useMemo } from 'react'
import { AppState, Platform } from 'react-native'
import { create } from 'zustand'
import { fetch as binaryFetch } from 'expo/fetch'
import { Directory, File, Paths } from 'expo-file-system'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { bareName, bundledNames, useLibrary, type LibraryPattern } from '../stores/useLibrary'
import { useBoards, type Board } from '../stores/useBoards'
import { usePrefs } from '../stores/usePrefs'
import { useStatus } from '../stores/useStatus'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { toast } from '../stores/useToast'
import { log } from '../stores/useAppLog'
import { pushToTable } from './pushPattern'
import { partAt, sendBatch, supportsBatchUpload, writeBatchBody, type BatchFile } from './tableBatch'
import { startSyncService, stopSyncService, updateSyncService } from './syncService'
import { assertSdIdle } from './sd'
import { setTableReceiving, tableAnswers } from '../api/board'
import { updateTableManifest } from './tableManifest'
import { NotMemberError, SignedOutError, hubFetch, useHubAccount } from './hubAuth'
import { hubTableFor, roundSize, sandTable, type HubTable, type SandTable } from './tableSize'
import { useIsRect } from '../components/RectTable'

/**
 * The Pattern Hub (duneweaver.com/patterns, dune-weaver-website's
 * lib/pattern-hub*.ts). catalog.json and every preview webp (black ink on
 * transparent, like the bundled previews, so tiles tint it the same way) sit in
 * a public bucket the app reads with no auth. A pattern's .thr is for Dune
 * Weaver plan owners only: the website's download route hands out a
 * short-lived signed URL per file, to the account signed in through hubAuth.ts.
 */
// EXPO_PUBLIC_DW_HUB points it at a test copy (a catalog with versions before the site has them).
const HUB = process.env.EXPO_PUBLIC_DW_HUB ?? 'https://storage.googleapis.com/dw-website-71b35-pattern-hub/'

/** Keep the screen on while a sync runs: a locked phone suspends the app and abandons the file in flight. */
const KEEP_AWAKE_TAG = 'dw-hub-sync'

/**
 * One version of a hub pattern: its main file, or one made for another of the
 * hub's table sizes (catalog `table` / `versions`).
 */
export interface HubVersion {
  /** The table size it's made for; null = any table. */
  table: HubTable | null
  /** The file name it has on the phone and the table. */
  name: string
  previewUrl: string
  bytes: number
  /** Its revision (catalog `rev`): a copy with another is out of date. Absent on older catalogs. */
  rev?: string
}

/**
 * A hub pattern as one table takes it (`forTable`): `table`, `name`,
 * `previewUrl` and `bytes` are that version's. fetchHubCatalog hands out the
 * main file's.
 */
export interface HubPattern extends HubVersion {
  id: string
  title: string
  author: string
  description: string
  /** The website's tags ("Geometric", "Halloween", …). */
  tags: string[]
  /** "CC-BY-NC-4.0", or STARTER_LICENSE for the starter set. */
  license?: string
  /** Every version, the main file first. */
  versions: HubVersion[]
}

interface CatalogEntry {
  id: string
  title: string
  author: string
  description?: string
  tags?: string[]
  license?: string
  /** Bucket path. */
  preview: string
  bytes: number
  /** Its file name, given once and kept by the website (absent on older catalogs). */
  file?: string
  rev?: string
  table?: unknown
  versions?: { table?: unknown; preview: string; bytes: number; file?: string; rev?: string }[]
}

const isHubTable = (t: unknown): t is HubTable => t === 'pro' || t === 'mini-pro'

// The website's own naming rules, so a pattern synced here and one downloaded
// from the site (or a starter already on the card) land under the SAME file
// name: lib/pattern-hub-types.ts `starterId` and `downloadFilename`. Its
// `cardFilenames` is this whole rule (clashes included) for the installer's SD
// card Pattern Manager, which loads the hub onto a card. Keep them in step.
// The website now gives each file its name once and keeps it (catalog `file`),
// so a title edit never renames a file; the rule below is for older catalogs.
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
const starterId = (file: string): string => `starter-${slug(file.replace(/\.thr$/i, ''))}`

// The latest catalog read's patterns (the new-patterns red badge). Its `launched` is
// saved in usePrefs (hubLaunched), so an offline launch keeps the hub tab.
const useLaunch = create<{ patterns: HubPattern[] | null }>(() => ({ patterns: null }))

/**
 * The hub's catalog, each pattern named for the phone and table. Newest first,
 * as the catalog comes, but the starter set last, like the website's hub: it
 * ships with every table (and is bundled here), so the hub leads with what's new.
 */
export async function fetchHubCatalog(): Promise<{ patterns: HubPattern[]; launched: boolean }> {
  const res = await fetch(`${HUB}catalog.json`)
  if (!res.ok) throw new Error(`The Pattern Hub answered HTTP ${res.status}`)
  const data = (await res.json()) as { launched?: unknown; patterns?: CatalogEntry[] }
  if (!Array.isArray(data.patterns)) throw new Error('The Pattern Hub sent an unreadable catalog')
  const starter = (p: { license?: string }) => p.license === STARTER_LICENSE
  data.patterns = [...data.patterns.filter((p) => !starter(p)), ...data.patterns.filter(starter)]
  const launched = data.launched === true
  // The starter set IS the app's bundled set: map those back to the bundled file
  // name, so they read as already on the phone and dedupe against the card.
  const bundled = new Map(bundledNames(false).map((n) => [starterId(n), n]))
  const used = new Set<string>(bundled.values())
  for (const p of data.patterns) for (const f of [p.file, ...(p.versions ?? []).map((v) => v?.file)]) if (f) used.add(f)
  // A preview's URL carries its revision, so an updated pattern's cached images are fetched afresh (the bucket ignores the query).
  const previewUrl = (path: string, rev?: string) => HUB + path + (rev ? `?r=${rev}` : '')
  const patterns = data.patterns.map((p): HubPattern => {
    let name = bundled.get(p.id) ?? p.file
    if (!name) {
      name = `${slug(p.title).slice(0, 60) || p.id}.thr`
      // Two hub patterns with the same title: the id keeps them apart.
      if (used.has(name)) name = `${p.id}.thr`
      used.add(name)
    }
    // A version for another table is named after the main file ("owl-mini-pro.thr"),
    // or by the id when that's taken, like the website's card names.
    const main = name
    const versions: HubVersion[] = [
      { table: isHubTable(p.table) ? p.table : null, name, previewUrl: previewUrl(p.preview, p.rev), bytes: p.bytes, rev: p.rev },
      ...(Array.isArray(p.versions) ? p.versions : []).flatMap((v) => {
        if (!isHubTable(v?.table)) return []
        let vName = v.file
        if (!vName) {
          vName = main.replace(/\.thr$/i, `-${v.table}.thr`)
          if (used.has(vName)) vName = `${p.id}-${v.table}.thr`
          used.add(vName)
        }
        return [{ table: v.table, name: vName, previewUrl: previewUrl(v.preview, v.rev), bytes: v.bytes, rev: v.rev }]
      }),
    ]
    return {
      id: p.id,
      title: p.title,
      author: p.author,
      description: p.description ?? '',
      tags: Array.isArray(p.tags) ? p.tags : [],
      license: p.license,
      versions,
      ...versions[0],
    }
  })
  usePrefs.getState().setHubCatalogData(
    Object.fromEntries(patterns.filter((p) => p.tags.length).flatMap((p) => p.versions.map((v) => [tagKey(v.name), p.tags]))),
    Object.fromEntries(patterns.flatMap((p) => p.versions.map((v) => [tagKey(v.name), v.previewUrl.slice(HUB.length)]))),
    Object.fromEntries(patterns.filter((p) => p.versions.length > 1).map((p) => [p.id, p.versions.map((v) => ({ key: tagKey(v.name), table: v.table }))])),
    launched,
  )
  // Hub downloads from before revisions: one the size of the catalog's file is
  // that file (downloads are saved byte for byte), so it gets its revision.
  const revs: Record<string, string> = {}
  for (const e of useLibrary.getState().patterns) {
    if (e.hubRev) continue
    const v = patterns.flatMap((p) => p.versions).find((x) => x.name === e.name)
    if (v?.rev && v.bytes === e.sizeBytes) revs[e.name] = v.rev
  }
  useLibrary.getState().setHubRevs(revs)
  useLaunch.setState({ patterns })
  return { patterns, launched }
}

/**
 * Hub files whose copy is OLDER than the catalog's (the pattern was updated on
 * the hub; it keeps its file name): on the phone (`library`, the revision each
 * download was) and on `board`'s table (`Board.hubSent`, the revision the app
 * sent it). A copy with no revision isn't from the hub, or predates revisions,
 * and is left alone. The auto-download (useHubAutoSync) replaces the phone's
 * copy and Sync to table sends it over the table's, so every playlist naming the file
 * plays the new drawing.
 */
export function staleHubFiles(patterns: HubPattern[], library: LibraryPattern[], board?: Board | null): { phone: Set<string>; table: Set<string> } {
  const have = new Map(library.map((e) => [e.name, e.hubRev]))
  const phone = new Set<string>()
  const table = new Set<string>()
  for (const v of patterns.flatMap((p) => p.versions)) {
    if (!v.rev) continue
    const onPhone = have.get(v.name)
    if (onPhone && onPhone !== v.rev) phone.add(v.name)
    const sent = board?.hubSent?.[v.name]
    if (sent && sent !== v.rev) table.add(v.name)
  }
  return { phone, table }
}

/**
 * Hub patterns new to this phone, in this table's version: not on the phone, not
 * passed over by the auto-download (usePrefs.hubSeen) and not yet announced
 * (usePrefs.hubShown). Only where Browse shows the hub (a round table) and for
 * plan owners: anyone else can't download them. From the session's catalog read.
 */
export function useNewHubPatterns(): HubPattern[] {
  const raw = useLaunch((s) => s.patterns)
  const board = useBoards((s) => s.getActive())
  const library = useLibrary((s) => s.patterns)
  const seen = usePrefs((s) => s.hubSeen)
  const shown = usePrefs((s) => s.hubShown)
  const member = useHubAccount((s) => s.state === 'member')
  // Both hooks every render: `&&` would skip useIsRect while the hub is hidden and change the hook order.
  const visible = useHubVisible()
  const rect = useIsRect()
  const on = visible && !rect && member
  return useMemo(() => {
    if (!raw || !on) return []
    const skip = new Set([...seen, ...shown])
    const has = useLibrary.getState().has
    return forTable(raw, board).filter((p) => !skip.has(p.id) && !has(p.name))
    // library: has() reads it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, board, library, seen, shown, on])
}

/**
 * Each pattern as this table takes it (lib/tableSize.ts hubTableFor): its
 * version for the table's size, else its main file. A pattern with one
 * version is that version everywhere.
 */
export function forTable(patterns: HubPattern[], board: Board | null | undefined): HubPattern[] {
  return patterns.map((p) => {
    const want = hubTableFor(board, p.id)
    const v = p.versions.find((x) => x.table === want) ?? p.versions[0]
    return v.name === p.name ? p : { ...p, ...v }
  })
}

/**
 * A hub preview as the sand engine leaves it on one sand table, after its clear
 * (the website's publicSandPreviewPath: `previews/x.webp` → `previews/sand/<table>/x.webp`).
 * Rendered off-site and uploaded by the website's scripts/hub-sand-previews.ts;
 * one that isn't there (yet) 404s and the ink preview stays.
 */
export const sandPreviewUrl = (previewUrl: string, table: SandTable): string =>
  previewUrl.replace(/\/previews\/([^/]+)$/, `/previews/sand/${table}/$1`)

/** The sand table of the active board's size: which sand previews to show. */
export const useSandTable = (): SandTable => useBoards((s) => sandTable(roundSize(s.getActive()).diameter))

/** The hub's (ink) preview of a file the hub has, by file name — the bundled set, downloads, the card's copies — or null. */
export function useHubPreviewUrl(name: string): string | null {
  const path = usePrefs((s) => s.hubPreviews[tagKey(name)])
  return path ? HUB + path : null
}

/** The starter set's license: it ships with every table and is the app's bundled set. */
export const STARTER_LICENSE = 'dune-weaver-starter'

/**
 * Turn the auto-download (useHubAutoSync) on or off. On means patterns added
 * from NOW on: what the catalog holds today counts as seen (~30 MB; the hub
 * tab's sync buttons are for that), so switching it on reads the catalog first.
 */
export async function setHubAutoDownload(on: boolean): Promise<void> {
  if (on) {
    const { patterns } = await fetchHubCatalog()
    const prefs = usePrefs.getState()
    prefs.setHubSeen([...new Set([...prefs.hubSeen, ...patterns.map((p) => p.id)])])
  }
  usePrefs.getState().setHubAuto(on)
}

/** The hub pattern a library or table file is a version of (the session's catalog read), or null. */
export function useHubIdFor(name: string | null): string | null {
  const patterns = useLaunch((s) => s.patterns)
  return useMemo(() => {
    if (!name || !patterns) return null
    const key = tagKey(name)
    return patterns.find((p) => p.versions.some((v) => tagKey(v.name) === key))?.id ?? null
  }, [name, patterns])
}

/** The key hub tags are saved under: the file name, folders dropped, any case. */
export const tagKey = (name: string): string => (name.split('/').pop() ?? name).toLowerCase()

// One successful catalog read per app session refreshes the saved launch flag and
// tags; a failed one (offline, table-only Wi-Fi) keeps the saved ones and is
// retried on the next return to the app.
let launchRead: Promise<void> | null = null
export function readCatalogOnce(): void {
  launchRead ??= fetchHubCatalog().then(
    () => undefined,
    () => {
      launchRead = null
    },
  )
}

/**
 * Whether Browse shows the hub: once the website has launched it (to everyone,
 * signed in or not: the tab is where a plan owner signs in), or to an admin
 * before that. Never on desktop (no secure store, no sign-in redirect).
 */
export function useHubVisible(): boolean {
  const launched = usePrefs((s) => s.hubLaunched)
  const admin = useHubAccount((s) => s.admin)
  const web = Platform.OS === 'web'
  useEffect(() => {
    if (web) return
    readCatalogOnce()
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') readCatalogOnce()
    })
    return () => sub.remove()
  }, [web])
  return !web && (launched || admin)
}

async function download(url: string): Promise<Uint8Array> {
  const res = await binaryFetch(url)
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * A pattern's .thr, through the website's download route: a signed URL (good
 * for ~10 min) asked for just before the file, so none expires mid-sync.
 * Signed out → SignedOutError (from hubFetch); no plan on the account →
 * NotMemberError, and the account reads as not a member from then on.
 */
async function downloadThr(p: HubPattern): Promise<Uint8Array> {
  // `table` picks the version; the site answers with the main file when there's none for it.
  const which = p.table ? `?table=${p.table}` : ''
  const res = await hubFetch(`/api/patterns/${encodeURIComponent(p.id)}/download${which}`, { method: 'POST' })
  const body: unknown = await res.json().catch(() => null)
  if (res.status === 403 && body && typeof body === 'object' && 'code' in body && body.code === 'not_a_buyer') {
    useHubAccount.setState({ state: 'notMember' })
    throw new NotMemberError()
  }
  const url = res.ok && body && typeof body === 'object' && 'url' in body ? body.url : null
  if (typeof url !== 'string') {
    // The site says why ("Pattern not found"): keep it, it isn't the connection.
    const why = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'Download failed'
    throw new Error(`${why} (HTTP ${res.status})`)
  }
  return download(url)
}

function save(dir: string, name: string, data: Uint8Array): File {
  const d = new Directory(Paths.document, dir)
  if (!d.exists) d.create({ intermediates: true })
  const f = new File(d, name)
  if (f.exists) f.delete()
  f.writeSync(data)
  return f
}

/**
 * Put one hub pattern in the library, like an import: the .thr verbatim (what
 * gets pushed) in Paths.document/thr, and the hub's preview where
 * PreviewGenerator keeps its own, so there's nothing left to render. A missing
 * preview only means PreviewGenerator draws one.
 */
async function saveToPhone(p: HubPattern): Promise<void> {
  const [thr, preview] = await Promise.all([downloadThr(p), download(p.previewUrl).catch(() => null)])
  if (thr.length === 0) throw new Error('empty pattern file')
  const lib = useLibrary.getState()
  // An update over an older download: a table that lists the file and has no
  // revision for it got it from this phone before revisions, so it holds the old one.
  const old = lib.patterns.find((e) => e.name === p.name)?.hubRev
  if (old && p.rev !== old) {
    for (const b of useBoards.getState().boards) {
      if (!b.hubSent?.[p.name] && lib.tableListOf(b.base).some((k) => bareName(k) === p.name)) useBoards.getState().setHubSent(b.base, { [p.name]: old })
    }
  }
  const f = save('thr', p.name, thr)
  lib.addImported(p.name, f.uri, f.size)
  if (p.rev) lib.setHubRevs({ [p.name]: p.rev })
  if (preview) lib.setPreviewUri(p.name, save('previews', p.name.replace(/\.thr$/i, '.webp'), preview).uri)
}

export interface HubProgress {
  /** phone = downloading from the hub; prepare = writing a batch's body (lib/tableBatch.ts); table = sending. */
  stage: 'phone' | 'prepare' | 'table'
  /** 1-based position in this stage. */
  index: number
  total: number
  title: string
  /** 0..1 across the whole stage, weighted by file size. */
  fraction: number
  /** Set (when it started) for a batch the system is sending in the background for an
   * earlier run of the app: no byte count, no Stop. */
  since?: number
}

/**
 * The hub tab's Sync to table while it runs: its panel shows it, and SyncBanner on
 * every other screen. `receiving` = the table (base) a batch is sending to: it
 * answers nothing else until the request ends, so the app holds its status poll
 * (useStatus.holdForSync) and refuses every other command (lib/sd.ts).
 */
export const useHubSync = create<{
  progress: (HubProgress & { eta: number | null }) | null
  running: boolean
  stopping: boolean
  receiving: string | null
}>(() => ({
  progress: null,
  running: false,
  stopping: false,
  receiving: null,
}))

/** "Sending 12 patterns to the table · started 8 min ago": a `since` batch's line. */
export function backgroundLine(p: HubProgress): string {
  const m = Math.round((Date.now() - (p.since ?? Date.now())) / 60000)
  return `Sending ${p.total} pattern${p.total === 1 ? '' : 's'} to the table · ${m < 1 ? 'started just now' : `started ${m} min ago`}`
}

export const stageLabel = (stage: HubProgress['stage']): string =>
  stage === 'phone' ? 'Downloading' : stage === 'prepare' ? 'Preparing' : 'Sending to the table'

export interface HubSyncResult {
  toPhone: number
  toTable: number
  /** Titles that didn't download. */
  failed: string[]
  /** The first of those downloads' errors (each is in the diagnostics log). */
  failedError?: unknown
  stopped: boolean
  /** Why the run ended early: signed out, not a plan owner (SignedOutError /
   * NotMemberError), or a send to the table that failed. */
  error?: unknown
}

// One sync at a time: the auto-download and a manual sync write the same files.
// A second call waits for the first, then skips whatever the first downloaded.
let queue: Promise<unknown> = Promise.resolve()

/**
 * Sync hub patterns, one file at a time: download every one the phone lacks or
 * holds an older revision of, then, given a `base`, send every one the table
 * lacks (`onTable`, bare file names; the caller leaves out the table's older
 * copies, staleHubFiles) — so "sync to table" is the whole trip. A failed download skips that
 * pattern; being signed out or not a plan owner ends the run (`error`), as does
 * a failed send, since a busy table or a full card fails every file after it.
 * What already downloaded stays. `shouldStop` is checked between files.
 */
export function syncHub(patterns: HubPattern[], opts: SyncOpts): Promise<HubSyncResult> {
  const run = queue.then(() => runSync(patterns, opts))
  queue = run.catch(() => undefined)
  return run
}

interface SyncOpts {
  base?: string
  onTable?: Set<string>
  onProgress: (p: HubProgress) => void
  shouldStop: () => boolean
}

// iOS suspends the app seconds after it leaves the screen, which kills the
// file in flight. A sync can't run on while suspended (that would need native
// background transfers), so it PAUSES: a file that failed after the app left
// is sent again once the app is back, and the sync carries on from there.
// Coming back, the network isn't usable at once (the request in flight fails
// with "The network connection was lost", Wi-Fi rejoins, the table drops the
// broken upload), so it retries with growing waits, about a minute in all; a
// file that starts in that window and fails gets the same retries.
let leftAt = 0
let backAt = 0
AppState.addEventListener('change', (state) => {
  if (state !== 'active') leftAt = Date.now()
  else backAt = Date.now()
})
const RESUME_WAITS_MS = [2000, 4000, 8000, 15000, 30000]
const MANIFEST_EVERY = 25
const BACK_WINDOW_MS = 30000
const untilActive = () =>
  new Promise<void>((done) => {
    if (AppState.currentState === 'active') return done()
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return
      sub.remove()
      done()
    })
  })

/**
 * Run one file's transfer; when it fails because the app left the screen (or
 * just came back to it), wait for the app to be back and retry with growing waits.
 */
async function resumable(task: () => Promise<void>, stopped: () => boolean): Promise<void> {
  const startedAt = Date.now()
  for (let attempt = 0; ; attempt++) {
    try {
      return await task()
    } catch (e) {
      // Signed out / not a plan owner: no wait fixes those.
      if (e instanceof SignedOutError || e instanceof NotMemberError) throw e
      const away = leftAt >= startedAt || AppState.currentState !== 'active' || startedAt - backAt < BACK_WINDOW_MS
      if (!away || attempt >= RESUME_WAITS_MS.length) throw e
      await untilActive()
      await new Promise((r) => setTimeout(r, RESUME_WAITS_MS[attempt]))
      if (stopped()) throw e
    }
  }
}

// A table batch that may still be landing when the app comes back (iOS can
// finish a background upload after the app was killed; the result is lost):
// what was sent, so the next launch can tell which new files made it.
const PENDING_KEY = 'dw.hub.pendingTableSync'
interface PendingBatch {
  base: string
  items: { key: string; rev: string | null; existed: boolean }[]
  at: number
  /** The body's size, so a later launch knows how long the system may still be sending it. */
  bytes?: number
}

/**
 * After a batch that didn't report back (failed, stopped, or the app was gone):
 * re-read the table's list (the firmware lists a file once it's complete, and
 * deletes a partial one) and record the hub revision of every NEW file there.
 * An overwritten file can't be told from its old copy, so it stays stale and
 * the next sync sends it again. false = the table couldn't be read yet.
 */
async function reconcileBatch(pending: PendingBatch): Promise<boolean> {
  const lib = useLibrary.getState()
  if (lib.tableBase !== pending.base) return false
  try {
    await lib.loadTable(pending.base, true)
  } catch {
    return false
  }
  const on = new Set(useLibrary.getState().tablePatterns.map((n) => bareName(n).toLowerCase()))
  const revs: Record<string, string | null> = {}
  for (const it of pending.items) if (!it.existed && on.has(it.key.toLowerCase())) revs[it.key] = it.rev
  if (Object.keys(revs).length) useBoards.getState().setHubSent(pending.base, revs)
  return true
}

// Whether iOS's background session may still be sending a batch an earlier run of the app
// started (the app was purged mid-sync, then opened again). ponytail: bounded at a slow
// 40 KB/s (DWG does ~150); the system's task isn't reattached, so there's no byte count.
const maybeSending = (p: PendingBatch): boolean => Date.now() - p.at < 120_000 + (p.bytes ?? 0) / 40

let settling = false

/** At launch / foreground: settle a batch the app didn't see finish. */
export async function settlePendingTableSync(): Promise<void> {
  // This run is sending it (its own catch settles it), or already settling.
  if (settling || useHubSync.getState().receiving) return
  settling = true
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY).catch(() => null)
    if (!raw) return
    const pending = JSON.parse(raw) as PendingBatch
    if (maybeSending(pending)) await waitOutBatch(pending)
    if (Date.now() - pending.at > 7 * 24 * 3600 * 1000 || (await reconcileBatch(pending))) {
      await AsyncStorage.removeItem(PENDING_KEY).catch(() => undefined)
    }
  } finally {
    settling = false
  }
}

// While the table doesn't answer, it's taking that batch: show it receiving, never
// offline, and check every 20 s (one request at a time, past the gate).
async function waitOutBatch(pending: PendingBatch): Promise<void> {
  useStatus.getState().holdForSync(true)
  setTableReceiving(pending.base)
  useHubSync.setState({ receiving: pending.base, running: true })
  try {
    while (maybeSending(pending) && !(await tableAnswers(pending.base, 8000))) {
      useHubSync.setState({
        progress: { stage: 'table', index: 0, total: pending.items.length, title: '', fraction: 0, eta: null, since: pending.at },
      })
      await new Promise((r) => setTimeout(r, 20000))
    }
  } finally {
    setTableReceiving(null)
    useHubSync.setState({ receiving: null, running: false, progress: null })
    useStatus.getState().holdForSync(false)
  }
}

// The table stage as one upload that carries on in the background (lib/tableBatch.ts).
async function batchToTable(base: string, toTable: HubPattern[], opts: SyncOpts, result: HubSyncResult): Promise<HubSyncResult> {
  assertSdIdle()
  const lib = useLibrary.getState()
  const files: (BatchFile & { p: HubPattern })[] = []
  for (const p of toTable) {
    const key = bareName(p.name)
    const resolved = await lib.resolveThr(key)
    if (resolved) files.push({ key, uri: resolved.uri, p })
  }
  if (!files.length) return result
  const boundary = `dwsync${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  // Written a file at a time, yielding between them, so the progress shows and the
  // app stays responsive (a sync of the whole hub is over 100 MB).
  const total = files.reduce((n, f) => n + Math.max(1, f.p.bytes), 0)
  let written = 0
  const { body, ends, size } = await writeBatchBody(files, boundary, (i) => {
    opts.onProgress({ stage: 'prepare', index: i + 1, total: files.length, title: files[i].p.title, fraction: written / total })
    written += Math.max(1, files[i].p.bytes)
  })
  const pending: PendingBatch = {
    base,
    items: files.map((f) => ({
      key: f.key,
      rev: useLibrary.getState().patterns.find((e) => e.name === f.key)?.hubRev ?? null,
      existed: !!opts.onTable?.has(f.p.name),
    })),
    at: Date.now(),
    bytes: size,
  }
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(pending)).catch(() => undefined)
  const abort = new AbortController()
  const watch = setInterval(() => opts.shouldStop() && abort.abort(), 500)
  // The table's single-threaded server is busy with this request throughout.
  useStatus.getState().holdForSync(true)
  setTableReceiving(base)
  useHubSync.setState({ receiving: base })
  try {
    opts.onProgress({ stage: 'table', index: 1, total: files.length, title: files[0].p.title, fraction: 0 })
    await sendBatch(
      base,
      body,
      boundary,
      (sent) => {
        const i = partAt(ends, sent)
        opts.onProgress({ stage: 'table', index: i + 1, total: files.length, title: files[i].p.title, fraction: sent / size })
      },
      abort.signal,
    )
    // Every file landed (the firmware added each to /patterns/index.json itself).
    const revs: Record<string, string | null> = {}
    for (const [i, f] of files.entries()) {
      revs[f.key] = pending.items[i].rev
      if (useLibrary.getState().tableBase === base) useLibrary.getState().addTablePattern(f.key)
    }
    useBoards.getState().setHubSent(base, revs)
    await AsyncStorage.removeItem(PENDING_KEY).catch(() => undefined)
    return { ...result, toTable: files.length }
  } catch (e) {
    setTableReceiving(null)
    useHubSync.setState({ receiving: null })
    useStatus.getState().holdForSync(false)
    if (await reconcileBatch(pending)) await AsyncStorage.removeItem(PENDING_KEY).catch(() => undefined)
    const sent = pending.items.filter((it, i) => !it.existed && useLibrary.getState().tablePatterns.some((n) => bareName(n) === files[i].key)).length
    return abort.signal.aborted ? { ...result, toTable: sent, stopped: true } : { ...result, toTable: sent, error: e }
  } finally {
    clearInterval(watch)
    setTableReceiving(null)
    useHubSync.setState({ receiving: null })
    useStatus.getState().holdForSync(false)
    try {
      body.delete()
    } catch {
      // the cache folder is the OS's to clear
    }
  }
}

async function runSync(patterns: HubPattern[], opts: SyncOpts): Promise<HubSyncResult> {
  const result: HubSyncResult = { toPhone: 0, toTable: 0, failed: [], stopped: false }
  const weight = (list: HubPattern[]) => list.reduce((n, p) => n + Math.max(1, p.bytes), 0)
  void activateKeepAwakeAsync(KEEP_AWAKE_TAG)
  // A sync to the table holds Android's foreground service (lib/syncService.ts), whose
  // notification follows the progress; the auto-download (phone only) doesn't.
  if (opts.base) {
    await startSyncService(`Syncing ${patterns.length} patterns`)
    const report = opts.onProgress
    opts = {
      ...opts,
      onProgress: (p) => {
        report(p)
        updateSyncService(`${stageLabel(p.stage)} ${p.index} of ${p.total} · ${p.title}`, p.fraction)
      },
    }
  }
  try {
    const lib = useLibrary.getState()
    const older = staleHubFiles(patterns, lib.patterns).phone
    const toPhone = patterns.filter((p) => !lib.has(p.name) || older.has(p.name))
    const phoneTotal = weight(toPhone)
    let done = 0
    for (const [i, p] of toPhone.entries()) {
      if (opts.shouldStop()) return { ...result, stopped: true }
      opts.onProgress({ stage: 'phone', index: i + 1, total: toPhone.length, title: p.title, fraction: done / phoneTotal })
      try {
        await resumable(() => saveToPhone(p), opts.shouldStop)
        result.toPhone++
      } catch (e) {
        // Every file after this one would be refused the same way.
        if (e instanceof SignedOutError || e instanceof NotMemberError) return { ...result, error: e }
        result.failed.push(p.title)
        result.failedError ??= e
        log.warn('hub', `${p.title} didn't download: ${e instanceof Error ? e.message : String(e)}`)
      }
      done += Math.max(1, p.bytes)
    }

    const base = opts.base
    if (!base) return result
    const toTable = patterns.filter((p) => !opts.onTable?.has(p.name) && useLibrary.getState().has(p.name))
    if (supportsBatchUpload(useStatus.getState().status?.fw, base)) return await batchToTable(base, toTable, opts, result)
    const tableTotal = weight(toTable)
    done = 0
    // The card's catalog (/patterns/index.json) gets the sent files in one write
    // every MANIFEST_EVERY files and at the end, stopped or not: once per file was
    // a read and a rewrite of a ~20 KB file each time (~2 s a pattern on a DW Gold).
    let unlisted: string[] = []
    const flush = async () => {
      if (!unlisted.length) return
      const names = unlisted
      unlisted = []
      await resumable(() => updateTableManifest(base, { add: names }, { strict: true }), () => false).catch((e: unknown) =>
        log.warn('hub', `The table's pattern list (index.json) didn't get ${names.length} sent patterns: ${e instanceof Error ? e.message : String(e)}`),
      )
    }
    try {
      for (const [i, p] of toTable.entries()) {
        if (opts.shouldStop()) return { ...result, stopped: true }
        const at = (f: number) =>
          opts.onProgress({ stage: 'table', index: i + 1, total: toTable.length, title: p.title, fraction: (done + f * Math.max(1, p.bytes)) / tableTotal })
        at(0)
        try {
          await resumable(() => pushToTable(base, p.name, at, { manifest: false }), opts.shouldStop)
        } catch (e) {
          return { ...result, error: e }
        }
        unlisted.push(bareName(p.name))
        if (useLibrary.getState().tableBase === base) useLibrary.getState().addTablePattern(bareName(p.name))
        result.toTable++
        done += Math.max(1, p.bytes)
        if (unlisted.length >= MANIFEST_EVERY) await flush()
      }
      return result
    } finally {
      await flush()
    }
  } finally {
    void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined)
    stopSyncService()
  }
}

const AUTO_EVERY_MS = 60 * 60 * 1000
let autoAt = 0
let autoRunning = false

/**
 * Keeps the phone's hub patterns current, for plan owners (anyone else would be
 * refused): every UPDATED one the phone holds (staleHubFiles, every version) is
 * downloaded again, always — the owner wants updates picked up. With the
 * auto-download on (usePrefs.hubAuto) every hub pattern this phone hasn't seen
 * yet goes into the library too. Switching it on marks the catalog of the day
 * as seen, so it fetches only patterns published after that. Phone only, never the table: the owner ruled
 * out the app touching the card on its own (see preview sync), and a send holds
 * the SD card and the status poller for minutes; Sync to table sends updates.
 * A pattern counts as seen once it's on the phone, so a failed download is
 * retried next time and one deleted from the phone stays deleted.
 */
async function autoSync(force: boolean): Promise<void> {
  if (autoRunning || useHubAccount.getState().state !== 'member' || (!force && Date.now() - autoAt < AUTO_EVERY_MS)) return
  autoRunning = true
  try {
    const all = (await fetchHubCatalog()).patterns
    autoAt = Date.now()
    const older = staleHubFiles(all, useLibrary.getState().patterns).phone
    const updates = all.flatMap((p) => p.versions.filter((v) => older.has(v.name)).map((v) => ({ ...p, ...v })))
    // Each new pattern in the version for the table in use now.
    const seen = new Set(usePrefs.getState().hubSeen)
    const auto = usePrefs.getState().hubAuto
    const fresh = auto ? forTable(all, useBoards.getState().getActive()).filter((p) => !seen.has(p.id)) : []
    if (!fresh.length && !updates.length) return
    // Switching the auto-download off stops a run of new ones, not the updates.
    const r = await syncHub([...updates, ...fresh], { onProgress: () => undefined, shouldStop: () => !!fresh.length && !usePrefs.getState().hubAuto })
    const lib = useLibrary.getState()
    if (fresh.length) usePrefs.getState().setHubSeen([...seen, ...fresh.filter((p) => lib.has(p.name)).map((p) => p.id)])
    const still = staleHubFiles(all, lib.patterns).phone
    const updated = updates.filter((v) => !still.has(v.name)).length
    const added = r.toPhone - updated
    if (added > 0) toast.info(`Downloaded ${added} new pattern${added === 1 ? '' : 's'} from the Pattern Hub`)
    if (updated) toast.info(`Updated ${updated} pattern${updated === 1 ? '' : 's'} from the Pattern Hub`)
    if (r.failed.length) log.warn('hub', `Auto-download: ${r.failed.length} didn't download`)
    if (r.error) log.warn('hub', `Auto-download: ${r.error instanceof Error ? r.error.message : String(r.error)}`)
  } catch (e) {
    log.warn('hub', `Auto-download: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    autoRunning = false
  }
}

/**
 * Mounted once in App.tsx. Runs autoSync (updates always, new patterns when the
 * auto-download is on) for a plan owner, at launch, on switching the
 * auto-download on, and on return to the foreground (at most hourly). Waits for
 * the library to load, or everything already on the phone would look missing.
 */
/** A table batch the app didn't see finish is settled at launch and on each return to the app. */
export function useSettlePendingTableSync(): void {
  const tableBase = useLibrary((s) => s.tableBase)
  useEffect(() => {
    void settlePendingTableSync()
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void settlePendingTableSync()
    })
    return () => sub.remove()
  }, [tableBase])
}

export function useHubAutoSync(): void {
  const on = usePrefs((s) => s.hubAuto)
  const ready = useLibrary((s) => s.hydrated)
  const member = useHubAccount((s) => s.state === 'member')
  useEffect(() => {
    if (!ready || !member) return
    void autoSync(true)
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void autoSync(false)
    })
    return () => sub.remove()
  }, [on, ready, member])
}
