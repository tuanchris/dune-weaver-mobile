import { useStatus } from '../stores/useStatus'
import { usePreviews } from '../stores/usePreviews'
import { TableReceivingError, tableReceiving } from '../api/board'

export { TableReceivingError }
import { isBusy } from '../api/status'

/**
 * SD-access gate. The firmware streams the running pattern off the SD card on a
 * single thread, so reading or writing any other file mid-job risks stalling or
 * corrupting it. Every SD file operation (manifest read, preview read, pattern /
 * playlist upload, delete) must check this first. Status-only routes (/sand_status,
 * /command, LED, home/stop/pause) don't touch the SD and are NOT gated here.
 */
export function isSdBusy(): boolean {
  return isBusy(useStatus.getState().status)
}

/** Thrown when an SD file operation is attempted while the table is running. */
export class SdBusyError extends Error {
  constructor() {
    super('The table is running — wait until it finishes to access files.')
    this.name = 'SdBusyError'
  }
}

/** Throw if the table is mid-job. Guards SD reads/writes at their entry points. */
export function assertSdIdle(): void {
  if (isSdBusy()) throw new SdBusyError()
}

/**
 * Preview-sync mutual exclusion. While the app is streaming preview shards off
 * the card (usePreviews.syncing), starting motion would make the board's
 * single-threaded SD serve a running pattern AND the shard reads at once —
 * the contention that stalls both. Motion-START actions gate on this;
 * STOP/pause/resume never do (you must always be able to halt the table).
 */
export function isSyncingPreviews(): boolean {
  return usePreviews.getState().syncing
}

/** Thrown when motion is started while a preview sync is streaming. */
export class SyncBusyError extends Error {
  constructor() {
    super('The app is syncing previews from the table — try again in a moment.')
    this.name = 'SyncBusyError'
  }
}

/**
 * A Pattern Hub batch is sending to the active table (lib/tableBatch.ts): the table
 * answers nothing else until it ends, so nothing that talks to it can work.
 */
export function isTableReceiving(): boolean {
  const receiving = tableReceiving()
  return !!receiving && receiving === useStatus.getState().base
}

/** Throw if a preview sync is in progress, or the table is receiving patterns. Guards motion-start entry points. */
export function assertNotSyncing(): void {
  if (isTableReceiving()) throw new TableReceivingError()
  if (isSyncingPreviews()) throw new SyncBusyError()
}
