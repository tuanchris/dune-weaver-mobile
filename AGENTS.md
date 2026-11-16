# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v58.0.0/ before writing any code.
Expo SDK **58.0.23** (React Native 0.88.1, iOS 27 SDK: the UIScene life cycle, so builds need Xcode 27+). The app is managed Expo; `expo-file-system` uses the **new `File`/`Directory`/`Paths` class API** (not the legacy functional API) — and since SDK 58 `File.write()` is ASYNC, so the app uses `writeSync()` (as does the desktop shim).

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
  `$THR/Feed=`, `$LED/Effect|Palette|Color|Color2|Brightness|Speed|Intensity|Count|Order|RunEffect|IdleEffect=`,
  `$Sands/Enabled|Slots=` (quiet hours), `$Hostname=` (rename, fw ≥ v0.1.18 — see the rename
  bullet), `$X` (unlock from Alarm; the app's Unlock first sends the Ctrl-X reset via
  `GET /restart_reload`, because a soft/hard-limit alarm is FluidNC's Critical state, which `$X`
  answers Ok and leaves alone; the route redirects to a 503 page, so its status is ignored), `$Bye` (reboot). Built with
  `encodeURIComponent` on the whole `plain` value (the firmware `arg("plain")` URL-decodes it).
  EnumSetting values are case-insensitive (`strcasecmp`); booleans are `ON`/`OFF`.
- Files: `POST /upload?dontlist=yes` multipart (`dontlist`: no directory listing in the reply) (file part's **filename = full SD path**, e.g. `/patterns/x.thr`;
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
  pattern detail sheet; "Add & send" swaps the import preview for the detail body IN THE SAME
  sheet before pushing, so progress is visible (two sheets would be a present/dismiss handoff).
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
  the firmware is too old to report its mcu and the release ships BOTH images, `FirmwareCard`'s
  `startInstall` asks the user which board it is up front ("ESP32 (most tables)" / "ESP32-S3
  (DLC32 MAX)") and passes the answer as `forceMcu` — asking beats guess-flash-fail-retry (owner
  call), a wrong pick is rejected safely (old firmware keeps running; the failure toast says to
  try the other choice), and the question disappears once the table runs mcu-reporting firmware.
  Update checks
  live in `src/lib/updates.ts` + `src/stores/useUpdates.ts` (app: iTunes lookup / Play page scrape /
  desktop's latest GitHub release of `tuanchris/dune-weaver-desktop`, tagged with the bundled mobile
  version; all fail-safe to "unknown"); a count badge on the Settings tab (`tabBarBadge` = the
  number of pending updates, 1–2, in `AppTabs`; computed in App.tsx) + the Firmware / About rows
  of the Settings list (red dot + "Update available") surface them; the pages hold `FirmwareCard` /
  `AppVersionCard` (both in `UpdatesCard.tsx`). Checks re-run on the Settings list's focus (10 min max-age) and
  the 6 h throttle only arms after a FULLY successful check — a failed/partial one retries, so a
  stale "up to date" self-heals. The fetched "latest" is app-global; only `status.fw` is per-table.
  **Installing a SPECIFIC version**: `FirmwareCard` (Settings › Firmware) has an "Install a specific version…" button
  (real tables only) opening `FirmwareVersionPicker` — a sheet listing every GitHub release with a
  flashable image (`fetchFirmwareReleases`, lazy per-open, newest first), marking the installed one
  and flagging Newer/Older/Pre-release; each row's line is the release's section headings
  (`notesSummary` — not the intro sentence every release repeats). Tapping a row opens that
  release's NOTES as an in-sheet page (one sheet at a time) with the install button pinned at the
  bottom ("Install vX" / "Downgrade to vX" / "Reinstall"). Installing runs the same `runFirmwareUpdate` OTA flow (it
  takes the whole release and picks the per-MCU image); the confirm dialog adapts wording
  (Install / Reinstall / Downgrade) and the splash shows the target version. **EVERY release is
  installable, including the installed one** (that's the Reinstall path, and the escape hatch when the
  app misreads which build is on the table — an rc3 table that couldn't reach its own final release
  is exactly how this was found) — with ONE exception: when the table's mcu is KNOWN and a release
  has no image for it (pre-S3 releases on an S3 table), the row is tagged "Not for this board" and
  its notes page says so in place of the install button, because that flash can only ever be
  rejected. "Installed" identity uses `sameVersion`/`versionTag` (exact tag
  string, `v`-stripped, git_info tail dropped) and NOT `parseVersion`'s numeric key: the key
  deliberately ignores prerelease tails it doesn't model, so any unknown tail (`-beta1`) or, before
  v1.1.1, `-rcN` collapses several distinct builds onto one key and badges the wrong one as
  installed. `relation()` in `UpdatesCard.tsx` returns `re` only on that exact match — an equal key with
  differing tags falls through to the neutral "Install" wording. **Beta toggle**: prereleases are
  HIDDEN by default behind "Show beta versions" (`usePrefs.showPrereleaseFirmware`, persisted;
  also filters the firmware "What's new" list) — except the build on the table, which is always
  listed so a tester on an rc can see and re-flash where they are.
  **Release notes ("What's new")**: both rows in the About card link to a shared
  `ReleaseNotesSheet` — a bottom sheet with a deliberately small markdown renderer (headings,
  bullets, inline `**bold**`/`` `code` ``/links; hard-wrapped lines are JOINED into the bullet
  above, since the firmware's release bodies wrap at ~80 cols, and inline markdown is stripped
  AFTER joining, since a bullet's `**bold**` often spans the wrap; a short plain line with no
  closing punctuation straight above a list is that section's heading, which is how the firmware
  notes title sections). The renderer (`Notes`) is shared with the version picker's notes page. Firmware notes are the GitHub
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

### Rectangular (CoreXY) tables (firmware ≥ v0.2.1-rc3 with `kinematics: CoreXY`)
The firmware plays plain G-code (`.gcode`/`.gc`/`.nc`, e.g. Sandify output) through the same run /
playlist / clear commands; `.thr` plays only on round tables. On such a table `/sand_status` carries
`kinematics` and **`x`/`y` in machine mm instead of `theta`/`rho`**, and `feed` is 0.
- `translateStatus` sets `Status.cartesian` (= the status has `x`) plus `x`/`y`; `theta`/`rho` read 0.
  `useIsRect()` (`components/RectTable.tsx`) is the UI's switch: live status, else "has a saved size".
- **Size** = the board's `$/axes/x|y/max_travel_mm` (`board.travel`, a `/command` `$/` read that
  answers in the body and 503s while moving). `useStatus` reads it once per app session per table, and AGAIN after the table restarts (uptime
  going backwards: a new config only lands on a restart — one booted on FluidNC's defaults reported
  1000 × 1000 and the frames stayed square after it came back),
  while idle (60 s retry) and saves it on the board (`Board.travel`), so it draws right offline or
  mid-pattern. Not typed in: it's the envelope the firmware's soft limits and goto clamp use.
- Drawing (`RectTable.tsx`): G-code's y points UP (machine 0,0 = bottom-left), like Sandify's
  preview. `TableRect` is Control's hero. Every list frames a rectangular table's patterns in
  `useThumbFrame()` (the table's own proportions, not a disc). Inside it, `PatternThumb` shows the
  pattern's preview IMAGE (`RectPreview`: the bundled png, or the one rendered on import) and
  falls back to `RectPattern` (live SVG of the geometry; `PolarPattern` dispatches G-code names to
  it, which also covers `LiveDrawing`'s fallback). Image and live drawing share
  `lib/gcodeGeometry.mjs`: the viewer's 96% inset and `max(1, width/600)` stroke. Every G-code
  view (preview image, live drawing, the Fast player, Now Playing) frames a pattern by its OWN
  extent (0,0 to its max x/y), never the table's travel: some of DWCX's own files reach y 320 on
  its 307 mm travel, and framing by travel cut their tops off. Geometry is
  `parseGcode` (`lib/gcode.ts`, mm points, decimated) via `useLibrary.ensureXY`, from the bundled
  or imported file.
- Browse lists only what the table can draw (`isGcode(name) === rect`): on a rectangle that is the
  bundled G-code set (`bundledNames(rect)`, see "Bundled defaults") + imports + the card's G-code;
  the playlist picker lists the card's. Import takes G-code there (`importThr(rect)`), and the
  missing-previews banner stays off (every bundled G-code pattern has its preview, and the card's
  preview bundle is `.thr`-only).
- Control: Clear tiles are the card's `clear_*` G-code files (no stock set — the firmware's own
  clears point at whatever the config / `$Playlist/ClearIn|Out` name), Move ball is Center only
  (`/sand_goto?x=&y=`; Home already parks in the corner), telemetry is X/Y mm.
- Speed is the override PERCENT (`SpeedControl percent`, `/sand_feed?pct=` 10–200) — `mm=` 400s.
- Settings hides Homing (crash mode, θ offset and orientation are polar; CoreXY always `$H`s), and
  Playback's clear card hides Clear speed (`$Playlist/ClearSpeed` is read only by ThetaRho).
- LEDs: `LedRing` draws the strip round the RECTANGLE (`rectPoint`: evenly spaced on a rounded
  rect from 12 o'clock, clockwise — the ring's order), `size` = width; the gallery goes 2 columns.
  The Ball tracker mode is hidden: the firmware's ball effect follows θ and, without ThetaRho,
  draws only its background — `ledSim.ts` mirrors that exit (`ball.angle < 0`) and
  `ringDots` too (`ball.at < 0`).
- Favorites are shared by every table, so the Favorites-playlist sync writes only the active
  table's kind (`isGcode(k) === status.cartesian`) — the firmware skips unplayable entries and 5 in
  a row cancel the run. Browse's Favorites filter counts only visible kinds; Copy-to-table offers
  only tables of the same shape (`!!Board.travel === rect`).
- Control's clear tiles match `clear_*` AND `wipe_*` G-code (the firmware's CoreXY config template
  names its wipes `wipe_in/out/sideway.gcode`). `CLEAR_DESC` is worded to hold on both shapes;
  adaptive is random on a rectangle (G-code has no first ρ).

## Pattern library + previews + upload
The app is the source of truth for LOCAL patterns; it never reads pattern DATA (.thr) back off the SD
for previews. Card-only patterns (bulk-loaded via the website's SD Card Pattern Manager) get their
thumbnails from the card's **preview bundle** instead — see the previewSync bullet below.
- **Bundled defaults (100)**: `npm run gen-geometry` reads `../dune-weaver/patterns/` and emits
  `assets/thr/<name>.thr` (decimated to `MAX_POINTS=15000`, the pushable copy) + `assets/previews/<name>.webp`
  (dw's pre-rendered preview) + `assets/pattern-manifest.js` (static `require()` maps `THR`/`PREVIEW`).
  Metro needs literal require paths, so the manifest is generated.
- **Bundled G-code (rectangular tables)**: the same run copies EVERY top-level `.gcode`/`.gc`/`.nc`
  in `../dwcx-patterns/patterns/` (the Sandify-made set, see its README) verbatim to
  `assets/gcode/` and RENDERS each one's preview into `assets/gcode-previews/<stem>.png`
  (`scripts/rectPreview.mjs`, no dependencies), mapped as `GCODE`/`GCODE_PREVIEW`. Adding a
  pattern to the app = drop the file there and re-run `npm run gen-geometry` (Node 20; the
  round assets come out byte-identical). The previews follow dune-weaver-viewer's thumbnails
  (`mac/Shared/ThrPath.swift`): the finished pattern, inset to 96%, stroked at `max(1, w/600)` px
  with round caps and joins. The image is ONLY the grooves, black on transparent, so the tile's
  frame is the table and `tintColor` (the theme's ink) makes it follow light/dark like an SF
  Symbol. Format per the HIG (`images.md`): an 8-bit PALETTE png (256 alphas of black, 1
  byte/px) with an sRGB chunk, 1080 px wide = the 360 pt detail view at @3x. The preview file
  drops the pattern extension (`x.png`, never `x.gcode.png` — a second assetExt in a name trips
  Metro's dev server, like the `.thr` webps). `.gcode`/`.gc`/`.nc` are Metro `assetExts` here AND
  in `../dune-weaver-desktop/metro.config.js`.
- **Previews**: bundled patterns render their image (`PatternThumb` → `<Image>`); imported/unbundled
  render **live SVG** from geometry (`PolarPattern`, geometry derived on demand by `useLibrary.ensureXY`)
  until `PreviewGenerator` has rendered theirs (once, on import: a webp for `.thr`, a png at the
  bundled previews' size, inset and stroke for G-code). Those are the INK previews; on a round
  table a thumbnail shows SAND first when it has one (see "Sand previews").
- **Import**: `expo-document-picker` → parse/validate → decimate → save to `Paths.document/thr/` →
  `useLibrary.addImported`. See `src/lib/importPattern.ts`.
- **Pattern Hub** (`src/lib/patternHub.ts` + `components/HubPane.tsx`, round tables only — the hub
  is `.thr`; desktop too, see below): duneweaver.com/patterns (dune-weaver-website, `lib/pattern-hub*.ts`)
  keeps `catalog.json` (`{version: 2, launched, patterns:[{id, title, author, license, preview,
  bytes, …}]}`) and every preview webp in a PUBLIC bucket (paths relative to it, CORS `*`, no auth),
  so everyone sees the catalog. The `.thr` files are PRIVATE: **downloads are for Dune Weaver plan
  owners only**. Each file is `hubFetch('/api/patterns/<id>/download', {method:'POST'})` → `{url}`
  (a ~10 min signed URL, asked for just before that file so none expires mid-sync) → `expo/fetch`.
  A 403 `code:'not_a_buyer'` throws `NotMemberError` and sets the account to `notMember`; that or
  `SignedOutError` ENDS the run (`result.error`): what already downloaded stays, there's no "N
  didn't download" toast, and the hub tab's panel shows the matching state. **Launch gate**: the website
  writes `launched` (its `PATTERN_HUB_PUBLIC`) into the catalog, and Browse's Pattern Hub tab needs
  `useHubVisible()` = `launched || admin` — so the app can ship before the site
  launches the hub. `launched` comes from ONE successful catalog read per app session and is SAVED
  (`usePrefs.hubLaunched`), so a launch that can't reach the hub (table-only Wi-Fi) keeps the tab; a
  failed read is retried on the next foreground. Signed out, the tab still shows (it's where a plan
  owner signs in).
  **Sign-in** (`src/lib/hubAuth.ts`): OAuth authorization code + PKCE S256 (`lib/pkce.mjs`) against
  the website's public client `duneweaver-app`, redirect `duneweaver://oauth` (`app.json`
  `"scheme": "duneweaver"`), in the system sign-in window (`expo-web-browser`
  `openAuthSessionAsync`); site = `EXPO_PUBLIC_DW_SITE ?? 'https://duneweaver.com'` (point it at a
  preview deploy to test). SecureStore keys, `AFTER_FIRST_UNLOCK`: `dw.hub.pending` (`{verifier,
  state, at}`, honored for 15 min, so an EMAIL LINK that opens the app from cold still finishes —
  `useHubAuthLinks` (App.tsx) catches the `duneweaver://oauth` deep link; no pending, a different
  `state` or an old one is refused with a toast, never exchanged) and `dw.hub.refresh` (the
  rotating refresh token; the ~1 h access token lives only in memory). Refresh is SINGLE-FLIGHT
  (one shared promise): the site revokes the whole grant when an old refresh token is replayed,
  so two refreshes at once would sign the user out. Only `invalid_grant`, no refresh token, or a
  401 after a refresh signs out — a network error never does (table-only Wi-Fi). `useHubAccount`
  = `unknown | signedOut | member | notMember` + email + admin + `checkedAt`, read from `GET
  /api/patterns/me` on each focus of the account page and each switch to Browse's Pattern Hub tab. Every change
  is saved to AsyncStorage `dw.hub.account` and restored at launch, so an offline launch still
  shows who is signed in. `checkAccount` (launch + every foreground, `useHubAuthLinks`) re-reads
  /me ONLY when the account is `unknown` or a week old (`RECHECK_MS`): with no access token in
  memory every /me ROTATES the refresh token, and a reply lost after the site rotated (app killed,
  Wi-Fi switched to the table's hotspot) leaves a superseded token the site answers with
  `invalid_grant`, i.e. a sign-out. The weekly read also keeps the 365-day grant alive for
  someone who never opens the hub. The keychain still decides: no refresh token = `signedOut`.
  **`unknown` with a stored token is SIGNED IN** (/me not answered yet, or failing right after
  the code exchange — `refreshAccount` turns `signedOut` into `unknown` when a token exists), so
  nothing offers Sign in for it (a second sign-in would orphan the stored grant): the Settings
  row shows the email or "Signed in", the account page "Signed in. Can’t reach duneweaver.com
  right now.", the hub tab "Checking your duneweaver.com account…" then that line + Try again.
  Settings › On this
  phone › **duneweaver.com** (`settings/AccountSettings.tsx`): Sign in, or the
  email + plan status, **Open Pattern Hub** (`navigate('Browse', { tab: 'hub' })`; Browse reads
  the `tab` param and clears it; shown when the hub is visible on a round table), Sign out
  (best-effort revoke) and, in its own card at the foot of the page behind a confirm, Delete account… (opens `${SITE}/account/delete`), then for a plan owner
  (same visibility as Open Pattern Hub) a Pattern Hub card with the auto-download toggle. A finished sign-in
  toasts "Signed in as <email>". The hub tab's panel: signed out → "Pattern Hub is for every
  Dune Weaver plan owner. Sign in with your duneweaver.com account to sync its patterns to your phone
  and table." + Sign in; not a member → "Pattern Hub
  downloads are for Dune Weaver plan owners." + "Use the duneweaver.com account your plan is
  under." (a Hide My Email Apple sign-in matches no order; this is the user's only hint) + the
  email + Use another account (sign out, then sign in); member → the sync buttons. **No purchase
  wording and no shop links anywhere in the app** (App Store 3.1.1 / 3.1.3). **Desktop has the hub
  and the account too** (owner's call, 2026-11-16: on par with mobile), through its shims
  (`../dune-weaver-desktop/shims`): `expo-secure-store` = Electron `safeStorage`; `expo-web-browser`
  opens the sign-in page in the system browser and answers `cancel`, which keeps the pending
  sign-in; the site's `duneweaver://oauth` redirect reaches the app from the OS (`main.js`
  registers the scheme) and arrives as a `Linking` 'url' event (`shims/linking.ts`), so
  `useHubAuthLinks` finishes it as it does an email link; `expo-crypto` = Web Crypto. Desktop's
  Sync to table is the per-file path (no `UploadTask`), running while the app is open. `npm run check-hub-auth` checks PKCE,
  the refresh/sign-out rules and the saved-account / weekly re-check rules offline. Browse has two
  tabs, a `Segmented` **Library | Pattern Hub** under its title (only where the hub is visible;
  otherwise Browse is just the library). The hub tab mounts on its first visit and then stays
  mounted, hidden with `display: none`, so a sync keeps its progress and Stop across a switch to
  Library. It is: a search row (search + Tags), a PANEL (the account states above, or for a
  plan owner the scope summary + ONE **Sync to table** button, then progress + Stop while running;
  no phone-only sync, owner's call 2026-11-15: people don't keep patterns on the phone) and the
  catalog as a grid, newest first with the starter set LAST (as the website's hub does: it ships
  with every table and is bundled here; `license === 'dune-weaver-starter'`). Only the search row
  is fixed (like the Library tab); the panel is the grid's first header item and scrolls away, so
  browsing gets the whole screen. It PINS above the grid (never at the bottom: on iOS 26 a tab
  screen's bottom is under the glass tab bar and the mini player) only while something is picked
  or a sync runs; the two spots line up, so the tiles don't jump when it moves. The grid: a
  tile's glyph marks what's still MISSING, like the Library's phone glyph (cloud = only on the
  hub, phone = on this phone but not the table, none = on the table; never a check, which would
  read as the pick badge). Tap to pick (the panel's **Deselect** drops the picks; never "Clear",
  which is a sand word here), nothing picked = all. TOUCH AND HOLD a tile for its details, a `fit`
  sheet laid out like a Library pattern's: the disc, "by <author>", the description (few have
  one), the tags as chips (a tap filters the grid by that tag and closes the sheet), where it is
  · size · license (`CC-BY-NC-4.0` shown as "CC BY-NC 4.0"; the starter set as "Dune Weaver
  starter set") and Select / Deselect. **Votes** (`lib/hubVotes.ts` + `components/HubVote.tsx`, as on the website: ↑ score ↓
  in a pill, your vote in sand, the same vote again takes it back) sit in that sheet under the author, and in the Library
  tab's detail sheet for any file that is a hub pattern's version (`useHubIdFor`: the session's catalog read; the
  starter set counts), only where the hub is visible. Scores = the site's public `GET /api/patterns/votes` once a
  session; your votes = `GET /api/patterns/my-votes` once per account; `POST /api/patterns/vote` with the app's
  token (website a1b04dc, 2026-11-15: both routes take the app's token via `hubPrincipal`). Any signed-in account with
  a verified email votes, plan or not (the site's rule); signed out, a tap says where to sign in. A search or tag with no results says so and offers
  **Show all patterns**. **Sync to table** downloads whatever the phone lacks into the library like an
  import (`.thr` verbatim to `Paths.document/thr`, the hub's webp to `Paths.document/previews` as
  `previewUri`, so PreviewGenerator has nothing to render), then
  `pushToTable`s every pick the table lacks (bare-name match, so a copy in a subfolder counts), one
  file at a time behind a size/time confirm — gated on `isJobLocked` + preview sync, keep-awake held,
  Stop checked between files, the first send error ends the run. Both stages show "n of N · title"
  and a size-weighted bar, plus a time-left estimate per stage (the rate since a point 5 s in,
  shown after 5 s more: from the stage's start, connection start-up and the first burst into the
  phone's send buffer threw it way off; time away from the app not counted). iOS gives the batch
  upload's `bytesSent` as a BigInt (`tableBatch.ts` takes `Number()` of it: mixed into the math it
  threw on every event and the bar never moved). **On firmware >= v0.2.3 the table stage runs in the
  BACKGROUND** (never on the demo table: it reports v99 with no server to send to, so App Review's
  sync takes the per-file path; `supportsBatchUpload(fw, base)`) (owner's call, 2026-11-15; `lib/tableBatch.ts`): the phone writes ONE multipart body
  with every file (no `<path>S` size fields: the firmware refuses a request's 33rd non-file field) to the cache and Expo's `UploadTask` sends it as one
  request, `sessionType: 'background'`, so on iOS the shared background URLSession carries on with the
  app suspended or the phone locked. ONE request because the table's single-threaded server can't take
  several connections (Expo's background session allows a few per host) and chaining one task per file
  from a suspended app gets throttled by iOS. It needs v0.2.3: the firmware feeds its 120 s task
  watchdog per upload chunk (older builds panic on a request that long) and adds each uploaded pattern
  to `/patterns/index.json` itself (so the app writes no manifest on this path). On Android the
  foreground service `modules/sync-service` (local Expo module, type `dataSync`, one ongoing
  "Syncing patterns" notification with the progress; POST_NOTIFICATIONS asked on Android 13+;
  `lib/syncService.ts`) keeps the process alive for any Sync to table (not the phone-only
  auto-download); **Play Console needs the foreground-service declaration (data sync) for it**.
  **While a batch sends, the table answers nothing else** (owner: the user must know they can't do
  anything meanwhile, and see progress): `useHubSync.receiving` = its base; `board.ts`'s Proxy refuses
  every call to it at once with `TableReceivingError` (`setTableReceiving`); `useStatus.holdForSync`
  keeps the poller off, so `resume()` on returning to the app doesn't fail polls into "offline";
  Control's lock reason reads "Receiving patterns" (Home and the clears off), Playlists' Play is off,
  the IdleGate pages say so, `act()` refuses with the reason, and `SyncBanner` on every screen adds
  "The table can't do anything else until this is done." The confirm says it up front. The body is
  written a file at a time with a `prepare` progress stage ("Preparing n of N", yielding between
  files), then the upload's byte progress maps to files. A batch the app
  didn't see finish (failed, stopped, or iOS finished it after the app was killed) is settled by
  `settlePendingTableSync` (launch + foreground, `useSettlePendingTableSync` in App.tsx): it re-reads
  the table's list and records the hub revision of every NEW file there (`dw.hub.pendingTableSync`);
  an overwritten file can't be told from its old copy and is sent again next time. If the marker is
  recent (`at` + its `bytes` at 40 KB/s + 2 min: iOS may still be sending it after purging the app) and
  the table doesn't answer, `waitOutBatch` shows it RECEIVING, not offline (same locks; the header dot
  in `live`, Control's state word "Receiving"; the banner and hub panel "Sending N patterns to the
  table · started X min ago", no percentage or Stop: the system's task isn't reattached), and checks
  `/sand_status` every 20 s past the gate (`board.tableAnswers`) until it answers, then settles. Swiping the app away
  (iOS) or force-stopping it (Android) still stops it. Downloads from the hub stay in the foreground
  (seconds). On older firmware the stage is per file as before, and it runs only while the app is
  open: iOS suspends it seconds after it leaves the screen, and the progress panel asks people to keep
  the app open while it runs. So it PAUSES: a file that failed after the app left (or
  started just after it came back) is retried once the app is active again, with growing waits for about a minute (`resumable` in
  `patternHub.ts`: coming back, the request in flight fails with "The network connection was lost" and Wi-Fi takes a while
  to rejoin, so one retry after 2 s wasn't enough), and the sync carries on. Its progress is a store (`useHubSync`) so
  every other screen shows it too: `SyncBanner`, rendered by `Screen` (`hideSync` on Browse's hub tab, whose panel shows it),
  a tap opens the hub tab. During a sync the tiles' picks are fixed but touch and hold still opens the details. File names follow the WEBSITE's rules so everything dedupes: the starter
  set maps back to the bundled file (`starterId(file)` = the seed script's id), community patterns
  get `downloadFilename(title)` — keep `slug`/`starterId` in step with the website's
  `cardFilenames` (`lib/pattern-hub-types.ts`), which the installer's SD card Pattern Manager uses to
  load the hub onto a card under the same names. The website now gives each file its name ONCE
  and keeps it (catalog `file`, its `hub_meta/file_names`), so a title edit or a newer pattern with
  the same title never renames a file; the app uses `file` and keeps the rule for older catalogs.
  **Updates** (a sand-weaver re-import, an admin replacing a version; owner's call 2026-11-12:
  changes reach the phone, the table and its playlists): each catalog file has a `rev` (start of
  its fingerprint). A hub download records it (`LibraryPattern.hubRev`; one from before revs whose
  size equals the catalog's `bytes` gets it on the next catalog read) and a push records it per
  table (`Board.hubSent`, set in `pushToTable`; a table that listed the file before revs gets the
  phone's OLD rev as the phone's copy is replaced). `staleHubFiles` = copies whose rev differs.
  The phone's are downloaded again by `useHubAutoSync` for every plan owner, auto-download on or
  off ("Updated N patterns"). The table's wait for the user (no card I/O the user didn't start):
  the hub tab counts an older copy as missing (update glyph on the tile, "Updated on the Pattern
  Hub" in its details) so Sync to table sends it, and Browse's Play sends it first (no "Replace?"
  ask). Either way it goes over the old file under the SAME name, so every playlist naming it
  plays the new drawing — playlists list files, nothing in them changes. Replacing an import drops
  its cached geometry, and the Fast player's path cache keys on the import's id. Preview URLs
  carry `?r=<rev>` (the bucket ignores it) so cached ink and sand images refresh; the hub's
  renderer re-renders on a rev change.
  **Versions per table size**: a hub pattern can come in a version for each of the hub's sizes
  (website `HUB_TABLES`: `pro` = DW Pro, `mini-pro` = DW Mini Pro, simplified with bolder lines;
  sand-weaver makes both). The catalog's top-level `preview`/`bytes` are the MAIN file, `table`
  says what it's made for (absent = any table) and `versions: [{table, preview, points, bytes}]`
  lists the others. A version's file name is the main one with `-<table>` before `.thr`
  (`owl.thr` → `owl-mini-pro.thr`; `<id>-<table>.thr` when taken), so each version is its own
  file on the phone and the table and a Gold can hold a mix; keep it in step with the website's
  card names. `POST …/download?table=<t>` sends that version (the main file when there's none). `EXPO_PUBLIC_DW_HUB` (the bucket
  root, trailing slash) points the catalog and previews at a test copy, as `EXPO_PUBLIC_DW_SITE` does the site.
  Which version a table takes is `hubTable(board)` (`lib/tableSize.ts`, by `roundSize`): Pro-sized
  (≥ 600 mm) the Pro one, Mini Pro-sized (≤ 300 mm) the Mini Pro one; IN BETWEEN (a DW Gold,
  custom sizes) the owner chooses — the Pro one by default (owner's call, 2026-11-13), switched for every pattern by
  the hub tab's "Versions for this table" control (a card in the grid's header, shown only there
  and only when some pattern has two versions; switching drops the per-pattern picks), or for
  one pattern in its details sheet (mix and match; `Board.hub = {table, picks}`, per table,
  `useBoards.setHubTable`). A pattern with one version shows it everywhere. `forTable` resolves
  the catalog for the active table (the grid, the sync, the auto-download); the details sheet
  says "made for a DW Pro" when the shown version names a size. Hub tags are saved under every
  version's name. The SD card Pattern Manager still loads main files only (website follow-up).
  The search covers title, author and description; Tags is a `fit` sheet (the catalog's
  `tags`, by count; a sand filter button when one is on, like Browse's Show); with nothing picked
  the buttons act on what's SHOWN. **Hub tags stay in the app**: every catalog read
  (`fetchHubCatalog`) saves `usePrefs.hubTags`, `tagKey(file name)` (folders dropped,
  lowercased) → tags, and NOTHING is written to a table. Because the bundled set, hub downloads
  and the card's copies share the hub's file names, the tags apply to all of them; Browse's Show
  filter and the playlist picker filter by them (see Favorites / Playlists). `readCatalogOnce`
  (the once-per-session read) runs from Browse and the playlist picker everywhere, desktop
  included. **Auto-download** (`usePrefs.hubAuto`, off by default; "Download new patterns" in
  Settings › duneweaver.com, shown only to a plan owner where the hub is visible, since it's set
  once and the grid comes first; it runs only for a plan owner; `setHubAutoDownload`):
  `useHubAutoSync` (App.tsx) fetches the catalog at launch and on
  foreground (hourly at most, after the library hydrates) and downloads every id not in
  `usePrefs.hubSeen`. Switching it on reads the catalog and marks it all as seen (~30 MB of community
  patterns; Sync all covers those), and an id joins `hubSeen` once it's on the phone, so a failed
  download retries and a deleted one stays deleted. PHONE ONLY: it never sends to the table (the
  owner's rule from preview sync: no card I/O the user didn't start). `syncHub` runs one sync at a
  time (a promise queue), so a manual sync waits for the auto one and skips what it downloaded.
  **New patterns get a red mark** (owner's call, 2026-11-11): `useNewHubPatterns()` = the session's
  catalog read, this table's version, not on the phone, not in `usePrefs.hubSeen` (the auto-download's
  list) nor `usePrefs.hubShown` (already announced); only where Browse shows the hub (round table)
  and for plan owners. While it's non-empty: a COUNT badge on the Browse tab (`tabBarBadge`, both
  `AppTabs` files, the nav theme's notification red like Settings' update badge; an empty badge
  draws nothing on iOS) and a red dot on the "Pattern Hub" segment (`Segmented` option `dot`). No
  banner on top (owner: the red dot is enough). Opening the hub tab adds them to `hubShown`: both
  clear and return only when more are published. `hubShown` is kept apart from `hubSeen` so looking
  never stops an auto-download. (A first-time owner with auto-download off is told about every hub
  pattern not on the phone once.) While the table can't take a sync, Sync to table is disabled with
  the reason under it (`tableReason`: no table, offline, busy, preview sync). **No upload in the app**
  (the "Share your own pattern" link was removed 2026-11-15: people don't keep pattern files on the
  phone); uploading is the website's `duneweaver.com/patterns/upload`, whose `POST /api/patterns` needs
  a Firebase ID token the app's tokens can't stand in for. The site's
  hub pages 404 for non-admins until `PATTERN_HUB_PUBLIC` (website `lib/pattern-hub-types.ts`).
- **Push to table**: holds an `expo-keep-awake` lock for the transfer (an auto-locked phone suspends
  the app mid-upload; the firmware OTA, `runFirmwareUpdate`, holds one too). Read the decimated `.thr` (bundled asset via `expo-asset`, or imported file) and
  `board.uploadFile` to `/patterns/<name>`. See `src/lib/pushPattern.ts`.
- **On-card catalog stays in step**: `src/lib/tableManifest.ts` — after a push/delete, best-effort
  read-modify-write of `/patterns/index.json` (a hub Sync to table writes it ONCE per 25 files and at the end,
  `strict` so a failure is retried/logged: per file it was a GET + a ~20 KB rewrite, ~2 s a pattern on a DW Gold) (the firmware serves it VERBATIM from `/sand_patterns`
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
  (`lib/previewCoverage.ts`, `useMissingPreviewCount`) — and taps through to Settings › Patterns via
  `navigate('Settings', { screen: 'Patterns', initial: false })` (`initial: false` keeps the
  Settings list underneath, so Back lands on it; `src/navigation.ts` types the params with
  navigator-agnostic `NavigationProp`, so the native and web tab navigators share them). Dismissal is persisted
  (`usePrefs.previewNagDismissedCount` = the missing count when dismissed) and the banner returns only
  if MORE patterns end up without a thumbnail, so a partial sync doesn't re-nag. Manual import
  (`importPreviews.ts`, Settings) accepts individual images OR the bundle's `.zip` shards directly
  (unzipped with `fflate`) — the offline path to load a bundle into every table without pulling it off
  each card. **iOS container gotcha**: `usePreviews` persists preview image refs as bare FILENAMES and
  rebuilds the absolute `file://` uri under the current document dir on hydrate (`resolvePreviewUri`).
  iOS rotates the app-container UUID on every app UPDATE, so a persisted absolute Documents uri goes
  dead after an update (the key survives → count looks right, but `<Image>` loads blank).
  `useLibrary` stores absolute `thrUri`/`previewUri` but `rebase`s a dead one on hydrate (same
  filename under today's `Paths.document/thr|previews`) — without it, PUSHING an imported or hub
  pattern failed after every update. The brand logo still has the latent bug.
  **Sync ↔ motion are mutually exclusive** (shared single-threaded SD): sync only starts when the
  table is idle and, while shards stream, sets `usePreviews.syncing` — motion-START actions (run
  pattern/playlist, home, clear, move to center/edge, skip) disable + refuse via `assertNotSyncing()`
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
- **Create (text generator)**: Browse's "+" menu › **Create from text** opens `TextGenerator`
  (`components/TextGenerator.tsx`): words written on the table in ONE continuous line.
  **HELD BACK from 1.4.0** (owner's call, 2026-11-14): `CREATE_TEXT` (exported by
  `TextGenerator.tsx`) is `false`, so Browse's "+" imports straight away (no menu), the one-time
  callout never shows (its `createHintSeen` stays unset, so it shows once the feature ships), and
  Settings › Table size leaves Create out of its copy. To ship it: set it `true` and add its line
  back to the release notes (`APP_CHANGELOG`, both fastlane notes). The
  engine is `src/lib/sandText/` (plain JS, no deps; `index.mjs` layout + exporters, `inlay.mjs`).
  **Fonts** (one strip of tiles, each drawing "Abc"; single-line first, a divider, then outline):
  - Single-line (`fonts.mjs`, baked once from their sources, edit glyphs there; a glyph is
    `[advance, x0, y0, …]` in em, capital height 1, y up, joining line y 0): **Sandskrit**
    (SandSkrit by UnintelligibleMaker, github.com/xplo2be-alt/Sandskrit-Image-Pattern, MIT; its 82
    characters; its `!` had the dot on top, so it's Sans's), **Sans** and **Script** (Sandify's
    Raysol fonts; Script joins a lower-case letter after b/o/v/w in its raised form, `joinAfter`),
    **Capitals** (Sandify's Monospace grid font, lower case drawn as upper). A character one lacks
    borrows Sandskrit's.
  - Outline (`outlineFonts.mjs`, baked once from Sandify's bundled TTFs with opentype.js: ASCII
    32–126, curves flattened, simplified to 0.003 em; a glyph is `[advance, regions]`, a region
    `[outline, ...holes]`): Serif (EB Garamond Bold), Brush script (Lobster), Geometric
    (Montserrat Bold), Slab (Holtwood One SC), Marker (Permanent Marker), Rounded (Bubblegum
    Sans), Handwriting (Caveat Bold), Heavy (Roboto Black). RENAMED on purpose: they're
    converted copies and Lobster/Bubblegum reserve their names under the OFL; the originals,
    copyrights and the OFL/Apache texts are in Settings › About (`notices.mjs`).
  - **Symbols** (`symbols.mjs`, baked once from Noto Emoji — OFL, Sandify's bundled copy — with
    opentype.js: 51 popular emoji chosen to read as bold line art in sand, ♥ being U+2665's solid
    heart; each centred, its larger side 1, regions like an outline glyph). TYPED in the text (any
    font, either style) a symbol draws like an outline letter, 1.2 em, on the joining line; every
    coloured heart (❤️ 💙 🧡 …) is ♥, and emoji presentation selectors, joiners and skin tones are
    dropped. PLACED (Inlaid only, up to 40: `symbols: [{ ch, x, y, size, rot }]`, x/y −1..1 of the
    half width / height, size its larger side's share of the table's smaller side, rot degrees
    clockwise) a symbol is an inlay unit
    like a letter; `keepOnTable` moves it in (and if it's bigger than the table, shrinks it) until
    its outline is a ball inside the edge, so the raking's turns along the edge keep half a ball
    clear of it. The engine applies it, and so does the canvas while a symbol moves. A symbol's
    size is measured in BALLS across its larger side, so it follows the table: it READS WELL from
    `goodSymbolSize` / `symbolBalls` (10 for bold shapes, 14 for some detail, 20 for faces,
    animals and busy pictures; tiers set from sim renders of all 51, 2026-11-14) and may go down
    to `minSymbolSize` = 6 balls (the owner found the tiers too big as a hard minimum, so they're
    advice: below its tier the inspector and the status line say its details blur). New symbols
    start at max(22%, the floor). The TEXT block moves too
    (Inlaid only; `place: { x, y, rot }`, its centre and turn; `keepTextOnTable` moves it in
    until it lies a ball inside the edge, and on a rectangle shrinks a turned block that can't
    fit). On lines it stays centred: its rows run to the edge.
  A character no font has is left out and named in the status line. Accents are dropped (NFKD)
  and typographic quotes/dashes made plain (iOS types ’). Up to 8 rows (`MAX_LINES`), 160
  characters. **Layout**: the block fits 90% of the table (round: every letter inside 0.9 R;
  rectangle: 90% of each side), then Size (30–100%); Rows = Same size, or Fill each row (each
  row as wide as its place on the table allows, at most twice the smallest; iterated on row
  boxes, then fitted on the letters). **Style**:
  - **On lines** (SandSkrit's and Sandify's way): every letter starts and ends on a JOINING
    LINE under its row; rows run back and forth. An outline letter is reached by a tick from the
    line to its outline's point nearest the line and traced round; its other rings (holes, an
    i's dot) are bridged in from the nearest ring already reached (`glyphWalk`, cached per
    character). Next row = Along the edge (every row's line runs edge to edge, the ball moves
    along the rim or frame edge to the next row) or Beside the text (a short line beside the
    wider row; only the first and last lines reach the edge).
  - **Inlaid** (sand-weaver's inlays, `experiments/region-program/inlays.js`): a host rakes the
    sand round the letters, 0.3 ball apart. Background = **Spiral** (the default since
    2026-11-14): one line out from the centre (a rectangle's: a rectangular spiral from a core
    along its long side, each side a pitch further out a turn, meeting both edges at once), out to
    a disc 1.2 balls beyond the furthest letter or symbol (Raked area 0%) through that share of
    the rest to the table's edge (100%). **Lanes**: straight lanes at 45° over a band across the
    table round the text (same 0%–100%), swept from top left to bottom right, joined along the
    host's edge. Each letter is a unit drawn right after the host's LAST pass within `ZONE` (1
    ball) of it, at the point the host leaves that zone: a step in, the letter, the same step out.
    Nothing passes it afterwards, and every move between letters lies under later passes. ZONE was
    half a ball until the sim showed the passes after a letter plowing its far side (every
    letter's lower right worn on the lanes host: the "right side cut off"); at one ball the edge
    stays crisp, with a clean halo, and the step in and out is still short. Units: an outline font's part, Solid =
    its own lanes across the host's (lanes clipped to the outline and holes, joined along their
    rims — a lane's ends lie on the outline and the gap between two pieces is bounded by one rim —
    then the outline once round), or Outline = each ring traced twice round from its door
    (sand-weaver rule 51); a single-line font's WORD, out to one end along its line and back to
    the other (its joining line stays under the word: Sandskrit's E and L use it as their
    bottom bar). A SYMBOL's part (placed or typed) is filled by sand-weaver's contour fill
    (`sandText/contour/`, vendored: lanes are level lines of a smoothed distance from its outline
    and holes, drawn as spirals from the deepest, the outline last), so the lanes follow the
    shape (a rainbow's bands are arcs); straight lanes across a symbol read as noise (sim,
    2026-11-14). LETTERS too (the owner's call, 2026-11-14: "concentric alongside the stroke"), with
    NO smoothing (`LETTER_FILL = { smooth: 0 }`: rings parallel to the stroke, crisp corners, an
    engraved inline look; the smoothed field wobbled inside letters and the straight hatch was
    rejected — sim comparisons of both on three texts, 2026-11-14); the straight-lane `fillRegion`
    stays only as the fallback for a part too thin to fill. The ball steps in at the outline's
    point nearest the host, runs ALONG the outline to its point nearest the fill's start and steps
    straight in (a straight line to the start crossed out of concave letters and over finished
    ones: the fill's last lap retraces the outline, burying the way in), and after the outline's
    lap runs along it to the point nearest the host before stepping out. Each symbol's fill is
    cached by shape and pitch (~100–170 ms the first time in Node), so typing never refills one.
    Detailed symbols (animals, the globe, the crown) are busy at the default 22% size; bigger
    reads better. Every symbol stays Noto Emoji's own drawing (a mirrored full-arch rainbow was
    tried and dropped, 2026-11-14: it no longer looked like the emoji); the picker, the chips and
    the inspector show that line art (`SymbolIcon`), never the system's emoji, so what's picked is
    what's drawn on every platform. Lengths: a band ≈ 35–100 m, the whole table ≈ 130 m of lanes plus the letters
    (on 700 mm). Known weak spot: a small counter (Brush script's o) gets busy, the fill going
    round it on every lane.
  Lines and the Lanes background start and end AT THE EDGE (ρ 1 on a round table), so an
  adaptive clear before them runs from the centre; the Spiral starts AT THE CENTRE and, raking
  the whole table, ends at the edge. Frames are as seen on the table: x right, y up. **Table size**
  (`ballOf`): a rectangle's travel is real mm, its ball 10 mm. A ROUND table's size comes from
  `src/lib/tableSize.ts` (`roundSize(board)`): set by hand in Settings › Table size
  (`Board.size`), else its MODEL's — the config name the table reports (`$/name` via
  `board.configName`, read by `useStatus`'s `learnTable` like a rectangle's travel: once per
  session and after a restart, while idle; saved as `Board.model`, e.g. "Dune Weaver Pro
  (Pulley) ThetaRho", "Dune Weaver Gold ThetaRho"; matched Mini Pro, then Gold, then Pro) —
  else a DW Pro's. Sizes (sand diameter / ball, mm, the owner's; balls 2026-11-11): Pro 700/10, Gold
  395/8, Mini Pro 250/8 (the sand preview's engine uses the same balls, the viewer's `TABLES`). The firmware's `rho_mm` is motor mm (20 on every model) and says
  nothing about size. The same size picks which Pattern Hub version a table gets (`hubTable`, see the
  Pattern Hub bullet). The ball's share of the table sets the lanes' pitch, the band's margin,
  the inlay clearance and the small-letters warning, so a Mini Pro is raked proportionally
  coarser than a Pro; Create says which size it used, under Rows. **Orientation**:
  `.thr` θ = atan2(−y, x), i.e. as the app draws a `.thr` (x = ρcosθ right, y = ρsinθ DOWN the
  screen) — sand-weaver's DW Pro calibration (its sim view is reflected; it delivers π − θ) shows
  that this is how the table draws it from above. `.thr` steps are cut so none bows more than
  0.0005 R off its line (`thrSteps`: a step of length L at distance r from the centre bows about
  L²/8r; 0.002–0.03 R, and 0.0005 R where a step passes within 0.002 R of the centre, where θ
  swings fast; at ρ < 0.0001 θ keeps its last value, since there it means nothing), so long
  lanes stay a few points; G-code is `G1 X Y` mm from the travel's
  lower-left corner, opening `G1 F5000` (FluidNC refuses a move before a feed). Letter size,
  from sand-weaver's DW Pro sim (700 mm, 10 mm ball): 38 mm capitals read, 26 mm blur, so the
  status line warns under 3.2 balls (32 mm). The sheet is ONE editor page (canvas first, since
  2026-11-14), FULL SCREEN (`Sheet variant="full"`): the CANVAS PINNED on top (`SymbolCanvas.tsx`,
  as wide as the screen but at most 45% of the measured height, so the controls keep the rest —
  the iPhone Duo's short outer display left them no room at 60%; on a WIDE window (wider than
  1.15× its height: iPad, an open Duo held sideways, desktop) the canvas sits LEFT and the
  controls RIGHT) shows the DESIGN, not the pattern: every
  text's letters (`host: 'none'` layouts, centred, as filled shapes) and every symbol, filled
  even-odd, moved directly. Nothing there lays out the pattern: the host spiral and the symbols'
  contour fills took up to a second a change on the phone (the owner: "lagging resizing and
  moving emojis… let user free move stuff first, we'll render after"), so the pattern is laid out
  only by PREVIEW and SAVE. A DRAG moves a text or a symbol straight away, controls hidden
  (they'd be in the way; one finger snaps to the centre lines within 8 pt, a guide shows); two
  fingers pinch and twist it. A TAP shows its controls (dashed box; corner handle resizes, the knob
  above turns, snapping within 5° of a quarter turn; the ✕ at the top-left corner removes a symbol,
  or a text when there are others), ANOTHER TAP hides them (the owner's call, 2026-11-14: easier to
  move things around); a pick from the strip shows them; a tap on the sand selects nothing. A gesture moves only the canvas (its own copy of the state, PanResponder refs, the scroll
  locked) and hands the result over on release. Under it the status line (errors, small letters,
  else what a gesture does), Preview, then a STRIP of what's on the table as chips: Pattern (tune
  icon), each text (its first row), each symbol, + (the Add page: Add text, then the emoji grid).
  Every edit works from the strip and sliders too (HIG: gestures need another way). SEVERAL TEXTS
  (up to 8; Inlaid; `layoutText({ texts })`, each its own text, font, size, rows and place; On
  lines draws only the first, its rows running edge to edge). The inspector below shows the
  selection: a TEXT (the first is selected on opening: what people come to write) = its field,
  the font strip (outline fonts first, Geometric leading: `ORDER` in index.mjs, a divider, then
  the single-line ones), Size (30–100%), Turn (Inlaid), Rows, Centre (Inlaid), Remove (when there
  are others); a SYMBOL = Size (from its per-table minimum, said under it in % and mm), Turn,
  Centre, Remove; PATTERN = Style (On lines: Next row; Inlaid: Background = Spiral /
  Lanes, Raked area slider, Letters and symbols = Solid / Outline) and the table size it's laid
  out for, then Name (placeholder: the suggested name — the first row, else the first symbol's
  label). DEFAULTS: Inlaid, Spiral, Raked area 100% (the whole table), Solid, Geometric,
  "Dune" / "Weaver", centred. PREVIEW (in-sheet page) lays the pattern out a beat after it opens
  and shows Path (the ball's path: letters in ink, the raking faint) or, on a round table,
  SAND: the sand engine (`SandView` given the unsaved `.thr` text as `thr`, instead of a library
  name) after the table's clear, Play / Pause and Finished sand. Save lays it out again. Each
  symbol's contour fill is cached in the part's OWN frame (its outline's centre, unturned by its
  `rot`), so moving or turning one never refills it (18 ms vs 224 ms); only a new size does. The sheet is the JS one on iOS too (`Sheet native={false}`): a
  native pageSheet follows any vertical drag inside it and cancels the touch. The one in-sheet
  page is **Add a symbol** (a grid of the emoji, up to 40 placed; a pick returns to the editor
  with it selected, at the first free spot of eight). Browse's "+" gets a one-time callout
  ("New: write on your table", `usePrefs.createHintSeen`, false after an update or a fresh
  install, true until prefs load so it never flashes) that the "+" or its close clears. Layout takes ≤ 45 ms for 160 characters under `node
  --jitless`, so it redraws on every keystroke. Cancel/Save in the header; a dirty sheet isn't
  swipe-dismissible and asks Keep editing / Discard (/ Save); setters hand back the same recipe
  when nothing changed. Rectangular tables need the table's size (`useTravel`; Create toasts
  until it's known). Names: the first row's words ("Text" when empty); a pattern extension typed
  into Name is dropped; a name any pattern in the library or on the table uses (in any folder)
  gets " 2", said under the Name field, and an existing file is never overwritten. Save writes
  with `savePatternText` (`lib/importPattern.ts`, shared with import; full resolution),
  `addImported`s it (PreviewGenerator then renders its preview), and Browse opens its detail
  sheet (Play sends then draws). The sheet remembers the last recipe per table kind for the
  session. `npm run check-text` runs every font on both table shapes and every layout in both
  styles, every symbol placed and typed, and placed symbols at the edge: on the table, starting and ending at the edge, no `.thr` step bowing off its line,
  continuous θ, G-code inside the travel, rows reading the way the app draws them, the spiral
  starting at the centre (and ending at the edge when it rakes the whole table), and (inlay, both
  backgrounds) no host pass within half a ball of a letter drawn before it (a negative control — letters
  spliced where the lane enters their zone — fails it). The earlier Sandify generator (shapes,
  effects, layers; vendored engine) was removed on 2026-11-10; its files are in
  `/Volumes/SSD/projects/_archive/dune-weaver-mobile-sandify-2026-11-10.tgz`.
- **Sand preview** (`components/SandView.tsx`, round tables, iOS/Android): Browse's preview player
  (`PatternPlayer`) runs the Sand Weaver sand engine — the same physics as sand-weaver's
  `dwpro-v6` profile — after the table's own clear, with the steel ball, in a `react-native-webview`
  (WebGL2 + `EXT_color_buffer_float`). It's dune-weaver-viewer's Sand page (`web/index.html`)
  without its controls: the app's transport drives it (`sandPlayer.play/pause/seek/speed` via
  `injectJavaScript`, commands queued until the page posts `ready`) and the page posts back
  `{f, playing, phase}`; the engine keeps the clock, and playback waits for it ("Simulating the
  sand…"). **Source chain**: sand-weaver `sim/` → dune-weaver-viewer `web/engine` (its
  `sync-engine.sh`) + the baked clears (its `bake-clears.mjs`) → `npm run gen-sand`
  (`scripts/gen-sand.mjs`), which writes `assets/sand/`: `index.js` (the page as ONE string —
  engine, `clears.js` and `scripts/sand-page.js` in a single inline module with imports dropped,
  because a file:// page can't load modules; KEY; FILES requires) plus each table's baked clear
  (`<DWP|DWG|DWMP>-from-<rim|centre>.bin`, ~4 MB for all six, `bin` is a Metro assetExt) and
  clear pattern (`.thr`). Only the `.bin`s are bundled assets (FILES); the clear patterns ship as
  text in `TEXTS`, written into the cache folder by SandView: an Android RELEASE build names each
  raw resource without its extension, so `x.thr` beside `x.bin` fails `:app:mergeReleaseResources`
  with "Duplicate resources" (dev builds load from Metro and never hit it). The `.thr` files stay
  on disk for the hub's sand renderer, whose `prepare.mjs` copies them by name. It refuses a bake whose hash doesn't match the engine (the viewer's
  `bakedName`) — re-bake in the viewer, never hand-copy. Never edit `assets/sand/`; edit
  `scripts/sand-page.js` (no `window.sand`: the `<canvas id="sand">` owns that name). At run time the
  page, and the active table's clears, are copied into `Paths.cache/sand-<KEY>/` (the one folder
  the WebView may read: `allowingReadAccessToURL` / `allowFileAccessFromFileURLs`; XHR, not
  fetch) and the pattern text is injected as `window.SAND`. The table is the baked one nearest
  `roundSize(board)` (`sandTable`: ≥ 550 mm DWP, ≥ 320 mm DWG, else DWMP). Any page error or a
  killed web process falls back to Fast (logged to diagnostics as `sand-preview`). Web/desktop
  (`SandView.web.tsx`, desktop; owner's call 2026-11-16: on par with mobile) runs the SAME page in an
  `<iframe>`: the clears are prepared in the same cache folder (`lib/sandFiles.ts` `prepareSand`,
  shared with `SandView.tsx`), which desktop serves as `app://cache/…`; the page goes in as `srcdoc`
  with a `<base>` there (its XHRs find the clears), reads `window.SAND` from the app's window
  (`__dwSand[id]`, same origin) and its `ReactNativeWebView.postMessage` comes back the same way. So
  the player, Create's sand preview and on-device sand thumbnails work there (Chromium encodes the
  still as WebP). The page stays untouched (it's the KEY). Desktop's metro lists `bin` as an assetExt.
- **Sand renders are tinted on display, never in the render** (owner's call, 2026-11-11): hub
  and on-phone renders stay the engine's neutral grey; `SandTint` (PatternThumb.tsx) and the
  sand player's injected overlay (SandView, `injectedJavaScript` — NOT the page, which is the
  engine KEY and would re-render the hub) blend theme tokens over them: `sandLight` (#FFF8EC,
  MULTIPLY: the table's warm ring light, option B of four engine tints, matched within 1/255)
  and, in light mode only, `sandLift` (#FFF1DC, SOFT-LIGHT) so they don't sit too dark on the
  paper. Retune by editing the tokens; no re-render.
- **The app's sand grid and light** (owner's calls, 2026-11-11/12, from side-by-sides and a
  photo of a real Mini Pro): the app (player, on-phone previews, and the hub's previews, made by
  the same page) simulates on the viewer's `APP_GRID` (`clears.js`), not the 2048 grid the
  viewer's own page and sand-weaver use: 768 plow cells across every table, rendered at 1024,
  with the ring light's height and shadow reach scaled to the table (`scaleLight`), so a Gold or
  Mini Pro is lit at the DWP's angle. 768 holds the DWP look at ~1/6 of 2048's work (512 breaks
  fine raking into moiré); the DWP's 20 mm ring height on a 250 mm table lit it ~3× steeper and
  washed it out, where the real table shows dark grooves and the head's fine terraces.
  `bake-clears.mjs` bakes both grids; `gen-sand` copies the app's.
- **Sand previews** (owner's call, 2026-11-11): every round pattern's thumbnail is the sand
  engine's FINISHED sand, after the table's clear, on the active table's size (`useSandTable`:
  `sandTable(roundSize(board))` → DWP 700 mm / 10 mm ball, DWG 395 / 8, DWMP 250 / 8, the viewer's
  `TABLES`; the same balls as Create's `tableSize.ts`). Made by the player's own page in STILL
  mode (`window.SAND.still`, `scripts/sand-page.js`: clear + pattern simulated to the end, cut
  to the disc, a data URL; no ball). Two sources, never bundled in the app:
  - **The Pattern Hub has it** (by file name: the bundled set = the starter set, hub downloads,
    the card's copies): `previews/sand/<DWP|DWG|DWMP>/<id>[-<version>].webp` in the hub bucket,
    the ink preview's name under the table (`sandPreviewUrl`; website `publicSandPreviewPath`).
    Each catalog read saves `usePrefs.hubPreviews` (tagKey → the ink preview's bucket path,
    beside `hubTags`) so Library tiles find theirs; the hub grid and details use the entry's
    own. `SandImage` (PatternThumb.tsx) layers the sand over the ink preview until it loads,
    and drops back to the ink when it can't (offline, not rendered yet); `cache:
    'force-cache'` keeps loaded ones for table-only Wi-Fi on iOS, and `?v=<engine KEY>` on the URL
    fetches them afresh after a new engine (the bucket ignores the query; the pattern's `?r=<rev>`
    does the same after an update). A version's renders cover
    the tables that take it (website `sandTablesFor`: a Pro the pro file, a Mini Pro the
    mini-pro one, a Gold both). The HUB renders them: the website repo's
    `services/sand-renderer` (Cloud Run, us-central1) runs THIS app's sand page (its
    `prepare.mjs` copies `assets/sand` in) on software WebGL, triggered by every write of
    the hub's `catalog.json` (Eventarc): it renders what's missing or was made by another
    engine (object metadata `sandKey` = `assets/sand` KEY) and deletes what the catalog no
    longer lists. Rate-limited (one instance, bursts merged, a daily render budget); see its
    README. **After `npm run gen-sand` (a new engine, clear or ball), redeploy it**, or the
    hub keeps the old renders. `npm run gen-sand-previews` here renders a folder on this
    Mac's GPU (several times faster; for a big backfill, uploaded with the service's `seed`).
  - **Anything else** (imports, Create's): `SandPreviewGenerator` (App.tsx) renders it ON THE
    PHONE, one at a time, in a hidden `SandView` in still mode (PNG out of WebKit → webp via
    `PreviewGenerator`'s `saveCapture`), for the active table's size, into
    `Documents/sand-previews/<engine KEY>/<table>/` (paths computed, never stored; another
    KEY's folder is deleted at launch). `useLocalSandPreview` finds them. 4 min cap a
    pattern; failures go to diagnostics as `sand-preview`.
  Card-only patterns the hub doesn't have keep the ink preview (no file on the phone).
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
  a forced retry and toasts "…will refresh when it's idle")), `useTheme` (NOT persisted: it
  follows the system appearance via RN `Appearance` — read at module load so the first frame is
  right, updated by `addChangeListener`; dark is the fallback; there is no in-app toggle), `useToast`
  (errors linger 7 s vs 2.6 s for info/success), `useAppLog` (local diagnostics ring buffer —
  see below).
- **Custom clear patterns** (`$Playlist/ClearIn`/`ClearOut`/`ClearSpeed`, firmware ≥ v0.1.11):
  `ClearPatternsCard` (Settings › Playback) points the from-center / from-edge clears at any on-table pattern
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
  `/updatefw` calls, and the Wi-Fi POSTs. `SecurityCard` (Settings › Password, hidden for the demo table)
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
  automatically, which keeps diagnostics off the App Privacy label (since hub sign-in, the label
  must list the duneweaver.com account's email, for app functionality, and nothing else).
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
  tappable heart badge on EVERY grid tile (sand `primary` fill when on — favourites are not
  destructive, so never ember; a nested Pressable, so it wins the
  touch over the tile), the same toggle in the pattern detail sheet header, and a single-select
  "Show" filter DROPDOWN in the search row (bottom-sheet listing All patterns / Favorites /
  On this phone (imports + Pattern Hub downloads; only once there are some) / Default / each
  subfolder (labelled by its LAST path segment, so a card's `custom_patterns/…/patterns` reads
  "patterns") / each Pattern Hub tag the library's patterns carry (tag icon + count, most used
  first; see the Pattern Hub bullet's hub tags); a choice whose option disappears falls back to All patterns — replaced BOTH the old folder-chip row and the heart toggle; owner
  explicitly did not want a second filter line). The trigger reflects the selection (filter-list
  icon; sand fill whenever a filter is active, Favorites included, with a heart icon for
  Favorites); the same sheet holds the sort (a `Segmented` above the list — it was a
  fourth button in the search row): Newest (the default: newest first by `LibraryPattern.addedAt`,
  set on import and Pattern Hub download; the bundled set and card-only patterns have no date, so
  they come last, A–Z; owner's call — oldest first looked like A–Z), A–Z, Z–A, and the search placeholder names the scope ("Search 112
  patterns" / "Search in Favorites") so the filter shows without a second line. Selecting Favorites with zero
  favorites shows a guidance empty state.
- `src/screens/` — `Browse` (Library | Pattern Hub tabs, see the Pattern Hub bullet; the Library tab is one grid: bundled + imported + on-table patterns deduped by name,
  circular thumbs with 13 pt names; once the table's list is known, a small phone glyph marks the
  tiles the table DOESN'T have. A hub pattern made in versions per table size shows only the
  version the active table takes (`forTable`'s rule via `usePrefs.hubVersions`, saved on each
  catalog read): a Pro-sized table never lists `owl-mini-pro.thr`, a Mini Pro never `owl.thr`,
  a Gold its pick — even when the phone or the card holds both (owner's call, 2026-11-11; the
  hidden file still counts for Create's name clashes). Search row = search · Show (filter + sort) · "+" (a pull-down drawn in the view, not a Modal, so the generator's sheet can open straight after: Create from text · Import from file; while `CREATE_TEXT` is off it imports straight away) — plain,
  not sand: sand there means a filter is on. The detail sheet: the pattern on its frame (disc or the table's rectangle). TAPPING it
  (only when the app holds a copy; no play badge on it, the owner's call: nothing covers the pattern) opens the
  sheet's `preview` sub-page (a page, not a second sheet — one at a time) with a PLAYBACK
  PREVIEW: on a ROUND table the SAND preview (see "Sand preview"), elsewhere (or when the engine
  can't run) the FAST one below. On a RECTANGULAR table that page also offers full screen — a tap on the drawing, or
  the full-screen button by the controls — never on its own: `FullscreenPlayer`, sideways so a
  wide pattern gets the phone's length. The app is portrait-only with no native orientation
  module, so on an upright window the player's content is laid out landscape and turned 90°
  (turn the phone left to watch; safe-area insets mapped to the turned sides), unturned when
  the window is already landscape (iPad, desktop). It's its own Modal, so Browse closes the
  pattern's sheet, opens the player once `!useAnySheetOpen()`, and reopens the sheet on the preview
  page after (iOS: from the Modal's `onDismiss`; Android/web stack Modals, so at once), showing
  the finished drawing rather than replaying it. The player (`PatternPlayer` + `lib/playbackPath.ts`) is a port of
  dune-weaver-viewer's Fast player (`mac/Shared/PlayerView.swift` + `ThrPath.swift`): the
  pattern draws itself on the phone as the ball moves at constant speed, 30 s for the whole
  path at 1×, speeds 0.25–8× (a tap cycles them), play/pause and a scrubber, a frame gap
  counted as at most 0.1 s, sized to the sheet's width (or the screen's). Nothing reaches the table (its caption
  says so); it starts playing on open, since the tap asked for it, and play from the end
  starts over. `.thr` moves are subdivided
  in theta-rho (0.01 radii) so arcs stay arcs, G-code moves are straight; the path is laid
  out with the previews' 96% inset, simplified to 0.25 pt in runs of 1024 points (a long
  spiral is near RDP's worst case), and drawn by `PathDrawing` with a ball in the ink color
  (not patina: that color means the real table). PERFORMANCE: react-native-svg redraws a
  whole `<Svg>` on any prop change and strokes by outlining the path
  (`CGContextReplacePathWithStrokedPath`), so ONE Svg re-stroking the full path each frame (the
  first version: a moving stroke dash) ran at a few fps. Like the viewer's Ink bitmap, the
  finished part stays put: pieces of 256 points in static `DoneLayer` Svgs of 16 pieces
  (memoized; redrawn only when a piece joins), and only the piece in progress + the ball
  redraw per frame. Only for patterns the app holds (`useLibrary.has`); a
  card-only one shows its static frame. While its path is built the frame is dimmed under a
  spinner, and when none can be built it SAYS so ("Couldn't draw this pattern", play retries) —
  never a silent still image. `playbackPath` caches only successes, so a retry really retries,
  and the player re-lays out whenever it's started with no path for its CURRENT size (a size
  that changed mid-load used to leave it "playing" the still image). Then a line
  saying where it lives ("On the table · <folder>" / "On this phone — Play sends it to the table
  first"), then a "Before drawing" ROW (the remembered clear, `CLEAR_MODES` minus Random, picked on
  an in-sheet sub-page with `CLEAR_DESC` under each — the same list as a playlist's clear) above
  **Play**, the ONE prominent button. Play on a library pattern the table lacks sends it and then
  draws it (`doPush(name, true)`), instead of Send → close → reopen → Play. Send / Re-send is
  secondary; Delete is the outlined-ember destructive style behind its Alert),
  `Playlists` (the list: one row per playlist with a COVER — its first three patterns as
  overlapping sand discs — and its pattern count. The table's `/sand_playlists` gives names only,
  so covers come from `tableCache[base].playlistCovers` (count + first three, persisted), which
  `lib/playlists.ts` writes on EVERY read/write of a playlist file (load, save, copy-to-target,
  delete) and the Favorites sync updates too. The ones it hasn't seen are filled in the
  background by `fillPlaylistCovers` — each file read ONCE, strictly one at a time (module guard),
  standing aside only for a preview sync; mid-pattern is fine, as for loadPlaylist. Pull-to-refresh
  re-reads every cover (edits made in the web app). A cover still loading is a plain disc.
  The running playlist's row is marked in `live` (patina border, dot, "Playing · 3 of 12");
  there is no separate now-playing bar — Skip/Stop are the player's. Editing:
  create/edit/delete, pattern picker grid, loop/shuffle/pause + pause-from-start/clear/
  auto-home. The picker (`add` page) has a row of Pattern Hub tag chips under its search: the
  tags the table's patterns carry (`usePrefs.hubTags`), most used first, single-select (sand when
  on; tap again to clear); a tag, then All, then Add makes a playlist of that tag. Only patterns
  on the table are listed, as before. The firmware holds only ONE global playlist config, so these run options are remembered
  app-side in `usePrefs.playlistPrefs` and re-applied on each run — keyed PER TABLE + filename
  (`playlistPrefKey(base, name)`, `\u001F`-joined), so the same-named playlist can differ per table;
  `usePrefs.playlistPref(base, name)` falls back to a legacy bare-filename entry for prefs saved
  before per-table keying. A playlist with no saved pref gets `DEFAULT_PREF` — **loop + shuffle +
  a 3 h pause between patterns + adaptive clear** (a living sculpture, not a slideshow). That
  default is authoritative: `loadPref` no longer seeds the controls from the board's global
  `$Playlist/*`, which held whatever the last-run playlist pushed and so made a NEW playlist
  inherit an unrelated one's options. Create + editor are ONE `page` Sheet with sub-pages
  (`create` → `edit` → `add` / `clear` / `copy`; the create page flips to the editor in place).
  Pattern-list edits are local (`dirty`) until saved: a clean editor shows ✕; a dirty one shows
  leading **Cancel** (= `closeDetail`'s Keep editing / Discard / Save alert, which also catches a
  blocked swipe and Android back — the sheet is `dismissible={page !== 'add' && !dirty && !busy}`:
  the `add` page's picks live in `picked`, not `items`, so it's never dismissible and
  `closeDetail` ignores it — leave via Back or Add) and a trailing
  prominent **Save** that commits and KEEPS the sheet open (Play lives there; toast "Playlist
  saved") — never a silent write. Shuffle / repeat / pause / clear are NOT part of `dirty`: they
  persist instantly to `usePrefs`, so Cancel/Discard reverts only the pattern list. Options live
  in the grid's scrolling header block: Shuffle and Repeat (`Toggle` rows), "Pause between
  patterns" (−/value/+ stepper and an inline sec|min|hr segmented control — not a `Select`, which
  would stack a sheet) and a "Clear before each pattern" row (current mode label + chevron → the
  `clear` sub-page). **Play** is a full-width primary `Button` in a bar pinned IN FLOW at the
  sheet's bottom (thumb reach) — nothing floats over the grid, so tiles and their remove badges
  are never covered. Playlist-item remove badges are neutral (foreground), not ember — a
  removal is undone by discarding. Copy and Delete are rows at the FOOT of the editor's list
  (Delete in ember, last), away from Add patterns and the remove badges; copy
  sends the playlist to another saved table via `copyPlaylistTo`, resolving every item against the TARGET's /sand_patterns catalog:
  same key keeps its path, a file the target keeps in a different folder is re-pointed by file
  name (case-insensitive, target's casing wins), and files the target lacks are DROPPED with a
  "skipped N" toast — no pattern push; an all-missing copy refuses instead of writing an empty list),
  `Control` — a hero of the table FROM ABOVE (`TableDisc`, in `RectTable.tsx` beside `TableRect`: the sand disc with the ball at the live
  θ/ρ, mapped like the pattern previews: θ = 0 points right; patina while moving, ember in Alarm) with
  the state word, a plain-words subline (pattern + %, "Ball at center", "Between patterns"…), θ in
  wrapped degrees + ρ in mono, and Home / Stop (+ Unlock in Alarm; Home drops to secondary while the
  table moves, Stop is never the primary). Then ONE card: Clear sand (the stock clear files, each
  tile a little `TableDisc` drawing its sweep and where the ball starts — the real webp previews are
  too dense to read small, and the two spirals look identical) and Move ball (Center / Edge pills;
  Edge keeps the arm's angle, so its mini disc shows the ball on the rim where it points now). Both
  need an idle, homed, online table and no preview sync; the card's title says WHY when they're off
  (`lockReason`: offline / syncing / alarm / playlist / pattern / not idle). Speed, then **Restart
  table** as a row with the uptime — `$Bye` behind an Alert that, via `lib/stopFirst.ts`
  `stopFirstWarning`/`stopAndSettle`, says it will stop a running job and does so first. Firmware
  version is NOT here (Settings › Firmware shows it). Clear labels come from `CLEAR_MODES`),
  `Led` — built around the RING: a `LedRing` hero (`components/LedRing.tsx`, SVG dots around the
  sand disc, one per LED up to `$LED/Count` clamped 12–72) showing what the strip shows
  (`status.led.active`, not the chosen effect), ANIMATED like WLED's live view by
  `lib/ledSim.ts` — a LINE-FOR-LINE port of the firmware's `Leds::renderEffect` (same integer
  math, frame clock, speed/intensity meanings; the ball tracker follows the live `status.theta`).
  **Any change to an effect in the firmware's `Leds.cpp` is a change to `ledSim.ts`**. The palette
  tables (`lib/ledPalettes.ts`) are GENERATED with the firmware's by its
  `tools/gen_led_palettes.py` — never hand-edit them. It's simulated on the phone because
  the table's single-threaded web server can't stream frames. Every `AnimatedLedRing` runs off
  ONE shared requestAnimationFrame clock at the firmware's 33 ms frame (`LedRing.tsx`), so all
  rings on screen update in one batched render; each re-renders only itself. They run only while
  visible (hero: tab focused, gallery closed, LEDs on; gallery tiles: their ROW on screen, via
  SectionList viewability, drawn every other frame ≈15 fps — the simulation keeps full speed) and
  never under Reduce Motion, where rings show `ringDots` — a STILL sketch of each effect in the
  user's colors. The gallery groups the effects (Calm · Color · Motion · Sparkle · Flash · Noise · 2D —
  `GROUPS` in `LedScreen.tsx`; an effect left out of every group falls into "More"). 114 of them
  are WLED's, ported line for line in `lib/wledfx/` (`shim.ts` = the firmware's WledFx layer,
  `runner.ts`, `fx_*.ts`, generated `catalog.ts`) and shown only on firmware reporting
  `LED/Palettes`; the firmware's `tools/fx_parity.py` must report every one matching its C++
  twin byte for byte after any change. Picking one resets the sliders to WLED's defaults for it. Gallery
  tiles preview each effect at the DEFAULT speed/intensity (50/128) — what a tap applies, since
  picking resets them — except the playing one, which shows the user's tuning. Every ring
  simulates the strip's REAL length (`$LED/Count`) and pools it into the dots it draws (brightest
  LED per dot, `LedSim.dots(out)`), so a comet laps a 24-dot tile as slowly as the real ring. The
  palette swatches flow at the effect's speed (the firmware's phase rate, on the same clock).
  Rainbow's Size slider SNAPS to the firmware's 9 sizes (`16 << ix/29`: 1/16 … 16 rainbows around
  the ring) and names them — smooth, it sat dead for 29 steps then jumped. Power is the button in the ring's center (sand fill when on; disabled during Still
  Sands quiet hours, which outrank it), effect name + brightness % beneath, then the master
  Brightness slider (always shown — it's `$LED/Brightness`, master over every effect, ball too).
  A `Segmented` Effects | Ball tracker switch replaced the old Ball toggle card (ball is just the
  `ball` effect; switching back restores the last non-ball effect WITHOUT resetting sliders).
  Effects mode: an Effect row (mini ring + name + Browse) opening a `page` Sheet GALLERY of every
  effect as a ring in the user's colors — tapping one plays it on the table immediately and the
  sheet stays open (Done closes) — then only the inputs that effect reads: a Palette row
  (flowing swatch + name + Browse) opening a `page` Sheet of every palette as a still gradient
  swatch (`PaletteGrid`; Default's swatch shows the effect's own colors), color(s) via the wheel
  sheet, and speed / intensity sliders that
  MIRROR WLED's two effect sliders (WLED v16.0.1 `FX.cpp` metadata; the firmware implements the
  same meanings, table in the firmware's COMMANDS.md). Palettes follow WLED's model: `default`
  keeps the effect's own colors, any other palette recolors it, replacing Color on the color
  effects (the first-color picker then hides). `uses.palette` is `true` (auto-hue: every
  firmware) or `'wled'` (only firmware reporting `LED/Palettes` in `/sand_settings` — WLED's 68
  palettes; older firmware has the original eight, id 0 named `rainbow`, and ignores a palette on
  the color effects), resolved by `ledEffectInputs(name, wledPalettes)`.
  `LED_EFFECTS[].uses.intensity` is WLED's
  label (Gap size, # of balls, Spark rate, …; WLED's default "!" shows as "Intensity") and is
  absent exactly where WLED hides the slider; `uses.speed` is WLED's speed label where it renames
  it (Cooling, Gravity, Repeat speed — plasma keeps plain 'Speed', since its speed isn't WLED's Phase) or `false` where WLED hides it (fireworks; also
  off/static, which don't animate). Keep the app table and the firmware in step. Picking an effect in the gallery resets Speed/Intensity to the firmware defaults (`LED_DEFAULT_SPEED` 50 / `LED_DEFAULT_INTENSITY` 128, each effect's designed look) in the same `$Sand/Led` command, like WLED's "use effect defaults"; the power button and the mode switch restore an effect WITHOUT resetting. The intensity
  slider is also hidden on firmware whose `/sand_settings` lacks `LED/Intensity` (settings are re-read on every focus of the tab and whenever `status.fw` changes: the tab stays mounted across an OTA, and the count may change in Settings). A table whose `/sand_settings` has no `LED/Effect` gets an empty state, not a page of dead controls. Then a
  link row to Settings › LED strip (shown when `/sand_settings` has `LED/Count`; the strip's count
  and color order live there: they're what the strip IS, set once, not what it shows) — and a "While playing or idle" card that mirrors the dw web app:
  you **"Save current"** the selected effect as the `$LED/RunEffect`/`$LED/IdleEffect` override —
  the board stores only an effect per hook, palette/colours/speed/brightness are global — plus a
  Clear per hook, instead of picking a different effect from a dropdown), `Settings` — a STACK in
  its tab (`screens/settings/SettingsStack.tsx`, `@react-navigation/native-stack`, `headerShown:
  false`), laid out like iOS Settings: `SettingsScreen` is the list — saved Tables (switch / rename
  / remove, which asks first — Cancel / destructive Remove; add-by-IP folded behind a button), then
  rows grouped by WHERE the setting lives, each showing its current value: the active table's
  name heads Playback (auto-play on boot, clear patterns, auto-home), Still Sands (+ the table
  clock), Homing, Table size (round tables: Create's sizing, `TableSizeSettings`; stored on
  the phone, so not gated: From the table / DW Pro / DW Gold / DW Mini Pro / Custom), LED strip (only when the table reports `LED/Count`: `$LED/Count` + the
  `$LED/Order` color-order picker, shown only on firmware that lists `LED/Order` — 6 RGB + 6
  W-last RGBW orders, plus whatever the table has if it's another of the firmware's 30; both
  idle/paused settings, numeric fields save on `onBlur` because react-native-web never fires
  `onEndEditing`), Wi-Fi, Password, Firmware; "On this phone" heads duneweaver.com (the Pattern Hub
  account), Patterns (previews + imported catalog), Branding, Diagnostics, About. Row values come from status, local stores and ONE
  `/sand_settings` read per focus of the list; each page reads its own. Pages wrap their cards in
  `SettingsPage` (`table` = the table's name above the title; `gated` = the IdleGate below), on
  `Screen`'s `back` row — our own header, not the native nav bar, so safe areas and the iOS 26
  accessory behave as on every tab.
- `src/components/` — `PolarPattern` (static SVG path preview), `LiveDrawing` (the expanded player's
  signature view: the pattern DRAWING ITSELF AS THE TABLE DRAWS IT, on a disc (or the table's
  rectangle) whose rim is a glowing progress ARC in the `live` color — sweep driven by the same
  `pct` as the linear bar, so the between-patterns pause fills it too. The drawing is
  dune-weaver-viewer's player (`PathDrawing` + `lib/playbackPath.ts`, shared with Browse's
  preview player): the grooves so far and a ball at their tip, both in the ink color. The tip
  goes where the POLLED ball is (`NowPlaying.ball`: status x/y mm on a rectangle, ρ·cosθ/ρ·sinθ
  on a disc, mapped by the path's own `place`): `locate()` in `playbackPath.ts` takes the point
  of the path nearest it, searched only within ±2% of the file around `NowPlaying.drawn` =
  `Status.fraction` (the firmware's UNROUNDED progress, the share of the file's bytes executed,
  queued moves netted out — `SandStatus::executed_percent`), so a path crossing itself can't
  jump passes, and where it retraces itself (maze walls) the candidate nearer the file's
  estimate wins. File share alone was off by ~10–25 mm (its 0.1% steps, planner lag);
  `npm run check-playback` checks the tip lands on the ball. `useChase` eases the tip along
  the path's LENGTH across each 1 s poll and snaps on a new pattern. Whole pattern between
  patterns (`drawn` 1), and shown whole (no ball) while homing or with no file running. A
  clear (a Control tile, or a playlist's / Play's clear before a pattern) follows like any
  pattern: the firmware reports the clear file as `file` with ITS OWN progress, the
  `clearing` flag only marking the phase. Still ONE ball, the drawing's tip (the owner removed a separate live-θ/ρ
  dot). Patterns the app has no copy of fall back to `PatternThumb`), `PatternThumb`, `NowPlayingBar` (four parts in one file:
  `MiniPlayer` = Pause/Resume + Skip only, tap to open (the floating one also swipes up) — **no Stop in the mini bar**
  (a one-tap stop was too easy to hit; the expanded player and Control have one). On iOS 26+
  (`NATIVE_ACCESSORY` in `lib/layout.ts`, mirroring react-native-screens' gate — set it `false` as
  a kill switch) it rides in the native tab bar's `bottomAccessory` (`regular`/`inline` placements,
  set only while something plays — `undefined` removes the glass capsule). The accessory content is
  **rendered twice**, so `MiniPlayer` must stay stateless: no Modals, no fetches, no per-instance
  clock. Both copies draw the SAME content: react-native-screens before 4.30 hid the other
  placement's copy by layer opacity, which UIKit resets, so both could show at once — identical
  copies then line up exactly. 4.30 (SDK 58) hides it with `hidden`; keep them identical anyway,
  it costs nothing. The tab bar never minimizes, so `inline` is the hidden copy anyway. A
  rectangular table's thumbnail sits on a small framed table (`MiniThumb`). Everywhere else `Screen` renders it in flow (`placement="floating"`) as its last child —
  no absolute positioning, no tab-bar-height constant. `useNowPlaying()` derives the display from
  status + ONE module-level `session` clock (pattern start, last file, pause anchor), updated
  idempotently at render, so every copy agrees on elapsed time. `NowPlayingSheet` is the expanded
  player (`fit` Sheet: content height, so a rectangular table's short frame doesn't leave a tall
  empty page; queue as a sub-page, keeps Stop), mounted ONCE in App.tsx; its open state
  is the `usePlayerSheet` store, and the auto-open on a playlist start waits for
  `!useAnySheetOpen()` and for full screen to be closed. On a rectangular table, tapping the
  drawing (a full-screen badge on its frame) shows the live drawing in `FullscreenPlayer`, sideways,
  with the same close-sheet → open → reopen-on-dismiss handoff as Browse's preview. The sheet's body
  is `PlayerBody` + `QueueList` + `FullPlayer`, shared with `NowPlayingPane`: the UNFOLDED layout
  (see the iPhone Duo gotcha), mounted ONCE in App.tsx over the half of the window `Screen` gives
  up, always up while split (the player while anything plays, else `IdleTable`: the table at rest),
  with its own queue toggle. The pane never scrolls the player (owner's call): `PlayerBody
  compact` (one-line name, "up next" as one short row, a smaller play button); book mode sizes
  the drawing to the height its measured rest (`onRestHeight`) leaves; laptop mode puts the
  drawing beside a column spread over the half's height. While split the mini player (accessory and fallback) hides and the
  sheet never auto-opens. The playlist file behind "up next"/the queue is read ONCE for both
  (`useUpcoming`, a module store keyed by base + playlist)), `Screen` (header = branding logo + table chip/switcher only — no theme or
  restart buttons; screen title below; the pill is `TablePill.tsx`, shared with `NowPlayingPane`), `AppTabs` (see the native-tabs gotcha), `Sheet` (see the
  sheets gotcha), `ui.tsx` (`Button`/`Card`/`IconButton`/`Slider`/`Select`/`Segmented`/`Toggle` —
  the `Slider` is PanResponder-based, no native dep), `IdleGate` + `IdleGateBanner`
  (**the gate covers writes to the BOARD, and nothing else** — it wraps the GATED Settings pages
  (`SettingsPage gated`: Playback, Still Sands, Homing, LED strip, Wi-Fi, Password). **A PAUSE is not a stop**:
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
  going wrong mid-pattern: the Settings list (its table header just says "Locked while drawing";
  switching tables is safe), and every "On this phone" page — Patterns (`CatalogCard` imports from
  a picked file; its only board read, flipping back to the live catalog, is `loadTable`, which
  already defers itself to the next idle), Branding, Diagnostics, About (release notes + the
  update check are GitHub/App-Store reads, never the board). Firmware is a table page but NOT
  gated, and Wi-Fi's reboot actions aren't dead ends in the window a pause opens: both reboot the
  table, which no pause survives, so instead of refusing they stop it themselves after saying so
  in the confirm dialog (`lib/stopFirst.ts`).
  The ONE control a pause doesn't free is **preview sync** — it streams shards off the same
  single-threaded SD the paused job still holds its `.thr` open on — so that single Button is
  disabled on `isJobLocked(status)` (isBusy OR a live playlist, gap included) with its own inline
  reason, rather than dimming a card whose other half (importing from Files) is local.
  Homing MODE + sensor offset are `holdOk` firmware-side — they're consulted at home time and
  resuming never re-homes — so they change freely while paused; only `AlignOrientation` inside
  that card stays strictly idle-gated, since it JOGS via
  `/sand_goto` and `SandApi::goTo` requires a true `Idle` (it 409s in `Hold`, which the sheet's
  retry would spin on forever).
  ONE banner sits at the top of each gated page, with exactly ONE inline button: **Pause** wherever a
  pause would help (it opens Settings without ending the run — pairing it with Stop only invites
  the destructive one), **Stop** exactly where a pause can't (already held, or firmware too old to
  unlock on a hold). A feed hold works from Idle too (FluidNC goes straight to `Hold`, and the
  playlist only starts its next pattern from `Idle`), so Pause is also the button during the
  between-patterns gap: it keeps the next pattern from starting and holds Settings open past the
  gap instead of relocking as it winds down — which is why the banner STAYS UP through that gap
  ("Between patterns — pause to keep settings open.") but not through a manual pause, where
  nothing is dimmed and nothing is about to relock. The gate dims to 0.55 (values stay readable), blocks touches, and
  re-applies the page ScrollView's card `gap` (a wrapper View otherwise collapses it).
  The banner is normal-flow, NOT an
  absolute overlay — an overlay covers a short card's whole content and iOS height-constrains
  overlay text to one truncated line. `ClearPatternsCard` follows the same `!isSettingsLocked`
  rule for its own row-level disabling),
  `Onboarding`, `Toaster`, `AlignOrientation`
  (crash-homing pattern orientation, in Settings › Homing: crash home never moves theta — the
  arm's direction at home time BECOMES theta=0 — so the sheet nudges the ball around the edge
  via absolute `/sand_goto?theta=` jogs (`board.rotateTo`, seeded from live status.theta, 409-retry
  while the previous jog finishes) until it points "East" (viewer's right), then homes to lock it in.
  Mirrors dw's Pattern Orientation Alignment dialog).
- `src/lib/` — `thrGeometry.mjs`, `patternGeometry.ts`, `patternSource`/`pushPattern`/`importPattern`/`playlists`,
  `layout.ts` (`thumbGrid`, `useScreenWidth`, `useSplit`, `SCROLL_BOTTOM_PAD`, `NATIVE_ACCESSORY`).
- `metro.config.js` adds `thr` to `assetExts`. `app.json` has `assetBundlePatterns` for `assets/thr` + `assets/previews`.

## Conventions / gotchas
- After geometry/UI changes, verify with: `npx tsc --noEmit`, `npx expo export --platform ios` (bundles
  + confirms assets resolve) AND the web bundle the way the desktop app builds it:
  `(cd ../dune-weaver-desktop && npx expo export -p web --output-dir <tmp>)` — web runs different
  files (`AppTabs.web.tsx`), so an iOS bundle doesn't cover it. This repo can't export web itself
  (no `react-dom`/`react-native-web`; the desktop metro config resolves this source against its own
  node_modules), and desktop's `npm run web` writes to the desktop app's own `dist/`. There are no
  unit tests; the checks are `npm run check-playback` (`scripts/check-playback-path.mjs`:
  the Fast-preview path on real bundled patterns — run it after touching `lib/playbackPath.ts`),
  `npm run check-text` (`scripts/check-text.mjs`: the text generator on every font, table shape,
  layout and style — run it after touching `src/lib/sandText`), and `npm run check-hub-auth` (`scripts/check-hub-auth.mjs`: PKCE and the refresh/sign-out
  rules — run it after touching `lib/hubAuth.ts` or `lib/pkce.mjs`).
- **Native tab bar** (`src/components/AppTabs.tsx`, iOS + Android): `createNativeBottomTabNavigator`
  from `@react-navigation/bottom-tabs/unstable` — an UNSTABLE API; re-check it after any
  react-navigation / react-native-screens upgrade.
  It THROWS on web, so `AppTabs.web.tsx` keeps the JS `createBottomTabNavigator` for web/desktop
  (Metro picks it by extension; same props, same badge) — every tab change goes in both files.
  `lazy: true` is REQUIRED (the native default is `false`, which mounts all five screens and fires
  every screen's board load into the throttled launch burst). Icons: SF Symbols on iOS; Android
  needs images, so the same MaterialIcons glyphs are rasterized via `getImageSource`.
  `tabBarLabelVisibilityMode: 'labeled'` (Android hides unselected labels with 5 tabs otherwise).
  The Settings (updates) and Browse (new Pattern Hub patterns) `tabBarBadge`s are COUNTs — `''` draws nothing on iOS — in the nav theme's default
  `notification` red (don't override it with ember). Inside a tab, `Screen` uses `SafeAreaView`
  from `react-native-screens/experimental` (NOT safe-area-context, whose insets exclude the tab bar
  and iPadOS 18's top bar) — **exactly ONE per Screen** (Android keeps a single insets listener).
  It pads left/right too: on iPhone Duo the tab bar is an 84 pt RAIL down one side (folded, and
  open in landscape; on the left in Split View's left window), so content is narrower than the
  window — size tab-screen content by `useScreenWidth()` (`lib/layout.ts`, Screen's measured
  content width), never `useWindowDimensions().width`.
  On iOS 26 its bottom edge is left unpadded so content scrolls under the glass bar + accessory;
  scroll content pads its bottom with `SCROLL_BOTTOM_PAD` (`lib/layout.ts`). Never toggle
  `headerShown` at runtime (throws). The Settings tab nests a native-stack (see `Settings` in the
  screens list); re-tapping the tab pops it to the list (`tabBarRepeatedPressBehavior` default /
  the JS tabs' tabPress), so any new nested navigator goes under BOTH tab files the same way.
- **iPhone Duo** (foldable, iOS 27.1+; HIG "Designing for iPhone Duo", Expo's "Supporting iPhone
  Duo" guide): full-screen use needs an iOS **27.1+** SDK build (SDK 58 + Xcode 27.1 or later). An
  Xcode 26 or Xcode 27.0 build (`DTSDKName` iphoneos27.0) runs boxed in, clear of the status bar and
  camera, with a BOTTOM tab bar and no rail, so the unfolded pane covers the tabs. Check the built
  app's `DTSDKName` before handing a Duo build over. The NATIVE tab bar moves into the side rail
  by itself — keep it native, never a JS bar. What the app does on top: `Screen`, both sheet
  variants and the toast pad left/right safe areas; tab screens size by `useScreenWidth()`; grids
  use even column counts. SPLIT (`useSplit()` in `lib/layout.ts`) the window divides at its
  middle, exactly on the fold, and `NowPlayingPane` takes one half: (1) side by side when the
  window is wider than tall and ≥ 600 pt high — the open Duo held like a book is 951 × 669; also
  iPad landscape and big desktop windows — the pane on the half away from the tab rail; (2)
  stacked (`side: 'top'`) when open UPRIGHT (669 × 951) AND half folded like a laptop — the table
  on the standing half, the app on the flat one. Fully open upright doesn't split. Half fold is
  read from `expo-hinge` (`status === 'partiallyOpen'`; the window keeps its size as the device
  folds, so the hinge is the only signal) by ONE module-level listener into the layout store as a
  boolean — the angle streams every degree, and every Sheet calls useSplit. `Screen` publishes its
  safe box (`setScreenBox`) from the screens `SafeAreaView`'s OWN onLayout — it insets by MARGIN
  on itself, not padding, so its children sit at 0,0 (measuring a child put the pane under the
  status bar and on the rail's side) — and keeps `split.content`. While split the `TablePill`
  (logo · table · switcher) heads the PANE instead of `Screen`, and half folded a tab's big title
  hides unless it has an action or a back row (the flat half is short). Half folded the pane
  runs above Screen's box top (which sits lower: the tab container's top region left a dead
  strip): on iOS to the very TOP EDGE — the Duo's status bar keeps to the top right, so the pane's
  header keeps the pill AND the queue toggle top left, under the bar's empty left end; on Android
  (status bar icons on the left too) it stops under the status bar. Side by side it keeps the box
  top (on iPad that region is the tab bar). Side by side the halves MEET at the fold (no
  gap — owner's call). Laptop mode keeps a clear band round the crease, which bends whatever
  sits on it: `LID_GUTTER` (28 pt, tuned on the device) above it, `FOLD_GUTTER` (20 pt, a
  guessed calibration knob) below. Laptop mode's
  pane header sits `spacing.lg` from the top edge (also tuned on the device). While split EVERY sheet is the JS one held to `split.content` (a native
  pageSheet spans both halves): the pane stays uncovered and undimmed, and a tap on it closes the
  sheet like the scrim. A sheet's kind is fixed per presentation (`nativeRef`), never switched
  while up or sliding out. `expo-hinge` is a native module: adding it needs a new dev build; on
  web (desktop, which lists it too) and older builds it reports no hinge. `orientation: portrait` stays — on iOS 27 a lock is only a PREFERENCE
  wherever the app can be resized (the Duo's displays, Split View), so every screen must hold up
  in a landscape-shaped window (FullscreenPlayer already turns by the window, not the device).
  Known gaps, by choice (`expo-hinge` gives the fold's state, not its frame — `react-native-reserved-regions` /
  Expo UI's `ArrangementView` would be the tools): the split assumes the fold is at the window's
  middle (it is on the Duo; reserved regions would give its exact frame); alerts and other
  system UI are the system's to place; `Screen`'s own header stays a horizontal row (it isn't a
  native toolbar, so it never joins the rail). Test in Xcode's Device Hub on the "iPhone Duo"
  simulator (iOS 27.1 runtime): folded, open portrait/landscape, partially folded, Split View.
- **Android R8 is ON** (`expo-build-properties` `android.enableMinifyInReleaseBuilds: true`, since
  1.4.1: Play flagged 1.4.0's DEX obfuscation at 1%, fix by Feb 2027). Keep rules go in
  `extraProguardRules` there (EAS prebuilds `android/`, so never only in `android/app/proguard-rules.pro`):
  `com.github.druk.**` (react-native-zeroconf's bundled mDNSResponder, whose `JNISupport.c` finds its
  classes, fields and callbacks BY NAME) and `@JavascriptInterface` methods (react-native-webview's
  bridge, which the sand page calls by name). Libraries with their own consumer rules (React Native,
  Expo modules, screens, svg) need nothing here. After adding a native module, check a release build
  on a phone: mDNS discovery, the sand preview, uploads, sign-in. Resource shrinking stays off (Expo's
  assets are looked up by name). Play's other 1.4.0 note, "deprecated APIs or parameters for
  edge-to-edge", can't be cleared from the app: `dexdump` of the bundle finds `Window.setStatusBarColor`
  / `setNavigationBarColor` / `layoutInDisplayCutoutMode` only in androidx (activity's `EdgeToEdge*`,
  core's `WindowCompat`), Material's sheet dialogs and React Native's `WindowUtilKt`, all
  version-guarded compat paths; it's a recommendation with no deadline, and goes when they drop them.
- **Sheets**: every bottom sheet goes through `src/components/Sheet.tsx`, the ONLY Modal wrapper
  (the other Modals are full screen: `FwUpdateSplash`, a blocker, and `FullscreenPlayer` (its
  content is a render prop), which Browse and the player open only once no sheet is up). `variant="page"` = a native
  iOS `pageSheet` (non-transparent, `backdropColor` = theme background, system swipe-to-dismiss, no
  grabber), a tall JS sheet on Android/web — for editors, pickers, logs; `native={false}` keeps it the JS one on iOS too, for content with its own drags (a pageSheet follows vertical drags and cancels the touch). `variant="full"` = the whole screen inside the safe areas (split: the app's half), JS everywhere, no grabber and no swipe (its header buttons close it): for a workspace (Create). `variant="fit"` = a
  content-height JS sheet everywhere (max 560 wide, centered) with a REAL draggable grabber (the
  grabber + header are the only drag zone, so scrolls, Sliders and the ColorWheel never fight it)
  — for short choosers and content that would fight UIKit's sheet pan. Never draw a fake grabber.
  **`dismissible` contract**: a parent that may refuse `onClose` MUST pass `dismissible={false}`
  while it would refuse (dirty/busy) — a completed iOS swipe has already dismissed the sheet, so
  refusing then leaves JS state "open" over nothing; a blocked swipe still fires `onClose`, which
  is where to ask. **ONE sheet presented at a time**: iOS silently refuses a second Modal (even
  while the first animates out), so nested flows are in-sheet sub-pages (`onBack` swaps the leading
  slot for a back chevron; Android back calls it); to present after another sheet, wait for
  `!useAnySheetOpen()`. Never put a `Select` inside a sheet (it is itself a `fit` sheet) — use
  inline segmented choices or a sub-page. Grids inside a sheet size from `useSheetWidth()` (an iPad
  pageSheet is narrower than the window), called from a component rendered INSIDE the sheet, since
  it reads the sheet's context. Header buttons: `SheetButton` (`prominent` = sand pill).
  The JS sheet's drag zone claims the touch on START (inside a native Modal a touch that begins on
  the grabber/title otherwise bubbles to the Modal host and the move never reaches the header) and
  takes no gesture while closing; its slide-out unmounts whenever it ENDS closed, finished or not.
  **Toasts over sheets**: on iOS `Toaster` draws in a `FullWindowOverlay` (react-native-screens),
  remounted per toast — a root-view toast sits UNDER a presented pageSheet.
- **Design language ("the table from above, at night")**: warm basalt/sand palette (NOT the web
  app's gray+blue — see `src/theme/index.ts`, the single token source; light vs dark palette
  follows the SYSTEM appearance, no in-app toggle), **circular pattern
  thumbnails**, **pill-shaped controls** (`radius.pill`). Type roles: Bricolage Grotesque display
  (`font.family.display`) for screen titles / pattern names / the Control state word; system font
  for body/controls; IBM Plex Mono (`font.family.mono`) for ALL telemetry (times, %, feed, θ/ρ,
  IPs, versions). Fonts load in App.tsx via `expo-font` (render-gated). Palette rules: `primary`
  (sand) = user actions; `live` (patina) = things happening on the table NOW (progress fills, live
  ball, active-state dot) — never swap them; `destructive` (ember) means destructive / error /
  offline ONLY — favourites, selection and badges are never ember (the update badge is the nav
  theme's notification red); destructive buttons are OUTLINED ember, not filled;
  never hardcode `#fff` on a primary/destructive surface — use `primaryForeground`/
  `destructiveForeground`. Light-mode ink tokens (muted, primary, destructive, success, live) are
  tuned to WCAG AA 4.5:1 on background, card AND cardElevated (the tight one) — re-check all three
  when tweaking one, and don't lower text opacity under them. Text over a tinted banner
  (`<color>22` fill) is `foreground`; the tint colour stays on the icon/border only. On/off
  settings use `ui.tsx`'s `Toggle` (sand track) at NATIVE size (don't scale it), NEVER a bare
  `Switch` (the stock iOS green fights the palette). Thumb grids come from `thumbGrid(width)` in
  `lib/layout.ts` (~140 pt per column, min 3; past the minimum the count is EVEN, so iPhone Duo's
  fold falls between columns): screens pass `useScreenWidth()` (NOT `useWindowDimensions` width,
  which includes the Duo's rail, nor module-scope `Dimensions.get` — the window resizes), grids
  in a sheet pass `useSheetWidth()` (measured inside the sheet's safe area). Tab-screen scroll content pads its bottom with `SCROLL_BOTTOM_PAD`.
  **Dynamic Type**: any container that holds text uses `minHeight` (plus `paddingVertical` where
  needed), never a fixed `height`; names/titles that can wrap get `numberOfLines={2}` (grid-tile
  captions, base URLs, the header table chip, one-word screen titles and both mini-player forms
  stay 1 line — the native accessory capsule also caps text with `maxFontSizeMultiplier`). **Vocabulary**: clear names come ONLY from `board.ts` `CLEAR_MODES`
  (Adaptive · From center · From edge · Sideways · Random · None, default first); standing alone
  (sheet title, toast) prefix them — "Clear from center" / "Clear from edge" / "Clear sideways".
  The ball position is "Edge", never "Perimeter". Screen titles equal their tab names (Browse,
  Playlists, Control, LEDs, Settings).
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
