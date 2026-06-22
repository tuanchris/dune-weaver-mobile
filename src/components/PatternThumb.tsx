import React from 'react'
import { Image } from 'react-native'
import { previewSource, bareName, useLibrary } from '../stores/useLibrary'
import { usePreviews, previewKey } from '../stores/usePreviews'
import { useTheme } from '../stores/useTheme'
import { PolarPattern } from './PolarPattern'

/**
 * Grid thumbnail for a pattern. Bundled defaults use their pre-rendered webp
 * (full quality, cheap); imported / unbundled patterns render live from
 * geometry. `previewSource` is a pure function of the static bundle, so this
 * doesn't subscribe to the library store.
 */
export function PatternThumb({ name, size }: { name: string; size: number }) {
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
  if (src.kind === 'webp') {
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
