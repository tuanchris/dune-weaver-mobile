import React, { useEffect, useMemo, useRef, useState } from 'react'
import { PixelRatio, View } from 'react-native'
import { create } from 'zustand'
import { Directory, File, Paths } from 'expo-file-system'
import { SAND, SAND_KEY, SandView } from './SandView'
import { safeName, saveCapture } from './PreviewGenerator'
import { bareName, useLibrary } from '../stores/useLibrary'
import { usePrefs } from '../stores/usePrefs'
import { log } from '../stores/useAppLog'
import { tagKey, useSandTable } from '../lib/patternHub'
import { isGcode } from '../lib/gcode'
import type { SandTable } from '../lib/tableSize'

// Sand previews the phone renders itself: library .thr patterns the Pattern Hub
// doesn't have (imports, Create's), on the active table's size. Everything the
// hub has shows the hub's (PatternThumb). One at a time, in a hidden SandView in
// still mode, saved under Documents/sand-previews/<engine key>/<table>/ — a new
// engine starts afresh, and nothing persisted holds a path (iOS moves the
// container on every update).
// ponytail: a removed pattern's renders stay on disk until the engine changes.

const OUT = 512 // the ink previews' size
/** Give up on a pattern the engine hasn't finished in this long (a huge file, a stuck page). */
const TIMEOUT_MS = 4 * 60_000

const root = () => new Directory(Paths.document, 'sand-previews')
// "-2": renders made before floatLinearShim.mjs came out FLAT on phones without float
// filtering (2026-11-18), so this folder name drops them once, like a new engine.
const RENDERS = `${SAND_KEY}-2`
const dirFor = (table: SandTable) => new Directory(root(), RENDERS, table)
const fileFor = (table: SandTable, name: string) => new File(dirFor(table), `${safeName(bareName(name))}.webp`)

/** Bumped when the worker saves one, so thumbnails look again. */
const useSaved = create<{ n: number }>(() => ({ n: 0 }))

/** This table's on-phone sand preview of a library pattern, or null. */
export function useLocalSandPreview(name: string): string | null {
  const table = useSandTable()
  const n = useSaved((s) => s.n)
  return useMemo(() => {
    if (!SAND || isGcode(name)) return null
    try {
      const f = fileFor(table, name)
      return f.exists ? f.uri : null
    } catch {
      return null
    }
    // n: a new render may be this one
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, name, n])
}

/** Invisible, always-mounted worker (App.tsx), like PreviewGenerator. */
export function SandPreviewGenerator(): React.JSX.Element | null {
  const patterns = useLibrary((s) => s.patterns)
  const hubPreviews = usePrefs((s) => s.hubPreviews)
  const table = useSandTable()
  // Tried this session (done or failed), so a bad one can't loop.
  const attempted = useRef(new Set<string>())
  const [, bump] = useState(0)

  // Another engine's renders are stale: drop them once.
  useEffect(() => {
    try {
      if (SAND && root().exists) for (const d of root().list()) if (d.name !== RENDERS) d.delete()
    } catch {
      // keep them; harmless
    }
  }, [])

  const target = SAND
    ? patterns.find((p) => !isGcode(p.name) && !hubPreviews[tagKey(p.name)] && !attempted.current.has(`${table}/${p.name}`) && !fileFor(table, p.name).exists)
    : undefined
  const key = target ? `${table}/${target.name}` : ''
  const finish = (k: string) => {
    if (attempted.current.has(k)) return
    attempted.current.add(k)
    bump((x) => x + 1)
  }
  useEffect(() => {
    if (!key) return
    const t = setTimeout(() => {
      log.warn('sand-preview', `${key}: took too long, skipped`)
      finish(key)
    }, TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [key])

  if (!target) return null
  const name = target.name
  // The page shades at size × the screen's scale: ~1024 px, scaled down to OUT.
  const size = 1024 / PixelRatio.get()
  return (
    <View style={{ position: 'absolute', left: -10000, top: 0, width: size, height: size, opacity: 0 }} pointerEvents="none">
      <SandView
        key={key}
        name={name}
        table={table}
        size={size}
        still={OUT}
        onStill={(data) => {
          void (async () => {
            try {
              await saveCapture(name, data.slice(data.indexOf(',') + 1), { width: OUT, height: OUT, png: false }, dirFor(table))
              useSaved.setState((s) => ({ n: s.n + 1 }))
            } catch (e) {
              log.warn('sand-preview', `${key}: ${e instanceof Error ? e.message : String(e)}`)
            } finally {
              finish(key)
            }
          })()
        }}
        onError={(message) => {
          log.warn('sand-preview', `${key}: ${message}`)
          finish(key)
        }}
      />
    </View>
  )
}
