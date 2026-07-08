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
`../fluidnc/FluidNC/src/SandApi.cpp` and `WebServer.cpp`). All API access is in `src/api/board.ts`:

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
  Settings (`UpdatesCard.tsx`) surface them.

### Key data conventions (easy to get wrong)
- **theta is RADIANS**, continuous/unwound (same as `.thr` files), NOT degrees. `rho` may be signed.
  Live ball position uses `x=rho·cosθ, y=rho·sinθ` directly (see `livePosition` in `patternGeometry.ts`).
- `progress` from the board is 0..100 (older builds 0..1); `translateStatus` handles both.
- `.thr` files are `"<theta> <rho>"` lines (theta radians, possibly hundreds of turns — converting to
  xy destroys the winding, so we never store xy for anything that gets pushed back).

## Pattern library + previews + upload
The app is the source of truth for patterns; it never reads pattern data back off the SD for previews.
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
- **Shared geometry**: `src/lib/thrGeometry.mjs` (plain ESM `.mjs` so BOTH the Node build script and
  Metro import it — `mjs` is in Expo's `sourceExts`). `parseThr` / `decimate` / `toXY` / `decimateThrText`.

## Project layout
- `src/api/` — `board.ts` (HTTP client), `status.ts` (RawStatus → Status).
- `src/stores/` — zustand, persisted via AsyncStorage: `useBoards` (tables), `useStatus` (1s poll),
  `useLibrary` (imported patterns + geometry cache + bundle accessors), `useTheme`, `useToast`.
- `src/screens/` — `Browse` (Library|On-Table tabs, circular thumbs, import, push, clear-before-run),
  `Playlists` (create/edit/delete, pattern picker grid, loop/shuffle/pause + pause-from-start/clear/
  auto-home), `Control` (home/stop/unlock/speed + quiet-hours + live status), `Led` (effect/palette/
  color pickers, brightness/speed sliders, run/idle overrides), `Settings` (tables + reboot + app/
  firmware updates).
- `src/components/` — `PolarPattern` (SVG path + progress + live dot), `PatternThumb`, `NowPlayingBar`
  (swipe up/down to expand/collapse), `Screen`, `ui.tsx` (`Button`/`Card`/`IconButton`/`Slider` —
  the `Slider` is PanResponder-based, no native dep), `Onboarding`, `Toaster`.
- `src/lib/` — `thrGeometry.mjs`, `patternGeometry.ts`, `patternSource`/`pushPattern`/`importPattern`/`playlists`.
- `metro.config.js` adds `thr` to `assetExts`. `app.json` has `assetBundlePatterns` for `assets/thr` + `assets/previews`.

## Conventions / gotchas
- After geometry/UI changes, verify with: `npx tsc --noEmit` and `npx expo export --platform ios` (bundles
  + confirms assets resolve). There are no unit tests.
- **Stacked Modals**: a second `<Modal>` rendered as a sibling won't present over an open one (iOS) —
  nest it inside the first Modal's tree (see the playlist pattern picker).
- UI mimics the dw web frontend: **circular pattern thumbnails**, **pill-shaped controls** (`radius.pill`),
  soft shadows.
- No native discovery module installed — tables are added by IP/hostname manually. mDNS browsing
  (`react-native-zeroconf`) would need a custom dev build; the firmware advertises `_http._tcp` with TXT
  `api=sandtable/1`, `model=dune-weaver`.
- The firmware now drives the **on-board LED ring directly** (`$LED/*`, `led{}` in status) — this is no
  longer Pi-only. The LED screen hides Color/Color2/Palette controls per the active effect's needs
  (see `LED_EFFECTS[].uses` / `ledEffectInputs` in `board.ts`).
- Out of reach (need the Pi backend, not the firmware): networked **WLED** controllers, MQTT, WiFi
  setup UI, favorites, play-count/last-played history, server-rendered preview cache, multi-table discovery.
