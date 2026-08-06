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
