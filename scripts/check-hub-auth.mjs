// Checks the Pattern Hub sign-in in plain Node:
//   npm run check-hub-auth
// src/lib/pkce.mjs directly; src/lib/hubAuth.ts transpiled with the repo's
// TypeScript, its native modules stubbed and fetch faked (nothing leaves the machine).
import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { base64url, verifierFrom } from '../src/lib/pkce.mjs'

// RFC 7636 Appendix B: the S256 challenge of its example verifier.
assert.equal(
  base64url(createHash('sha256').update('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk').digest('base64')),
  'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
)
assert.equal(verifierFrom(new Uint8Array(32)), 'A'.repeat(43))
assert.match(verifierFrom(webcrypto.getRandomValues(new Uint8Array(32))), /^[A-Za-z0-9_-]{43}$/)

// hubAuth.ts, with a Map for SecureStore and a scripted fetch.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const stubs = `
import { base64url, verifierFrom } from '${pathToFileURL(path.join(ROOT, 'src/lib/pkce.mjs')).href}'
export const store = new Map(), saved = new Map()
const SecureStore = { AFTER_FIRST_UNLOCK: 0,
  getItemAsync: async (k) => store.get(k) ?? null, setItemAsync: async (k, v) => void store.set(k, v), deleteItemAsync: async (k) => void store.delete(k) }
const AsyncStorage = { getItem: async (k) => saved.get(k) ?? null, setItem: async (k, v) => void saved.set(k, v) }
const create = (init) => { let s = init(); const ls = []; const h = () => s; h.getState = () => s
  h.setState = (p) => { s = { ...s, ...p }; ls.forEach((l) => l(s)) }; h.subscribe = (l) => ls.push(l); return h }
const useEffect = () => {}, Linking = {}, AppState = {}, Crypto = {}, WebBrowser = {}
const toast = { error() {}, success() {} }, log = { warn() {} }
`
const src = stubs + fs.readFileSync(path.join(ROOT, 'src/lib/hubAuth.ts'), 'utf8').replace(/^import .*$/gm, '')
const out = path.join(ROOT, 'node_modules/.cache/check-hub-auth.mjs')
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText)
const hub = await import(pathToFileURL(out).href)
const { store, saved, hubFetch, completeSignIn, refreshAccount, checkAccount, useHubAccount, SignedOutError } = hub

const json = (status, body) => new Response(JSON.stringify(body), { status })
const tokens = (n) => json(200, { access_token: `a${n}`, refresh_token: `r${n}`, expires_in: 3600, token_type: 'Bearer' })
let calls = []
const fake = (route) => {
  calls = []
  globalThis.fetch = async (url, init = {}) => {
    const call = { path: new URL(url).pathname, body: String(init.body ?? ''), auth: new Headers(init.headers).get('Authorization') }
    calls.push(call)
    return route(call)
  }
}
const tokenCalls = () => calls.filter((c) => c.path === '/api/oauth/token').length

// Two calls at once with no access token share ONE refresh (a replayed refresh token kills the grant).
store.set('dw.hub.refresh', 'r0')
let n = 0
fake((c) => (c.path === '/api/oauth/token' ? new Promise((r) => setTimeout(() => r(tokens(++n)), 20)) : json(200, { ok: true })))
const [x, y] = await Promise.all([hubFetch('/api/patterns/me'), hubFetch('/api/patterns/me')])
assert.equal(tokenCalls(), 1, 'refresh is single-flight')
assert.ok(x.ok && y.ok)
assert.equal(store.get('dw.hub.refresh'), 'r1')
assert.ok(calls.filter((c) => c.path === '/api/patterns/me').every((c) => c.auth === 'Bearer a1'))

// A 401 refreshes once and retries once.
fake((c) => (c.path === '/api/oauth/token' ? tokens(2) : json(c.auth === 'Bearer a2' ? 200 : 401, {})))
assert.equal((await hubFetch('/api/patterns/me')).status, 200)
assert.equal(tokenCalls(), 1)

// Offline: the error passes through, nothing is signed out.
useHubAccount.setState({ state: 'member', email: 'a@b.c', admin: false })
fake(() => Promise.reject(new TypeError('Network request failed')))
await assert.rejects(hubFetch('/api/patterns/me'), TypeError)
await refreshAccount()
assert.equal(store.get('dw.hub.refresh'), 'r2')
assert.equal(useHubAccount.getState().state, 'member')

// A server error on refresh doesn't sign out either.
fake((c) => (c.path === '/api/oauth/token' ? json(500, { error: 'server_error' }) : json(401, {})))
await assert.rejects(hubFetch('/api/patterns/me'), (e) => !(e instanceof SignedOutError))
assert.equal(store.get('dw.hub.refresh'), 'r2')

// A 401 after a refresh signs out.
fake((c) => (c.path === '/api/oauth/token' ? tokens(3) : json(401, {})))
await assert.rejects(hubFetch('/api/patterns/me'), SignedOutError)
assert.equal(store.has('dw.hub.refresh'), false)
assert.equal(useHubAccount.getState().state, 'signedOut')

// invalid_grant on refresh signs out.
store.set('dw.hub.refresh', 'old')
fake(() => json(400, { error: 'invalid_grant' }))
await assert.rejects(hubFetch('/api/patterns/me'), SignedOutError)
assert.equal(store.has('dw.hub.refresh'), false)

// A code without a matching, recent pending sign-in is refused and never exchanged.
const expired = { message: 'That sign-in expired. Try again.' }
fake(() => tokens(9))
await assert.rejects(completeSignIn('duneweaver://oauth?code=c&state=s1'), expired)
store.set('dw.hub.pending', JSON.stringify({ verifier: 'v', state: 's1', at: Date.now() }))
await assert.rejects(completeSignIn('duneweaver://oauth?code=c&state=s2'), expired)
store.set('dw.hub.pending', JSON.stringify({ verifier: 'v', state: 's1', at: Date.now() - 16 * 60_000 }))
await assert.rejects(completeSignIn('duneweaver://oauth?code=c&state=s1&x=1'), expired)
assert.equal(calls.length, 0)

// A matching one is exchanged once, even when the redirect arrives twice.
store.set('dw.hub.pending', JSON.stringify({ verifier: 'v', state: 's1', at: Date.now() }))
fake((c) => (c.path === '/api/oauth/token' ? tokens(4) : json(200, { email: 'a@b.c', member: true, admin: false })))
const url = 'duneweaver://oauth?code=c1&state=s1'
await Promise.all([completeSignIn(url), completeSignIn(url)])
await completeSignIn(url)
assert.equal(tokenCalls(), 1)
assert.match(calls[0].body, /grant_type=authorization_code/)
assert.match(calls[0].body, /code_verifier=v/)
assert.match(calls[0].body, /redirect_uri=duneweaver%3A%2F%2Foauth/)
assert.equal(store.get('dw.hub.refresh'), 'r4')
assert.equal(store.has('dw.hub.pending'), false)
const me = useHubAccount.getState()
assert.deepEqual({ ...me, checkedAt: 0 }, { state: 'member', email: 'a@b.c', admin: false, checkedAt: 0 })
assert.ok(Date.now() - me.checkedAt < 1000)
assert.equal(JSON.parse(saved.get('dw.hub.account')).email, 'a@b.c', 'the /me answer is saved')

// A stored token is signed in even when /me fails (after the code exchange, offline):
// never 'signedOut', which would offer a second sign-in.
useHubAccount.setState({ state: 'signedOut', email: null })
fake(() => Promise.reject(new TypeError('Network request failed')))
await refreshAccount()
assert.equal(useHubAccount.getState().state, 'unknown')

// Launch: the saved answer comes back before anything else, and a week-fresh one
// with a token in the keychain asks the site nothing (every /me can rotate the token).
useHubAccount.setState({ state: 'unknown', email: null, admin: false, checkedAt: 0 })
saved.set('dw.hub.account', JSON.stringify({ state: 'member', email: 'm@x.y', admin: true, checkedAt: Date.now() - 60_000 }))
fake(() => json(200, { email: 'm@x.y', member: true, admin: true }))
await checkAccount()
assert.equal(calls.length, 0, 'fresh saved answer: no request')
assert.deepEqual([useHubAccount.getState().state, useHubAccount.getState().email, useHubAccount.getState().admin], ['member', 'm@x.y', true])

// A week old: re-read.
useHubAccount.setState({ checkedAt: Date.now() - 8 * 24 * 60 * 60_000 })
await checkAccount()
assert.equal(calls.filter((c) => c.path === '/api/patterns/me').length, 1, 'stale answer: one /me')
assert.ok(Date.now() - useHubAccount.getState().checkedAt < 1000)

// Unknown (an offline launch): re-read on the next foreground, once online.
useHubAccount.setState({ state: 'unknown' })
fake(() => Promise.reject(new TypeError('Network request failed')))
await checkAccount()
assert.equal(useHubAccount.getState().state, 'unknown')
fake(() => json(200, { email: 'm@x.y', member: false, admin: false }))
await checkAccount()
assert.equal(useHubAccount.getState().state, 'notMember')

// The keychain decides: a fresh saved answer without a refresh token is signed out, with no request.
store.delete('dw.hub.refresh')
useHubAccount.setState({ state: 'member', checkedAt: Date.now() })
fake(() => json(200, {}))
await checkAccount()
assert.equal(calls.length, 0)
assert.equal(useHubAccount.getState().state, 'signedOut')
store.set('dw.hub.refresh', 'r4')

// Sign out revokes (best-effort, even offline) and forgets both keys.
store.set('dw.hub.pending', '{}')
fake(() => Promise.reject(new TypeError('Network request failed')))
await hub.signOut()
assert.equal(calls[0]?.path, '/api/oauth/revoke')
assert.match(calls[0].body, /token=r4/)
assert.equal(store.size, 0)
assert.equal(useHubAccount.getState().state, 'signedOut')

console.log('ok')
