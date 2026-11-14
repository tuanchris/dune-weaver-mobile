import React, { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { Directory, File, Paths } from 'expo-file-system'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { useLibrary, type Point } from '../stores/useLibrary'
import { buildPath } from '../lib/patternGeometry'
import { isGcode } from '../lib/gcode'
import { rectPathD } from './RectTable'
// @ts-ignore - shared plain-ESM module (the build script renders the bundled previews with it)
import { gcodeExtent, PREVIEW_WIDTH, previewStroke } from '../lib/gcodeGeometry.mjs'

// Mirror dw's preview.py: render the theta-rho path as a thin black line on a
// transparent square (no rings), supersample, downscale, and save a WEBP — the
// same format + black-ink-on-transparent shape as dw's pre-rendered bundled
// previews. react-native-svg's toDataURL gives us a PNG (no native rasterizer /
// dev build needed); expo-image-manipulator re-encodes it to WEBP. We persist
// the webp in the app's document storage and record its path on the pattern, so
// an imported pattern gets a real image preview — the app-data equivalent of
// the bundled webps — generated once and reused on every launch. The tile then
// tints the image to the theme foreground, like bundled previews (webp keeps
// the alpha channel, so the transparent background tints cleanly).
const OUT_SIZE = 512 // final webp edge (matches dw's DISPLAY_SIZE)
const RENDER_SIZE = 1024 // supersample the SVG, then downscale -> smoother lines
// dw pads ~1% (SCALE = RENDER/2 - 10); match it so custom previews frame the
// same way the bundled webps do. pad is a size-independent fraction.
const PAD = 10 / (OUT_SIZE / 2) / 2

/** True if a previously-persisted preview file is still present on disk. */
function previewExists(uri: string | undefined): boolean {
  if (!uri) return false
  try {
    return new File(uri).exists
  } catch {
    return false
  }
}

/** Keep filenames flat/safe (names may contain spaces/parens). */
export function safeName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_')
}

/** Write base64 image bytes into a dir; return its uri. Throws if it looks empty. */
function writeImageFile(dir: Directory, fileName: string, b64: string): string {
  if (!dir.exists) dir.create({ intermediates: true })
  const file = new File(dir, fileName)
  if (file.exists) file.delete()
  file.writeSync(b64, { encoding: 'base64' })
  // A real pattern image is several KB; a near-empty file means the capture
  // failed — discard it so the tile falls back to live SVG instead of a blank.
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
 * Take the base64 PNG from toDataURL, re-encode it at `out` size via
 * expo-image-manipulator (which needs a file uri, not a data uri), persist it in
 * document storage, and return its uri. Cleans up the temp PNG. Round patterns
 * keep WEBP (like dw's bundled previews); G-code saves PNG, like its bundled ones.
 */
export async function saveCapture(
  name: string,
  pngB64: string,
  out: { width: number; height: number; png: boolean },
  dir = new Directory(Paths.document, 'previews'),
): Promise<string> {
  const tmpDir = new Directory(Paths.cache, 'dw-preview-tmp')
  const pngFile = `${safeName(name)}.png`
  // Reuse writeImageFile for the temp PNG (also rejects an empty capture early).
  writeImageFile(tmpDir, pngFile, pngB64)
  const tmp = new File(tmpDir, pngFile)
  try {
    const rendered = await ImageManipulator.manipulate(tmp.uri)
      .resize({ width: out.width, height: out.height })
      .renderAsync()
    const saved = await rendered.saveAsync(
      out.png ? { format: SaveFormat.PNG, base64: true } : { format: SaveFormat.WEBP, compress: 0.85, base64: true }
    )
    return writeImageFile(dir, `${safeName(name)}.${out.png ? 'png' : 'webp'}`, saved.base64 ?? '')
  } finally {
    try {
      if (tmp.exists) tmp.delete()
    } catch {
      // ignore
    }
  }
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
  const view = target && pts ? renderView(target.name, pts) : null

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
    const out = view!.out
    try {
      svgRef.current.toDataURL((b64: string) => {
        attempted.current.add(name)
        // PNG -> WEBP is async (expo-image-manipulator); fire-and-forget, then
        // advance to the next target whether it succeeds or fails.
        void (async () => {
          try {
            if (b64) setPreviewUri(name, await saveCapture(name, b64, out))
          } catch {
            // leave it without a preview -> live SVG fallback
          } finally {
            bump((x) => x + 1)
          }
        })()
      })
    } catch {
      attempted.current.add(name)
      bump((x) => x + 1)
    }
  }

  if (!view) return null
  return (
    <View style={{ position: 'absolute', left: -10000, top: 0, width: view.width, height: view.height, opacity: 0 }} pointerEvents="none">
      <Svg ref={svgRef} width={view.width} height={view.height} onLayout={rasterize}>
        <Path d={view.d} stroke="#000000" strokeWidth={view.stroke} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      </Svg>
    </View>
  )
}

/** What to draw off-screen for one pattern, and the image to save from it. */
function renderView(name: string, pts: Point[]) {
  if (isGcode(name)) {
    // Like the bundled G-code previews (scripts/rectPreview.mjs): the drawing's
    // own extent, PREVIEW_WIDTH px wide. Laid out at that many POINTS, the
    // capture comes back supersampled by the screen scale, then downscaled.
    const [W, H] = (gcodeExtent(pts) as [number, number] | null) ?? [2, 1]
    const width = PREVIEW_WIDTH
    const height = Math.round((width * H) / W)
    return {
      width,
      height,
      d: rectPathD(pts, [W, H], width, height),
      stroke: previewStroke(width),
      out: { width, height, png: true },
    }
  }
  // Render at RENDER_SIZE (supersampled); strokeWidth scales with it so the
  // downscaled line lands at STROKE_OUT px in the final OUT_SIZE webp.
  const STROKE_OUT = 0.9 // effective line width at OUT_SIZE
  return {
    width: RENDER_SIZE,
    height: RENDER_SIZE,
    d: buildPath(pts, RENDER_SIZE, { pad: PAD }),
    stroke: STROKE_OUT * (RENDER_SIZE / OUT_SIZE),
    out: { width: OUT_SIZE, height: OUT_SIZE, png: false },
  }
}
