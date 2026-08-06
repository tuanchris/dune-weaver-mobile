// "Is there something newer?" checks. Both are best-effort over the internet
// (the phone may be on a table-only Wi-Fi) — callers must treat null / thrown
// as "unknown", never as "up to date".

import { Platform } from 'react-native'
import { parseVersion } from './version'

/** Firmware releases live as GitHub Release assets (see the firmware repo's
 * RELEASING.md): flat .bin images + manifest.json per tag. */
const FIRMWARE_REPO = 'tuanchris/dune-weaver-firmware'

const APP_BUNDLE_ID = 'com.duneweaver'
const APP_STORE_ID = '6785920802'

export interface FirmwareRelease {
  version: string // tag, e.g. "v0.1.2"
  /** Direct download URL of the app-partition image (firmware.bin asset). */
  firmwareUrl: string
  releaseUrl: string
  notes: string
  /** ISO publish date, for the version picker. Absent on older code paths. */
  publishedAt?: string
  /** GitHub prerelease flag, for the version picker. */
  prerelease?: boolean
}

interface GhRelease {
  tag_name?: string
  html_url?: string
  body?: string
  published_at?: string
  prerelease?: boolean
  assets?: { name: string; browser_download_url: string }[]
}

/** Map a GitHub release to a FirmwareRelease, or null if it has no flashable
 * firmware.bin asset. */
function toFirmwareRelease(r: GhRelease): FirmwareRelease | null {
  const bin = r.assets?.find((a) => a.name === 'firmware.bin')
  if (!r.tag_name || !bin) return null
  return {
    version: r.tag_name,
    firmwareUrl: bin.browser_download_url,
    releaseUrl: r.html_url ?? `https://github.com/${FIRMWARE_REPO}/releases`,
    notes: r.body ?? '',
    publishedAt: r.published_at,
    prerelease: r.prerelease,
  }
}

export interface AppRelease {
  version: string
  /** Store page to send the user to. */
  url: string
  /** The store's "What's new" for that version. iOS only — Play doesn't put it
   * in the page HTML, so Android falls back to the bundled changelog. */
  notes?: string
}

/** Latest published firmware release, or null if unreachable / no firmware.bin
 * asset. Unauthenticated GitHub API (60 req/h per IP) — we check rarely. */
export async function fetchLatestFirmware(): Promise<FirmwareRelease | null> {
  const res = await fetch(`https://api.github.com/repos/${FIRMWARE_REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) return null
  return toFirmwareRelease((await res.json()) as GhRelease)
}

/** Every published firmware release that ships a flashable firmware.bin, newest
 * version first — for the "install a specific version" picker. Best-effort
 * (empty array on failure); unauthenticated GitHub API (60 req/h per IP), so
 * this is fetched lazily when the picker opens, not on every launch. Includes
 * prereleases; `/releases/latest` (fetchLatestFirmware) still excludes them. */
export async function fetchFirmwareReleases(): Promise<FirmwareRelease[]> {
  const res = await fetch(`https://api.github.com/repos/${FIRMWARE_REPO}/releases?per_page=100`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) return []
  const arr = (await res.json()) as GhRelease[]
  if (!Array.isArray(arr)) return []
  return arr
    .map(toFirmwareRelease)
    .filter((r): r is FirmwareRelease => r != null)
    .sort((a, b) => {
      const va = parseVersion(a.version)
      const vb = parseVersion(b.version)
      if (!va || !vb) return 0
      for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) return vb[i] - va[i]
      return 0
    })
}

/** Latest store version of THIS app, or null if the store can't tell us.
 * iOS: the official iTunes lookup API. Android: scraped from the Play page
 * (no public API) — a parse failure just means "unknown". */
export async function fetchLatestApp(): Promise<AppRelease | null> {
  if (Platform.OS === 'ios') {
    // bundleId lookups are occasionally flaky; retry by the numeric app id.
    for (const q of [`bundleId=${APP_BUNDLE_ID}`, `id=${APP_STORE_ID}`]) {
      const res = await fetch(`https://itunes.apple.com/lookup?${q}`)
      if (!res.ok) continue
      const r = (await res.json()) as { results?: { version?: string; trackViewUrl?: string; releaseNotes?: string }[] }
      const hit = r.results?.[0]
      if (hit?.version) {
        return {
          version: hit.version,
          url: hit.trackViewUrl ?? `https://apps.apple.com/app/id${APP_STORE_ID}`,
          notes: hit.releaseNotes?.trim() || undefined,
        }
      }
    }
    return null
  }
  if (Platform.OS === 'android') {
    const url = `https://play.google.com/store/apps/details?id=${APP_BUNDLE_ID}&hl=en`
    const res = await fetch(url)
    if (!res.ok) return null
    const html = await res.text()
    // The version is embedded in the page's data blobs as [[["1.2.3"]].
    const m = /\[\[\["(\d+(?:\.\d+)+)"\]\]/.exec(html)
    if (!m) return null
    return { version: m[1], url }
  }
  return null
}
