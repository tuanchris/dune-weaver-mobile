import { board } from '../api/board'
import { useLibrary, bareName } from '../stores/useLibrary'
import { assertSdIdle } from './sd'

/**
 * Push a locally-held pattern (bundled default or imported) to a board's SD
 * card at /patterns/<name>. Resolves the local decimated .thr to a file uri +
 * size, then uploads it. Throws if the pattern isn't available locally, the
 * table is running (no SD access mid-job), or the upload fails.
 */
export async function pushToTable(base: string, name: string): Promise<void> {
  assertSdIdle()
  const key = bareName(name)
  const resolved = await useLibrary.getState().resolveThr(key)
  if (!resolved) throw new Error('Pattern not available locally')
  await board.uploadFile(base, resolved.uri, `/patterns/${key}`, resolved.size)
}
