import * as DocumentPicker from 'expo-document-picker'
import { File, Directory, Paths } from 'expo-file-system'
import { previewKey } from '../stores/usePreviews'

export interface PreviewIngestResult {
  entries: { key: string; uri: string }[] // saved previews, keyed by previewKey
  failed: string[] // filenames we couldn't key or copy (skipped)
}

const IMG_EXT = /\.(webp|png|jpe?g)$/i

/** Keep on-disk filenames flat/safe (names may contain spaces/parens). */
function safe(s: string): string {
  return s.replace(/[^\w.-]+/g, '_')
}

/**
 * Let the user pick one or many preview images (webp/png/jpg). Each is keyed to
 * its pattern by NAME (see previewKey) and copied full-quality into the app's
 * document storage so it survives relaunches. Files with an unrecognizable name
 * are skipped and reported. Returns null only if the user cancels the picker.
 *
 * These mirror the bundled dw previews (black ink on transparent) and get tinted
 * to the theme like them — so import the cached_images-style exports, not full
 * colour screenshots.
 */
export async function importPreviews(): Promise<PreviewIngestResult | null> {
  const res = await DocumentPicker.getDocumentAsync({
    type: ['image/*'],
    copyToCacheDirectory: true,
    multiple: true,
  })
  if (res.canceled || !res.assets || res.assets.length === 0) return null

  const dir = new Directory(Paths.document, 'userPreviews')
  if (!dir.exists) dir.create({ intermediates: true })

  const entries: { key: string; uri: string }[] = []
  const failed: string[] = []
  for (const asset of res.assets) {
    const rawName = asset.name || ''
    const key = previewKey(rawName)
    const ext = (rawName.match(IMG_EXT)?.[1] || 'webp').toLowerCase()
    if (!key) {
      failed.push(rawName || 'unknown')
      continue
    }
    try {
      const dest = new File(dir, `${safe(key)}.${ext}`)
      if (dest.exists) dest.delete()
      new File(asset.uri).copy(dest)
      entries.push({ key, uri: dest.uri })
    } catch {
      failed.push(rawName || 'unknown')
    }
  }
  return { entries, failed }
}
