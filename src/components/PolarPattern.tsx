import React, { useEffect, useMemo } from 'react'
import Svg, { Circle, Path, G } from 'react-native-svg'
import { useTheme } from '../stores/useTheme'
import { useLibrary, patternKey } from '../stores/useLibrary'
import { buildPath, livePosition, toScreen } from '../lib/patternGeometry'

interface Props {
  name: string | null | undefined
  size: number
  /** Draw boundary + concentric guide rings (full view). */
  showRings?: boolean
  /** 0..100 progress; when set, highlights the drawn portion of the path. */
  progress?: number | null
  /** Live ball position to overlay as a dot. */
  live?: { theta: number; rho: number } | null
  /** Subsample stride for cheap thumbnails. */
  step?: number
  /** Override stroke width of the pattern path. */
  strokeWidth?: number
}

/**
 * Renders a pattern's decimated theta-rho path on a circle. Doubles as a
 * thumbnail (showRings off, larger step) and the Now Playing progress view
 * (showRings on, progress highlight + live dot).
 */
export function PolarPattern({ name, size, showRings, progress, live, step = 1, strokeWidth }: Props) {
  const colors = useTheme((s) => s.colors)
  const key = patternKey(name)
  // Geometry is derived from the decimated .thr (bundled or imported), loaded
  // lazily and cached; the subscription re-renders us once it's ready.
  const pts = useLibrary((s) => s.xyCache[key] ?? null)
  const ensureXY = useLibrary((s) => s.ensureXY)
  useEffect(() => {
    if (key) ensureXY(key)
  }, [key, ensureXY])
  const sw = strokeWidth ?? Math.max(1, size / 160)

  const fullPath = useMemo(() => (pts ? buildPath(pts, size, { step }) : ''), [pts, size, step])
  const frac = progress != null ? Math.max(0, Math.min(1, progress / 100)) : null
  const drawnPath = useMemo(
    () => (pts && frac != null ? buildPath(pts, size, { to: frac }) : ''),
    [pts, size, frac]
  )

  const c = size / 2
  const ringR = c * (1 - 0.06)
  // Position the ball like dw does: the coordinate at the current progress index,
  // so it ALWAYS sits on the drawn path (robust to live theta/rho frame quirks).
  // Fall back to the reported live position only when there's no progress.
  const ball = useMemo(() => {
    if (pts && pts.length && frac != null) {
      const idx = Math.min(pts.length - 1, Math.max(0, Math.round(frac * (pts.length - 1))))
      return toScreen(pts[idx], size)
    }
    return live ? livePosition(live.theta, live.rho, size) : null
  }, [pts, frac, size, live])

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
        <>
          {/* Full pattern path. Static previews use the foreground "ink" so
              they match the tinted webp thumbnails in Browse; during playback
              the full path is faint and the drawn portion is highlighted. */}
          <Path
            d={fullPath}
            stroke={frac != null ? colors.mutedForeground : colors.foreground}
            strokeWidth={sw}
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
            opacity={frac != null ? 0.35 : 0.9}
          />
          {/* Drawn-so-far portion, highlighted */}
          {frac != null && drawnPath ? (
            <Path
              d={drawnPath}
              stroke={colors.primary}
              strokeWidth={sw * 1.4}
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}
        </>
      ) : (
        // Placeholder when geometry isn't bundled for this filename.
        <Circle cx={c} cy={c} r={ringR * 0.5} stroke={colors.mutedForeground} strokeWidth={sw} fill="none" opacity={0.5} />
      )}

      {ball && (
        <Circle cx={ball[0]} cy={ball[1]} r={Math.max(3, size / 70)} fill={colors.primary} stroke="#ffffff" strokeWidth={Math.max(1, size / 200)} />
      )}
    </Svg>
  )
}
