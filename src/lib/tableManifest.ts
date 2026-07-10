import { board } from '../api/board'
import { patternKey } from '../stores/useLibrary'

/**
 * Keep the on-card pattern catalog (/patterns/index.json) in step with app
 * pushes and deletes. The firmware serves that file VERBATIM from
 * /sand_patterns when it exists, so a push that doesn't update it produces a
 * pattern that vanishes from the app after the next cold start (the
 * optimistic in-memory update doesn't survive a manifest re-read).
 *
 * Rules that keep this safe:
 * - Only ever MODIFY an existing manifest. If the card has none, the
 *   firmware live-lists /patterns and finds the pushed file anyway —
 *   creating a manifest here (with only what we know about) would hide
 *   every other pattern on the card.
 * - If the manifest can't be read or parsed, write nothing.
 * - Existing entries are preserved byte-for-byte (they may carry path
 *   prefixes from other tools); membership tests compare normalized keys.
 */

/** Apply an add/remove to manifest entries; null → no write needed. */
export function applyManifestChange(
  entries: unknown,
  change: { add?: string; remove?: string }
): string[] | null {
  if (!Array.isArray(entries)) return null
  const keys = entries.filter((e): e is string => typeof e === 'string')

  if (change.add) {
    const addKey = patternKey(change.add)
    if (keys.some((e) => patternKey(e) === addKey)) return null
    return [...keys, addKey]
  }
  if (change.remove) {
    const removeKey = patternKey(change.remove)
    const next = keys.filter((e) => patternKey(e) !== removeKey)
    return next.length === keys.length ? null : next
  }
  return null
}

/**
 * Best-effort read-modify-write of the card's catalog after a push/delete.
 * `name` is the pattern's key relative to /patterns (e.g. "star.thr" or
 * "custom_patterns/x.thr"). Never throws — a failed catalog update must not
 * fail the push/delete that already succeeded; the SD Card Pattern Manager
 * can always reconcile drift later.
 */
export async function updateTableManifest(
  base: string,
  change: { add?: string; remove?: string }
): Promise<void> {
  let text: string
  try {
    text = await board.patternManifest(base)
  } catch {
    // No manifest on the card (404) or unreachable — nothing to maintain.
    return
  }

  let next: string[] | null
  try {
    next = applyManifestChange(JSON.parse(text), change)
  } catch {
    return // unparseable — don't clobber whatever is there
  }
  if (!next) return

  try {
    await board.uploadTextFile(base, '/patterns/index.json', JSON.stringify(next))
  } catch (e) {
    console.warn('Could not update the on-card pattern catalog', e)
  }
}
