// Version parsing/comparison for update checks. Handles both the app's plain
// "1.0.1" and the firmware's git_info, which is `git describe`-shaped:
// "v0.1.2" at an exact tag, "v0.1.2-pre1" / "v0.1.2-rc1" for prereleases, or
// "v0.1.2 (main-abc1234-dirty)" on untagged builds.

/** Prerelease ranks: -preN < -rcN < the final release. `rc` sits above `pre`
 * (release candidates come last) and both sit below MAX_SAFE_INTEGER. */
const RC_RANK = 1_000_000

/** Numeric sort key: [major, minor, patch, pre]. `pre` ranks the prerelease
 * tail (see RC_RANK), or MAX_SAFE_INTEGER for a full release — so
 * v1.2.3-pre1 < v1.2.3-rc1 < v1.2.3-rc2 < v1.2.3.
 *
 * The rc tail MATTERS: firmware features have shipped in an -rcN before their
 * final tag, so treating "v0.1.18-rc1" as plain "v0.1.18" (which this used to
 * do, by not matching the tail at all) makes a feature gate answer yes for a
 * build that predates the feature. Gate constants therefore name the exact
 * prerelease that carries the change. */
export function parseVersion(s: string | null | undefined): number[] | null {
  if (!s) return null
  const m = /v?(\d+)\.(\d+)\.(\d+)(?:-(pre|rc)(\d+))?/.exec(s)
  if (!m) return null
  const pre =
    m[4] == null ? Number.MAX_SAFE_INTEGER : (m[4] === 'rc' ? RC_RANK : 0) + Number(m[5])
  return [Number(m[1]), Number(m[2]), Number(m[3]), pre]
}

/** The bare version token of a release tag / firmware git_info, lowercased and
 * `v`-stripped: "v0.1.18-rc3 (main-abc1234)" → "0.1.18-rc3". Null when there's
 * no version in the string.
 *
 * Use this — NOT parseVersion — for "is this exact build the one on the table?".
 * The numeric key deliberately ignores prerelease tails it doesn't recognise
 * (anything that isn't -preN/-rcN parses as the final release), so comparing
 * keys badges a DIFFERENT build as the installed one and locks the real
 * version out of the picker. That is how an -rc3 table ended up unable to
 * install its own final release. */
export function versionTag(s: string | null | undefined): string | null {
  if (!s) return null
  const m = /v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)*)/.exec(s)
  return m ? m[1].toLowerCase() : null
}

/** Same build? (exact tag identity, not a numeric-key comparison). */
export function sameVersion(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = versionTag(a)
  return ta != null && ta === versionTag(b)
}

/** True when `candidate` is a strictly newer version than `current`.
 * False if either side is missing/unparseable (never nag on unknowns). */
export function isNewer(candidate: string | null | undefined, current: string | null | undefined): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}
