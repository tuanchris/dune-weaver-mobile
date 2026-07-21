import { board } from '../api/board'
import { patternKey } from '../stores/useLibrary'
import { assertSdIdle } from './sd'

const DIR = '/playlists/'

/** Display name for a playlist file ("Evening.txt" -> "Evening"). */
export function playlistName(filename: string): string {
  return filename.replace(/\.txt$/i, '')
}

function fileName(name: string): string {
  const base = playlistName(name.trim())
  return `${base}.txt`
}

/**
 * Parse playlist text into pattern keys relative to /patterns (e.g. "star.thr"
 * or "custom_patterns/x.thr"). Keeping the subfolder is what lets nested custom
 * patterns resolve their bundled preview.
 */
export function parsePlaylist(text: string): string[] {
  const items: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    let line = raw
    const hash = line.indexOf('#')
    if (hash >= 0) line = line.slice(0, hash)
    line = line.trim()
    if (!line) continue
    items.push(patternKey(line))
  }
  return items
}

/**
 * Fetch a playlist's pattern list from the board. NOT gated on motion — it's a
 * small read the firmware serves during playback (block-during-motion is off by
 * default), so "up next" works while a pattern is running.
 */
export async function loadPlaylist(base: string, filename: string): Promise<string[]> {
  const text = await board.playlistText(base, filename)
  return parsePlaylist(text)
}

/**
 * Create/overwrite a playlist on the board: upload the pattern list as a .txt to
 * /playlists/<name>.txt. Items are bare ".thr" names. The content is sent inline
 * (text multipart) — no temp file — see board.uploadTextFile.
 */
export async function savePlaylist(base: string, name: string, items: string[]): Promise<string> {
  assertSdIdle()
  const fname = fileName(name)
  const content = items.map((n) => `/patterns/${patternKey(n)}`).join('\n') + '\n'
  await board.uploadTextFile(base, `${DIR}${fname}`, content)
  return fname
}

export interface PlaylistCopyResult {
  filename: string
  /** Items written to the target. */
  kept: number
  /** Pattern keys dropped because the target table doesn't have the file. */
  dropped: string[]
}

/**
 * Copy a playlist to a DIFFERENT table, resolving every item against the
 * target's own pattern catalog (/sand_patterns — the manifest when the card
 * has one): an item whose key exists on the target verbatim keeps its path, an
 * item the target files under a different folder is re-pointed by FILE NAME,
 * and items the target doesn't have at all are dropped (nothing is pushed).
 * Matching is case-insensitive (FAT card), writing the target's own casing.
 * Refuses to write an empty playlist when nothing matches.
 *
 * Unlike savePlaylist this doesn't assert the active table is idle — the
 * target isn't the table we poll, and reads + this tiny write are served by
 * the firmware during playback.
 */
export async function copyPlaylistTo(targetBase: string, name: string, items: string[]): Promise<PlaylistCopyResult> {
  const targetList = await board.patterns(targetBase)
  const byKey = new Map<string, string>() // lowercased full key -> target key
  const byFile = new Map<string, string>() // lowercased bare filename -> target key
  for (const entry of targetList) {
    const key = patternKey(entry)
    if (!key) continue
    if (!byKey.has(key.toLowerCase())) byKey.set(key.toLowerCase(), key)
    const file = key.split('/').pop()!.toLowerCase()
    if (!byFile.has(file)) byFile.set(file, key)
  }

  const kept: string[] = []
  const dropped: string[] = []
  for (const item of items) {
    const key = patternKey(item)
    const hit = byKey.get(key.toLowerCase()) ?? byFile.get(key.split('/').pop()!.toLowerCase())
    if (hit) kept.push(hit)
    else dropped.push(key)
  }
  if (kept.length === 0) {
    throw new Error('none of its patterns are on that table')
  }

  const fname = fileName(name)
  const content = kept.map((n) => `/patterns/${n}`).join('\n') + '\n'
  await board.uploadTextFile(targetBase, `${DIR}${fname}`, content)
  return { filename: fname, kept: kept.length, dropped }
}

/** Delete a playlist file from the board. */
export async function deletePlaylist(base: string, filename: string): Promise<void> {
  assertSdIdle()
  await board.deleteSdFile(base, DIR, filename)
}
