// WiFi reconfiguration flows (firmware >= v0.1.8): move a table to a home
// network (POST /wifi_save) or flip it to standalone hotspot mode
// (POST /wifi_standalone).
//
// Both writes are idle-gated NVS commits on the board — they answer
// {"status":"busy"} during the boot auto-home or a running pattern — and both
// can reboot the table, which drops the link before (or just after) the reply
// gets out. The captive portal treats a lost reply as the success path; we do
// the same and let the reboot-wait / user guidance sort out the truth.

import { board, type WifiWriteResult } from '../api/board'
import { useStatus } from '../stores/useStatus'

export type WifiSetupStage = 'saving' | 'rebooting'

/** The firmware's default hotspot address ($AP/IP) — where a standalone or
 * fallback table answers once the phone joins its network. */
export const WIFI_AP_BASE = 'http://192.168.0.1'

/** Keep retrying "busy" this long (covers the boot auto-home; a running
 * pattern can hold the gate for hours, so don't wait it out). */
const BUSY_RETRY_MS = 20_000
const BUSY_POLL_MS = 2_000

/** How long we wait for the table to reappear after the reboot (~25-30s to
 * rejoin Wi-Fi, plus DHCP). */
const REBOOT_TIMEOUT_MS = 90_000
const REBOOT_POLL_MS = 3_000

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Run a WiFi write, riding out "busy" replies. A thrown network error means
 * the reboot raced the reply (or the link is already gone) — report it as a
 * rebooting success rather than failing a write that most likely landed.
 */
async function writeWithBusyRetry(post: () => Promise<WifiWriteResult>): Promise<WifiWriteResult> {
  const deadline = Date.now() + BUSY_RETRY_MS
  for (;;) {
    let r: WifiWriteResult
    try {
      r = await post()
    } catch {
      return { status: 'ok', reboot: true }
    }
    if (r.status !== 'busy') return r
    if (Date.now() > deadline) {
      throw new Error('The table is busy — stop the current pattern and try again')
    }
    await sleep(BUSY_POLL_MS)
  }
}

/**
 * Point the table at a home Wi-Fi network. Resolves 'connected' when the
 * table answers on `base` again after its reboot, or 'moved' when it doesn't
 * — which is NOT necessarily failure: the table may have joined a network
 * this phone isn't on, or fallen back to its setup hotspot on a wrong
 * password. Callers turn 'moved' into guidance, not an error toast.
 * Throws with a user-readable message on validation/busy errors.
 */
export async function connectTableToWifi(
  base: string,
  ssid: string,
  password: string,
  onStage: (stage: WifiSetupStage) => void
): Promise<'connected' | 'moved'> {
  onStage('saving')
  const r = await writeWithBusyRetry(() => board.wifiSave(base, ssid, password))
  if (r.status === 'error') throw new Error(r.message || 'The table rejected those credentials')
  if (!r.reboot) return 'connected' // demo table applies live

  // The table reboots into STA>AP. Suspend the 1s poller for the outage and
  // poll until the status route answers again on the same address.
  onStage('rebooting')
  const { setBase } = useStatus.getState()
  setBase(null)
  try {
    await sleep(8_000)
    const deadline = Date.now() + REBOOT_TIMEOUT_MS
    for (;;) {
      try {
        await board.status(base, REBOOT_POLL_MS)
        return 'connected'
      } catch {
        if (Date.now() > deadline) return 'moved'
        await sleep(REBOOT_POLL_MS)
      }
    }
  } finally {
    // Resume polling either way — if the table moved networks, the poller's
    // failures arm useAutoRelocate, which re-finds it by mDNS identity.
    setBase(base)
  }
}

/**
 * Flip the table to standalone hotspot mode. `reboot` tells the caller what
 * happened: true = it was on home Wi-Fi and is restarting into the hotspot
 * (it's about to vanish from this network); false = it was already a hotspot
 * (fallback/demo) and the switch applied live.
 */
export async function switchTableToStandalone(base: string): Promise<{ reboot: boolean }> {
  const r = await writeWithBusyRetry(() => board.wifiStandalone(base))
  if (r.status === 'error') throw new Error(r.message || 'Could not switch to standalone mode')
  return { reboot: r.reboot }
}
