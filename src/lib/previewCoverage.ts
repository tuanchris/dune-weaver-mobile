import { useMemo } from 'react'
import { bareName, hasBundledThr, previewSource, useLibrary } from '../stores/useLibrary'
import { previewKey, usePreviews } from '../stores/usePreviews'

/**
 * True when <PatternThumb> can draw this pattern's real shape — via its bundled
 * webp, an ingested/imported preview image, or local .thr geometry (bundled or
 * imported). Everything else falls through to <PolarPattern>'s blank
 * placeholder circle: an on-table pattern the app has no local copy of and no
 * preview image for. That's exactly the bulk-loaded card case the SD Card
 * Pattern Manager's preview bundle exists to cover (see lib/previewSync.ts).
 */
export function hasThumbnail(
  name: string,
  previews: Record<string, string>,
  importedNames: Set<string>,
): boolean {
  if (previewSource(name).kind === 'webp') return true
  if (previews[previewKey(name)]) return true
  return hasBundledThr(name) || importedNames.has(bareName(name))
}

/**
 * How many of `names` render as the blank placeholder — the number the Browse
 * banner offers to fix by syncing previews from the table.
 */
export function useMissingPreviewCount(names: string[]): number {
  const previews = usePreviews((s) => s.map)
  const imported = useLibrary((s) => s.patterns)
  return useMemo(() => {
    const importedNames = new Set(imported.map((p) => p.name))
    let missing = 0
    for (const name of names) if (!hasThumbnail(name, previews, importedNames)) missing++
    return missing
  }, [names, previews, imported])
}
