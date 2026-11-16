import { File } from 'expo-file-system'
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake'
import { board } from '../api/board'
import { useLibrary, bareName } from '../stores/useLibrary'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { assertSdIdle } from './sd'
import { updateTableManifest } from './tableManifest'

/**
 * Push a locally-held pattern (bundled default or imported) to a board's SD
 * card at /patterns/<name>. Resolves the local .thr (full-resolution for
 * imports), reads its text, and uploads it. .thr is plain text, so we send it
 * via the hand-built multipart path (board.uploadTextFile) — RN's FormData
 * file-uri part throws "unsupported formdata part" on this RN version.
 * Throws if the pattern isn't available locally, the table is running (no SD
 * access mid-job), or the upload fails.
 */
/** Screen stays on while a file goes to the table: a locked phone suspends the app mid-upload. */
const KEEP_AWAKE_TAG = 'dw-push'

/** `manifest: false` leaves /patterns/index.json to the caller: a hub sync adds all its files in one write (tableManifest.ts). */
export async function pushToTable(base: string, name: string, onProgress?: (fraction: number) => void, { manifest = true } = {}): Promise<void> {
  assertSdIdle()
  const key = bareName(name)
  const resolved = await useLibrary.getState().resolveThr(key)
  if (!resolved) throw new Error('Pattern not available locally')
  const text = await new File(resolved.uri).text()
  // Suspend the 1s status poller for the transfer — the board's web server is
  // single-threaded, so polls queue against (and slow) a multi-MB upload.
  const { suspend, resume } = useStatus.getState()
  suspend()
  void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined)
  try {
    await board.uploadTextFile(base, `/patterns/${key}`, text, undefined, onProgress)
    // Which hub revision the table now holds (none for anything else), so an
    // updated hub pattern is sent again (lib/patternHub.ts).
    const hubRev = useLibrary.getState().patterns.find((p) => p.name === key)?.hubRev ?? null
    useBoards.getState().setHubSent(base, { [key]: hubRev })
    // Keep the on-card catalog in step, or the pushed pattern disappears
    // from the on-table list after the next manifest read (best-effort).
    if (manifest) await updateTableManifest(base, { add: key })
  } finally {
    resume()
    void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined)
  }
}
