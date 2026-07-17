import React, { useEffect, useMemo } from 'react'
import { View } from 'react-native'
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from 'react-native-svg'
import { useTheme } from '../stores/useTheme'
import { useLibrary, patternKey } from '../stores/useLibrary'
import { buildPath } from '../lib/patternGeometry'
import { PatternThumb } from './PatternThumb'

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
 * The player's disc: the pattern at full strength, ringed by a glowing
 * progress arc (the LED ring as progress bar — sweep matches the linear bar
 * below it). Falls back to the webp thumbnail inside the disc for patterns
 * with no local geometry (e.g. card-only bulk loads).
 */
export function LiveDrawing({ name, size, pct }: { name: string | null | undefined; size: number; pct: number }) {
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

        {pts ? (
          <Path d={fullPath} fill="none" stroke={colors.foreground} strokeWidth={1.1} opacity={0.9} strokeLinecap="round" strokeLinejoin="round" />
        ) : null}
      </Svg>
      {!pts && name ? (
        // No geometry (card-only pattern): the webp preview inside the disc.
        <View style={{ position: 'absolute', top: size * 0.12, left: size * 0.12 }}>
          <PatternThumb name={key} size={size * 0.76} />
        </View>
      ) : null}
    </View>
  )
}
