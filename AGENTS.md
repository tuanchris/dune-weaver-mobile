# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.
Expo SDK **56.0.12**. The app is managed Expo; `expo-file-system` uses the **new `File`/`Directory`/`Paths` class API** (not the legacy functional API).

---

# Dune Weaver Mobile — project map

React Native / Expo app that controls a **FluidNC-firmware** Dune Weaver kinetic sand table
**directly over its local HTTP API**. No Python backend, no cloud, no proxy — native `fetch`, so no
CORS. The phone must be on the same Wi-Fi as the table.

## Architecture — talks to the firmware, not the dw backend
The official `dune-weaver` repo (sibling `../dune-weaver`) has a Python/FastAPI backend + web frontend.
**This app does NOT use that backend.** It speaks to the FluidNC fork's own HTTP routes (see
`../dune-weaver-firmware/FluidNC/src/SandApi.cpp` and `WebServer.cpp`). All API access is in `src/api/board.ts`:

- **Concurrency gate**: the board runs a single-threaded web server with a tiny socket pool, so
  every real-board call funnels through a client-side semaphore in `board.ts` (`MAX_CONCURRENCY = 2`,
  at the `board` Proxy; demo base bypasses). Opening 4 sockets at once (the launch burst) could
  exhaust its sockets and wedge it — the gate queues calls client-side instead. Cap is 2 (not 1) so a
  slow listing read can't starve the status poll of a slot.
- **503 back-off**: `/sand_patterns` + `/sand_playlists` go through `getJsonRetry` — the firmware's
  transient 503 ("busy: low memory") is retried with jittered exponential back-off (~0.5s/1s, 3 tries)
  instead of failing, so a contended listing loads a beat later. Only 503 retries; 404/network throw.
- Reads (JSON): `GET /sand_status`, `/sand_patterns`, `/sand_playlists`, `/sand_settings`.
- Actions (plain text "ok"): `/sand_home`, `/sand_stop`, `/sand_pause`, `/sand_resume`, `/sand_feed?d=`.
- Commands: `GET /command?plain=$...` — `$SD/Run=`, `$Sand/Run=<file> clear=<mode>` (pre-exec clear),
  `$Playlist/Run|Stop|Skip`, `$Playlist/Mode|Shuffle|PauseTime|PauseFromStart|ClearPattern|AutoHome=`,
  `$THR/Feed=`, `$LED/Effect|Palette|Color|Color2|Brightness|Speed|Intensity|RunEffect|IdleEffect=`,
  `$Sands/Enabled|Slots=` (quiet hours), `$Hostname=` (rename, fw ≥ v0.1.18 — see the rename
  bullet), `$X` (unlock from Alarm), `$Bye` (reboot). Built with
  `encodeURIComponent` on the whole `plain` value (the firmware `arg("plain")` URL-decodes it).
  EnumSetting values are case-insensitive (`strcasecmp`); booleans are `ON`/`OFF`.
- Files: `POST /upload` multipart (file part's **filename = full SD path**, e.g. `/patterns/x.thr`;
  text field `<sdPath>S` = byte size). `GET /upload?action=delete&path=&filename=` to delete.
  On upload failure, `uploadTextFile` retries once after best-effort `action=createdir` of the
  parent folders — user SD cards prepared on a computer often lack `/playlists`, and firmware
  ≤ v0.1.3 doesn't create parents on upload (newer does). `createdir` on an existing dir answers
  HTTP 500; ignored. The upload abort timeout scales with payload size (30 s + ~25 KB/s floor) —
  the board drains uploads slowly, and a flat timeout cancelled multi-MB full-res patterns
  mid-transfer (surfaces as firmware "upload cancelled" / app "Fetch request has been canceled").
  Pattern pushes suspend the 1 s status poller for the transfer (`useStatus.suspend()/resume()` —
  keeps the last status on screen, unlike `setBase(null)` which the OTA flow uses); the board's
  single-threaded server would otherwise queue polls against the upload. Uploads go through
  XMLHttpRequest (not fetch) so `upload.onprogress` can drive the progress bar in Browse's
  pattern detail sheet; "Add & send" opens that sheet before pushing so progress is visible.
- **IP changes (DHCP)**: boards store an optional `hostname` (mDNS instance name, set when added
  via discovery). `useAutoRelocate` (App.tsx) watches for the active board going unreachable
  ~12 s, then re-scans mDNS (`scanOnce` in discovery.ts, retry every 60 s) and repoints the saved
  board via `useBoards.updateBase` when a discovered table matches by hostname (display-name
  fallback for older entries; manual boards without a hostname never auto-relocate). Settings'
  discovered-table add also reconciles by hostname — updates the existing entry's IP instead of
  erroring "Already added".
  **Reading files needs the explicit `/sd/` mount prefix** — `GET /sd/playlists/<name>.txt` /
  `GET /sd/patterns/<name>.thr` (firmware `myStreamFile`); a bare `/playlists/...` resolves to the
  on-board flash FS instead, so it won't find SD files.
- **No WebSocket** — `useStatus` polls `/sand_status` every 1s, scheduled relative to request start.
  The poll is **paused while the app is backgrounded** (`AppState` in App.tsx → `suspend()`/`resume()`)
  and snaps back with an immediate poll on foreground — no point hammering the board off-screen.
  Status also carries `playlist.quiet` (Still Sands active → `Status.isQuiet`), `mcu` (board build
  target `esp32`/`esp32s3` → `Status.mcu`, picks the OTA image; absent on older firmware), `fw` (firmware
  version → `Status.fw`) and, when LEDs are configured, `led:{effect,brightness}` (→ `Status.led`).
  Firmware ≥ v0.1.13 adds `playlist.next` (shuffle-aware upcoming pattern) and `playlist.last`
  (just-completed pattern = what's on the sand; named during the between-patterns pause) — the
  NowPlayingBar shows `last`'s preview through the pause (falling back to an in-memory ref on
  older firmware, which only works if the app watched the pattern run) and `next` as "Up next".
- **OTA firmware update**: `GET /updatefw` probes (`{status:"ready"|"busy",fw,mcu}`; 409 while a
  pattern runs), `POST /updatefw` multipart (`firmware.binS` size field + `firmware.bin` file part)
  flashes and reboots. `src/lib/firmwareUpdate.ts` orchestrates: download the matching GitHub
  release asset, suspend the status poller (the board's web server is single-threaded), flash via
  `board.uploadFirmware` (binary body needs `expo/fetch` — RN's fetch can't send typed arrays),
  poll until the board is back.
  **The image is per-MCU** (`tuanchris/dune-weaver-firmware` releases ship `esp32-firmware.bin` +
  `esp32s3-firmware.bin`; the bare `firmware.bin` is a compatibility alias OF THE ESP32 IMAGE, and
  the only asset pre-S3 releases have): a wrong-MCU image uploads completely and is only rejected
  by the board's chip-ID check at the very end (both chips share the 0xE9 magic byte — the app's
  own header check cannot catch this), which surfaced as "The table rejected the update" on every
  S3 OTA. So `FirmwareRelease.images` maps mcu→URL (`firmwareUrlFor` picks), and
  `runFirmwareUpdate(base, release, onStage, forceMcu?)` reads `mcu` from the /updatefw probe
  (fw ≥ the field; also in `status.mcu`) and refuses releases with no image for a KNOWN mcu. When
  the firmware is too old to report its mcu and the release ships BOTH images, `UpdatesCard`'s
  `startInstall` asks the user which board it is up front ("ESP32 (most tables)" / "ESP32-S3
  (DLC32 MAX)") and passes the answer as `forceMcu` — asking beats guess-flash-fail-retry (owner
  call), a wrong pick is rejected safely (old firmware keeps running; the failure toast says to
  try the other choice), and the question disappears once the table runs mcu-reporting firmware.
  Update checks
  live in `src/lib/updates.ts` + `src/stores/useUpdates.ts` (app: iTunes lookup / Play page scrape;
  both fail-safe to "unknown"); a red dot on the Settings tab (App.tsx) + an Updates card in
  Settings (`UpdatesCard.tsx`) surface them. Checks re-run on Settings focus (10 min max-age) and
  the 6 h throttle only arms after a FULLY successful check — a failed/partial one retries, so a
  stale "up to date" self-heals. The fetched "latest" is app-global; only `status.fw` is per-table.
  **Installing a SPECIFIC version**: `UpdatesCard` has an "Install a specific version…" button
  (real tables only) opening `FirmwareVersionPicker` — a sheet listing every GitHub release with a
  flashable image (`fetchFirmwareReleases`, lazy per-open, newest first), marking the installed one
  and flagging Newer/Older/Pre-release. Any pick runs the same `runFirmwareUpdate` OTA flow (it
  takes the whole release and picks the per-MCU image); the confirm dialog adapts wording
  (Install / Reinstall / Downgrade) and the splash shows the target version. **EVERY row is
  tappable, including the installed one** (that's the Reinstall path, and the escape hatch when the
  app misreads which build is on the table — an rc3 table that couldn't reach its own final release
  is exactly how this was found) — with ONE exception: when the table's mcu is KNOWN and a release
  has no image for it (pre-S3 releases on an S3 table), the row is disabled and tagged "Not for
  this board", because that flash can only ever be rejected. "Installed" identity uses `sameVersion`/`versionTag` (exact tag
  string, `v`-stripped, git_info tail dropped) and NOT `parseVersion`'s numeric key: the key
  deliberately ignores prerelease tails it doesn't model, so any unknown tail (`-beta1`) or, before
  v1.1.1, `-rcN` collapses several distinct builds onto one key and badges the wrong one as
  installed. `relation()` in `UpdatesCard` returns `re` only on that exact match — an equal key with
  differing tags falls through to the neutral "Install" wording. **Beta toggle**: prereleases are
  HIDDEN by default behind "Show beta versions" (`usePrefs.showPrereleaseFirmware`, persisted;
  also filters the firmware "What's new" list) — except the build on the table, which is always
  listed so a tester on an rc can see and re-flash where they are.
  **Release notes ("What's new")**: both rows in the About card link to a shared
  `ReleaseNotesSheet` — a bottom sheet with a deliberately small markdown renderer (headings,
  bullets, inline `**bold**`/`` `code` ``/links; hard-wrapped lines are JOINED into the bullet
  above, since the firmware's release bodies wrap at ~80 cols). Firmware notes are the GitHub
  release bodies via `fetchFirmwareReleases` (lazy on first open, installed one badged). App notes
  come from **`src/lib/appChangelog.ts`, a BUNDLED list** — there is no fetchable source that works
  on both stores (iOS has `releaseNotes` in the iTunes lookup, which `fetchLatestApp` now returns
  and the sheet shows on top for a pending update; Play does NOT put "What's new" in the page HTML,
  so it can't be scraped alongside the version) and bundling also works offline on a table-only
  Wi-Fi. **Add an entry to `APP_CHANGELOG` whenever `app.json`'s `version` is bumped**, with the
  same copy that goes into `fastlane/metadata/en-CA/release_notes.txt` (App Store, 4000 chars) AND
  a SHORTER cut in `fastlane/metadata/android/en-CA/changelogs/<versionCode>.txt` — **Play caps
  "What's new" at 500 characters** and rejects the whole edit commit above it
  (`403 … notes in language en-CA with length N, which is too long`). Play notes are not set by
  `eas submit` at all: attach them afterwards via the androidpublisher API (create edit → GET
  `tracks/production` → add `releaseNotes` to the release holding the new versionCode → PUT →
  `:commit`), authenticating with the same service-account key `eas.json` uses.
- **WiFi control** (firmware ≥ v0.1.8 — older builds 404 these routes, which is how `WifiCard`
  detects "unsupported"): `GET /wifi_status` (`{mode:"sta"|"fallback"|"standalone", sta_ssid,
  ap_ssid, fail}`), `GET /wifi_scan` (async; `{status:"scanning"}` until done — poll ~1.5 s;
  `?rescan=1` forces a fresh scan; the firmware's JSONencoder emits rssi/secure as STRINGS —
  `board.wifiScan` coerces), `POST /wifi_save` (form-encoded `ssid`+`password` 8–64 chars, open
  networks unsupported; table reboots into STA>AP ~0.5 s after replying), `POST /wifi_standalone`
  ($WiFi/Mode=AP; live from the hotspot, reboot from STA). Both writes are idle-gated
  (`{"status":"busy"}` during boot auto-home / a running pattern) and reply JSON on every HTTP
  status. `src/lib/wifiSetup.ts` orchestrates: busy-retry (20 s cap), a LOST reply on a write is
  the SUCCESS path (the reboot races the reply out — same as the captive portal), suspend the
  poller and wait ~90 s for the table to return after /wifi_save. Standalone flips repoint the
  saved board at `http://192.168.0.1` (the firmware's default $AP/IP) so the app works the moment
  the phone joins the hotspot. UI is `src/components/WifiCard.tsx` in Settings; it also works when
  the phone is joined to the table's own hotspot (fallback/standalone), not just over the LAN.

### Key data conventions (easy to get wrong)
- **theta is RADIANS**, continuous/unwound (same as `.thr` files), NOT degrees. `rho` may be signed.
  Live ball position uses `x=rho·cosθ, y=rho·sinθ` directly (see `livePosition` in `patternGeometry.ts`).
- `progress` from the board is 0..100 (older builds 0..1); `translateStatus` handles both.
- `.thr` files are `"<theta> <rho>"` lines (theta radians, possibly hundreds of turns — converting to
  xy destroys the winding, so we never store xy for anything that gets pushed back).

## Pattern library + previews + upload
The app is the source of truth for LOCAL patterns; it never reads pattern DATA (.thr) back off the SD
for previews. Card-only patterns (bulk-loaded via the website's SD Card Pattern Manager) get their
thumbnails from the card's **preview bundle** instead — see the previewSync bullet below.
- **Bundled defaults (100)**: `npm run gen-geometry` reads `../dune-weaver/patterns/` and emits
  `assets/thr/<name>.thr` (decimated to `MAX_POINTS=15000`, the pushable copy) + `assets/previews/<name>.webp`
  (dw's pre-rendered preview) + `assets/pattern-manifest.js` (static `require()` maps `THR`/`PREVIEW`).
  Metro needs literal require paths, so the manifest is generated.
- **Previews**: bundled patterns render their **webp** (`PatternThumb` → `<Image>`); imported/unbundled
  render **live SVG** from geometry (`PolarPattern`, geometry derived on demand by `useLibrary.ensureXY`).
- **Import**: `expo-document-picker` → parse/validate → decimate → save to `Paths.document/thr/` →
  `useLibrary.addImported`. See `src/lib/importPattern.ts`.
- **Push to table**: read the decimated `.thr` (bundled asset via `expo-asset`, or imported file) and
  `board.uploadFile` to `/patterns/<name>`. See `src/lib/pushPattern.ts`.
- **On-card catalog stays in step**: `src/lib/tableManifest.ts` — after a push/delete, best-effort
  read-modify-write of `/patterns/index.json` (the firmware serves it VERBATIM from `/sand_patterns`
  when present, so a push without a catalog update vanishes after the next cold start). It only ever
  MODIFIES an existing manifest — creating one on a card without it would hide every other pattern.
- **Preview bundle sync** (`src/lib/previewSync.ts` — `syncPreviewBundle`, **MANUAL only**: Settings →
  "Sync previews from table". The owner does NOT want the app reading the card's bundle on its own —
  there is deliberately no auto-trigger (the old `usePreviewSync` App.tsx hook was removed; don't
  re-add it): the
  website's SD Card Pattern Manager writes `/patterns/previews/shard-<0..7>.zip` (STORE-mode zips of
  preview webps) + a ~1 KB `previews.json` sidecar with a content hash per shard. On a manual sync
  (idle-gated), the app reads the sidecar, fetches only shards whose CONTENT hash it hasn't
  ingested (`usePreviews.ingestedShards` — a persisted SET of content hashes, deliberately keyed by
  hash not shard-name so it's cross-table: a second table carrying the same patterns produces a
  byte-identical bundle → identical hashes → zero re-download), unzips with `fflate`, and registers
  images via `usePreviews.addMany` — same store as manual preview imports, keyed by `previewKey`
  basename (path-stripped, so the same pattern filed under a different folder on another table still
  resolves the same image → **previews are shared across all tables**). This is what gives bulk-loaded
  card patterns thumbnails; 404 sidecar (no bundle) is a quiet no-op. Since the sync never runs
  itself, Browse ASKS for it: `MissingPreviewsBanner` (the FlatList header) counts patterns that can
  only render the blank placeholder — no bundled webp, no ingested image, no local `.thr`
  (`lib/previewCoverage.ts`, `useMissingPreviewCount`) — and taps through to Settings via
  `navigate('Settings', {focus:'previews'})` (`src/navigation.ts` types the tab params; Settings
  scrolls its Pattern previews card into view and outlines it for ~2.5 s). Dismissal is persisted
  (`usePrefs.previewNagDismissedCount` = the missing count when dismissed) and the banner returns only
  if MORE patterns end up without a thumbnail, so a partial sync doesn't re-nag. Manual import
  (`importPreviews.ts`, Settings) accepts individual images OR the bundle's `.zip` shards directly
  (unzipped with `fflate`) — the offline path to load a bundle into every table without pulling it off
  each card. **iOS container gotcha**: `usePreviews` persists preview image refs as bare FILENAMES and
  rebuilds the absolute `file://` uri under the current document dir on hydrate (`resolvePreviewUri`).
  iOS rotates the app-container UUID on every app UPDATE, so a persisted absolute Documents uri goes
  dead after an update (the key survives → count looks right, but `<Image>` loads blank). NOTE: the
  same latent bug still lives in `useLibrary` (imported patterns' `thrUri`/`previewUri`) and the brand
  logo — `thrUri` breakage silently breaks PUSHING imported patterns after an update.
  **Sync ↔ motion are mutually exclusive** (shared single-threaded SD): sync only starts when the
  table is idle and, while shards stream, sets `usePreviews.syncing` — motion-START actions (run
  pattern/playlist, home, clear, center/perimeter, skip) disable + refuse via `assertNotSyncing()`
  (`sd.ts`; Stop/pause/resume never gate). The streaming phase also holds an `expo-keep-awake` lock
  so a screen-off suspend can't abandon a half-fetched shard.
- **Imported pattern catalog** (`src/lib/importCatalog.ts` + `components/CatalogCard.tsx`, Settings —
  the weak-Wi-Fi escape hatch): pick the card's `/patterns/index.json` off the phone (a saved
  `/sand_patterns` response or `{patterns:[…]}` also parse) and the On-Table list is FROZEN to it —
  `loadTable` returns early on `catalogSource === 'imported'` and never reads the board. The two
  lists live side by side in `tableCache[base]` (`importedPatterns` vs `patterns`), so flipping the
  toggle back and forth costs no re-import and no refetch; `addTablePattern`/`removeTablePattern`
  write through to whichever one is active. Browse's pull-to-refresh says so instead of silently
  doing nothing.
- **Shared geometry**: `src/lib/thrGeometry.mjs` (plain ESM `.mjs` so BOTH the Node build script and
  Metro import it — `mjs` is in Expo's `sourceExts`). `parseThr` / `decimate` / `toXY` / `decimateThrText`.

## Project layout
- `src/api/` — `board.ts` (HTTP client), `status.ts` (RawStatus → Status).
- `src/stores/` — zustand, persisted via AsyncStorage: `useBoards` (tables), `useStatus` (1s poll),
  `useLibrary` (imported patterns + geometry cache + bundle accessors + a **per-board persisted cache
  of the on-table listings** — `tableCache[base] = {patterns, playlists}`, keyed by base; `loadTable`
  / `loadPlaylists` are stale-while-revalidate: they populate `tablePatterns`/`tablePlaylists` from
  cache instantly and hit the board ONLY on `force` (pull-to-refresh) or the first-ever load, so the
  launch effect no longer force-reads the catalog every open; `addTablePattern`/`removeTablePattern`
  write through to the cache so a push/delete survives relaunch. **Neither read hits the board while
  the table is mid-pattern** (`tableBusy`/`isBusy` — demo bypasses): even though `/sand_patterns` and
  `/sand_playlists` don't block motion firmware-side, a read still contends with the status poll on
  the single-threaded server, so a needed fetch is DEFERRED and re-run at the next idle by
  `lib/catalogRefresh.ts` (`useCatalogRefreshOnIdle` in App.tsx; a mid-pattern pull-to-refresh records
  a forced retry and toasts "…will refresh when it's idle")), `useTheme`, `useToast`
  (errors linger 7 s vs 2.6 s for info/success), `useAppLog` (local diagnostics ring buffer —
  see below).
- **Custom clear patterns** (`$Playlist/ClearIn`/`ClearOut`/`ClearSpeed`, firmware ≥ v0.1.11):
  `ClearPatternsCard` (Settings) points the from-center / from-edge clears at any on-table pattern
  (a searchable single-select picker over `useLibrary.tablePatterns`; "Use built-in clear" sends `''`
  → firmware falls back to its config default) and sets a dedicated clear feed (mm/min; 0 = pattern
  feed). The firmware runs the chosen file NON-destructively (unlike the old web app, which
  overwrote the stock clear files). Values are full SD paths (`/patterns/<key>`); a stored path equal
  to the stock `/patterns/clear_from_{in,out}.thr` (or empty) displays as "Built-in". Idle-gated.
- **API password** (`$Sand/Password`, firmware ≥ v0.1.11): a locked table 401s every CONTROL route
  without the key (`?key=` or `X-Sand-Key`; reads stay open). The app stores the key per saved
  board (`useBoards` `Board.key`) and attaches `X-Sand-Key` to EVERY request — `board.ts` gets the
  key via `registerKeyLookup` (injected from useBoards; board.ts can't import the store, the store
  imports `normalizeBase`). All request paths carry it: the shared helpers, the XHR upload, both
  `/updatefw` calls, and the Wi-Fi POSTs. `SecurityCard` (Settings, hidden for the demo table)
  sets/changes/removes the password on the table (`board.setSandPassword` — carries the old key
  automatically) or just saves an existing password locally (`board.testKey` probes with `$G`;
  401 = wrong). Lost password: `$Sand/Password=` over USB serial (never gated).
- **Renaming a table renames it on the network too** (`src/lib/renameTable.ts`, wired into Settings'
  inline row rename): the local rename lands first and ALWAYS sticks; pushing `$Hostname=` to the
  table is best-effort on top. The two names are different strings — the display name is free text,
  the firmware hostname takes only `[A-Za-z0-9-]{1,32}` — so `toHostname()` derives a legal one
  ("Living Room" → `Living-Room`, NFKD-folded) and the toast names it when it differs. **The
  firmware version gate is not optional**: before **v0.1.18** `$Hostname=` was swallowed by
  config.yaml's top-level `hostname:` key (in-memory only), so the board answered Ok, read the new
  name back, and lost it on the next boot — indistinguishable from success over HTTP. So
  `supportsRename(status.fw)` skips the push entirely on older firmware and the rename just stays
  local (exactly the pre-feature behavior). Gated by `isSettingsLocked` like every other board-config
  write, not `isBusy` — the between-patterns Idle would otherwise race the next pattern's start into
  a 503 "Try again when not moving" (now mapped in `errors.ts`). On success the saved board's
  `hostname` is updated immediately, and a base written as the OLD mDNS name (`http://dwmp.local`)
  is re-pointed at the new one — otherwise the rename makes the table unreachable. Every non-applied
  outcome (`unsupported`/`busy`/`invalid`/`failed`) has its own toast; the demo table supports it
  (virtual `$Hostname`, fw `v99.0.0`) so App Review can see it work.
- **User-facing errors go through `userMessage(e, 'create the playlist')`** (`src/lib/errors.ts`):
  it maps raw causes to actionable sentences — SD card missing/unformatted (firmware's
  "No SD card"/"filesystem inaccessible" 503s, plus `status.sd_ok === false` for otherwise-opaque
  HTTP errors), busy/409, 507 card-full, network-unreachable — and logs the RAW error to the
  diagnostics log so friendly toasts never lose detail. `useBoardAction.act(fn, successMsg, doing)`
  takes the verb phrase as its third arg. Libs that already throw human messages
  (`firmwareUpdate.ts`, `wifiSetup.ts`) surface those directly.
- **Diagnostics** (`useAppLog` + `DiagnosticsCard` in Settings): a ~600-entry local ring buffer
  (tail persisted) capturing failed board requests (`board.ts` helpers log everything EXCEPT
  `/sand_status` — `useStatus` logs connect/disconnect transitions instead, so an offline table
  doesn't flood it), plus uncaught JS errors via `ErrorUtils` (hooked in `initAppLog`, called from
  App.tsx). "View logs" opens a table-first sheet: the Table tab shows the COLLECTED table-log
  history — `useTableLogSync` (App.tsx) harvests `/sand_log` (a heap-free static-buffer route on
  the board) into `useTableLog` (persisted per saved-board id, ~2000 lines) on every
  unreachable→reachable transition and every 5 min while connected, merging by the `[+uptime]`
  line prefixes (uptime going backwards = reboot → "— table restarted —" marker). Each collected
  line is stored as `{ts, text}`: the raw `[+uptime]` text plus an epoch-ms timestamp resolved at
  collection time (boot anchored to wall clock via `status.uptime`, monotonic-clamped), so the
  viewer shows wall-clock time AND uptime; pre-v2 lines and markers have `ts: null`. This outlives
  the board's ~8 KB RAM ring, which is lost on every table reboot. The app ring is the second
  tab; the share icon exports the VISIBLE tab through the system share sheet. Nothing is uploaded
  automatically, which keeps the "Data Not Collected" App Privacy label truthful.
  (`/sand_bootlog`/`/sand_coredump` are no longer fetched; their `board.ts` helpers remain as
  API-surface mirrors.)
- **Favorites** are LOCAL (`usePrefs.favorites`, persisted; keyed by `patternKey` so they apply
  across tables, like previews) — a FluidNC table has no backend to hold them, and the dw web FE's
  Favorites-playlist convention targets the Pi backend, not the firmware. They are additionally
  MIRRORED into `/playlists/Favorites.txt` on the active table (`src/lib/favoritesPlaylist.ts`,
  mounted via `useFavoritesPlaylistSync` in App.tsx): heart → added (file created on first
  favorite), un-heart → removed. It RECONCILES rather than overwrites — only removes keys it
  previously synced (per-board baseline `usePrefs.favSynced`), preserves entries added on-table by
  other means, and won't re-add a favorite deleted table-side. Writes wait for
  connected + !isBusy + !preview-sync (the SD rule), debounce 1.5 s, and retry on the next
  toggle/reconnect/idle after a failure (logged to diagnostics, no toasts). UI lives in Browse: a
  tappable heart badge on EVERY grid tile (ember fill when on; a nested Pressable, so it wins the
  touch over the tile), the same toggle in the pattern detail sheet header, and a single-select
  "Show" filter DROPDOWN in the search row (bottom-sheet listing All patterns / Favorites /
  Default / each subfolder — replaced BOTH the old folder-chip row and the heart toggle; owner
  explicitly did not want a second filter line). The trigger reflects the selection (filter-list
  icon; sand fill for a folder, ember heart for Favorites); selecting Favorites with zero
  favorites shows a guidance empty state.
- `src/screens/` — `Browse` (Library|On-Table tabs, circular thumbs, import, push, clear-before-run),
  `Playlists` (create/edit/delete, pattern picker grid, loop/shuffle/pause + pause-from-start/clear/
  auto-home. The firmware holds only ONE global playlist config, so these run options are remembered
  app-side in `usePrefs.playlistPrefs` and re-applied on each run — keyed PER TABLE + filename
  (`playlistPrefKey(base, name)`, `\u001F`-joined), so the same-named playlist can differ per table;
  `usePrefs.playlistPref(base, name)` falls back to a legacy bare-filename entry for prefs saved
  before per-table keying. A playlist with no saved pref gets `DEFAULT_PREF` — **loop + shuffle +
  a 3 h pause between patterns + adaptive clear** (a living sculpture, not a slideshow). That
  default is authoritative: `loadPref` no longer seeds the controls from the board's global
  `$Playlist/*`, which held whatever the last-run playlist pushed and so made a NEW playlist
  inherit an unrelated one's options. Editor edits are local until the editor closes, and closing dirty ASKS
  save/discard — never silently writes; a copy-icon in the editor header copies the playlist to another
  saved table via `copyPlaylistTo`, resolving every item against the TARGET's /sand_patterns catalog:
  same key keeps its path, a file the target keeps in a different folder is re-pointed by file
  name (case-insensitive, target's casing wins), and files the target lacks are DROPPED with a
  "skipped N" toast — no pattern push; an all-missing copy refuses instead of writing an empty list),
  `Control` (home/stop/unlock/speed + quiet-hours + live status), `Led` (effect/palette/
  color pickers, brightness/speed sliders, an intensity slider — WLED's 2nd slider, labelled per
  effect from `LED_EFFECTS[].uses.intensity` (Density/Trail/Flame/Flicker), hidden for effects that
  ignore it and on firmware whose `/sand_settings` lacks `LED/Intensity` — and a Motion-reactive card that mirrors the dw web app:
  you **"Save current"** the selected effect as the `$LED/RunEffect`/`$LED/IdleEffect` override —
  the board stores only an effect per hook, palette/colours/speed/brightness are global — plus a
  Clear per hook, instead of picking a different effect from a dropdown), `Settings` (tables + Wi-Fi
  + homing mode/orientation + reboot + app/firmware updates).
- `src/components/` — `PolarPattern` (static SVG path preview), `LiveDrawing` (the expanded player's
  signature view: the full pattern on a disc whose rim is a glowing progress ARC in the `live`
  color — sweep driven by the same `pct` as the linear bar, so the between-patterns pause fills it
  too; NO live-ball dot (owner removed it); falls back to `PatternThumb` inside the disc when no
  local geometry exists), `PatternThumb`, `NowPlayingBar`
  (swipe up/down to expand/collapse), `Screen`, `ui.tsx` (`Button`/`Card`/`IconButton`/`Slider` —
  the `Slider` is PanResponder-based, no native dep), `IdleGate` + `IdleGateBanner`
  (**the gate covers writes to the BOARD, and nothing else** — its scope is a contiguous block of
  Settings, from `WifiCard` down to `StillSands`. **A PAUSE is not a stop**:
  `IdleGate`/`isSettingsLocked(status)` gates board-CONFIG writes and OPENS while the table is
  paused — a feed hold isn't stepping and firmware ≥ `SETTINGS_IN_HOLD_MIN_FW` (v0.1.18-rc2) accepts
  those NVS writes in `Hold` via its `holdOk()` opt-in, so pausing is the quick way into Settings
  mid-playlist. The version gate lives INSIDE `isSettingsLocked` (older firmware answers every
  write with IdleError, so a pause there stays locked) — callers can't forget it. The
  between-patterns gap unlocks too (the firmware genuinely sits in Idle there), but only with
  >`PAUSE_UNLOCK_FLOOR_S` (10 s) left, so a 3 s gap can't flap the lock open or let a write race
  the next pattern's start.
  **What is deliberately OUTSIDE the gate, and why** — a running table is no reason to lock a
  screen that isn't writing to it, and a locked-out log viewer is worst exactly when something is
  going wrong mid-pattern: the Tables card (above the banner; switching tables is safe),
  `CatalogCard` (imports from a picked file — its only board read, flipping back to the live
  catalog, is `loadTable`, which already defers itself to the next idle), the preview library,
  App branding, `DiagnosticsCard`, and `UpdatesCard` (release notes + the update check are
  GitHub/App-Store reads, never the board). Wi-Fi and OTA stay INSIDE the gate but are not dead
  ends in the window a pause opens: they reboot the table, which no pause survives, so instead of
  refusing they stop it themselves after saying so in the confirm dialog (`lib/stopFirst.ts`).
  The ONE control a pause doesn't free is **preview sync** — it streams shards off the same
  single-threaded SD the paused job still holds its `.thr` open on — so that single Button is
  disabled on `isJobLocked(status)` (isBusy OR a live playlist, gap included) with its own inline
  reason, rather than dimming a card whose other half (importing from Files) is local.
  Homing MODE + sensor offset are `holdOk` firmware-side — they're consulted at home time and
  resuming never re-homes — so they change freely while paused; only `AlignOrientation` inside
  that card stays strictly idle-gated, since it JOGS via
  `/sand_goto` and `SandApi::goTo` requires a true `Idle` (it 409s in `Hold`, which the sheet's
  retry would spin on forever).
  ONE banner sits under the Tables card, with exactly ONE inline button: **Pause** wherever a
  pause would help (it opens Settings without ending the run — pairing it with Stop only invites
  the destructive one), **Stop** exactly where a pause can't (already held, or firmware too old to
  unlock on a hold). A feed hold works from Idle too (FluidNC goes straight to `Hold`, and the
  playlist only starts its next pattern from `Idle`), so Pause is also the button during the
  between-patterns gap: it keeps the next pattern from starting and holds Settings open past the
  gap instead of relocking as it winds down — which is why the banner STAYS UP through that gap
  ("Between patterns — pause to keep settings open.") but not through a manual pause, where
  nothing is dimmed and nothing is about to relock. The gate dims to 0.55 (values stay readable), blocks touches, and
  re-applies the ScrollView's card `gap` (a wrapper View otherwise collapses it).
  The banner is normal-flow, NOT an
  absolute overlay — an overlay covers a short card's whole content and iOS height-constrains
  overlay text to one truncated line. `ClearPatternsCard` follows the same `!isSettingsLocked`
  rule for its own row-level disabling),
  `Onboarding`, `Toaster`, `AlignOrientation`
  (crash-homing pattern orientation, in Settings' Homing card: crash home never moves theta — the
  arm's direction at home time BECOMES theta=0 — so the sheet nudges the ball around the perimeter
  via absolute `/sand_goto?theta=` jogs (`board.rotateTo`, seeded from live status.theta, 409-retry
  while the previous jog finishes) until it points "East" (viewer's right), then homes to lock it in.
  Mirrors dw's Pattern Orientation Alignment dialog).
- `src/lib/` — `thrGeometry.mjs`, `patternGeometry.ts`, `patternSource`/`pushPattern`/`importPattern`/`playlists`.
- `metro.config.js` adds `thr` to `assetExts`. `app.json` has `assetBundlePatterns` for `assets/thr` + `assets/previews`.

## Conventions / gotchas
- After geometry/UI changes, verify with: `npx tsc --noEmit` and `npx expo export --platform ios` (bundles
  + confirms assets resolve). There are no unit tests.
- **Stacked Modals**: a second `<Modal>` rendered as a sibling won't present over an open one (iOS) —
  nest it inside the first Modal's tree (see the playlist pattern picker).
- **Design language ("the table from above, at night")**: warm basalt/sand palette (NOT the web
  app's gray+blue — see `src/theme/index.ts`, the single token source), **circular pattern
  thumbnails**, **pill-shaped controls** (`radius.pill`). Type roles: Bricolage Grotesque display
  (`font.family.display`) for screen titles / pattern names / the Control state word; system font
  for body/controls; IBM Plex Mono (`font.family.mono`) for ALL telemetry (times, %, feed, θ/ρ,
  IPs, versions). Fonts load in App.tsx via `expo-font` (render-gated). Palette rules: `primary`
  (sand) = user actions; `live` (patina) = things happening on the table NOW (progress fills, live
  ball, active-state dot) — never swap them; destructive buttons are OUTLINED ember, not filled;
  never hardcode `#fff` on a primary/destructive surface — use `primaryForeground`/
  `destructiveForeground`; on/off settings use `ui.tsx`'s `Toggle` (sand track), NEVER a bare
  `Switch` (the stock iOS green fights the palette). Thumb-grid sizes derive from
  `useWindowDimensions` (NOT module-scope `Dimensions.get` — iPad split view resizes the window).
  Every `IconButton` takes a `label` (VoiceOver). The sibling touch-panel repo intentionally uses a DIFFERENT accent (Ember) — do not
  "reconcile" them.
- No native discovery module installed — tables are added by IP/hostname manually. mDNS browsing
  (`react-native-zeroconf`) would need a custom dev build; the firmware advertises `_http._tcp` with TXT
  `api=sandtable/1`, `model=dune-weaver`.
- The firmware now drives the **on-board LED ring directly** (`$LED/*`, `led{}` in status) — this is no
  longer Pi-only. The LED screen hides Color/Color2/Palette controls per the active effect's needs
  (see `LED_EFFECTS[].uses` / `ledEffectInputs` in `board.ts`).
- Out of reach (need the Pi backend, not the firmware): networked **WLED** controllers, MQTT,
  play-count/last-played history, server-rendered preview cache, multi-table discovery.
  (Favorites were on this list but are now implemented app-locally — see the Favorites bullet.)
