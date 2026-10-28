import React, { useEffect, useMemo } from 'react'
import { Image, PixelRatio, type ImageSourcePropType } from 'react-native'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
// @ts-ignore - shared plain-ESM module (the build script renders previews with it)
import { gcodeExtent, PREVIEW_INSET, previewStroke } from '../lib/gcodeGeometry.mjs'
import { radius } from '../theme'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { useLibrary, patternKey, type Point } from '../stores/useLibrary'

// Rectangular (CoreXY) tables: the table from above is a W×H mm rectangle,
// with G-code's y axis pointing UP (machine 0,0 = bottom-left), like Sandify's
// preview. Sizes come from the board (board.travel, saved per table).

type Size = [number, number]

/** The active table's size in mm, or null until it's been read. */
export function useTravel(): Size | null {
  return useBoards((s) => s.getActive()?.travel ?? null)
}

/** Is the active table rectangular? The live status says; offline, a saved size does. */
export function useIsRect(): boolean {
  const live = useStatus((s) => s.status?.cartesian)
  const travel = useTravel()
  return live ?? !!travel
}

interface Fit { ox: number; oy: number; s: number; w: number; h: number; H: number }

/** Center a W×H mm table in a box at (x0, y0). */
function fit([W, H]: Size, x0: number, y0: number, boxW: number, boxH: number): Fit {
  const s = Math.min(boxW / W, boxH / H)
  return { ox: x0 + (boxW - W * s) / 2, oy: y0 + (boxH - H * s) / 2, s, w: W * s, h: H * s, H }
}

/** mm (y up) -> screen (y down). */
function at(f: Fit, x: number, y: number): [number, number] {
  return [f.ox + x * f.s, f.oy + (f.H - y) * f.s]
}

function pathOf(pts: Point[], f: Fit, step = 1): string {
  let d = ''
  for (let i = 0; i < pts.length; i += step) {
    const [sx, sy] = at(f, pts[i][0], pts[i][1])
    d += (d ? 'L' : 'M') + sx.toFixed(1) + ' ' + sy.toFixed(1)
  }
  return d
}

/** Without a known table size, frame the drawing itself. */
function extent(pts: Point[] | null): Size | null {
  return pts?.length ? (gcodeExtent(pts) as Size | null) : null
}

/**
 * A pattern drawn on a `width`×`height` preview of a `size` (mm) table: scaled
 * evenly, centred and inset like dune-weaver-viewer's thumbnails, the same way
 * scripts/rectPreview.mjs renders the bundled previews.
 */
export function rectPathD(pts: Point[], size: Size, width: number, height: number, step = 1): string {
  return pathOf(pts, previewFit(size, width, height), step)
}

/** mm (y up) -> screen on a `width`×`height` preview of a `size` table, as rectPathD maps them. */
export function rectToScreen(size: Size, width: number, height: number): (x: number, y: number) => [number, number] {
  const f = previewFit(size, width, height)
  return (x, y) => at(f, x, y)
}

function previewFit(size: Size, width: number, height: number): Fit {
  const bw = width * PREVIEW_INSET
  const bh = height * PREVIEW_INSET
  return fit(size, (width - bw) / 2, (height - bh) / 2, bw, bh)
}

/** The active table's width:height (2:1 until its size has been read). */
export function useAspect(): number {
  const travel = useTravel()
  return travel ? travel[0] / travel[1] : 2
}

export interface Frame { width: number; height: number; borderRadius: number }

/**
 * The thumbnail frame for a `size`-wide slot: the round table's disc, or the
 * rectangular table at its own proportions. Every list wraps its pattern
 * thumbnails in this, so a rectangular table's patterns sit on rectangles.
 */
export function useThumbFrame(): (size: number) => Frame {
  const rect = useIsRect()
  const aspect = useAspect()
  return (size) => {
    if (!rect) return { width: size, height: size, borderRadius: size / 2 }
    const height = Math.round(size / aspect)
    return { width: size, height, borderRadius: Math.min(radius.md, height * 0.2) }
  }
}

/**
 * A G-code pattern's preview image (bundled, or rendered on the phone when it
 * was imported): `size` wide, the table's proportions tall. The image is only
 * the grooves, black on transparent; tinting it to the theme's ink makes it
 * follow light and dark, and the caller's frame is the table.
 */
export function RectPreview({ source, size }: { source: ImageSourcePropType; size: number }): React.JSX.Element {
  const ink = useTheme((s) => s.colors.foreground)
  const height = size / useAspect()
  return <Image source={source} style={{ width: size, height, tintColor: ink }} resizeMode="contain" />
}

/**
 * A G-code pattern on its table, drawn live from its geometry: `size` wide,
 * the table's proportions tall, only the drawing (the caller's frame is the
 * table). Geometry is local only (bundled or imported); a card-only pattern
 * draws nothing yet. Matches the preview images' inset and stroke.
 */
export function RectPattern({ name, size, step = 1 }: { name: string | null | undefined; size: number; step?: number }): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const key = patternKey(name)
  const pts = useLibrary((s) => s.xyCache[key] ?? null)
  const ensureXY = useLibrary((s) => s.ensureXY)
  useEffect(() => {
    if (key) ensureXY(key)
  }, [key, ensureXY])
  // The frame has the table's proportions; the drawing is framed by its own
  // extent inside it, like the preview images (some patterns run past the travel).
  const table = useTravel() ?? extent(pts) ?? [2, 1]
  const height = (size * table[1]) / table[0]
  const d = useMemo(() => {
    const own = extent(pts)
    return pts && own ? rectPathD(pts, own, size, height, step) : ''
  }, [pts, size, height, step])
  // The viewer's groove width, in device pixels: max(1, width / 600).
  const px = PixelRatio.get()
  const sw = previewStroke(size * px) / px
  return (
    <Svg width={size} height={height}>
      {d ? <Path d={d} stroke={colors.foreground} strokeWidth={sw} fill="none" strokeLinejoin="round" strokeLinecap="round" /> : null}
    </Svg>
  )
}

/** The rectangular table from above with the ball at `ball` (mm) — Control's hero. */
export function TableRect({ width, ball, color }: { width: number; ball: Size | null; color: string }): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const travel = useTravel() ?? [2, 1]
  const height = (width * travel[1]) / travel[0]
  const r = Math.max(2.5, width * 0.017)
  // Inset by the ball and the frame stroke, so the travel's edge sits just inside the frame.
  const pad = r + 2.5
  const f = fit(travel, pad, pad, width - pad * 2, height - pad * 2)
  const [x, y] = ball
    ? at(f, Math.max(0, Math.min(travel[0], ball[0])), Math.max(0, Math.min(travel[1], ball[1])))
    : [0, 0]
  return (
    <Svg width={width} height={height}>
      <Rect x={1} y={1} width={width - 2} height={height - 2} rx={Math.min(8, height * 0.08)} fill={colors.cardElevated} stroke={colors.border} strokeWidth={1.5} />
      {ball ? (
        <>
          <Circle cx={x} cy={y} r={r * 2.2} fill={color} opacity={0.18} />
          <Circle cx={x} cy={y} r={r} fill={color} />
        </>
      ) : null}
    </Svg>
  )
}
