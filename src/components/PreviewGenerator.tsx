import React, { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { Directory, File, Paths } from 'expo-file-system'
import { useLibrary } from '../stores/useLibrary'
import { buildPath } from '../lib/patternGeometry'

// Mirror dw's preview.py: render the theta-rho path as a thin black line on a
// transparent square, no rings. We rasterize it once with react-native-svg's
// toDataURL (already a dependency — no native rasterizer / dev build needed),
// write the PNG into the app's document storage, and persist its path on the
// pattern. So an imported pattern gets a real image preview — the app-data
// equivalent of the bundled webps — generated once and reused on every launch.
// The tile then tints the image to the theme foreground, like bundled previews.
const SIZE = 512
// dw pads ~1% (SCALE = RENDER/2 - 10); match it so custom previews frame the
// same way the bundled webps do.
const PAD = 10 / (SIZE / 2) / 2

/** True if a previously-persisted preview file is still present on disk. */
function previewExists(uri: string | undefined): boolean {
  if (!uri) return false
  try {
    return new File(uri).exists
  } catch {
    return false
  }
}

/** Write the base64 PNG from toDataURL into document storage; return its uri. */
function writePreviewFile(name: string, b64: string): string {
  const dir = new Directory(Paths.document, 'previews')
  if (!dir.exists) dir.create({ intermediates: true })
  // Keep filenames flat/safe (names may contain spaces/parens).
  const file = new File(dir, `${name.replace(/[^\w.-]+/g, '_')}.png`)
  if (file.exists) file.delete()
  file.write(b64, { encoding: 'base64' })
  // A real pattern PNG is several KB; a near-empty file means the capture failed
  // — discard it so the tile falls back to live SVG instead of a blank image.
  if (!file.exists || file.size < 256) {
    try {
      file.delete()
    } catch {
      // ignore
    }
    throw new Error('empty preview')
  }
  return file.uri
}

/**
 * Invisible, always-mounted worker. Walks imported patterns that don't yet have
 * a persisted preview image, one at a time: ensures geometry is loaded, renders
 * it off-screen, writes the PNG to document storage, and records its path. Runs
 * only for patterns missing a preview — once generated it's reused across
 * launches, so this normally does nothing after the first time each is added.
 */
export function PreviewGenerator() {
  const patterns = useLibrary((s) => s.patterns)
  const xyCache = useLibrary((s) => s.xyCache)
  const ensureXY = useLibrary((s) => s.ensureXY)
  const setPreviewUri = useLibrary((s) => s.setPreviewUri)

  // Names we've already tried (success or failure) so a bad render can't loop.
  const attempted = useRef<Set<string>>(new Set())
  const [, bump] = useState(0)
  // toDataURL lives on the native Svg instance, not the typed surface.
  const svgRef = useRef<any>(null)
  const rasterized = useRef(false)

  // Regenerate when there's no preview yet, or the persisted file went missing
  // (e.g. storage cleared) — self-heals a stale path instead of a blank tile.
  const target = patterns.find((p) => !attempted.current.has(p.name) && !previewExists(p.previewUri))
  const pts = target ? xyCache[target.name] : null

  // Load geometry for the current target if needed.
  useEffect(() => {
    if (target && !pts) ensureXY(target.name)
  }, [target?.name, pts, ensureXY])

  // New target -> allow one rasterize pass.
  useEffect(() => {
    rasterized.current = false
  }, [target?.name])

  const rasterize = () => {
    if (rasterized.current || !svgRef.current || !target) return
    rasterized.current = true
    const name = target.name
    try {
      svgRef.current.toDataURL((b64: string) => {
        attempted.current.add(name)
        try {
          if (b64) setPreviewUri(name, writePreviewFile(name, b64))
        } catch {
          // leave it without a preview -> live SVG fallback
        }
        bump((x) => x + 1) // advance to the next target (also covers failures)
      })
    } catch {
      attempted.current.add(name)
      bump((x) => x + 1)
    }
  }

  if (!target || !pts) return null
  const d = buildPath(pts, SIZE, { pad: PAD })
  return (
    <View style={{ position: 'absolute', left: -10000, top: 0, width: SIZE, height: SIZE, opacity: 0 }} pointerEvents="none">
      <Svg ref={svgRef} width={SIZE} height={SIZE} onLayout={rasterize}>
        <Path d={d} stroke="#000000" strokeWidth={1.5} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      </Svg>
    </View>
  )
}
