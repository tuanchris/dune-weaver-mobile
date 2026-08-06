// Renaming a saved table also renames it ON the table ($Hostname), so the name
// the owner picked in the app is the name the network shows: /sand_status,
// <name>.local, the mDNS service the discovery scan lists, and (after the
// table's next reboot) the router's client list.
//
// The two names are NOT the same string. The app's display name is free text
// ("Living Room", "Tuan's table"); the firmware's hostname accepts only letters,
// digits and "-", 1..32 chars, and rejects anything else outright. So the
// display name stays exactly as typed and a sanitized DERIVATION of it is what
// gets pushed ("Living Room" -> "Living-Room"). The push is best-effort: the
// local rename always sticks, even when the table is off, busy, or too old.
//
// BACKWARD COMPATIBILITY (this is why the version gate is not optional):
// before firmware v0.1.18, `$Hostname=` was captured by config.yaml's top-level
// `hostname:` key instead of reaching the NVS setting. The board answered "ok",
// read the new name back for the rest of the session, and lost it on the next
// boot — a silent no-op that LOOKS like success. There is no way to detect that
// from the response, so we check status.fw and simply don't push to older
// tables (rename stays local, exactly as it behaved before this feature).

import { board } from '../api/board'
import { translateStatus, isSettingsLocked, type Status } from '../api/status'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { userMessage } from './errors'
import { isNewer } from './version'

/** First firmware whose `$Hostname=` write actually survives a reboot — the
 * rc that carried the fix, not the final tag: parseVersion ranks rc tails, so
 * a bare 'v0.1.18' here would read as NEWER than a table running -rc1 and skip
 * the push on the very build that introduced it. */
export const HOSTNAME_MIN_FW = 'v0.1.18-rc1'

/** Firmware hostname rules (FluidNC WifiConfig.cpp HostnameSetting). */
const MAX_HOSTNAME_LENGTH = 32

/**
 * Derive a firmware-legal hostname from a display name: keep letters, digits
 * and "-", fold every other run (spaces, apostrophes, emoji) to a single "-",
 * trim leading/trailing "-", cap at 32 chars. Returns null when nothing usable
 * survives (e.g. a name that is only emoji) — the caller then leaves the
 * table's network name alone rather than inventing one.
 */
export function toHostname(name: string): string | null {
  const h = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .slice(0, MAX_HOSTNAME_LENGTH)
    .replace(/^-+|-+$/g, '')
  return h.length ? h : null
}

/** Does this firmware make `$Hostname=` stick? Unknown version => no. */
export function supportsRename(fw: string | null | undefined): boolean {
  if (!fw) return false
  // "fw is at least MIN" == "MIN is not newer than fw".
  return !isNewer(HOSTNAME_MIN_FW, fw)
}

export type RenameOutcome =
  | { applied: true; hostname: string }
  /** Nothing to do — the table already answers to this name (or it's the demo). */
  | { applied: false; reason: 'unchanged' }
  /** The display name has no letters/digits to build a hostname from. */
  | { applied: false; reason: 'invalid' }
  /** Firmware older than v0.1.18: the write would be silently dropped. */
  | { applied: false; reason: 'unsupported' }
  /** Mid-pattern — the firmware refuses config writes during motion. */
  | { applied: false; reason: 'busy' }
  /** Table unreachable, or the write failed. `message` is user-facing. */
  | { applied: false; reason: 'failed'; message: string }

/** Live status for the ACTIVE table (already polled every 1s), else a probe. */
async function statusFor(base: string): Promise<Status> {
  const live = useStatus.getState()
  if (live.base === base && live.status?.connected) return live.status
  return translateStatus(await board.status(base))
}

/**
 * Push a saved table's new display name to the table itself. Best-effort —
 * every failure mode is reported, none of them undo the local rename.
 *
 * On success the saved board's stored `hostname` is updated immediately (the
 * status poll would do it a second later anyway, but auto-relocate reads it),
 * and a base written as the OLD mDNS name (`http://dwmp.local`) is re-pointed
 * at the new one — otherwise the rename would make the table unreachable.
 */
export async function syncHostname(boardId: string, displayName: string): Promise<RenameOutcome> {
  const b = useBoards.getState().boards.find((x) => x.id === boardId)
  if (!b) return { applied: false, reason: 'unchanged' }

  const hostname = toHostname(displayName)
  if (!hostname) return { applied: false, reason: 'invalid' }

  try {
    const status = await statusFor(b.base)
    if (!supportsRename(status.fw)) return { applied: false, reason: 'unsupported' }
    if (status.hostname === hostname) {
      // Already right, but the saved entry may not know it yet.
      if (b.hostname !== hostname) useBoards.getState().updateBase(b.id, b.base, hostname)
      return { applied: false, reason: 'unchanged' }
    }
    // $Hostname is a board-config write like homing mode, so it follows the
    // same rule as the rest of Settings: locked for the WHOLE playlist run, not
    // just during motion. isBusy alone would let a write through the momentary
    // Idle of the between-patterns pause and race the next pattern's start
    // (the firmware would answer 503 "Try again when not moving").
    if (isSettingsLocked(status)) return { applied: false, reason: 'busy' }

    await board.setHostname(b.base, hostname)

    // Follow the rename in the saved entry. A base typed as "<old>.local" dies
    // with the old mDNS record, so re-point it; IP bases are left alone.
    // (App.tsx mirrors the active board's base into useStatus, so repointing
    // the entry is enough to move the poller.)
    const oldHost = status.hostname ?? b.hostname
    const nextBase = oldHost ? renamedLocalBase(b.base, oldHost, hostname) : b.base
    useBoards.getState().updateBase(b.id, nextBase, hostname)

    return { applied: true, hostname }
  } catch (e) {
    return { applied: false, reason: 'failed', message: userMessage(e, 'rename the table on the network') }
  }
}

/** `http://dwmp.local:80` + (dwmp -> studio) => `http://studio.local:80`. */
function renamedLocalBase(base: string, oldHostname: string, newHostname: string): string {
  const m = /^(https?:\/\/)([^/:]+)(:\d+)?$/i.exec(base)
  if (!m) return base
  const host = m[2]
  const bare = host.replace(/\.local\.?$/i, '')
  if (bare === host) return base // an IP or a plain name — not an mDNS base
  if (bare.toLowerCase() !== oldHostname.toLowerCase()) return base
  return `${m[1]}${newHostname}.local${m[3] ?? ''}`
}

/** One-line, user-facing summary of an outcome — or null when it needs no toast. */
export function renameMessage(
  outcome: RenameOutcome,
  displayName: string
): { kind: 'success' | 'info' | 'error'; text: string } | null {
  if (outcome.applied) {
    // Name the derived hostname whenever it isn't just what they typed, so a
    // "Living Room" -> "Living-Room" fold is visible rather than surprising.
    return {
      kind: 'success',
      text:
        outcome.hostname === displayName.trim()
          ? `Renamed. The table answers to ${outcome.hostname}.local`
          : `Renamed. On the network the table is now ${outcome.hostname}.local`,
    }
  }
  switch (outcome.reason) {
    case 'unchanged':
      return null
    case 'invalid':
      return {
        kind: 'info',
        text: 'Renamed in the app. Its network name is unchanged — those need letters, numbers or hyphens.',
      }
    case 'unsupported':
      return {
        kind: 'info',
        text: 'Renamed in the app. Update the table’s firmware to change its network name too.',
      }
    case 'busy':
      return {
        kind: 'info',
        text: 'Renamed in the app. The table is running — rename it again when it’s idle to change its network name.',
      }
    case 'failed':
      return { kind: 'error', text: outcome.message }
  }
}
