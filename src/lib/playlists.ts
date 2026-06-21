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

/** Delete a playlist file from the board. */
export async function deletePlaylist(base: string, filename: string): Promise<void> {
  assertSdIdle()
  await board.deleteSdFile(base, DIR, filename)
}
