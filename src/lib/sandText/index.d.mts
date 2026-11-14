// Types for index.mjs: the text generator's layout and exporters.
export type FontId = 'sandskrit' | 'sans' | 'script' | 'capitals' | 'serif' | 'brush' | 'geometric' | 'slab' | 'marker' | 'rounded' | 'hand' | 'heavy'
export type Join = 'edge' | 'beside'
export type RowSize = 'same' | 'fill'
export type Style = 'lines' | 'inlay'
export type Letters = 'solid' | 'outline'
export type XY = [number, number]

export interface Font {
  label: string
  /** Glyphs are closed outlines (`[advance, regions]`), not single lines (`[advance, x0, y0, …]`). */
  outline?: boolean
  /** Lower-case letters after one of these use their joined form. */
  joinAfter?: string
  /** Lower case draws as upper case. */
  upper?: boolean
  glyphs: Record<string, unknown>
}

/** A round table is the unit disc (its sand `diameter` and `ball` in mm size the ball in it); a rectangle is its travel in mm. */
export type Frame = { round: true; diameter?: number; ball?: number } | { round: false; W: number; H: number; ball?: number }

export interface Layout {
  /** The ball's path, as seen on the table (x right, y up, centred): unit disc or mm. */
  path: XY[]
  rows: number
  /** Characters no font could draw (left out). */
  missing: string[]
  /** Capital height of the smallest row, in the frame's units. */
  capHeight: number
  /** Inlay style: each letter's visit (path indices) and the outline the host's later passes keep clear of. */
  visits?: { from: number; to: number; outline: XY[] }[]
}

export const FONTS: Record<FontId, Font>
export const FONT_IDS: FontId[]
/** Popular emoji as outlines (symbols.mjs): centred, the larger side 1. */
export interface Symbol {
  label: string
  w: number
  h: number
  regions: number[][][]
}
export const SYMBOLS: Record<string, Symbol>
export const SYMBOL_IDS: string[]
/** A symbol placed on the table: x, y −1..1 of the half width / height (right, up); size = its larger side's share of the table's smaller side; rot = degrees clockwise. */
export interface Placed {
  ch: string
  x: number
  y: number
  size: number
  rot?: number
}
export const MAX_LINES: number
export const MAX_CHARS: number
export function ballOf(frame: Frame): number
/** A placed symbol moved (and if need be shrunk) so it lies on the table. */
export function keepOnTable<T extends Placed>(frame: Frame, sym: T): T
export function textRows(text: string): string[]
export function layoutText(opts: {
  text: string
  font?: FontId
  frame: Frame
  size?: number
  spacing?: number
  rowSize?: RowSize
  style?: Style
  join?: Join
  letters?: Letters
  /** Inlay: 0 (a band just round the text) .. 1 (the whole table). */
  rake?: number
  /** Inlay: symbols placed freely. */
  symbols?: Placed[]
}): Layout | null
export function thrSteps(path: XY[]): XY[]
export function toThr(path: XY[]): string
export function toGcode(path: XY[], W: number, H: number): string
