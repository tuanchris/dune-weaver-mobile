import React, { useEffect, useMemo } from 'react'
import Svg, { Circle, Path, G } from 'react-native-svg'
import { useTheme } from '../stores/useTheme'
import { useLibrary, patternKey } from '../stores/useLibrary'
import { buildPath } from '../lib/patternGeometry'

interface Props {
  name: string | null | undefined
  size: number
  /** Draw boundary + concentric guide rings (full view). */
  showRings?: boolean
  /** Subsample stride for cheap thumbnails. */
  step?: number
}

/**
 * Renders a pattern's decimated theta-rho path on a circle. Used as a static
 * thumbnail (showRings off, larger step) and the larger import-preview view
 * (showRings on). Live geometry only — bundled patterns show their webp via
 * <PatternThumb>; this is the fallback for imported / unbundled ones.
 */
export function PolarPattern({ name, size, showRings, step = 1 }: Props) {
  const colors = useTheme((s) => s.colors)
  const key = patternKey(name)
  // Geometry is derived from the decimated .thr (bundled or imported), loaded
  // lazily and cached; the subscription re-renders us once it's ready.
  const pts = useLibrary((s) => s.xyCache[key] ?? null)
  const ensureXY = useLibrary((s) => s.ensureXY)
  useEffect(() => {
    if (key) ensureXY(key)
  }, [key, ensureXY])
  const sw = Math.max(1, size / 160)

  const fullPath = useMemo(() => (pts ? buildPath(pts, size, { step }) : ''), [pts, size, step])

  const c = size / 2
  const ringR = c * (1 - 0.06)

  return (
    <Svg width={size} height={size}>
      {showRings && (
        <G>
          <Circle cx={c} cy={c} r={ringR} stroke={colors.border} strokeWidth={sw} fill="none" />
          <Circle cx={c} cy={c} r={ringR * 0.66} stroke={colors.border} strokeWidth={sw * 0.5} opacity={0.4} fill="none" />
          <Circle cx={c} cy={c} r={ringR * 0.33} stroke={colors.border} strokeWidth={sw * 0.5} opacity={0.4} fill="none" />
        </G>
      )}

      {pts ? (
        // Static preview uses the foreground "ink" so it matches the tinted webp
        // thumbnails in Browse.
        <Path
          d={fullPath}
          stroke={colors.foreground}
          strokeWidth={sw}
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity={0.9}
        />
      ) : (
        // Placeholder when geometry isn't bundled for this filename.
        <Circle cx={c} cy={c} r={ringR * 0.5} stroke={colors.mutedForeground} strokeWidth={sw} fill="none" opacity={0.5} />
      )}
    </Svg>
  )
}
