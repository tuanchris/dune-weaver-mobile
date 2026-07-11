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
  /** When the last FULLY successful check finished (0 = never). */
  checkedAt: number
  /** Refresh both checks if the last successful one is older than
   * `maxAgeMs` (default 6 h). Never throws. */
  check: (maxAgeMs?: number) => Promise<void>
}

/** Collapse concurrent callers (launch + Settings focus) onto one check. */
let inflight: Promise<void> | null = null

export const useUpdates = create<UpdatesStore>((set, get) => ({
  appLatest: null,
  fwLatest: null,
  checkedAt: 0,

  check: async (maxAgeMs = CHECK_EVERY_MS) => {
    if (Date.now() - get().checkedAt < maxAgeMs) return
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const [app, fw] = await Promise.allSettled([fetchLatestApp(), fetchLatestFirmware()])
        // Keep the previous answer when a check fails (offline ≠ up to date).
        if (app.status === 'fulfilled' && app.value) set({ appLatest: app.value })
        if (fw.status === 'fulfilled' && fw.value) set({ fwLatest: fw.value })
        // Only a fully successful check arms the throttle — after a failed or
        // partial one (offline, GitHub rate limit) the next call retries, so
        // a stale "up to date" self-heals instead of sticking for 6 h.
        if (app.status === 'fulfilled' && app.value && fw.status === 'fulfilled' && fw.value) {
          set({ checkedAt: Date.now() })
        }
      } finally {
        inflight = null
      }
    })()
    return inflight
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
