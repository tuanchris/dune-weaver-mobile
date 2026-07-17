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
  `$THR/Feed=`, `$LED/Effect|Palette|Color|Color2|Brightness|Speed|RunEffect|IdleEffect=`,
  `$Sands/Enabled|Slots=` (quiet hours), `$X` (unlock from Alarm), `$Bye` (reboot). Built with
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
  Status also carries `playlist.quiet` (Still Sands active → `Status.isQuiet`), `fw` (firmware
  version → `Status.fw`) and, when LEDs are configured, `led:{effect,brightness}` (→ `Status.led`).
- **OTA firmware update**: `GET /updatefw` probes (`{status:"ready"|"busy",fw}`; 409 while a pattern
  runs), `POST /updatefw` multipart (`firmware.binS` size field + `firmware.bin` file part) flashes
  and reboots. `src/lib/firmwareUpdate.ts` orchestrates: download the latest GitHub release asset
  (`tuanchris/dune-weaver-firmware` releases → `firmware.bin`), suspend the status poller (the
  board's web server is single-threaded), flash via `board.uploadFirmware` (binary body needs
  `expo/fetch` — RN's fetch can't send typed arrays), poll until the board is back. Update checks
  live in `src/lib/updates.ts` + `src/stores/useUpdates.ts` (app: iTunes lookup / Play page scrape;
  both fail-safe to "unknown"); a red dot on the Settings tab (App.tsx) + an Updates card in
  Settings (`UpdatesCard.tsx`) surface them. Checks re-run on Settings focus (10 min max-age) and
  the 6 h throttle only arms after a FULLY successful check — a failed/partial one retries, so a
  stale "up to date" self-heals. The fetched "latest" is app-global; only `status.fw` is per-table.
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
- **Preview bundle sync** (`src/lib/previewSync.ts`, mounted via `usePreviewSync` in App.tsx): the
  website's SD Card Pattern Manager writes `/patterns/previews/shard-<0..7>.zip` (STORE-mode zips of
  preview webps) + a ~1 KB `previews.json` sidecar with a content hash per shard. Once per table per
  session (idle-gated), the app reads the sidecar, fetches only shards whose CONTENT hash it hasn't
  ingested (`usePreviews.ingestedShards` — a persisted SET of content hashes, deliberately keyed by
  hash not shard-name so it's cross-table: a second table carrying the same patterns produces a
  byte-identical bundle → identical hashes → zero re-download), unzips with `fflate`, and registers
  images via `usePreviews.addMany` — same store as manual preview imports, keyed by `previewKey`
  basename (path-stripped, so the same pattern filed under a different folder on another table still
  resolves the same image → **previews are shared across all tables**). This is what gives bulk-loaded
  card patterns thumbnails; 404 sidecar (no bundle) is a quiet no-op. Manual import
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
  write through to the cache so a push/delete survives relaunch), `useTheme`, `useToast`
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
  line prefixes (uptime going backwards = reboot → "— table restarted —" marker). This outlives
  the board's ~8 KB RAM ring, which is lost on every table reboot. The app ring is the second
  tab; the share icon exports the VISIBLE tab through the system share sheet. Nothing is uploaded
  automatically, which keeps the "Data Not Collected" App Privacy label truthful.
  (`/sand_bootlog`/`/sand_coredump` are no longer fetched; their `board.ts` helpers remain as
  API-surface mirrors.)
- `src/screens/` — `Browse` (Library|On-Table tabs, circular thumbs, import, push, clear-before-run),
  `Playlists` (create/edit/delete, pattern picker grid, loop/shuffle/pause + pause-from-start/clear/
  auto-home; edits are local until the editor closes, and closing dirty ASKS save/discard — never
  silently writes; a copy-icon in the editor header copies the playlist's `.txt` VERBATIM to another
  saved table via `copyPlaylistTo` — no pattern push, so patterns the target lacks just won't play),
  `Control` (home/stop/unlock/speed + quiet-hours + live status), `Led` (effect/palette/
  color pickers, brightness/speed sliders, run/idle overrides), `Settings` (tables + Wi-Fi + homing
  mode/orientation + reboot + app/firmware updates).
- `src/components/` — `PolarPattern` (static SVG path preview), `LiveDrawing` (the expanded player's
  signature view: the full pattern on a disc whose rim is a glowing progress ARC in the `live`
  color — sweep driven by the same `pct` as the linear bar, so the between-patterns pause fills it
  too; NO live-ball dot (owner removed it); falls back to `PatternThumb` inside the disc when no
  local geometry exists), `PatternThumb`, `NowPlayingBar`
  (swipe up/down to expand/collapse), `Screen`, `ui.tsx` (`Button`/`Card`/`IconButton`/`Slider` —
  the `Slider` is PanResponder-based, no native dep), `Onboarding`, `Toaster`, `AlignOrientation`
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
  favorites, play-count/last-played history, server-rendered preview cache, multi-table discovery.
