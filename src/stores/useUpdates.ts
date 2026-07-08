// Update availability: latest app-store version + latest firmware release.
// Checked over the internet (best-effort), while the CURRENT firmware version
// comes from the table itself via useStatus (status.fw). Not persisted — a
// fresh check per launch is the point.

import { create } from 'zustand'
import Constants from 'expo-constants'
import { fetchLatestApp, fetchLatestFirmware, type AppRelease, type FirmwareRelease } from '../lib/updates'
import { isNewer } from '../lib/version'

/** Re-check at most this often (per launch; the store isn't persisted). */
const CHECK_EVERY_MS = 6 * 3600_000

interface UpdatesStore {
  appLatest: AppRelease | null
  fwLatest: FirmwareRelease | null
  checkedAt: number
  /** Refresh both checks (throttled unless `force`). Never throws. */
  check: (force?: boolean) => Promise<void>
}

export const useUpdates = create<UpdatesStore>((set, get) => ({
  appLatest: null,
  fwLatest: null,
  checkedAt: 0,

  check: async (force = false) => {
    const { checkedAt } = get()
    if (!force && Date.now() - checkedAt < CHECK_EVERY_MS) return
    set({ checkedAt: Date.now() })
    const [app, fw] = await Promise.allSettled([fetchLatestApp(), fetchLatestFirmware()])
    // Keep the previous answer when a check fails (offline ≠ up to date).
    if (app.status === 'fulfilled' && app.value) set({ appLatest: app.value })
    if (fw.status === 'fulfilled' && fw.value) set({ fwLatest: fw.value })
  },
}))

/** The version of the app the user is running right now. */
export const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0'

export function appUpdateAvailable(appLatest: AppRelease | null): boolean {
  return isNewer(appLatest?.version, APP_VERSION)
}

/** `tableFw` is status.fw from the active table (null = unknown → no nag). */
export function fwUpdateAvailable(fwLatest: FirmwareRelease | null, tableFw: string | null | undefined): boolean {
  return isNewer(fwLatest?.version, tableFw)
}
