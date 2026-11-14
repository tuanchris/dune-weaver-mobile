// Sign-in to duneweaver.com for the Pattern Hub: OAuth authorization code +
// PKCE against the website's public `duneweaver-app` client, in the system
// sign-in window. The refresh token lives in Keychain/Keystore (SecureStore,
// long-lived: the site ends it after a year unused); the ~1 h access token only
// in memory. Hub downloads go through `hubFetch`.
import { useEffect } from 'react'
import { AppState, Linking } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import * as WebBrowser from 'expo-web-browser'
import { base64url, verifierFrom } from './pkce.mjs'
import { toast } from '../stores/useToast'
import { log } from '../stores/useAppLog'

export const SITE = process.env.EXPO_PUBLIC_DW_SITE ?? 'https://duneweaver.com'
const CLIENT_ID = 'duneweaver-app'
const REDIRECT = 'duneweaver://oauth'
const PENDING_KEY = 'dw.hub.pending'
const REFRESH_KEY = 'dw.hub.refresh'
// An email link can open the app long after the sign-in window, even from cold.
const PENDING_TTL_MS = 15 * 60_000
const KEYCHAIN: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK }
// The last /me answer (AsyncStorage), so an offline launch still knows who's signed in.
const ACCOUNT_KEY = 'dw.hub.account'
// With no access token in memory, every /me rotates the refresh token, and a
// reply lost after the site rotated (app killed, Wi-Fi switched to the table's
// hotspot) leaves a superseded token that signs the user out. So launch and
// foreground reuse a saved answer for a week; the hub sheet and the account
// page still re-read it on every open. Weekly also keeps the grant (365 days
// from its last refresh) alive for someone who never opens the hub.
const RECHECK_MS = 7 * 24 * 60 * 60_000

export type HubAccountState = 'unknown' | 'signedOut' | 'member' | 'notMember'

interface HubAccount {
  state: HubAccountState
  email: string | null
  admin: boolean
  /** When /me last answered (epoch ms; 0 = never). */
  checkedAt: number
}

const SIGNED_OUT: HubAccount = { state: 'signedOut', email: null, admin: false, checkedAt: 0 }

export const useHubAccount = create<HubAccount>(() => ({ state: 'unknown', email: null, admin: false, checkedAt: 0 }))
// Every change is saved, including patternHub's not_a_buyer → notMember.
useHubAccount.subscribe((a) => void AsyncStorage.setItem(ACCOUNT_KEY, JSON.stringify(a)).catch(() => {}))

export class SignedOutError extends Error {
  constructor() {
    super('Sign in with your duneweaver.com account to sync Pattern Hub patterns.')
    this.name = 'SignedOutError'
  }
}

export class NotMemberError extends Error {
  constructor() {
    super('Pattern Hub downloads are for Dune Weaver plan owners.')
    this.name = 'NotMemberError'
  }
}

interface Pending {
  verifier: string
  state: string
  at: number
}

interface Tokens {
  access_token: string
  expires_in: number
  refresh_token: string
}

let access: { token: string; exp: number } | null = null
let refreshing: Promise<string> | null = null
// The redirect can arrive twice (Android: the sign-in window's result AND the
// app's url event). A code is single-use, so a repeat shares the first run.
let completing: { url: string; run: Promise<void> } | null = null
let restored: Promise<void> | null = null

const form = (body: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
  body: new URLSearchParams(body).toString(),
})

async function oauthError(res: Response): Promise<string> {
  const body: unknown = await res.json().catch(() => null)
  const code = body && typeof body === 'object' && 'error' in body ? String(body.error) : `HTTP ${res.status}`
  log.warn('hub', `oauth: ${code}`)
  return code
}

async function saveTokens(res: Response): Promise<string> {
  const t = (await res.json()) as Partial<Tokens>
  if (typeof t.access_token !== 'string' || typeof t.refresh_token !== 'string') throw new Error('Bad token response.')
  await SecureStore.setItemAsync(REFRESH_KEY, t.refresh_token, KEYCHAIN)
  // A minute early, so a token never expires between the check and the call.
  access = { token: t.access_token, exp: Date.now() + ((t.expires_in ?? 3600) - 60) * 1000 }
  return t.access_token
}

async function endSession(): Promise<never> {
  access = null
  await SecureStore.deleteItemAsync(REFRESH_KEY, KEYCHAIN)
  useHubAccount.setState(SIGNED_OUT)
  throw new SignedOutError()
}

async function refreshTokens(): Promise<string> {
  const token = await SecureStore.getItemAsync(REFRESH_KEY, KEYCHAIN)
  if (!token) return endSession()
  const res = await fetch(`${SITE}/api/oauth/token`, form({ grant_type: 'refresh_token', refresh_token: token, client_id: CLIENT_ID }))
  if (res.ok) return saveTokens(res)
  if ((await oauthError(res)) === 'invalid_grant') return endSession()
  throw new Error('duneweaver.com had a problem. Try again in a moment.')
}

/** Single-flight: the site revokes the whole grant when an old refresh token is
 * replayed, so two callers refreshing at once would sign the user out. */
function freshAccess(): Promise<string> {
  refreshing ??= refreshTokens().finally(() => {
    refreshing = null
  })
  return refreshing
}

/** A request to the site with the access token. 401 → one refresh + one retry;
 * a 401 after that, `invalid_grant`, or no refresh token signs out
 * (SignedOutError). Network errors pass through and leave the account alone. */
export async function hubFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const send = (token: string): Promise<Response> => {
    const headers = new Headers(init.headers)
    headers.set('Authorization', `Bearer ${token}`)
    return fetch(`${SITE}${path}`, { ...init, headers })
  }
  const res = await send(access && Date.now() < access.exp ? access.token : await freshAccess())
  if (res.status !== 401) return res
  const retry = await send(await freshAccess())
  if (retry.status === 401) return endSession()
  return retry
}

/** Re-reads the account from `/api/patterns/me`. Never throws; a network or
 * server error leaves the state as it was. */
export async function refreshAccount(): Promise<void> {
  try {
    if (!(await SecureStore.getItemAsync(REFRESH_KEY, KEYCHAIN))) {
      useHubAccount.setState(SIGNED_OUT)
      return
    }
    // A stored token is a signed-in user even before /me answers (right after
    // the code exchange, say, with /me failing): never show them signed out.
    if (useHubAccount.getState().state === 'signedOut') useHubAccount.setState({ state: 'unknown' })
    const res = await hubFetch('/api/patterns/me')
    if (!res.ok) return
    const me = (await res.json()) as { email?: string; member?: boolean; admin?: boolean }
    useHubAccount.setState({ state: me.member ? 'member' : 'notMember', email: me.email ?? null, admin: !!me.admin, checkedAt: Date.now() })
  } catch {
    // SignedOutError has already set the state; anything else leaves it.
  }
}

/** The saved answer, loaded once. Only over the launch default: anything that
 * set the account first (a /me, a sign-out) is newer. */
function restore(): Promise<void> {
  restored ??= AsyncStorage.getItem(ACCOUNT_KEY)
    .then((raw) => {
      const saved = JSON.parse(raw ?? 'null') as HubAccount | null
      if (saved && useHubAccount.getState().state === 'unknown') useHubAccount.setState(saved)
    })
    .catch(() => {})
  return restored
}

/** At launch and on every return to the foreground: re-reads the account only
 * when it's unknown (an offline launch) or a week old (RECHECK_MS). Never throws. */
export async function checkAccount(): Promise<void> {
  await restore()
  const a = useHubAccount.getState()
  const fresh = (a.state === 'member' || a.state === 'notMember') && Date.now() - a.checkedAt < RECHECK_MS
  // The keychain still decides whether anyone is signed in.
  if (fresh && (await SecureStore.getItemAsync(REFRESH_KEY, KEYCHAIN).catch(() => null))) return
  await refreshAccount()
}

export async function signIn(): Promise<void> {
  const verifier = verifierFrom(Crypto.getRandomBytes(32))
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  })
  const state = Crypto.randomUUID()
  const pending: Pending = { verifier, state, at: Date.now() }
  await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(pending), KEYCHAIN)
  const res = await WebBrowser.openAuthSessionAsync(
    `${SITE}/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT)}` +
      `&code_challenge=${base64url(digest)}&code_challenge_method=S256&state=${state}`,
    REDIRECT,
  )
  // A cancel keeps `pending`: the user may finish through an email link.
  if (res.type === 'success') await completeSignIn(res.url)
}

/** Finishes a sign-in from its redirect (the sign-in window's result or a deep
 * link). Refuses a code without a matching, recent pending sign-in. */
export function completeSignIn(url: string): Promise<void> {
  if (completing?.url === url) return completing.run
  const run = exchangeCode(url)
  completing = { url, run }
  // A failed run (offline, say) may be retried by opening the link again.
  run.catch(() => {
    if (completing?.run === run) completing = null
  })
  return run
}

async function exchangeCode(url: string): Promise<void> {
  const q = new URLSearchParams(url.split('#')[0].split('?')[1] ?? '')
  let pending: Pending | null = null
  try {
    pending = JSON.parse((await SecureStore.getItemAsync(PENDING_KEY, KEYCHAIN)) ?? 'null') as Pending | null
  } catch {
    pending = null
  }
  // Android re-delivers the link that launched the app when it's reopened from
  // Recents after the process died. Its code was already used: signed in, and
  // nothing pending, is that case, so there's nothing to say.
  if (!pending && (await SecureStore.getItemAsync(REFRESH_KEY, KEYCHAIN).catch(() => null))) return
  if (!pending || pending.state !== q.get('state') || !(Date.now() - pending.at < PENDING_TTL_MS)) {
    throw new Error('That sign-in expired. Try again.')
  }
  const code = q.get('code')
  if (!code) {
    log.warn('hub', `oauth redirect: ${q.get('error') ?? 'no code'}`)
    throw new Error("Sign-in didn't finish. Try again.")
  }
  const res = await fetch(
    `${SITE}/api/oauth/token`,
    form({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: CLIENT_ID, code_verifier: pending.verifier }),
  )
  if (!res.ok) {
    await oauthError(res)
    throw new Error("Couldn't finish signing in. Try again.")
  }
  await saveTokens(res)
  await SecureStore.deleteItemAsync(PENDING_KEY, KEYCHAIN)
  await refreshAccount()
  const { email } = useHubAccount.getState()
  toast.success(email ? `Signed in as ${email}` : 'Signed in to duneweaver.com')
}

export async function signOut(): Promise<void> {
  await refreshing?.catch(() => {}) // a refresh landing after this would bring the token back
  const token = await SecureStore.getItemAsync(REFRESH_KEY, KEYCHAIN)
  if (token) {
    // Best-effort and not awaited: revoking kills the whole grant on the site,
    // but offline (table-only Wi-Fi) the button mustn't hang on it. The token
    // is forgotten here either way.
    fetch(`${SITE}/api/oauth/revoke`, form({ token, client_id: CLIENT_ID })).catch(() => {})
  }
  access = null
  await SecureStore.deleteItemAsync(REFRESH_KEY, KEYCHAIN)
  await SecureStore.deleteItemAsync(PENDING_KEY, KEYCHAIN)
  useHubAccount.setState(SIGNED_OUT)
}

/** Mounted once (App.tsx): checks the account at launch and on each return to
 * the foreground, and finishes sign-ins that come back as a `duneweaver://oauth`
 * link (an email link, even with the app closed). */
export function useHubAuthLinks(): void {
  useEffect(() => {
    void checkAccount()
    const app = AppState.addEventListener('change', (s) => {
      if (s === 'active') void checkAccount()
    })
    const handle = (url: string | null | undefined): void => {
      if (!url?.startsWith(REDIRECT)) return
      completeSignIn(url).then(
        () => {
          try {
            WebBrowser.dismissAuthSession()
          } catch {
            // No sign-in window open.
          }
        },
        (e: unknown) => toast.error(e instanceof Error ? e.message : String(e)),
      )
    }
    void Linking.getInitialURL().then(handle)
    const sub = Linking.addEventListener('url', ({ url }) => handle(url))
    return () => {
      sub.remove()
      app.remove()
    }
  }, [])
}
