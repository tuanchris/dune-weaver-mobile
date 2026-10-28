import * as DocumentPicker from 'expo-document-picker'
import { File, Directory, Paths } from 'expo-file-system'
// @ts-ignore - shared plain-ESM module (Metro resolves .mjs; allowJs covers TS)
import { thrToXY } from './thrGeometry.mjs'
import { isGcode, parseGcode } from './gcode'
import type { Point } from '../stores/useLibrary'
import { bareName } from '../stores/useLibrary'

export interface ImportedThr {
  name: string // "X.thr"
  xy: Point[] // decimated geometry for on-screen preview (NOT what we store/push)
  thrUri: string // saved FULL-resolution .thr in the document dir
  sizeBytes: number
}

export interface ImportResult {
  imported: ImportedThr[]
  failed: string[] // filenames that weren't valid .thr (skipped)
}

/**
 * Validate one picked file, save the FULL-resolution copy to the app's document
 * storage (this exact copy is what gets pushed to the table — no decimation, so
 * the board runs every original point), and derive a decimated copy of its
 * geometry for fast on-screen preview only. Throws on an invalid file.
 */
async function processThr(uri: string, rawName: string, rect: boolean): Promise<ImportedThr> {
  // A rectangular table plays G-code; a round one plays .thr. Each kind is
  // validated by content, so the other kind (or anything else) fails here.
  let name = bareName(rawName || 'pattern')
  if (rect ? !isGcode(name) : !/\.thr$/i.test(name)) name = `${name}${rect ? '.gcode' : '.thr'}`

  const text = await new File(uri).text()
  const xy = (rect ? parseGcode(text) : thrToXY(text)) as Point[]
  if (xy.length === 0) throw new Error(`not a valid ${rect ? 'G-code' : '.thr'} file`)

  // Store the file verbatim, full-resolution.
  const dir = new Directory(Paths.document, 'thr')
  if (!dir.exists) dir.create({ intermediates: true })
  const dest = new File(dir, name)
  if (dest.exists) dest.delete()
  dest.write(text)

  // Geometry is decimated for RENDERING only (a multi-hundred-thousand-point SVG
  // path would be unusable); the stored/pushed file stays full-res.
  return { name, xy, thrUri: dest.uri, sizeBytes: dest.size }
}

/**
 * Let the user pick one OR many pattern files (.thr, or G-code for a
 * rectangular table: `rect`), validating + saving each. Invalid
 * files (no theta-rho points) are skipped and reported in `failed` rather than
 * aborting the whole batch. Returns null only if the user cancels the picker.
 */
export async function importThr(rect = false): Promise<ImportResult | null> {
  // .thr has no standard MIME type, so accept anything and validate by content.
  const res = await DocumentPicker.getDocumentAsync({
    type: ['*/*'],
    copyToCacheDirectory: true,
    multiple: true,
  })
  if (res.canceled || !res.assets || res.assets.length === 0) return null

  const imported: ImportedThr[] = []
  const failed: string[] = []
  for (const asset of res.assets) {
    try {
      imported.push(await processThr(asset.uri, asset.name, rect))
    } catch {
      failed.push(asset.name || 'unknown')
    }
  }
  return { imported, failed }
}
