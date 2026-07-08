/**
 * Display label for a pattern reference: strip the .thr extension and any folder
 * prefix (e.g. "custom_patterns/sea_star.thr" -> "sea_star"). Used wherever a
 * pattern filename is shown to the user (Browse, Playlists, Now Playing).
 */
export function prettyName(file: string | null | undefined): string {
  if (!file) return ''
  return file.replace(/\.thr$/i, '').split('/').pop() ?? file
}
