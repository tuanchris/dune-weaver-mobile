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
/** The desktop app (../dune-weaver-desktop: this source in Electron, so
 * Platform.OS is 'web') ships as GitHub Releases tagged with the mobile version
 * it bundles, e.g. "v1.2.0". */
const DESKTOP_REPO = 'tuanchris/dune-weaver-desktop'

/** Board MCUs a release can ship an image for. Matches both the release asset
 * prefixes (`esp32-firmware.bin` / `esp32s3-firmware.bin`) and the `mcu` the
 * firmware reports in /sand_status and the /updatefw probe. */
export type BoardMcu = 'esp32' | 'esp32s3'

export interface FirmwareRelease {
  version: string // tag, e.g. "v0.1.2"
  /** Direct download URL of the app-partition image, per MCU. `esp32` is
   * always present (releases predating the S3 board shipped only the bare
   * `firmware.bin`, which IS the ESP32 image — newer ones keep it as an
   * alias); `esp32s3` exists only on releases cut since the S3 board landed.
   * Flashing the wrong MCU's image is safe but useless: the board accepts the
   * whole upload, then rejects it at the final chip-ID check. */
  images: Partial<Record<BoardMcu, string>>
  releaseUrl: string
  notes: string
  /** ISO publish date, for the version picker. Absent on older code paths. */
  publishedAt?: string
  /** GitHub prerelease flag, for the version picker. */
  prerelease?: boolean
}

/** The image to flash on a table whose firmware reports `mcu` (from
 * /sand_status or the /updatefw probe). An unreported mcu (older firmware)
 * falls back to the ESP32 image — but FirmwareCard asks the user which board
 * it is BEFORE flashing whenever the release ships more than one image, so
 * this fallback is only reached when there is nothing to choose (an
 * esp32-only release; a mis-fit there is rejected harmlessly by the board).
 * Returns null when the release has no image for a KNOWN mcu (e.g. an S3
 * table picking a release that predates the S3 board) — refuse up front
 * rather than flash an image the board can only reject. */
export function firmwareUrlFor(release: FirmwareRelease, mcu: string | null): string | null {
  if (!mcu) return release.images.esp32 ?? null
  return (release.images as Record<string, string | undefined>)[mcu] ?? null
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
 * image. The ESP32 image is the explicit `esp32-firmware.bin` when present,
 * else the bare `firmware.bin` (pre-S3 releases shipped only that name;
 * post-S3 releases keep it as an alias OF the ESP32 image — see the firmware
 * repo's release workflow). */
function toFirmwareRelease(r: GhRelease): FirmwareRelease | null {
  const asset = (name: string) => r.assets?.find((a) => a.name === name)?.browser_download_url
  const esp32 = asset('esp32-firmware.bin') ?? asset('firmware.bin')
  const esp32s3 = asset('esp32s3-firmware.bin')
  if (!r.tag_name || !esp32) return null
  const images: FirmwareRelease['images'] = { esp32 }
  if (esp32s3) images.esp32s3 = esp32s3
  return {
    version: r.tag_name,
    images,
    releaseUrl: r.html_url ?? `https://github.com/${FIRMWARE_REPO}/releases`,
    notes: r.body ?? '',
    publishedAt: r.published_at,
    prerelease: r.prerelease,
  }
}

export interface AppRelease {
  version: string
  /** Store page (or desktop release page) to send the user to. */
  url: string
  /** The store's "What's new" for that version. iOS and desktop only — Play
   * doesn't put it in the page HTML, so Android falls back to the bundled
   * changelog. */
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
 * (no public API) — a parse failure just means "unknown". Desktop: the latest
 * GitHub release of DESKTOP_REPO. */
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
  if (Platform.OS === 'web') {
    const res = await fetch(`https://api.github.com/repos/${DESKTOP_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return null
    const r = (await res.json()) as GhRelease
    if (!r.tag_name) return null
    return {
      version: r.tag_name.replace(/^v/, ''),
      url: r.html_url ?? `https://github.com/${DESKTOP_REPO}/releases/latest`,
      notes: r.body?.trim() || undefined,
    }
  }
  return null
}
