import * as DocumentPicker from 'expo-document-picker'
import { File, Directory, Paths } from 'expo-file-system'
import { unzipSync } from 'fflate'
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
 * Let the user pick preview images (webp/png/jpg) AND/OR preview-bundle shard
 * zips (the STORE-mode .zip shards the SD Card Pattern Manager writes to
 * /patterns/previews/). Images and every image inside a zip are keyed to their
 * pattern by NAME (see previewKey) and copied full-quality into the app's
 * document storage so they survive relaunches. Importing shards directly is the
 * offline path: grab the bundle once and load it into every table's app without
 * pulling it slowly off each card. Unkeyable/undecodable items are skipped and
 * reported. Returns null only if the user cancels the picker.
 *
 * These mirror the bundled dw previews (black ink on transparent) and get tinted
 * to the theme like them — so import the cached_images-style exports, not full
 * colour screenshots.
 */
export async function importPreviews(): Promise<PreviewIngestResult | null> {
  const res = await DocumentPicker.getDocumentAsync({
    // image/* covers the individual exports; zip covers the bundle shards.
    type: ['image/*', 'application/zip'],
    copyToCacheDirectory: true,
    multiple: true,
  })
  if (res.canceled || !res.assets || res.assets.length === 0) return null

  const dir = new Directory(Paths.document, 'userPreviews')
  if (!dir.exists) dir.create({ intermediates: true })

  const entries: { key: string; uri: string }[] = []
  const failed: string[] = []

  /** Write raw image bytes under its previewKey; returns false if unkeyable. */
  const writeImage = (rawName: string, data: Uint8Array): boolean => {
    const key = previewKey(rawName)
    if (!key || data.length === 0) return false
    const ext = (rawName.match(IMG_EXT)?.[1] || 'webp').toLowerCase()
    const dest = new File(dir, `${safe(key)}.${ext}`)
    if (dest.exists) dest.delete()
    dest.write(data)
    entries.push({ key, uri: dest.uri })
    return true
  }

  for (const asset of res.assets) {
    const rawName = asset.name || ''
    try {
      // A .zip shard: unzip and ingest every image entry inside it.
      if (/\.zip$/i.test(rawName)) {
        const files = unzipSync(await new File(asset.uri).bytes())
        let any = false
        for (const [entryName, data] of Object.entries(files)) {
          if (!IMG_EXT.test(entryName)) continue
          if (writeImage(entryName, data)) any = true
        }
        if (!any) failed.push(rawName || 'unknown')
        continue
      }

      // A single image: copy it straight in (avoids a bytes round-trip).
      const key = previewKey(rawName)
      if (!key) {
        failed.push(rawName || 'unknown')
        continue
      }
      const ext = (rawName.match(IMG_EXT)?.[1] || 'webp').toLowerCase()
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
