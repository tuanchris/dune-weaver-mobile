// The app's own release notes, bundled.
//
// Why bundled rather than fetched: the firmware's notes come free from the
// GitHub release body, but there is no equivalent for the app. iOS exposes the
// store's notes through the iTunes lookup API (see fetchLatestApp), Android
// exposes nothing — Play's "What's new" is not in the page HTML, so it can't be
// scraped alongside the version. Bundling is the only source that works on both
// platforms, and it works offline (the phone is often on a table-only Wi-Fi).
//
// MAINTENANCE: add an entry here whenever app.json's `version` is bumped, with
// the same copy that goes into fastlane/metadata/en-CA/release_notes.txt (and a
// ≤500-char cut in fastlane/metadata/android/en-CA/changelogs/<versionCode>.txt
// — Play rejects longer ones). Newest first. Notes are shown verbatim, so write
// them for owners, not developers.

export interface AppReleaseNote {
  /** Bare version, matching app.json's `version` (no "v" prefix). */
  version: string
  notes: string
}

export const APP_CHANGELOG: AppReleaseNote[] = [
  {
    version: '1.2.0',
    notes: [
      '• Fixed: with more than one table, the brightness, LED speed and table speed sliders could change the first table you opened instead of the one you’re controlling. Sliders now always act on the selected table',
    ].join('\n'),
  },
  {
    version: '1.1.2',
    notes: [
      '• Support for tables with the new ESP32-S3 board — firmware updates pick the right update file for your board automatically, and the app asks which board you have when the table can’t say',
      '• Beta firmware is now hidden from the version picker unless you turn on “Show beta versions” — the build on your table is always listed either way',
      '• The version picker now badges the installed build correctly, so a table on a beta build can install its final release',
      '• The LED screen shows what your lights are really doing — when quiet hours or a saved “while playing / while idle” effect is overriding your choice, it says so and explains how to get control back',
      '• Saving “Off” as a playing or idle effect is now clearly called out, so LEDs that stay dark are no longer a mystery',
    ].join('\n'),
  },
  {
    version: '1.1.1',
    notes: [
      '• Pause the table to change its settings — no more waiting out a whole playlist (needs Dune Weaver Firmware v0.1.18 or newer)',
      '• Renaming a table in the app now renames it on your network too, so it shows up under the name you picked (needs Dune Weaver Firmware v0.1.18 or newer)',
      '• Read what changed — release notes for both the app and your table’s firmware, right in Settings',
      '• Patterns with no thumbnail are now flagged in Browse, with a tap through to sync previews from your table',
      '• Load a table’s pattern list from a file when Wi-Fi is weak, instead of waiting on the table',
      '• Tap the speed to type an exact value',
      '• A long list of pattern folders now scrolls inside the filter sheet',
    ].join('\n'),
  },
  {
    version: '1.1.0',
    notes: [
      'A big update with lots of polish:',
      '',
      '• Between patterns, the app clearly shows the table is waiting — with the pattern that’s on the sand and a live countdown to the next one',
      '• Install any firmware version right from the app, not just the latest',
      '• Motion-reactive LEDs: set the look you want, then “Save current” for playing or idle; brightness now shows as a percentage',
      '• Playlist options — shuffle, repeat, and time between patterns — are remembered per table',
      '• Table settings lock while a pattern is running, so changes don’t fail silently',
      '• More reliable connection to busy tables, timestamped table logs, and a smoother “copy playlist to another table”',
      '• Sliders no longer scroll the page while you adjust them, and long times now show hours',
    ].join('\n'),
  },
  {
    version: '1.0.11',
    notes: [
      '• The between-patterns wait is now clearly labelled, showing the pattern that’s on the table and a smooth countdown',
      '• Install any firmware version, not just the latest — handy for rolling back',
      '• Motion-reactive LEDs: set the look you want, then “Save current” for playing or idle; brightness now shows as a %',
      '• Playlist options (shuffle, repeat, time between patterns) are remembered per table',
      '• Sliders no longer scroll the page while you adjust them, and long times now show hours',
    ].join('\n'),
  },
  {
    version: '1.0.8',
    notes: [
      '• A whole new look — a warm, sand-and-basalt design inspired by the table itself, in both dark and light modes',
      '• Favorites — tap the heart on any pattern, then filter to your favorites from the new dropdown next to search',
      '• New expanded player — watch progress sweep around your pattern on a glowing disc',
      '• New display and telemetry typefaces throughout',
    ].join('\n'),
  },
  {
    version: '1.0.7',
    notes: [
      '• Fixed: pausing a pattern now lets you resume it — the play button reliably picks the pattern back up',
      '• Switching between tables is snappier — a table that’s slow to respond no longer holds up the one you switched to',
      '• Bigger, easier-to-tap controls for playlist settings, LED colors, and pattern filters',
      '• Faster startup — your table’s patterns and playlists appear instantly from a saved copy, then refresh with a pull-down',
      '• More reliable connection to your table, especially right after you open the app or when it’s busy with a pattern',
    ].join('\n'),
  },
  {
    version: '1.0.5',
    notes: [
      '• Protect your table with a password — set, change, or remove it in Settings, and the app remembers it on this phone (needs Dune Weaver Firmware v0.1.11 or newer)',
      '• Choose your own clear patterns for the “from center” and “from edge” sweeps, with an optional dedicated clear speed',
      '• New Diagnostics view collects your table’s logs so you can view and share them if something goes wrong',
      '• Clearer error messages that tell you what to try next — a missing SD card, a busy table, or a full card now read plainly',
      '• “Up next” now follows the real shuffle order, and editing a playlist asks before saving or discarding your changes',
      '• A “Check for updates” button, smoother Wi-Fi password entry, and more reliable preview syncing from the table',
    ].join('\n'),
  },
  {
    version: '1.0.4',
    notes: [
      '• Wi-Fi controls in Settings — see how your table is connected, move it to a different Wi-Fi network right from the app, or switch it to standalone hotspot mode for router-free setups (needs Dune Weaver Firmware v0.1.8 or newer)',
      '• Tables are now recognized by their hardware identity, so they’re found again automatically after your router hands out a new address — even tables added by IP',
      '• Firmware updates show a full-screen progress view with a restart countdown',
      '• More reliable update checks and small fixes',
    ].join('\n'),
  },
  {
    version: '1.0.3',
    notes: [
      '• Pattern previews now sync from your table — patterns bulk-loaded onto the SD card with the Pattern Manager get their thumbnails automatically, or on demand with “Sync previews from table” in Settings',
      '• Sending or deleting patterns now keeps the table’s on-card catalog in step, so pushed patterns no longer disappear after the table restarts',
      '• Small fixes and polish',
    ].join('\n'),
  },
  {
    version: '1.0.0',
    notes: 'Initial release.',
  },
]

/** Bundled notes for an exact version ("1.1.0" or "v1.1.0"), or null. */
export function appNotesFor(version: string | null | undefined): string | null {
  if (!version) return null
  const want = version.replace(/^v/, '')
  return APP_CHANGELOG.find((e) => e.version === want)?.notes ?? null
}
