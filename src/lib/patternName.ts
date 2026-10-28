/** A pattern file's extension: .thr (round tables) or G-code (rectangular). */
export const PATTERN_EXT = /\.(thr|gcode|gc|nc)$/i

/**
 * Display label for a pattern reference: strip the pattern extension and any folder
 * prefix (e.g. "custom_patterns/sea_star.thr" -> "sea_star"). Used wherever a
 * pattern filename is shown to the user (Browse, Playlists, Now Playing).
 */
export function prettyName(file: string | null | undefined): string {
  if (!file) return ''
  return file.replace(PATTERN_EXT, '').split('/').pop() ?? file
}
