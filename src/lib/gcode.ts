// G-code patterns, for rectangular (CoreXY) tables. The firmware plays them
// untouched, so the app only parses them to DRAW them: every move's endpoint
// in machine mm (y up, like any G-code viewer).
// @ts-ignore - shared plain-ESM module (Metro resolves .mjs; allowJs covers TS)
import { decimate, MAX_POINTS } from './thrGeometry.mjs'
// @ts-ignore - shared plain-ESM module (the build script parses with it too)
import { gcodePoints } from './gcodeGeometry.mjs'
import type { Point } from '../stores/useLibrary'

/** The pattern files a rectangular table plays (the firmware's list). */
export function isGcode(name: string | null | undefined): boolean {
  return /\.(gcode|gc|nc)$/i.test(name ?? '')
}

/** G-code text -> [x, y] mm move endpoints, decimated for rendering. */
export function parseGcode(text: string, max = MAX_POINTS): Point[] {
  return decimate(gcodePoints(text), max) as Point[]
}
