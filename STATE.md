# Release state

Point-in-time notes. Durable rules live in AGENTS.md / CLAUDE.md.

## 2026-11-18: 1.4.5 — flat sand preview fixed, on every platform

- **Customer report** (iPhone 13 Pro, iOS 27.2.1, app 1.4.3): the sand player played, but the
  sand stayed flat (no clear, no grooves), only the ball moved. The engine's R32F heightfield is
  sampled LINEAR, which needs `OES_texture_float_linear`; that GPU lacks it, so the textures are
  incomplete and read 0, with no error. `lib/floatLinearShim.mjs` (injected by SandView before the
  page, so the engine KEY and the hub's renders are unchanged) filters in the shaders there.
  `npm run check-sand-shim` reproduces it (sd 69.4 normal, 8.6 hidden, 69.4 with the shim). Not
  yet seen on an affected phone. On-phone sand stills moved to `<KEY>-2` (flat ones re-render).
- **Android**: versionCode 31 to production with `changelogs/31.txt` (androidpublisher API).
- **iOS**: 1.4.4 (build 29) was pulled from review while IN_REVIEW; that App Store version was
  renamed 1.4.5, given build 30 (cloud, iphoneos27.1) and both releases' notes, and is
  WAITING_FOR_REVIEW. 1.4.4 never shipped on iOS; build 29 is burned.
- **Desktop**: v1.4.5 released (notarized dmg + exe); `releases/latest` = v1.4.5. Desktop keeps
  the extension, so `SandView.web.tsx` has no shim; it ships for parity.
- dune-weaver-viewer's own web Sand page has the same flaw on such phones (engine untouched).

## 2026-11-17: 1.4.4 + firmware v0.2.6 — long LED strips, on every platform

- **Firmware v0.2.6** (cut from `origin/main` in a worktree, not the WIP tree; torture gate
  skipped, owner's call): own effects picked strip indices with `random8(lim)`, a `uint8_t`
  lim, so past 255 LEDs Twinkle, Glitter, Dissolve, Ripple, Drip, Lightning, Fireworks and
  Juggle reached only the first n % 256 LEDs (300 → the first 44). `random16(lim)` and an int
  Juggle scale fix it. The same change is in the firmware WIP tree, which is still 11 commits
  behind `origin/main`.
- **App**: `ledSim.ts` mirrors it; Settings › LED strip takes 1–400 (firmware v0.2.5 raised
  `$LED/Count` to 400). Checked with a scratch harness at 49/255/256/300/400 LEDs (every effect
  reaches the strip's last 10%) and `fx_parity.py --leds 400` (114/114 WLED ports match).
- **Android**: versionCode 30 to production with `changelogs/30.txt`, via the androidpublisher
  API (upload + track + commit in one edit).
- **iOS**: build 29 (cloud, iphoneos27.1), altool, new App Store version 1.4.4 submitted
  through the ASC API.
- **Desktop**: v1.4.4 released (notarized dmg + exe); `releases/latest` = v1.4.4.

## 2026-11-16: 1.4.3 — Android nav bar, keyboard and toasts, on every platform

- **Sheets clear Android's nav bar** (customer report, 3-button navigation: a playlist's Play sat
  under it). `Sheet.tsx`'s JS sheet ends in an EMPTY bottom `SafeAreaView`; safe-area-context's
  Android view returns no insets while its height is 0 (`getSafeAreaInsets`: `view.height == 0`
  → null), and inside a Modal it is its own provider, so it never padded. `minHeight: 1`.
- **Found in an Android + iOS audit right after**:
  - Android/web: toasts fired while a sheet is up drew UNDER it (a Modal is its own window / a
    portal): each JS sheet's Modal renders its own `Toaster`.
  - Android: every `KeyboardAvoidingView` had `behavior` undefined there, so the keyboard covered
    fields (the LED colour sheet's hex box, onboarding): `padding` on both platforms now.
  - Both: tab screens had no keyboard handling, so a field low on a Settings page (Wi-Fi
    password, Still Sands, Playback/Homing/LED strip numbers, Control's speed) sat under it.
  - Known, left: iOS number pads have no Return key (fields commit on blur: tap outside); in
    split view the clear picker (JS page sheet + `automaticallyAdjustKeyboardInsets`) doubles
    the gap.
- **Android**: TWO builds are named 1.4.3. versionCode 28 (the nav-bar fix alone) went to
  production first; 29 (everything) replaced it in production minutes later, with the full
  notes (`changelogs/29.txt`). Both committed via the androidpublisher API, no `eas submit`.
- **iOS**: build 27 was cancelled before upload (number burned). Build 28 (cloud): altool, then
  1.4.3 created and submitted through the ASC API with only the keyboard line as its notes
  (toasts over sheets already worked on iOS): WAITING_FOR_REVIEW, build 28 attached (verified).
- **Desktop**: v1.4.3 was published, deleted with its tag, then re-released with everything
  (notarized app in the dmg + exe); `releases/latest` = v1.4.3.
- The first rule from this release (now in CLAUDE.md): a fix for ONE platform ships only there.
  This one went everywhere because the audit's fixes reach every platform.

## 2026-11-16: 1.4.2 — sand contrast, on every platform

- **Sand contrast, hub-side**: `LEVELS` in `scripts/sand-page.js` (grey ~48–173 → 6–248), engine
  KEY `745a08f5` → `62132a40`. The renderer was deployed with it, but Cloud Run renders ~2 a
  minute, so its sweep was cancelled; the hub's previews were rendered on this Mac and uploaded
  with the renderer's new `export` / `seed` commands (see its README). All 650 carry the new
  KEY; a dry-run sweep finds nothing to render.
  Live revision: `sand-renderer-00008-r7b`, `DAILY_RENDERS=400`.
- Apps before 1.4.2 keep the flat previews they've already cached (their URL carries the old
  KEY); uncached ones load the new renders, and desktop 1.4.1 refetches after 5 min (max-age).
- **iOS**: 1.4.1 (build 25) was pulled from review unreviewed; that App Store version was renamed
  1.4.2, given build 26 and both releases' notes, and is WAITING_FOR_REVIEW. Build 25 never
  shipped; don't reuse it.
- **Android**: versionCode 27 committed to production with its Play notes through the
  androidpublisher API. `eas submit` sat ~35 min in EAS's queue and then failed on the concurrent
  edit; nothing from it reached Play.
- **Desktop**: v1.4.2 released (notarized dmg + exe).

## 2026-11-14: 1.4.0 on every platform

- **1.4.0** catches every platform up after the Android-only 1.3.1: iOS build 24 (cloud,
  `iphoneos27.1`) and Android versionCode 25 are in store review, desktop v1.4.0 is released.
- iOS build 23 and Android versionCode 24 were uploaded and then pulled. Never reuse them; EAS's
  remote counter is already past them.
- **Create from text is held back** (`CREATE_TEXT = false`): see AGENTS.md, Create bullet.
- The App Store age rating now answers user-generated content Yes (the Pattern Hub) and social
  media No.
