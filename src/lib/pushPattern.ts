import { File } from 'expo-file-system'
import { board } from '../api/board'
import { useLibrary, bareName } from '../stores/useLibrary'
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
export async function pushToTable(base: string, name: string, onProgress?: (fraction: number) => void): Promise<void> {
  assertSdIdle()
  const key = bareName(name)
  const resolved = await useLibrary.getState().resolveThr(key)
  if (!resolved) throw new Error('Pattern not available locally')
  const text = await new File(resolved.uri).text()
  // Suspend the 1s status poller for the transfer — the board's web server is
  // single-threaded, so polls queue against (and slow) a multi-MB upload.
  const { suspend, resume } = useStatus.getState()
  suspend()
  try {
    await board.uploadTextFile(base, `/patterns/${key}`, text, undefined, onProgress)
    // Keep the on-card catalog in step, or the pushed pattern disappears
    // from the on-table list after the next manifest read (best-effort).
    await updateTableManifest(base, { add: key })
  } finally {
    resume()
  }
}
