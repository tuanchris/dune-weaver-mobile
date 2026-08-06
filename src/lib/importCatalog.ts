import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'

export interface CatalogImportResult {
  /** Raw pattern references from the file (the store normalizes via patternKey). */
  keys: string[]
}

/**
 * Let the user pick the table's pattern catalog file and parse it into a list
 * of pattern references. This is the offline alternative to fetching
 * /sand_patterns from the board — useful when Wi-Fi is weak and re-reading the
 * catalog is expensive.
 *
 * The card's catalog is /patterns/index.json: a JSON array of pattern paths
 * (e.g. ["star.thr", "custom_patterns/x.thr"]). We also accept a saved
 * /sand_patterns response (same shape) and a wrapper object {patterns:[...]},
 * so a hand-exported file works either way.
 *
 * Returns null if the user cancels. Throws a friendly Error on an unreadable or
 * malformed file so the caller can surface it.
 */
export async function importCatalog(): Promise<CatalogImportResult | null> {
  const res = await DocumentPicker.getDocumentAsync({
    // index.json often has no registered UTI, so allow any file and validate.
    type: ['application/json', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  })
  if (res.canceled || !res.assets?.length) return null

  const asset = res.assets[0]
  let text: string
  try {
    text = await new File(asset.uri).text()
  } catch {
    throw new Error("Couldn't read that file.")
  }

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error("That file isn't valid JSON — pick the card's index.json.")
  }

  // Accept a bare array, or a { patterns: [...] } wrapper.
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { patterns?: unknown })?.patterns)
      ? (data as { patterns: unknown[] }).patterns
      : null
  if (!list) {
    throw new Error("That doesn't look like a pattern catalog (expected a list of patterns).")
  }

  const keys = list.filter((e): e is string => typeof e === 'string' && e.trim().length > 0)
  if (keys.length === 0) {
    throw new Error('No patterns found in that file.')
  }
  return { keys }
}
