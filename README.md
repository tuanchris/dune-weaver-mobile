# Dune Weaver Mobile

A React Native / [Expo](https://expo.dev) app that controls a **FluidNC-firmware**
[Dune Weaver](https://github.com/tuanchris/dune-weaver) kinetic sand table **directly over its local
HTTP API** — no Python backend, no cloud, no proxy. The phone talks straight to the board's firmware
on your Wi-Fi, so there's no CORS, no server to keep running, and nothing leaves your network.

> The official `dune-weaver` project has a Raspberry Pi / FastAPI backend and web UI. **This app does
> not use that backend.** It speaks the FluidNC fork's own HTTP routes directly. The phone and table
> must be on the same Wi-Fi.

## Features

- **Browse & run** – the full ~1000-pattern library is browsable; run any pattern with an optional
  pre-execution clear (adaptive / from center / from perimeter / sideways).
- **Your own patterns** – import `.thr` files (single or multi-select) at **full resolution**; they're
  stored on the device and pushed to the table's SD card intact.
- **Previews** – 100 default patterns ship with pre-rendered thumbnails; imported patterns get a
  WebP preview generated on-device, and you can bulk-import preview images for custom patterns in
  Settings (matched by filename, e.g. `star.thr.webp` → `star.thr`).
- **Playlists** – create / edit / delete, reorder, loop / shuffle, pause-between-patterns, clear and
  auto-home options.
- **Control** – home, stop, pause/resume, speed, jog the ball between patterns, live status with a
  polar progress trace and live ball position.
- **LEDs** – effect / palette / colour pickers, brightness & speed, run/idle overrides, ball tracker
  (driven by the firmware's on-board LED ring).
- **Homing** – choose crash vs sensor homing, set the sensor offset, and auto-home every _N_ patterns
  during playlists.
- **Quiet hours ("Still Sands")**, **auto-play on boot**, **multi-table** with a header switcher,
  custom **branding** (name + logo), and light/dark themes.

## Requirements

- Node 18+ and the [Expo CLI](https://docs.expo.dev) (`npx expo`)
- A **custom dev build** — the app uses native modules (`react-native-svg`, `react-native-zeroconf`,
  `expo-image-manipulator`), so **Expo Go will not work**.
  - iOS: Xcode
  - Android: Android SDK + **JDK 17**
- The sibling [`dune-weaver`](https://github.com/tuanchris/dune-weaver) repo checked out next to this
  one — only needed to (re)generate the bundled pattern assets (see below).

## Run

```bash
npm install
npm run ios        # builds & installs the dev client on a simulator/device
npm run android    # requires Android SDK + JDK 17
```

On first launch, add your table by IP (e.g. `192.168.68.160`) or `<host>.local`, or use
**Find tables on Wi-Fi** (mDNS). The phone must be on the same Wi-Fi as the table.

## How it talks to the board

All board access lives in [`src/api/board.ts`](src/api/board.ts). The firmware exposes plain HTTP:

- **Reads (JSON):** `/sand_status`, `/sand_patterns`, `/sand_playlists`, `/sand_settings`
- **Actions (text `ok`):** `/sand_home`, `/sand_stop`, `/sand_pause`, `/sand_resume`, `/sand_feed`
- **Commands:** `GET /command?plain=$…` — `$SD/Run`, `$Sand/Run`, `$Playlist/*`, `$LED/*`,
  `$Sand/HomingMode`, `$Sand/ThetaOffset`, `$Sands/*` (quiet hours), …
- **Files:** `POST /upload` (multipart) to write patterns/playlists; `GET /upload?action=delete` to
  remove them.

There's no WebSocket, so [`useStatus`](src/stores/useStatus.ts) polls `/sand_status` every second.
`theta` is in **radians** (continuous/unwound, same as `.thr` files); `rho` is `0..1`.

## Patterns, previews & geometry

The app is the source of truth for pattern data — it never reads pattern coordinates back off the
board. At build time, `npm run gen-geometry` reads the sibling `../dune-weaver/patterns/` and emits,
into `assets/` (git-ignored, regenerate locally):

- `thr/<name>.thr` + `previews/<name>.webp` — the **100 default** patterns (pushable + their
  thumbnails). Only the defaults are bundled to keep the binary small.
- `pattern-manifest.js` — static `require()` maps Metro needs.

Custom pattern data lives in app storage instead of the bundle: imported `.thr` files are saved
full-resolution, their previews are generated on-device, and you can ingest preview images for
on-table customs from **Settings → Pattern previews**.

```bash
npm run gen-geometry   # requires ../dune-weaver checked out as a sibling
```

## Project layout

```
src/api/         board.ts (HTTP client), status.ts (raw status → app status)
src/stores/      zustand (persisted via AsyncStorage): boards, status poll,
                 library (imported patterns), previews, prefs, theme, branding, toasts
src/screens/     Browse, Playlists, Control, Led, Settings
src/components/   PolarPattern (SVG), PatternThumb, NowPlayingBar, Screen, ui kit,
                 PreviewGenerator, Onboarding, Toaster
src/lib/         thr geometry, import/push patterns, import previews, playlists, discovery
scripts/         gen-pattern-geometry.mjs (build-time asset generator)
```

After geometry/UI changes, verify with `npx tsc --noEmit` and `npx expo export --platform ios`.

## Out of reach (needs the Pi backend)

Some web-app features depend on the `dune-weaver` Raspberry Pi backend and have no firmware
equivalent, so they're not in this app: networked **WLED** controllers, **MQTT**, Wi-Fi setup,
server-side play-count / history, and the homing _mode_ presets beyond what the firmware exposes.

## License

[GPL-3.0-or-later](LICENSE).
