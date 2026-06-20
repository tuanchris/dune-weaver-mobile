import { useStatus } from '../stores/useStatus'
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
