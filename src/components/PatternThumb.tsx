import React, { useState } from 'react'
import { Image, View } from 'react-native'
import { previewSource, bareName, useLibrary } from '../stores/useLibrary'
import { usePreviews, previewKey } from '../stores/usePreviews'
import { useTheme } from '../stores/useTheme'
import { PolarPattern } from './PolarPattern'
import { RectPreview } from './RectTable'
import { isGcode } from '../lib/gcode'
import { sandPreviewUrl, useHubPreviewUrl, useSandTable } from '../lib/patternHub'
import { useLocalSandPreview } from './SandPreviewGenerator'
import { SAND_KEY } from './SandView'

/**
 * Grid thumbnail for a pattern, as SAND on a round table: one the Pattern Hub has
 * (by file name: the bundled set, hub downloads, the card's copies) shows the
 * hub's sand preview for this table's size, any other the one the phone rendered
 * (SandPreviewGenerator: imports, Create's). Until then, and when the hub's can't
 * load (offline, not rendered yet), the ink preview.
 */
export function PatternThumb({ name, size }: { name: string; size: number }): React.JSX.Element {
  const hubUrl = useHubPreviewUrl(name)
  const local = useLocalSandPreview(name)
  const ink = <InkThumb name={name} size={size} />
  if (hubUrl && !isGcode(name)) return <SandImage inkUrl={hubUrl} size={size} fallback={ink} />
  if (local) {
    return (
      <View style={{ width: size, height: size }}>
        <Image source={{ uri: local }} style={{ width: size, height: size }} />
        <SandTint size={size} />
      </View>
    )
  }
  return ink
}

/**
 * The table's light over a sand render: `sandLight` MULTIPLIED in, warming the
 * engine's neutral grey (renders stay neutral, so the light can change without
 * re-rendering). A disc, like the render. The sand player does the same in its page.
 */
function SandTint({ size }: { size: number }): React.JSX.Element {
  const { sandLight, sandLift, sandLiftBlend } = useTheme((s) => s.colors)
  const disc = { position: 'absolute', width: size, height: size, borderRadius: size / 2 } as const
  return (
    <>
      <View pointerEvents="none" style={{ ...disc, backgroundColor: sandLight, mixBlendMode: 'multiply' }} />
      {sandLift ? <View pointerEvents="none" style={{ ...disc, backgroundColor: sandLift, mixBlendMode: sandLiftBlend }} /> : null}
    </>
  )
}

/**
 * A hub preview as the sand engine leaves it on the active table's size (an
 * opaque disc), over `fallback` until it has loaded; just `fallback` when it
 * can't load. force-cache keeps a loaded one for table-only Wi-Fi (iOS); the
 * engine's key and the pattern's revision in the URL (the bucket ignores them)
 * fetch afresh after a new engine or an update, which the hub re-renders under
 * the same names.
 */
export function SandImage({ inkUrl, size, fallback }: { inkUrl: string; size: number; fallback: React.ReactNode }): React.JSX.Element {
  // The ink URL may carry the pattern's revision (`?r=`), so an update is fetched afresh too.
  const sand = sandPreviewUrl(inkUrl, useSandTable())
  const uri = `${sand}${sand.includes('?') ? '&' : '?'}v=${SAND_KEY}`
  const [state, setState] = useState<{ uri: string; loaded: boolean; broken: boolean } | null>(null)
  const mine = state?.uri === uri ? state : { uri, loaded: false, broken: false }
  if (mine.broken) return <>{fallback}</>
  return (
    <View style={{ width: size, height: size }}>
      {mine.loaded ? null : fallback}
      <Image
        source={{ uri, cache: 'force-cache' }}
        onLoad={() => setState({ uri, loaded: true, broken: false })}
        onError={() => setState({ uri, loaded: false, broken: true })}
        style={{ position: 'absolute', width: size, height: size }}
      />
      {mine.loaded ? <SandTint size={size} /> : null}
    </View>
  )
}

/**
 * The ink preview. Bundled patterns use their pre-rendered image (full quality,
 * cheap); imported / unbundled patterns render live from geometry. `previewSource`
 * is a pure function of the static bundle, so this doesn't subscribe to the library store.
 */
function InkThumb({ name, size }: { name: string; size: number }): React.JSX.Element {
  // Pre-rendered previews are black ink on transparent; tint to the theme
  // foreground so they're dark in light mode and light (inverted) in dark mode.
  const ink = useTheme((s) => s.colors.foreground)
  // Imported/custom patterns get an on-device rasterized image, persisted in the
  // app's document storage (see <PreviewGenerator/>), so they render like the
  // bundled webps without re-rendering every launch.
  const key = bareName(name)
  const cached = useLibrary((s) => s.patterns.find((p) => p.name === key)?.previewUri)
  // User-ingested preview image (Settings → import previews), matched by name.
  const ingested = usePreviews((s) => s.map[previewKey(name)])
  const src = previewSource(name)
  // G-code (a rectangular table's) sits on its rectangle: the bundled preview, or
  // the one rendered when it was imported, else live geometry until that's ready.
  if (isGcode(name)) {
    if (src.kind === 'image') return <RectPreview source={src.module} size={size} />
    if (cached) return <RectPreview source={{ uri: cached }} size={size} />
    return <PolarPattern name={name} size={size} step={2} />
  }
  if (src.kind === 'image') {
    return <Image source={src.module} style={{ width: size, height: size, tintColor: ink }} resizeMode="contain" />
  }
  if (ingested) {
    return <Image source={{ uri: ingested }} style={{ width: size, height: size, tintColor: ink }} resizeMode="contain" />
  }
  if (cached) {
    return <Image source={{ uri: cached }} style={{ width: size, height: size, tintColor: ink }} resizeMode="contain" />
  }
  // Fall back to live geometry until the rasterized preview is ready.
  return <PolarPattern name={name} size={size} step={2} />
}
