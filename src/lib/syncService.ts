/**
 * Android: a foreground service (modules/sync-service, type dataSync) with one
 * ongoing "Syncing patterns" notification, up for as long as a hub sync runs, so
 * Android neither freezes nor kills the app in the background and the sync
 * (JS + Expo's UploadTask) carries on. iOS needs none of this: its table stage
 * rides the background URLSession (lib/tableBatch.ts). No-op on iOS and web.
 * Asks for the notification permission (Android 13+) the first time; without
 * it the service still runs, its notification just isn't shown.
 */
import { PermissionsAndroid, Platform } from 'react-native'
import { SyncServiceNative } from '../../modules/sync-service'
import { log } from '../stores/useAppLog'

let running = false

export async function startSyncService(text: string): Promise<void> {
  if (Platform.OS !== 'android' || !SyncServiceNative) return
  if (Number(Platform.Version) >= 33) {
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => undefined)
  }
  try {
    SyncServiceNative.start(text)
    running = true
  } catch (e) {
    log.warn('hub', `Sync service didn't start: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** `fraction` 0..1, or null for an indeterminate bar. */
export function updateSyncService(text: string, fraction: number | null): void {
  if (!running || !SyncServiceNative) return
  try {
    SyncServiceNative.update(text, fraction == null ? -1 : Math.round(fraction * 100))
  } catch {
    // the notification is a nicety; the sync goes on
  }
}

export function stopSyncService(): void {
  if (!running || !SyncServiceNative) return
  running = false
  try {
    SyncServiceNative.stop()
  } catch {
    // already gone
  }
}
