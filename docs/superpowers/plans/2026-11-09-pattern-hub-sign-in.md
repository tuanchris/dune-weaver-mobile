# Pattern Hub sign-in: app implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app signs in to duneweaver.com and downloads hub `.thr` files only for Dune Weaver plan owners. Everyone still sees the hub's previews, and the hub stays hidden until the website launches it, except for admins.

**Architecture:**
- **Sign-in:** OAuth authorization code with PKCE against the website's `duneweaver-app` client, in the system sign-in window (`expo-web-browser`). The refresh token lives in Keychain/Keystore (`expo-secure-store`); the access token only in memory.
- **Downloads:** every `.thr` comes through the website's download route as a 10-minute signed URL. Previews and `catalog.json` stay public.

**Tech Stack:** Expo SDK 58 (React Native 0.88), TypeScript, zustand, `expo-web-browser`, `expo-crypto`, `expo-secure-store`.

**Spec:** `/Volumes/SSD/projects/dune-weaver-website/.claude/worktrees/pattern-hub/notes/2026-11-09-pattern-hub-buyers-only-design.md` (approved 2026-11-09). This plan uses the routes built by the website plan beside it (`notes/2026-11-09-pattern-hub-buyers-only-plan.md`), which must be deployed first.

## Global Constraints

- Read the SDK 58 docs before touching a module: https://docs.expo.dev/versions/v58.0.0/. The APIs used here, checked 2026-11-09:
  - `WebBrowser.openAuthSessionAsync(url, redirectUrl)` returns `{ type: 'success', url }`, or `{ type: 'cancel' | 'dismiss' | … }`. `WebBrowser.dismissAuthSession()` works on iOS and web.
  - `Crypto.digestStringAsync(CryptoDigestAlgorithm.SHA256, data, { encoding: CryptoEncoding.BASE64 })`, `Crypto.getRandomBytes(32)` and `Crypto.randomUUID()`.
  - `SecureStore.getItemAsync / setItemAsync / deleteItemAsync(key, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK })`. Keys may use only alphanumerics, `.`, `-` and `_`. There is no web support.
- **No commits or pushes unless the owner asks.** No driving the simulator yourself: run the checks, launch the app, and hand it to the owner (`CLAUDE.md`).
- Checks:
  - every task: `npx tsc --noEmit`;
  - Task 1: `npm run check-hub-auth`;
  - before hand-off: `npx expo export --platform ios` and the desktop web export, `(cd ../dune-weaver-desktop && npx expo export -p web --output-dir <tmp>)`.
- Fixed values:
  - site `process.env.EXPO_PUBLIC_DW_SITE ?? 'https://duneweaver.com'`;
  - client `duneweaver-app`;
  - redirect `duneweaver://oauth`;
  - `app.json` `"scheme": "duneweaver"`.
- **No purchase wording and no shop links anywhere in the app** (App Store 3.1.1 / 3.1.3). Exact copy:
  - Non-member: `Pattern Hub downloads are for Dune Weaver plan owners.`
  - Signed out: `Sign in with your duneweaver.com account to sync Pattern Hub patterns.`
  - Under the non-member copy: `Use the duneweaver.com account your plan is under.` A Hide My Email Apple sign-in matches no order, and this is the only hint the user gets.
- The hub is hidden on desktop (`Platform.OS === 'web'`): there is no secure store and no redirect handling there.
- Docs ship with the code: the Pattern Hub bullet in `AGENTS.md`.

## Review Focus

1. **Two calls refreshing at once.** The website revokes the whole grant when an old refresh token is replayed more than 60 s after rotation. Refresh must be single-flight, one shared promise, or a sync and the account check can sign the user out. Covered in Task 1's `hubFetch`.
2. **The app killed during sign-in.** An email link can open the app from cold, long after the sign-in window. The pending `{ verifier, state }` must survive a restart (SecureStore) for 15 minutes, and a code with no pending state, or a mismatched one, must be refused with a toast, never exchanged. Task 1.
3. **Offline or on table-only Wi-Fi.** A network error must never sign the user out. Only `invalid_grant` on refresh, or a 401 after a refresh, does that. Task 1.
4. **Signed out or not a member partway through a sync.** The run stops, files already downloaded stay, and the sheet shows the sign-in or non-member state rather than "N didn't download". Task 3.
5. **Hub visibility before launch.** Non-admins must not see the Browse hub row while the catalog says `launched: false`. When the catalog can't be fetched, the row stays hidden. Task 3.

---

### Task 1: The sign-in core

**Files:**
- Modify:
  - `package.json`: dependencies, plus script `"check-hub-auth": "node scripts/check-hub-auth.mjs"`
  - `app.json`: `"scheme": "duneweaver"`
  - `App.tsx`: mount `useHubAuthLinks()` beside `useHubAutoSync()`
  - `../dune-weaver-desktop/metro.config.js`: add aliases beside `'expo-file-system'` at :11
- Create:
  - `src/lib/pkce.mjs`
  - `scripts/check-hub-auth.mjs`
  - `src/lib/hubAuth.ts`
  - `../dune-weaver-desktop/shims/expo-secure-store.ts`, `expo-web-browser.ts` and `expo-crypto.ts`

**Interfaces (produced):**
- `src/lib/pkce.mjs`, plain ESM so Node can test it, like `thrGeometry.mjs`:
  - `base64url(b64: string): string`
  - `verifierFrom(bytes: Uint8Array): string`: base64url of the bytes, which is 43 characters for 32 bytes.
- `src/lib/hubAuth.ts`:
  - `SITE: string`
  - `type HubAccountState = 'unknown' | 'signedOut' | 'member' | 'notMember'`
  - `useHubAccount`, a zustand store `{ state: HubAccountState; email: string | null; admin: boolean }`
  - `class SignedOutError extends Error` and `class NotMemberError extends Error`
  - `signIn(): Promise<void>`
    - verifier: `verifierFrom(getRandomBytes(32))`; challenge: `base64url(SHA-256 base64)`; state: `randomUUID()`.
    - Save `{ verifier, state, at }` under SecureStore `dw.hub.pending`.
    - `openAuthSessionAsync(\`${SITE}/oauth/authorize?response_type=code&client_id=duneweaver-app&redirect_uri=duneweaver%3A%2F%2Foauth&code_challenge=…&code_challenge_method=S256&state=…\`, 'duneweaver://oauth')`.
    - On `success`, call `completeSignIn(url)`. A cancel leaves `pending` in place for an email link.
  - `completeSignIn(url: string): Promise<void>`
    - Needs `pending` with the same `state` and `at` within 15 minutes; otherwise it throws `Error('That sign-in expired. Try again.')`.
    - Exchanges the code with a form POST to `${SITE}/api/oauth/token`: `grant_type=authorization_code`, `code`, `redirect_uri`, `client_id`, `code_verifier`.
    - Stores the refresh token under `dw.hub.refresh` (`AFTER_FIRST_UNLOCK`) and keeps the access token and its expiry in memory.
    - Deletes `pending`, then calls `refreshAccount()`.
  - `hubFetch(path: string, init?: RequestInit): Promise<Response>`
    - Adds `Authorization: Bearer`, refreshing first when there is no access token or it has expired.
    - A 401 triggers one refresh and one retry.
    - Refresh is single-flight.
    - `invalid_grant`, or no refresh token, clears the session, sets `signedOut` and throws `SignedOutError`.
    - Network errors pass through and leave the state alone.
  - `refreshAccount(): Promise<void>`: no refresh token → `signedOut`; otherwise `GET /api/patterns/me` sets `member` / `notMember`, `email` and `admin`. A network error leaves the state alone.
  - `signOut(): Promise<void>`: best-effort `POST ${SITE}/api/oauth/revoke` (`token`, `client_id`), then delete both SecureStore keys and set `signedOut`.
  - `useHubAuthLinks(): void`
    - Runs `refreshAccount()` once.
    - Handles `Linking.getInitialURL()` and `Linking.addEventListener('url')` for URLs starting with `duneweaver://oauth`: calls `completeSignIn`, then `WebBrowser.dismissAuthSession()` (try/catch). A failure shows `toast.error(message)`.
    - Ignores every other URL.
- Desktop shims:
  - secure store: `get` → `null`, `set`/`delete` do nothing;
  - web browser: `openAuthSessionAsync` → `{ type: 'cancel' }`, `dismissAuthSession` does nothing;
  - crypto: `digestStringAsync` via `crypto.subtle`, `getRandomBytes` via `crypto.getRandomValues`, `randomUUID` via `crypto.randomUUID`, plus the two enums.

- [ ] **Step 1: Add the dependencies.** Run `npx expo install expo-web-browser expo-crypto expo-secure-store` (Node 20.19.1 via nvm). Expected: three `~58.x` entries in `package.json`.
- [ ] **Step 2: Write the failing check.** `scripts/check-hub-auth.mjs` asserts with `node:assert`:
  - RFC 7636 Appendix B: `base64url(createHash('sha256').update('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk').digest('base64'))` equals `'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSStw-cM'`;
  - `verifierFrom(new Uint8Array(32))` equals `'A'.repeat(43)`;
  - `verifierFrom(crypto.getRandomValues(new Uint8Array(32)))` matches `/^[A-Za-z0-9_-]{43}$/`.
- [ ] **Step 3: Run it and confirm it fails.** Run `npm run check-hub-auth`. Expected: FAIL, `pkce.mjs` not found.
- [ ] **Step 4: Implement `pkce.mjs`, then run the check.** Expected: it prints `ok` and exits 0.
- [ ] **Step 5: Implement the rest.** `hubAuth.ts`, the scheme, the `App.tsx` mount, and the desktop shims with their aliases.
- [ ] **Step 6: Checkpoint.** Run `npx tsc --noEmit`, then the desktop web export. Expected: both clean.

### Task 2: The account page in Settings

**Files:**
- Create: `src/screens/settings/AccountSettings.tsx`
- Modify:
  - `src/navigation.ts`: `SettingsStackParamList` gains `Account: undefined`
  - `src/screens/settings/SettingsStack.tsx`: a `<Stack.Screen name="Account" …/>`
  - `src/screens/SettingsScreen.tsx`: a row in the "On this phone" group (:344-349)

**Interfaces:**
- Consumes `useHubAccount`, `signIn`, `signOut` and `SITE` from Task 1.
- The Settings row:
  - `<NavRow icon="account-circle" label="duneweaver.com" value={email ?? 'Signed out'} onPress={() => go('Account')} />`, placed above Patterns;
  - not rendered when `Platform.OS === 'web'`.
- The page is `SettingsPage title="duneweaver.com"`.
  - **Signed out:** the signed-out copy, then a primary `Sign in` button. It runs `signIn()` with a loading state; an error shows `toast.error(message)`.
  - **Member:** the email, then `Plan owner`.
  - **Not a member:** the email, then the non-member copy and the account hint.
  - **When signed in:** a secondary `Sign out` button, and a `destructive` `Delete account` button that runs `Linking.openURL(\`${SITE}/account/delete\`)`.

- [ ] **Step 1: Implement it.** Follow `PatternsSettings.tsx` for the page layout and `ui.tsx` `Button` for the variants.
- [ ] **Step 2: Checkpoint.** Run `npx tsc --noEmit`. Expected: clean.

### Task 3: Gated hub sync

**Files:**
- Modify:
  - `src/lib/patternHub.ts`
  - `src/components/HubSheet.tsx`
  - `src/screens/BrowseScreen.tsx` (the hub row, :483-486)
  - `AGENTS.md` (the Pattern Hub bullet)
  - `fastlane/metadata/review_information/notes.txt`

**Interfaces:**
- Consumes `hubFetch`, `SignedOutError`, `NotMemberError`, `useHubAccount` and `refreshAccount`.
- Produces, in `src/lib/patternHub.ts`:
  - `HubPattern` loses `thr`.
  - `fetchHubCatalog(): Promise<{ patterns: HubPattern[]; launched: boolean }>`
  - `useHubVisible(): boolean`
    - `false` on web.
    - Otherwise `launched || admin`. `launched` comes from one catalog fetch per app session, cached in the module; a failed fetch counts as `false`.
- Behaviour:
  - **Downloading a `.thr`:**
    - `hubFetch(\`/api/patterns/${encodeURIComponent(p.id)}/download\`, { method: 'POST' })`;
    - a 403 whose body has `code: 'not_a_buyer'` throws `NotMemberError`;
    - otherwise take `{ url }` and fetch it with `binaryFetch`. Previews are fetched as now.
  - **In `runSync`:** `SignedOutError` and `NotMemberError` end the run (`result.error`) instead of counting as a failed file.
  - **Auto-download:** `autoSync` and `useHubAutoSync` run only when `state === 'member'`.
  - **HubSheet:**
    - It calls `refreshAccount()` on open.
    - The bottom bar shows one of three states:
      - **signed out / unknown:** the signed-out copy and a primary `Sign in` button;
      - **not a member:** the non-member copy, the account hint, the account's email, and a secondary `Use another account` button (`signOut()` then `signIn()`);
      - **member:** today's sync buttons.
    - The auto-download toggle is disabled unless the account is a member.
    - A run that ends in `SignedOutError` or `NotMemberError` shows the matching state, with no error toast.
  - **Browse:** the hub row renders only when `!rect && useHubVisible()`.
  - **AGENTS.md:** sign-in (client, scheme, PKCE, SecureStore keys, single-flight refresh); downloads through the route; the `launched` flag; the hub hidden on desktop; no purchase wording. It replaces the text about public `.thr` downloads.
  - **notes.txt:** append, in the file's own voice: `The app controls a sand table the user builds from plans bought on duneweaver.com. Pattern Hub patterns come free with those plans; nothing is sold in the app. Test account: see demo user, which owns a plan.`

- [ ] **Step 1: Implement it.**
- [ ] **Step 2: Checkpoint.**
  - Run `npx tsc --noEmit`, `npx expo export --platform ios` and the desktop web export.
  - Expected: all clean. The desktop has no hub row and no account row.
- [ ] **Step 3: Hand off to the owner.**
  - The scheme and the three native modules need a new dev build. Build it (iOS dev client, Xcode-beta `DEVELOPER_DIR` per memory), launch it on "DW iPhone 17 Pro (26.5)", and start Metro without `CI=1`.
  - Use `EXPO_PUBLIC_DW_SITE=<preview URL>` if the website isn't in production yet.
  - Write down exactly what to check:
    - sign in with Google, Apple, password and email link, including the link opened from Mail with the app closed;
    - a plan account syncs;
    - an account without a plan shows the non-member state and downloads nothing;
    - sign out;
    - Delete account opens the website.

---

## Release steps (owner)

- App Privacy label: no longer "Data Not Collected". The app now links an email address to the user's identity, for app functionality.
- App Review: put the demo account (`fastlane/metadata/review_information/demo_user.txt`) on a plan, through `grant_product`.
- The desktop release ships as usual, with the hub hidden.
