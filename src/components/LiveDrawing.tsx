import React, { useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg'
import { useTheme } from '../stores/useTheme'
import { useLibrary, patternKey } from '../stores/useLibrary'
import { buildPath } from '../lib/patternGeometry'
import { isGcode } from '../lib/gcode'
import { PatternThumb } from './PatternThumb'
import { useAspect } from './RectTable'
import { PathDrawing } from './PatternPlayer'
import { locate, playbackPath, reveal, type PlaybackPath } from '../lib/playbackPath'
import { radius } from '../theme'

/** Arc from 12 o'clock, clockwise, frac 0..1 of the full circle. */
function arcPath(c: number, r: number, frac: number): string {
  const f = Math.max(0, Math.min(1, frac))
  if (f <= 0.002) return ''
  // A full-circle arc collapses to nothing (start === end); cap just short.
  const a = Math.min(f, 0.9995) * 2 * Math.PI
  const x = c + r * Math.sin(a)
  const y = c - r * Math.cos(a)
  return `M ${c} ${c - r} A ${r} ${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}`
}

/**
 * The player's table: the pattern drawing itself as the table draws it (the
 * grooves so far and the ball, like dune-weaver-viewer's player), ringed by a
 * glowing progress arc (the LED ring as progress bar — sweep matches the
 * linear bar below it). `drawn` is how far into the file the table is (0..1);
 * null shows the pattern whole. `ball` is the ball's polled position (mm on a
 * rectangle, the unit disc on a round table): the drawing's tip goes there, at
 * the point of the path nearest it, with `drawn` only saying which stretch of
 * the path to look in. Patterns the app has no copy of (card-only) show whole
 * too, from their preview image.
 */
interface Props { name: string | null | undefined; size: number; pct: number; drawn?: number | null; ball?: readonly [number, number] | null }

/**
 * The playback path to follow the table along, once `drawn` is known (null
 * while it loads, or when the app has no copy of the pattern).
 */
function useFollowPath(name: string | null | undefined, drawn: number | null | undefined, width: number, height: number): PlaybackPath | null {
  const key = patternKey(name)
  const follow = drawn != null && !!key
  const [path, setPath] = useState<PlaybackPath | null>(null)
  useEffect(() => {
    setPath(null)
    if (!follow) return
    let live = true
    void playbackPath(key, width, height).then((p) => live && setPath(p))
    return () => {
      live = false
    }
  }, [follow, key, width, height])
  return follow ? path : null
}

/**
 * `target` (a share of the path's length) eased over each one-second status
 * poll, so the ball glides along the path instead of jumping once a second.
 * Snaps on a new pattern (going backwards) or a jump of more than a fifth.
 */
function useChase(target: number | null | undefined): number | null {
  const [v, setV] = useState(target ?? null)
  const cur = useRef(target ?? null)
  useEffect(() => {
    const to = target ?? null
    const from = cur.current
    if (to == null || from == null || to < from - 0.02 || to - from > 0.2) {
      cur.current = to
      setV(to)
      return
    }
    const t0 = Date.now()
    let raf = 0
    const tick = () => {
      const s = Math.min(1, (Date.now() - t0) / 1000)
      cur.current = from + (to - from) * s
      setV(cur.current)
      if (s < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return v
}

export function LiveDrawing(props: Props) {
  // A G-code pattern plays on a rectangular table: draw that table instead of the disc.
  return isGcode(props.name) ? <LiveRect {...props} /> : <LiveDisc {...props} />
}

/** A rounded-rect outline from 12 o'clock, clockwise, so a dash from its start sweeps like the disc's arc. */
function rimPath(x0: number, y0: number, x1: number, y1: number, r: number): string {
  const cx = (x0 + x1) / 2
  return `M ${cx} ${y0} H ${x1 - r} A ${r} ${r} 0 0 1 ${x1} ${y0 + r} V ${y1 - r} A ${r} ${r} 0 0 1 ${x1 - r} ${y1} `
    + `H ${x0 + r} A ${r} ${r} 0 0 1 ${x0} ${y1 - r} V ${y0 + r} A ${r} ${r} 0 0 1 ${x0 + r} ${y0} Z`
}

/** The rectangular table, `size` wide: the pattern on it, progress as the glowing frame. */
function LiveRect({ name, size, pct, drawn, ball }: Props) {
  const colors = useTheme((s) => s.colors)
  const aspect = useAspect()
  const h = Math.round(size / aspect)
  const r = Math.min(radius.lg, h * 0.12)
  const rim = rimPath(3, 3, size - 3, h - 3, r)
  const len = 2 * (size - 6 - 2 * r) + 2 * (h - 6 - 2 * r) + 2 * Math.PI * r
  const f = Math.max(0, Math.min(1, pct / 100))
  // Full length would close the loop into nothing visible at the seam; cap just short.
  const dash = f > 0.002 ? `${(len * Math.min(f, 0.9995)).toFixed(1)} ${len.toFixed(1)}` : null
  const pad = 14
  const thumbW = (h - pad * 2) * aspect // the drawing keeps the table's proportions
  const path = useFollowPath(name, drawn, thumbW, thumbW / aspect)
  const at = useChase(path && drawn != null ? locate(path, drawn, ball) : null)
  return (
    <View style={{ width: size, height: h }}>
      <Svg width={size} height={h}>
        <Path d={rim} fill={colors.card} stroke={colors.border} strokeWidth={1.5} />
        {dash ? (
          <>
            <Path d={rim} fill="none" stroke={colors.live} strokeWidth={7} opacity={0.16} strokeLinecap="round" strokeDasharray={dash} />
            <Path d={rim} fill="none" stroke={colors.live} strokeWidth={4} opacity={0.3} strokeLinecap="round" strokeDasharray={dash} />
            <Path d={rim} fill="none" stroke={colors.live} strokeWidth={2} opacity={0.9} strokeLinecap="round" strokeDasharray={dash} />
          </>
        ) : null}
      </Svg>
      {name ? (
        <View style={{ position: 'absolute', top: pad, left: (size - thumbW) / 2 }}>
          {path && at != null ? (
            <PathDrawing path={path} width={thumbW} height={thumbW / aspect} {...reveal(path, at, 'length')} />
          ) : (
            <PatternThumb name={patternKey(name)} size={thumbW} />
          )}
        </View>
      ) : null}
    </View>
  )
}

function LiveDisc({ name, size, pct, drawn, ball }: Props) {
  const colors = useTheme((s) => s.colors)
  const key = patternKey(name)
  const pts = useLibrary((s) => (key ? (s.xyCache[key] ?? null) : null))
  const ensureXY = useLibrary((s) => s.ensureXY)
  useEffect(() => {
    if (key) ensureXY(key)
  }, [key, ensureXY])

  const c = size / 2
  const discR = c - 3
  const pad = 0.14 // pattern sits well inside the rim

  const fullPath = useMemo(() => (pts ? buildPath(pts, size, { step: 2, pad }) : ''), [pts, size])
  const arc = arcPath(c, discR, pct / 100)
  // The followed drawing sits where the full one does: its own 96% inset on an
  // inner square sized so the pattern's rim lands at `pad` inside the disc.
  const inner = (size * (1 - pad)) / 0.96
  const path = useFollowPath(name, drawn, inner, inner)
  const at = useChase(path && drawn != null ? locate(path, drawn, ball) : null)
  const following = !!path && at != null

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size}>
        <Defs>
          <RadialGradient id="disc" cx="50%" cy="42%" r="70%">
            <Stop offset="0%" stopColor={colors.cardElevated} />
            <Stop offset="100%" stopColor={colors.card} />
          </RadialGradient>
        </Defs>
        <Circle cx={c} cy={c} r={discR} fill="url(#disc)" />
        {/* track ring; the glowing arc over it IS the progress bar */}
        <Circle cx={c} cy={c} r={discR} fill="none" stroke={colors.border} strokeWidth={1.5} />
        {arc ? (
          // Layered strokes fake the glow — react-native-svg filter support is
          // too patchy across platforms to lean on.
          <>
            <Path d={arc} fill="none" stroke={colors.live} strokeWidth={7} opacity={0.16} strokeLinecap="round" />
            <Path d={arc} fill="none" stroke={colors.live} strokeWidth={4} opacity={0.3} strokeLinecap="round" />
            <Path d={arc} fill="none" stroke={colors.live} strokeWidth={2} opacity={0.9} strokeLinecap="round" />
          </>
        ) : null}

        {pts && !following ? (
          <Path d={fullPath} fill="none" stroke={colors.foreground} strokeWidth={1.1} opacity={0.9} strokeLinecap="round" strokeLinejoin="round" />
        ) : null}
      </Svg>
      {following ? (
        <View style={{ position: 'absolute', top: (size - inner) / 2, left: (size - inner) / 2 }}>
          <PathDrawing path={path} width={inner} height={inner} {...reveal(path, at, 'length')} />
        </View>
      ) : null}
      {!pts && name ? (
        // No geometry (card-only pattern): the webp preview inside the disc.
        <View style={{ position: 'absolute', top: size * 0.12, left: size * 0.12 }}>
          <PatternThumb name={key} size={size * 0.76} />
        </View>
      ) : null}
    </View>
  )
}
