// A round table's size. A .thr is in radii, so patterns that work in mm (the text
// generator's lanes, gaps and letter size) need the table's sand diameter and ball:
// set by hand (Settings › Table size), else its model's (from its config name,
// `$/name`), else a DW Pro's. Sizes are the owner's: sand diameter (2026-11-10) / ball (2026-11-11).
import type { Board } from '../stores/useBoards'

export interface RoundSize {
  /** Sand diameter, mm. */
  diameter: number
  /** Ball diameter, mm. */
  ball: number
}

export const MODELS: (RoundSize & { id: string; label: string; match: RegExp })[] = [
  // Mini Pro before Pro: "Dune Weaver Mini Pro ThetaRho" has both.
  { id: 'mini-pro', label: 'DW Mini Pro', match: /mini\s*pro/i, diameter: 250, ball: 8 },
  { id: 'gold', label: 'DW Gold', match: /gold/i, diameter: 395, ball: 8 },
  { id: 'pro', label: 'DW Pro', match: /pro/i, diameter: 700, ball: 10 },
]
const PRO = MODELS[2]

/** The model a config name names ("Dune Weaver Pro (Pulley) ThetaRho" → DW Pro), or null. */
export function modelOf(name?: string): (typeof MODELS)[number] | null {
  return name ? (MODELS.find((m) => m.match.test(name)) ?? null) : null
}

/** A round table's size and where it came from. */
export function roundSize(b?: Board | null): RoundSize & { from: 'set' | 'model' | 'default'; label: string } {
  if (b?.size) return { ...b.size, from: 'set', label: `${b.size.diameter} mm` }
  const m = modelOf(b?.model)
  if (m) return { diameter: m.diameter, ball: m.ball, from: 'model', label: m.label }
  return { diameter: PRO.diameter, ball: PRO.ball, from: 'default', label: PRO.label }
}

/**
 * The Pattern Hub's table sizes (the website's HUB_TABLES): a hub pattern can come
 * in a version for each, a Mini Pro one simplified, with bolder lines.
 */
export type HubTable = 'pro' | 'mini-pro'
export const HUB_TABLES: { id: HubTable; label: string }[] = [
  { id: 'mini-pro', label: 'DW Mini Pro' },
  { id: 'pro', label: 'DW Pro' },
]
export const hubTableLabel = (t: HubTable): string => HUB_TABLES.find((h) => h.id === t)?.label ?? t

/**
 * Which hub version a round table gets: a Pro-sized or Mini Pro-sized table its
 * own; one in between (a DW Gold, a custom build) the owner's choice, Pro
 * unless changed (`Board.hub`), for every pattern or per pattern.
 */
export function hubTable(b?: Board | null): { table: HubTable; choose: boolean } {
  const { diameter } = roundSize(b)
  if (diameter >= 600) return { table: 'pro', choose: false }
  if (diameter <= 300) return { table: 'mini-pro', choose: false }
  return { table: b?.hub?.table ?? 'pro', choose: true }
}

/** The version this table takes of one pattern: its pick for that pattern (tables in between only), else hubTable's. */
export function hubTableFor(b: Board | null | undefined, patternId: string): HubTable {
  const { table, choose } = hubTable(b)
  return (choose && b?.hub?.picks?.[patternId]) || table
}

/** The tables the sand engine's clears are baked for (dune-weaver-viewer's TABLES): the sand previews and player. */
export type SandTable = 'DWP' | 'DWG' | 'DWMP'

/** The baked table nearest a sand diameter. ponytail: custom sizes take the nearest model's clear and size. */
export function sandTable(diameter: number): SandTable {
  return diameter >= 550 ? 'DWP' : diameter >= 320 ? 'DWG' : 'DWMP'
}
