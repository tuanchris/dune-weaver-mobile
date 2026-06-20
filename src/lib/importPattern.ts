import * as DocumentPicker from 'expo-document-picker'
import { File, Directory, Paths } from 'expo-file-system'
// @ts-ignore - shared plain-ESM module (Metro resolves .mjs; allowJs covers TS)
import { parseThr, toXY, decimateThrText, MAX_POINTS } from './thrGeometry.mjs'
import type { Point } from '../stores/useLibrary'
import { bareName } from '../stores/useLibrary'

export interface ImportedThr {
  name: string // "X.thr"
  xy: Point[] // decimated geometry for preview
  thrUri: string // saved decimated .thr in the document dir
  sizeBytes: number
}

/**
 * Let the user pick a .thr file, validate + decimate it, save the decimated
 * copy to the app's document storage, and return its geometry for preview.
 * Returns null if the user cancels. Throws on an invalid file.
 */
export async function importThr(): Promise<ImportedThr | null> {
  // .thr has no standard MIME type, so accept anything and validate by content.
  const res = await DocumentPicker.getDocumentAsync({
    type: ['*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  })
  if (res.canceled || !res.assets || res.assets.length === 0) return null

  const asset = res.assets[0]
  let name = bareName(asset.name || 'pattern.thr')
  if (!/\.thr$/i.test(name)) name = `${name}.thr`

  const text = await new File(asset.uri).text()
  if (parseThr(text).length === 0) {
    throw new Error('Not a valid .thr file (no theta-rho points)')
  }

  const decimated = decimateThrText(text, MAX_POINTS)

  const dir = new Directory(Paths.document, 'thr')
  if (!dir.exists) dir.create({ intermediates: true })
  const dest = new File(dir, name)
  if (dest.exists) dest.delete()
  dest.write(decimated)

  const xy = toXY(parseThr(decimated)) as Point[]
  return { name, xy, thrUri: dest.uri, sizeBytes: dest.size }
}
