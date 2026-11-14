# Release state

Point-in-time notes. Durable rules live in AGENTS.md / CLAUDE.md.

## 2026-11-02: 1.3.1 shipped on Android only

- **1.3.1** (Android versionCode 22) is 1.3.0 (commit 092f83b) plus ONE fix and nothing from main.
  The fix: Android crashed with "Canvas: trying to use a recycled bitmap" when a pattern was opened.
  The cause is react-native-screens 4.25.2's native tab icons. They wrapped Fresco's cached bitmap,
  which Fresco recycles once the big previews evict it. 1.3.1 backports 4.26.0's bitmap copy as a
  `patch-package` patch. Main is on screens 4.30.0, which already has the fix, so main needs no patch.
- **App Store and desktop are still on 1.3.0.** The crash can't happen there: the desktop is web
  tabs, and iOS doesn't use this loader.
- **Next release: catch every platform up.** Bump `app.json` past 1.3.1 (1.3.2 or higher, never
  1.3.1 again: Play already has it) and ship iOS, Android AND desktop at that version
  (see CLAUDE.md, "Every published version ships on desktop too"). Main's `APP_CHANGELOG` and
  `fastlane/metadata/android/en-CA/changelogs/22.txt` already hold the 1.3.1 entry.
  Then delete this section.
