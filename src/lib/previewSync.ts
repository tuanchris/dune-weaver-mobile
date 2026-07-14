import { useEffect, useRef, useState } from 'react'
import { Directory, File, Paths } from 'expo-file-system'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { unzipSync } from 'fflate'
import { board } from '../api/board'
import { usePreviews, previewKey } from '../stores/usePreviews'
import { useStatus } from '../stores/useStatus'
import { isBusy } from '../api/status'
import { isSdBusy } from './sd'

/** Tag for the keep-awake lock held while shards stream (screen off would
 * suspend the transfer and leave a half-fetched bundle). */
const KEEP_AWAKE_TAG = 'dw-preview-sync'

/**
 * Sync preview thumbnails from the table's SD card. The SD Card Pattern
 * Manager (duneweaver.com/install → Pattern manager) renders a webp preview
 * per pattern and packs them into a few STORE-mode zip shards at
 * /patterns/previews/, described by a tiny previews.json sidecar carrying a
 * content hash per shard. We poll the sidecar (cheap), fetch only shards
 * whose hash we haven't ingested, unzip locally, and register every image in
 * usePreviews — the same store manual preview imports land in. This covers
 * the patterns the app has no local .thr for (bulk-loaded straight onto the
 * card), which neither the bundled previews nor <PreviewGenerator/> can.
 *
 * Serial-cost profile: steady state is one ~1 KB JSON read per app session;
 * a changed shard is one sequential file stream (the board's best case).
 * Everything is gated on the table being idle — SD reads mid-job risk
 * stalling the running pattern.
 */

interface ShardInfo {
  name: string
  hash: string
  bytes: number
  entries: number
}

interface PreviewSidecar {
  version: number
  shardCount: number
  previewCount: number
  shards: ShardInfo[]
}

export interface PreviewSyncResult {
  /**
   * ok — sidecar read fine (fetched counts say what changed);
   * no-bundle — the card has no preview bundle (or the table is unreachable);
   * busy — the table is mid-pattern, no SD access.
   */
  status: 'ok' | 'no-bundle' | 'busy'
  shardsFetched: number
  imagesIngested: number
}

/** Step-by-step reporting so the UI can show what the sync is doing. */
export type PreviewSyncProgress =
  | { stage: 'checking' }
  | { stage: 'downloading'; shard: number; totalShards: number; bytes: number }
  | { stage: 'saving'; shard: number; totalShards: number; images: number }

/** Keep on-disk filenames flat/safe (names may contain spaces/parens). */
function safe(s: string): string {
  return s.replace(/[^\w.-]+/g, '_')
}

function isSidecar(data: unknown): data is PreviewSidecar {
  const d = data as PreviewSidecar
  return (
    !!d &&
    d.version === 1 &&
    Array.isArray(d.shards) &&
    d.shards.every(
      (s) => typeof s?.name === 'string' && typeof s?.hash === 'string'
    )
  )
}

/** Timeout scaled to the shard size (~25 KB/s floor, like uploads). */
const shardTimeout = (bytes: number): number =>
  30000 + Math.round((bytes || 0) / 25)

/**
 * One sync pass against the active table. Quiet no-op when the card has no
 * bundle, the table is busy, or everything is already ingested. Never
 * throws.
 */
export async function syncPreviewBundle(
  base: string,
  onProgress?: (p: PreviewSyncProgress) => void
): Promise<PreviewSyncResult> {
  const result: PreviewSyncResult = { status: 'ok', shardsFetched: 0, imagesIngested: 0 }
  if (isSdBusy()) return { ...result, status: 'busy' }

  onProgress?.({ stage: 'checking' })
  let sidecar: unknown
  try {
    sidecar = await board.previewSidecar(base)
  } catch {
    return { ...result, status: 'no-bundle' } // 404 or table unreachable
  }
  if (!isSidecar(sidecar)) return { ...result, status: 'no-bundle' }

  const dir = new Directory(Paths.document, 'userPreviews')
  // Dedup by shard CONTENT hash, not shard name: two tables carrying the same
  // patterns produce byte-identical bundles, so switching tables re-fetches
  // nothing. (Keying by name would collide "shard-0" across tables and force a
  // full re-download each switch even though the images are already ingested.)
  const changed = sidecar.shards.filter((s) => !usePreviews.getState().hasShard(s.hash))
  if (changed.length === 0) return result // nothing to fetch; no lock, no keep-awake

  // Claim exclusive SD time for the streaming phase: mark syncing (motion
  // start is blocked while set) and keep the screen awake (a screen-off
  // suspend would abandon a half-fetched shard). Both released in finally.
  const { setSyncing } = usePreviews.getState()
  setSyncing(true)
  void activateKeepAwakeAsync(KEEP_AWAKE_TAG)
  try {
    for (let i = 0; i < changed.length; i++) {
      const shard = changed[i]
      const { addMany, markShard } = usePreviews.getState()
      // The table may have started a pattern mid-sync — stop politely and
      // pick the remaining shards up next session.
      if (isSdBusy()) break

      // Nothing to ingest from an empty shard; just record it as seen.
      if (!shard.entries) {
        markShard(shard.hash)
        continue
      }

      try {
        onProgress?.({
          stage: 'downloading',
          shard: i + 1,
          totalShards: changed.length,
          bytes: shard.bytes,
        })
        const bytes = await board.previewShard(base, shard.name, shardTimeout(shard.bytes))
        const files = unzipSync(bytes)
        if (!dir.exists) dir.create({ intermediates: true })
        const entries: { key: string; uri: string }[] = []
        for (const [entryName, data] of Object.entries(files)) {
          if (!entryName.toLowerCase().endsWith('.webp') || data.length === 0) continue
          const key = previewKey(entryName)
          if (!key) continue
          const dest = new File(dir, `${safe(key)}.webp`)
          if (dest.exists) dest.delete()
          dest.write(data)
          entries.push({ key, uri: dest.uri })
        }
        addMany(entries)
        markShard(shard.hash)
        result.shardsFetched++
        result.imagesIngested += entries.length
        onProgress?.({
          stage: 'saving',
          shard: i + 1,
          totalShards: changed.length,
          images: result.imagesIngested,
        })
      } catch (e) {
        // Failed shard: hash stays unrecorded, so the next pass retries it.
        console.warn(`Preview shard sync failed (${shard.name})`, e)
      }
    }
  } finally {
    void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined)
    setSyncing(false)
  }
  return result
}

/** Auto-sync retry cap for a contended/unreachable table (see below). */
const MAX_SYNC_ATTEMPTS = 4
const RETRY_DELAY_MS = 45000

/**
 * Kick a preview-bundle sync once per table per app session, as soon as the
 * active table is reachable and idle. Cheap when there's nothing to do (one
 * small JSON read), so once a session is plenty — a fresh bundle written
 * while the app runs is picked up on the next launch or table switch.
 *
 * A table is only marked done once the sidecar actually READ ('ok'). A 'busy'
 * or 'no-bundle' result (the latter also covers a timed-out sidecar fetch when
 * the board's single-threaded server is momentarily saturated by the status
 * poller) is retried a few times — otherwise a single contended first attempt
 * would leave a bundle-carrying table with no previews for the whole session.
 */
export function usePreviewSync(base: string | null): void {
  const done = useRef<Set<string>>(new Set())
  const attempts = useRef<Record<string, number>>({})
  const [tick, setTick] = useState(0)
  const idle = useStatus((s) => (s.status ? !isBusy(s.status) : false))
  const hydrated = usePreviews((s) => s.hydrated)

  useEffect(() => {
    if (!base || !idle || !hydrated) return
    if (done.current.has(base)) return
    let cancelled = false
    void (async () => {
      const res = await syncPreviewBundle(base)
      if (cancelled) return
      if (res.status === 'ok') {
        done.current.add(base) // clean sidecar read — nothing more to do this session
        return
      }
      // busy / no-bundle: possibly transient (contended or mid-pattern). Retry a
      // bounded number of times before giving up so we don't hammer a card that
      // genuinely has no bundle.
      const n = (attempts.current[base] ?? 0) + 1
      attempts.current[base] = n
      if (n >= MAX_SYNC_ATTEMPTS) {
        done.current.add(base)
        return
      }
      setTimeout(() => {
        if (!cancelled) setTick((t) => t + 1) // re-run the effect to try again
      }, RETRY_DELAY_MS)
    })()
    return () => {
      cancelled = true
    }
  }, [base, idle, hydrated, tick])
}
