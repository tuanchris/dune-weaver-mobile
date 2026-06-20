# Dune Weaver Mobile

A React Native (Expo) app that controls a **FluidNC-firmware** Dune Weaver kinetic sand table
**directly over its local HTTP API** — no Python backend, no cloud, no proxy. Native HTTP means no
CORS restrictions (unlike the web app, which needs the board to serve it or a proxy).

## Run

```bash
npm install
npm run ios       # or: npm run android / npm run web
```

On first launch, enter the table's IP (e.g. `192.168.68.160`) or `<host>.local`. The phone must be
on the same Wi-Fi as the table. Add multiple tables and switch between them in Settings.

## How it talks to the board

Read routes return JSON; action routes return plain text `"ok"`; `/command?plain=…` is
fire-and-forget (confirmed by the 1 s status poll). See `src/api/board.ts` and `src/api/status.ts`.
The app polls `GET /sand_status` every second (the board has no WebSocket).

## Pattern previews & progress

The board serves neither preview images nor pattern coordinates. Instead, at build time we extract
**decimated theta-rho geometry** from the sibling `../dune-weaver/patterns/*.thr` files into
`assets/patterns.json` (~1.3 MB for 100 patterns). That geometry powers both the Browse thumbnails
and the Now Playing **progress path** (the path is filled to the live `progress` fraction).

Regenerate after pattern changes:

```bash
npm run gen-geometry
```

(Requires the `dune-weaver` repo checked out as a sibling folder.)

## Structure

```
src/api/        board client + status translation
src/stores/     zustand: boards (persisted), status poll, theme, toasts
src/lib/        pattern geometry helpers (polar -> svg path, progress split)
src/components/ PolarPattern (svg), NowPlayingBar, Screen, ui kit, Onboarding, Toaster
src/screens/    Browse, Playlists, Control, Settings
assets/patterns.json   bundled decimated geometry (generated)
scripts/gen-pattern-geometry.mjs   build-time geometry extractor
```

## Scope

Mirrors the web app's firmware mode: browse + run patterns, run/skip/stop playlists, home/stop,
speed, live status + polar progress, multi-table. Out of scope (no board endpoint): playlist
editing, favorites, file upload, pattern history, LED, MQTT, WiFi setup.
