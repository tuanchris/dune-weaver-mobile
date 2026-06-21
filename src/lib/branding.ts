import * as DocumentPicker from 'expo-document-picker'
import { File, Directory, Paths } from 'expo-file-system'

const DIR = 'branding'

function brandingDir(): Directory {
  const dir = new Directory(Paths.document, DIR)
  if (!dir.exists) dir.create()
  return dir
}

function clearDir(dir: Directory): void {
  if (!dir.exists) return
  for (const entry of dir.list()) {
    try {
      entry.delete()
    } catch {
      // ignore a stale file we can't remove
    }
  }
}

/**
 * Pick from the photo library via expo-image-picker. Required lazily (not a
 * top-level import) and guarded: until the dev client is rebuilt with the
 * module this returns 'unavailable' and the caller falls back to the Files
 * picker instead of crashing. A denied photo permission throws.
 */
async function pickViaPhotos(): Promise<string | null | 'unavailable'> {
  let ImagePicker: typeof import('expo-image-picker')
  try {
    ImagePicker = require('expo-image-picker')
  } catch {
    return 'unavailable'
  }
  if (!ImagePicker?.launchImageLibraryAsync) return 'unavailable'

  let perm
  try {
    perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
  } catch {
    return 'unavailable'
  }
  if (!perm.granted) throw new Error('Photo library access denied — enable it in Settings.')

  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  })
  if (res.canceled || !res.assets?.[0]) return null
  return res.assets[0].uri
}

/** Fallback: pick an image file via the Files browser (no native module needed). */
async function pickViaFiles(): Promise<string | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: 'image/*', copyToCacheDirectory: true })
  if (res.canceled || !res.assets?.[0]) return null
  return res.assets[0].uri
}

/**
 * Let the user pick a logo (from the photo library where available, else the
 * Files browser), square-cropped, and copy it into the app's document storage
 * so it survives relaunches. Returns the persisted file:// uri, or null if
 * cancelled. Old logos are removed first; the filename is timestamped so the
 * <Image> cache doesn't show a stale picture after replacing.
 */
export async function pickLogo(): Promise<string | null> {
  let srcUri = await pickViaPhotos()
  if (srcUri === 'unavailable') srcUri = await pickViaFiles()
  if (!srcUri) return null

  const ext = (srcUri.split('?')[0].split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || 'jpg'
  const dir = brandingDir()
  clearDir(dir)
  const dest = new File(dir, `logo_${Date.now()}.${ext}`)
  new File(srcUri).copy(dest)
  return dest.uri
}

/** Delete any stored custom logo file(s). */
export function clearLogo(): void {
  clearDir(new Directory(Paths.document, DIR))
}
