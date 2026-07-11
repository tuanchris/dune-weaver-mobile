---
name: verify
description: Build, launch, and drive Dune Weaver Mobile in the iOS simulator to verify changes at the UI surface, against the in-app demo table and/or a real table on the LAN.
---

# Verify Dune Weaver Mobile

## Launch (Expo Go on the iOS simulator)

```bash
xcrun simctl boot "iPhone 17 Pro"; open -a Simulator
npx expo start --go --port 8081 &      # NOT plain `expo start` — the project otherwise demands a dev build
xcrun simctl openurl booted "exp://127.0.0.1:8081"
```

- `--go` is required (no dev client is installed). First run auto-installs Expo Go.
- **Metro file-watching is unreliable on the external SSD** — edits may never rebundle. Restart
  with `npx expo start --go --clear` and relaunch the app (`simctl terminate booted host.exp.Exponent`,
  then `openurl` again) to pick up changes. Check the log for a full `iOS Bundled … (1400+ modules)` line.
- `CI=1` disables reloads entirely; avoid it for iterative work.

## Drive

- Screenshots (always works, even headless): `xcrun simctl io booted screenshot out.png`
- Taps/typing: `cliclick c:X,Y` / `cliclick t:"text"` on the Simulator window.
  Get the window frame with `osascript -e 'tell application "System Events" to tell process "Simulator" to get {position, size} of window 1'`.
  Window content maps 1:1 to device points (iPhone 17 Pro = 402×874) below a 52 px title bar;
  screenshots are 3× device points. **If the Mac's display locks, the Simulator window disappears
  and cliclick is dead** — fall back to a temporary auto-drive `useEffect` in the component under
  test plus `initialRouteName` override, verified via screenshots; remove the harness after.
- App state persists in the sim across relaunches (AsyncStorage): added tables, demo table, previews.

## Real-table testing

- Find tables: probe `http://192.168.68.<x>/sand_status` for JSON (the Pi backend at another IP
  answers 200 with HTML for EVERY path — require a JSON body, not just HTTP 200).
- Demo mode ("Try demo mode" in onboarding) exercises most flows with no hardware.
- **Don't fire destructive/reboot routes at a live table** (`/wifi_save` with real intent,
  `/wifi_standalone`, OTA) — validation-error requests (e.g. short password → 400) are safe.
- The board's web server is single-threaded with a tiny socket pool: heavy concurrent request
  storms (e.g. a poller racing an async WiFi scan) can saturate it for minutes — it recovers only
  once traffic stops. If the board stops answering but pings, terminate the app and wait ~1-2 min.

## Fast checks

`npx tsc --noEmit` and `npx expo export --platform ios` (bundle + asset resolution). No unit tests.
