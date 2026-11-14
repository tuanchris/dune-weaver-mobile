// Types for index.mjs: the text generator's layout and exporters.
export type FontId = 'sandskrit' | 'sans' | 'script' | 'capitals' | 'serif' | 'brush' | 'geometric' | 'slab' | 'marker' | 'rounded' | 'hand' | 'heavy'
export type Join = 'edge' | 'beside'
export type RowSize = 'same' | 'fill'
export type Style = 'lines' | 'inlay'
export type Letters = 'solid' | 'outline'
/** Inlay: what rakes the sand round the letters. */
export type Host = 'spiral' | 'lanes'
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
  /** Inlay style: the (first) text's outline points, centred and unturned (before `place`), in the frame's units. */
  textPts?: XY[]
  /** host 'none' (the design alone): each letter or symbol part as rings (filled even-odd) or a line. */
  shapes?: ({ rings: XY[][] } | { line: XY[] })[]
}
/** One text block (inlay): its own text, font, size (a share of the largest that fits) and place. */
export interface TextBlock {
  text: string
  font?: FontId
  size?: number
  rowSize?: RowSize
  place?: Partial<TextPlace>
}
/** Where the text block goes (inlay): its centre, −1..1 of the half width / height, and its turn in degrees clockwise. */
export interface TextPlace {
  x: number
  y: number
  rot: number
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
/** The text block's place, moved towards the centre until `pts` (its outline, centred) lies a ball inside the edge; k < 1 shrinks it when even centred it can't (a turned block on a rectangle). */
export function keepTextOnTable(frame: Frame, pts: XY[], place?: Partial<TextPlace>): TextPlace & { k: number }
/** The size a symbol reads well at, in balls across (10 bold, 14 some detail, 20 detailed). */
export function symbolBalls(ch: string): number
/** A placed symbol's smallest size on this table (6 balls): its larger side's share of the table's smaller side. */
export function minSymbolSize(frame: Frame, ch?: string): number
/** The size it reads well at on this table (symbolBalls); smaller, its details blur. */
export function goodSymbolSize(frame: Frame, ch: string): number
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
  /** Inlay: 0 (just round the text and symbols) .. 1 (the whole table). */
  rake?: number
  /** Inlay: one line spiralling out from the centre (default), or straight lanes at 45°. */
  host?: Host | 'none'
  /** Inlay: a letter is drawn after the host's last pass within this many balls of it (default 1). */
  zone?: number
  /** Inlay: where the text block goes (kept on the table). */
  place?: Partial<TextPlace>
  /** Inlay: several text blocks, each its own (instead of text / font / size / rowSize / place). */
  texts?: TextBlock[]
  /** Inlay: symbols placed freely. */
  symbols?: Placed[]
}): Layout | null
export function thrSteps(path: XY[]): XY[]
export function toThr(path: XY[]): string
export function toGcode(path: XY[], W: number, H: number): string
