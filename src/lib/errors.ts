// Turn raw failures (transport errors, firmware HTTP replies) into sentences a
// table owner can act on. Every mapped error also lands in the diagnostics log
// with its raw text, so "friendly toast" never means "lost detail".
//
// `doing` is the verb phrase for what failed, e.g. "create the playlist" —
// messages read "Couldn't create the playlist — …".

import { log } from '../stores/useAppLog'
import { useStatus } from '../stores/useStatus'
import { SdBusyError, SyncBusyError } from './sd'

const SD_HELP =
  'the table can’t access its SD card. Check that a card is inserted and formatted as FAT32, then restart the table.'

export function userMessage(e: unknown, doing: string): string {
  const raw = (e as Error)?.message || String(e)
  log.error('ui', `Failed to ${doing}: ${raw}`)
  const m = raw.toLowerCase()

  if (e instanceof SyncBusyError) {
    return `Couldn’t ${doing} — the app is syncing previews from the table. Try again in a moment.`
  }

  if (e instanceof SdBusyError || /requires idle|http 409/.test(m)) {
    return `Couldn’t ${doing} — the table is busy. Stop the current pattern and try again.`
  }

  // Firmware ≥ v0.1.11 sheds load with 503 "busy: low memory" when its heap
  // runs dangerously low (usually mid-pattern with several clients attached).
  if (m.includes('low memory')) {
    return `Couldn’t ${doing} — the table is low on memory right now. Wait a few seconds (or stop the pattern) and try again.`
  }

  // $Sand/Password lock (firmware ≥ v0.1.11): control routes answer 401
  // without the right key.
  if (/http 401|password required/.test(m)) {
    return `Couldn’t ${doing} — this table is password-protected. Enter its password in Settings → Security.`
  }

  // The firmware answers uploads on a dead/absent/unformatted card with
  // "No SD card" / "filesystem inaccessible"; status.sd_ok carries the
  // boot-time card probe, so use it to explain otherwise-opaque errors too.
  const sdDead = useStatus.getState().status?.sdOk === false
  if (/no sd card|filesystem inaccessible|sd card|sd busy/.test(m) || (sdDead && m.includes('http '))) {
    return `Couldn’t ${doing} — ${SD_HELP}`
  }

  if (m.includes('http 507')) {
    return `Couldn’t ${doing} — the table’s SD card is full. Free up some space and try again.`
  }

  if (/network request failed|failed to connect|abort|cancel|timed out|timeout/.test(m)) {
    return `Couldn’t ${doing} — the table didn’t respond. Check that this phone and the table are on the same Wi-Fi.`
  }

  // Unknown cause: stay honest but keep it short — the full text is in the log.
  const detail = raw.length > 90 ? `${raw.slice(0, 90)}…` : raw
  return `Couldn’t ${doing}${detail ? ` (${detail})` : ''}`
}
