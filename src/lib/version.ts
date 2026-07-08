// Version parsing/comparison for update checks. Handles both the app's plain
// "1.0.1" and the firmware's git_info, which is `git describe`-shaped:
// "v0.1.2" at an exact tag, "v0.1.2-pre1" for prereleases, or
// "v0.1.2 (main-abc1234-dirty)" on untagged builds.

/** Numeric sort key: [major, minor, patch, pre]. `pre` is the -preN number,
 * or MAX_SAFE_INTEGER for a full release (so v1.2.3-pre1 < v1.2.3). */
export function parseVersion(s: string | null | undefined): number[] | null {
  if (!s) return null
  const m = /v?(\d+)\.(\d+)\.(\d+)(?:-pre(\d+))?/.exec(s)
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] != null ? Number(m[4]) : Number.MAX_SAFE_INTEGER]
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
