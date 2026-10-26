// OTA firmware update flow: download the release image from GitHub, flash it
// via POST /updatefw, then wait for the board to reboot and come back.
//
// Releases ship one image per MCU (esp32 / esp32s3) and the WRONG one is only
// rejected by the board's chip-ID check at the very end of the flash (both
// chips share the 0xE9 magic byte), so the image is picked by the `mcu` the
// /updatefw probe reports. Older firmware doesn't report it; the CALLER then
// asks the user which board it is before starting (FirmwareCard) and passes
// the answer as `forceMcu` — a wrong pick is always rejected safely, the old
// firmware keeps running, and the user just retries with the other choice.
//
// The board's web server is single-threaded, so the 1s status poller is
// suspended for the whole flow — concurrent /sand_status requests during an
// OTA write would queue against (or wedge) the flash upload.

import { fetch as binaryFetch } from 'expo/fetch'
import { board } from '../api/board'
import { useStatus } from '../stores/useStatus'
import { firmwareUrlFor, type BoardMcu, type FirmwareRelease } from './updates'

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
 * the old image running. `forceMcu` overrides the probed MCU (the user's
 * answer to FirmwareCard's which-board dialog when the firmware is too old to
 * report it).
 */
export async function runFirmwareUpdate(
  base: string,
  release: FirmwareRelease,
  onStage: (stage: FwUpdateStage) => void,
  forceMcu?: BoardMcu
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

  // The probe is the freshest word on the board's MCU; live status is the
  // backup (both fields arrived in the same firmware version).
  const mcu = forceMcu ?? probe.mcu ?? useStatus.getState().status?.mcu ?? null
  const firmwareUrl = firmwareUrlFor(release, mcu)
  if (!firmwareUrl) {
    throw new Error(`${release.version} has no image for this table's board (${mcu}) — pick a newer version`)
  }

  onStage('download')
  const res = await binaryFetch(firmwareUrl)
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`)
  const image = new Uint8Array(await res.arrayBuffer())
  // ESP32 app images start with the 0xE9 magic byte — catch a truncated or
  // wrong download before it ever reaches the board. (Same magic on the S3,
  // so this can NOT catch a wrong-MCU image — only the board's chip-ID check
  // at the end of the flash does.)
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
      if (result.status === 'busy') {
        throw new Error('The table is busy — stop the current pattern first')
      }
      // A rejection at the END of the flash on a picked/guessed MCU is the
      // wrong-image signature (the board's chip-ID check is the only thing
      // that catches it) — say so when the other choice exists.
      if ((forceMcu || !probe.mcu) && release.images.esp32s3) {
        throw new Error('The table rejected the update — if you picked the wrong board type, try again with the other one')
      }
      throw new Error('The table rejected the update')
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
