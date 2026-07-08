@AGENTS.md

## Build & release preferences (owner)

- **Default to building LOCALLY** (`eas build --local -p <platform> --profile production`); don't use cloud `eas build` unless required.
- **EXCEPTION — iOS must be CLOUD-built while this Mac is on beta macOS/Xcode.** This machine runs macOS 27 beta + Xcode 26.6 (iOS SDK 26.5), which Apple rejects on App Store upload (**ITMS-90111: Unsupported SDK** — App Store needs a GA/RC Xcode, and a GA Xcode can't run on a beta OS). So local iOS builds will always be rejected; build iOS with plain `eas build -p ios --profile production` (cloud, Apple-approved Xcode). Android local builds are fine (no equivalent rule). Revisit once macOS/Xcode go GA on this machine.
- **Monorepo archive scope** — this project lives inside the giant `/Volumes/SSD/projects` git repo, so EAS archives from the wrong root. Before any build: `git init -q .`, build, then `rm -rf .git` (restores the monorepo's tracking). See the EAS-build memory.
- **Local toolchains:** iOS needs Xcode + CocoaPods + `fastlane` (signing via EAS-managed creds). Android is READY on this Mac: `JAVA_HOME=/opt/homebrew/opt/openjdk@17` and `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools` (build-tools 36, platforms 35/36, NDK 27) — export both, then `eas build --local -p android --profile preview --output <path>.apk` works end-to-end.
- **Submitting (free EAS tier → skip the slow `eas submit` queue):**
  - **iOS:** download the build's `.ipa` (cloud builds: grab `artifacts.applicationArchiveUrl` from `eas build:view <id> --json` and curl it) and upload it **straight to App Store Connect with altool**:
    `cp ~/Downloads/AuthKey_SNJFP54RL8.p8 ~/.appstoreconnect/private_keys/` then
    `xcrun altool --upload-app -t ios -f <ipa> --apiKey SNJFP54RL8 --apiIssuer 45f73103-150c-4b99-825c-389a396ffc53`. No EAS queue.
  - **Android:** `eas submit -p android --profile production --path <.aab>` (Play service account in `eas.json`) — Play submits don't hit the same queue pain, or upload the `.aab` manually in Play Console.
- App Store metadata/screenshots/review-notes are managed via `fastlane deliver` (`fastlane/` dir; ASC API key in `fastlane/asc_api_key.json`, gitignored).
