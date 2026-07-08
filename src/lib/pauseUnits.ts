import type { PauseUnit } from '../stores/usePrefs'

/** Convert a pause amount + unit to whole seconds (the firmware's unit). */
export function pauseToSeconds(value: number, unit: PauseUnit): number {
  if (unit === 'hr') return Math.round(value * 3600)
  if (unit === 'min') return Math.round(value * 60)
  return Math.round(value)
}

/**
 * Derive a friendly unit + value from a stored seconds count, preferring the
 * largest whole unit (3600 -> 1h, 120 -> 2m, else seconds). Used to seed the
 * pause controls from the board's settings.
 */
export function secondsToPause(secs: number): { unit: PauseUnit; value: number } {
  if (secs && secs % 3600 === 0) return { unit: 'hr', value: secs / 3600 }
  if (secs && secs % 60 === 0) return { unit: 'min', value: secs / 60 }
  return { unit: 'sec', value: secs }
}
