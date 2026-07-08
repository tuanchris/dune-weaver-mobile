// OTA firmware update flow: download the release image from GitHub, flash it
// via POST /updatefw, then wait for the board to reboot and come back.
//
// The board's web server is single-threaded, so the 1s status poller is
// suspended for the whole flow — concurrent /sand_status requests during an
// OTA write would queue against (or wedge) the flash upload.

import { fetch as binaryFetch } from 'expo/fetch'
import { board } from '../api/board'
import { useStatus } from '../stores/useStatus'

export type FwUpdateStage = 'download' | 'flash' | 'reboot'

export const FW_STAGE_LABELS: Record<FwUpdateStage, string> = {
  download: 'Downloading…',
  flash: 'Installing…',
  reboot: 'Restarting table…',
}

/** How long we wait for the board to rejoin Wi-Fi after the reboot (it
 * typically needs ~25-30s). */
const REBOOT_TIMEOUT_MS = 120_000
const REBOOT_POLL_MS = 3_000

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * Run the whole update. Resolves with the firmware version the board reports
 * after rebooting; throws with a user-readable message on any failure. The
 * table itself is safe throughout — a failed/interrupted upload just leaves
 * the old image running.
 */
export async function runFirmwareUpdate(
  base: string,
  firmwareUrl: string,
  onStage: (stage: FwUpdateStage) => void
): Promise<string> {
  // Will the board take an update right now? (409/"busy" while a pattern runs.)
  // Pre-OTA firmware answers with a legacy shape (e.g. {"status":"0"}) — treat
  // anything that isn't the new contract as "can't update from the app".
  const probe = await board.updateProbe(base)
  if (probe?.status === 'busy') {
    throw new Error('The table is busy — stop the current pattern first')
  }
  if (probe?.status !== 'ready') {
    throw new Error('This firmware is too old for in-app updates — update it once via the web installer')
  }

  onStage('download')
  const res = await binaryFetch(firmwareUrl)
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`)
  const image = new Uint8Array(await res.arrayBuffer())
  // ESP32 app images start with the 0xE9 magic byte — catch a truncated or
  // wrong download before it ever reaches the board.
  if (image.length < 100_000 || image[0] !== 0xe9) {
    throw new Error('Downloaded firmware image looks invalid')
  }

  // Suspend the status poller while flashing + rebooting.
  const { setBase } = useStatus.getState()
  setBase(null)
  try {
    onStage('flash')
    const result = await board.uploadFirmware(base, image)
    if (result.status !== 'ok') {
      throw new Error(result.status === 'busy' ? 'The table is busy — stop the current pattern first' : 'The table rejected the update')
    }

    // Board reboots ~1s after "ok"; give it a head start, then poll until the
    // status route answers again.
    onStage('reboot')
    await sleep(8_000)
    const deadline = Date.now() + REBOOT_TIMEOUT_MS
    for (;;) {
      try {
        const raw = await board.status(base, REBOOT_POLL_MS)
        return raw.fw ?? ''
      } catch {
        if (Date.now() > deadline) {
          throw new Error('Update sent, but the table has not come back online — check it in a minute')
        }
        await sleep(REBOOT_POLL_MS)
      }
    }
  } finally {
    setBase(base) // resume polling whatever happened
  }
}
