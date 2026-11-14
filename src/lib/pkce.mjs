// PKCE (RFC 7636) pieces of the Pattern Hub sign-in (lib/hubAuth.ts). Plain ESM
// .mjs like thrGeometry.mjs, so scripts/check-hub-auth.mjs tests it in Node.

/** Standard base64 -> base64url without padding (RFC 7636 §3). */
export function base64url(b64) {
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A code verifier from random bytes: their base64url, 43 characters for 32 bytes. */
export function verifierFrom(bytes) {
  return base64url(btoa(String.fromCharCode(...bytes)))
}
