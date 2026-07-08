// Parse / serialize the firmware's $Sands/Slots string:
//   HH:MM-HH:MM@<days>,...   days = daily | weekdays | weekends | mon+tue+fri
// A window whose end is before its start spans midnight.

export type DayPreset = 'daily' | 'weekdays' | 'weekends' | 'custom'

export interface QuietSlot {
  start: string // "HH:MM"
  end: string // "HH:MM"
  days: DayPreset
  customDays: string[] // sun..sat, used when days === 'custom'
}

/** Day codes in firmware order (bit 0 = Sunday). */
export const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
export const DAY_LABELS: Record<string, string> = {
  sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
}

export const DEFAULT_SLOT: QuietSlot = { start: '22:00', end: '06:00', days: 'daily', customDays: [] }

/** Normalize "9:5" -> "09:05"; returns null if not a valid HH:MM. */
export function normalizeTime(s: string): string | null {
  const m = s.trim().match(/^(\d{1,2}):(\d{1,2})$/)
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  if (h > 23 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function parseOne(spec: string): QuietSlot | null {
  const at = spec.indexOf('@')
  const times = (at >= 0 ? spec.slice(0, at) : spec).trim()
  const daysSpec = (at >= 0 ? spec.slice(at + 1) : 'daily').trim().toLowerCase()
  const dash = times.indexOf('-')
  if (dash < 0) return null
  const start = normalizeTime(times.slice(0, dash))
  const end = normalizeTime(times.slice(dash + 1))
  if (!start || !end) return null

  let days: DayPreset = 'daily'
  let customDays: string[] = []
  if (daysSpec === '' || daysSpec === 'daily') days = 'daily'
  else if (daysSpec === 'weekdays') days = 'weekdays'
  else if (daysSpec === 'weekends') days = 'weekends'
  else {
    days = 'custom'
    customDays = daysSpec.split('+').map((d) => d.trim()).filter((d) => (DAYS as readonly string[]).includes(d))
    if (customDays.length === 0) days = 'daily'
  }
  return { start, end, days, customDays }
}

export function parseSlots(spec: string): QuietSlot[] {
  return spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseOne)
    .filter((s): s is QuietSlot => s !== null)
}

export function serializeSlots(slots: QuietSlot[]): string {
  return slots
    .map((s) => {
      const days = s.days === 'custom' ? (s.customDays.length ? [...s.customDays].sort((a, b) => DAYS.indexOf(a as any) - DAYS.indexOf(b as any)).join('+') : 'daily') : s.days
      return `${s.start}-${s.end}@${days}`
    })
    .join(',')
}