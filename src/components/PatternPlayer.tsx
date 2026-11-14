import React, { useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, PixelRatio, Pressable, StyleSheet, Text, View } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import { MaterialIcons } from '@expo/vector-icons'
import { useTheme } from '../stores/useTheme'
import { useLibrary } from '../stores/useLibrary'
import { font, radius, spacing } from '../theme'
import { Slider } from './ui'
import { PatternThumb } from './PatternThumb'
import { useAspect, useIsRect, useThumbFrame } from './RectTable'
import { useSheetWidth } from './Sheet'
import { SAND, SandView, sandTable, type SandHandle, type SandState, type SandTable } from './SandView'
import { playbackPath, reveal, type PlaybackPath } from '../lib/playbackPath'
import { useBoards } from '../stores/useBoards'
import { log } from '../stores/useAppLog'
import { roundSize } from '../lib/tableSize'
// @ts-ignore - shared plain-ESM module
import { previewStroke } from '../lib/gcodeGeometry.mjs'

// dune-weaver-viewer's players on the phone. On a round table it's SAND: the
// Sand Weaver engine (SandView) simulating the sand the table leaves, after the
// table's clear. Elsewhere (rectangular tables, web/desktop, or when the engine
// can't run) it's FAST (mac/Shared/PlayerView.swift): the pattern draws itself
// as the ball moves at constant speed. Both have play/pause, a scrubber and a
// speed, and nothing is sent to the table. Browse opens it as a page of the
// pattern's sheet when its preview image is tapped, and it starts playing then
// (that tap asked for it); play from the end starts over.

const SAND_LABEL: Record<SandTable, string> = { DWP: 'DW Pro', DWG: 'DW Gold', DWMP: 'DW Mini Pro' }

/** Seconds for the whole pattern at 1×, as in the viewer. */
const DURATION = 30
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8]

interface Props {
  name: string
  /** Start playing as soon as it opens. */
  autoplay?: boolean
  /** The frame's width; by default it fills the sheet it's in (FullscreenPlayer passes its own). */
  frameWidth?: number
  /** The "table doesn't move" line under the controls (default on). */
  caption?: boolean
  /** Offer full screen: a tap on the drawing, and a button by the controls. */
  onFullscreen?: () => void
}

export function PatternPlayer({ name, autoplay, frameWidth, caption = true, onFullscreen }: Props): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const frame = useThumbFrame()
  const sheetW = useSheetWidth()
  const frameW = frameWidth ?? Math.min(sheetW - spacing.xl * 2, 640)
  const width = frameW - 12
  const rect = useIsRect()
  const aspect = useAspect()
  const height = rect ? width / aspect : width
  // Only patterns the app holds (bundled or imported) can play: card-only ones have no copy here.
  const playable = useLibrary((s) => s.has(name))

  // The path is laid out for one size; a new size (the sheet measured itself) lays it out again.
  const layout = `${width}x${height}`
  const [laidOut, setLaidOut] = useState<{ layout: string; path: PlaybackPath | null } | null>(null)
  const path = laidOut?.layout === layout ? laidOut.path : null
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false) // no path could be built (said on the frame; play retries)
  const [started, setStarted] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(1)
  const [speed, setSpeed] = useState(1)
  const resumeAfterDrag = useRef(false)

  // Sand: the engine keeps the clock, so playing and progress are what it reports.
  const sandSize = useBoards((s) => roundSize(s.getActive()).diameter)
  const table = sandTable(sandSize)
  const [sandFailed, setSandFailed] = useState(false)
  const sand = SAND && !rect && playable && !sandFailed
  const sandRef = useRef<SandHandle>(null)
  const [sandState, setSandState] = useState<SandState>({ f: 0, playing: false, phase: 'loading' })
  const [dragging, setDragging] = useState(false)
  const isPlaying = sand ? sandState.playing : playing
  const shown = sand && !dragging ? sandState.f : progress
  const busy = sand ? sandState.phase === 'loading' : loading

  const load = async (): Promise<PlaybackPath | null> => {
    if (path) return path
    setLoading(true)
    setFailed(false)
    const p = await playbackPath(name, width, height)
    setLaidOut({ layout, path: p })
    setLoading(false)
    if (!p) setFailed(true)
    return p
  }
  // Lay out again whenever started with no path for the current size — a new size
  // (the sheet measured itself), and ALSO one that arrived while a load for the old
  // size was still running: keyed on `layout` alone, that one was never redone and
  // the player "played" the still image.
  useEffect(() => {
    if (started && !path && !loading && !failed) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load reads this render's values
  }, [layout, started, path, loading, failed])

  // The ball's clock. A frame gap counts as at most 0.1 s, so coming back from
  // a stall doesn't jump ahead (the viewer clamps the same way).
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last: number | null = null
    const tick = (now: number) => {
      const dt = last == null ? 0 : Math.min(now - last, 100) / 1000
      last = now
      setProgress((p) => Math.min(1, p + (dt * speed) / DURATION))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed])
  useEffect(() => {
    if (playing && progress >= 1) setPlaying(false)
  }, [playing, progress])

  const toggle = async () => {
    if (sand) {
      if (sandState.playing) sandRef.current?.pause()
      else sandRef.current?.play()
      return
    }
    await toggleFast()
  }
  const toggleFast = async () => {
    if (playing) {
      setPlaying(false)
      return
    }
    if (!(await load())) return
    setStarted(true)
    if (progress >= 1) setProgress(0)
    setPlaying(true)
  }

  useEffect(() => {
    if (autoplay) void toggle()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on open
  }, [])

  const scrub = (v: number) => {
    if (sand) {
      if (sandState.playing) {
        resumeAfterDrag.current = true
        sandRef.current?.pause()
      }
      setDragging(true)
      setProgress(v / 1000)
      sandRef.current?.seek(v / 1000)
      return
    }
    if (playing) {
      resumeAfterDrag.current = true
      setPlaying(false)
    }
    setStarted(true)
    void load()
    setProgress(v / 1000)
  }
  const scrubEnd = (v: number) => {
    if (sand) {
      setDragging(false)
      sandRef.current?.seek(v / 1000)
      if (resumeAfterDrag.current) {
        resumeAfterDrag.current = false
        if (v < 1000) sandRef.current?.play()
      }
      return
    }
    setProgress(v / 1000)
    if (resumeAfterDrag.current) {
      resumeAfterDrag.current = false
      if (v < 1000) setPlaying(true)
    }
  }

  const drawing = sand ? (
    <SandView
      ref={sandRef}
      name={name}
      table={table}
      size={width}
      onState={setSandState}
      onError={(message) => {
        // Fall back to Fast, which carries on where the tap asked it to.
        log.warn('sand-preview', message)
        setSandFailed(true)
        if (autoplay) void toggleFast()
      }}
    />
  ) : started && path ? (
    <PathDrawing path={path} width={width} height={height} {...reveal(path, progress, 'length')} />
  ) : (
    <PatternThumb name={name} size={width} />
  )
  const note = !sand
    ? 'A preview on this phone. The table doesn’t move.'
    : sandState.phase === 'clearing'
      ? 'Clearing the sand first, as the table does…'
      : sandState.phase === 'simulating'
        ? 'Simulating the sand…'
        : `Simulated sand on a ${SAND_LABEL[table]}. The table doesn’t move.`

  return (
    <View style={caption ? styles.page : styles.bare}>
      <Pressable
        onPress={onFullscreen}
        disabled={!onFullscreen}
        accessibilityRole={onFullscreen ? 'button' : undefined}
        accessibilityLabel={onFullscreen ? 'Full screen' : undefined}
        style={[styles.frame, frame(frameW), { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        {drawing}
        {/* Say why it's still: a spinner while the drawing is prepared, a reason when it can't be. */}
        {busy || failed ? (
          <View style={[StyleSheet.absoluteFill, styles.overlay, { backgroundColor: `${colors.card}cc` }]}>
            {busy ? (
              <ActivityIndicator size="large" color={colors.foreground} />
            ) : (
              <>
                <MaterialIcons name="error-outline" size={28} color={colors.mutedForeground} />
                <Text style={{ color: colors.foreground, fontWeight: font.weight.medium, textAlign: 'center' }}>Couldn’t draw this pattern</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, textAlign: 'center' }}>Tap play to try again.</Text>
              </>
            )}
          </View>
        ) : null}
      </Pressable>
      {playable ? (
        <View style={[styles.transport, { width: frameW }]}>
          <Pressable
            onPress={toggle}
            accessibilityRole="button"
            accessibilityLabel={isPlaying ? 'Pause preview' : 'Play preview'}
            style={({ pressed }) => [styles.round, { borderColor: colors.border, backgroundColor: pressed ? colors.cardElevated : colors.card }]}
          >
            {busy ? (
              <ActivityIndicator color={colors.foreground} />
            ) : (
              <MaterialIcons name={isPlaying ? 'pause' : 'play-arrow'} size={24} color={colors.foreground} />
            )}
          </Pressable>
          <View style={styles.scrubber}>
            <Slider value={Math.round(shown * 1000)} min={0} max={1000} step={1} onChange={scrub} onComplete={scrubEnd} />
          </View>
          <Pressable
            onPress={() => {
              const next = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]
              setSpeed(next)
              sandRef.current?.speed(next)
            }}
            accessibilityRole="button"
            accessibilityLabel={`Preview speed, ${speed} times`}
            style={({ pressed }) => [styles.speed, { borderColor: colors.border, backgroundColor: pressed ? colors.cardElevated : colors.card }]}
          >
            <Text style={{ color: colors.foreground, fontFamily: font.family.mono, fontSize: font.size.sm }}>{`${speed}×`}</Text>
          </Pressable>
          {onFullscreen ? (
            <Pressable
              onPress={onFullscreen}
              accessibilityRole="button"
              accessibilityLabel="Full screen"
              style={({ pressed }) => [styles.round, { borderColor: colors.border, backgroundColor: pressed ? colors.cardElevated : colors.card }]}
            >
              <MaterialIcons name="fullscreen" size={24} color={colors.foreground} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {caption ? (
        <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, textAlign: 'center' }}>
          {note}
        </Text>
      ) : null}
    </View>
  )
}

/** Points per piece of path, and pieces per static layer (see PathDrawing). */
const PIECE = 256
const LAYER = 16

function pathD(path: PlaybackPath, from: number, to: number): string {
  let d = `M${path.xs[from].toFixed(1)} ${path.ys[from].toFixed(1)}`
  for (let i = from + 1; i <= to; i++) d += `L${path.xs[i].toFixed(1)} ${path.ys[i].toFixed(1)}`
  return d
}

interface Ink { width: number; height: number; color: string; stroke: number }

/** One static layer: finished pieces [from, to) of the path, redrawn only when a piece joins it. */
const DoneLayer = React.memo(function DoneLayer({ path, from, to, ink }: { path: PlaybackPath; from: number; to: number; ink: Ink }) {
  const d = useMemo(() => pathD(path, from * PIECE, Math.min(to * PIECE, path.xs.length - 1)), [path, from, to])
  return (
    <Svg width={ink.width} height={ink.height} style={StyleSheet.absoluteFill}>
      <Path d={d} stroke={ink.color} strokeWidth={ink.stroke} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  )
})

/**
 * The grooves drawn so far — the path up to point `index`, then on to the ball
 * at (x, y) — as the viewer draws them (its groove width; ball 1.2% of the
 * width). Ink, not patina: patina means the real table.
 *
 * react-native-svg redraws a whole Svg on any change, and strokes by outlining
 * the path: one Svg re-stroking the full path every frame ran at a few fps. So,
 * like the viewer's Ink bitmap, what's done stays put: finished pieces of PIECE
 * points sit in static layers of LAYER pieces (each redrawn only when a piece
 * joins it), and each frame redraws only the piece in progress and the ball.
 */
export function PathDrawing({ path, width, height, index, x, y }: { path: PlaybackPath; width: number; height: number; index: number; x: number; y: number }): React.JSX.Element {
  const color = useTheme((s) => s.colors.foreground)
  const px = PixelRatio.get()
  const ink = useMemo(() => ({ width, height, color, stroke: previewStroke(width * px) / px }), [width, height, color, px])
  const done = Math.floor(index / PIECE) // finished pieces
  const layers: React.ReactNode[] = []
  for (let l = 0; l * LAYER < done; l++) {
    layers.push(<DoneLayer key={l} path={path} from={l * LAYER} to={Math.min(done, (l + 1) * LAYER)} ink={ink} />)
  }
  const live = `${pathD(path, done * PIECE, index)}L${x.toFixed(1)} ${y.toFixed(1)}`
  return (
    <View style={{ width, height }}>
      {layers}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Path d={live} stroke={color} strokeWidth={ink.stroke} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={x} cy={y} r={Math.max(2.5, width * 0.012)} fill={color} />
      </Svg>
    </View>
  )
}

const styles = StyleSheet.create({
  page: { alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  bare: { alignItems: 'center', gap: spacing.sm },
  frame: { borderWidth: 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  overlay: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs, padding: spacing.lg },
  transport: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, maxWidth: '100%' },
  round: { width: 44, height: 44, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  scrubber: { flex: 1, justifyContent: 'center', minHeight: 44 },
  speed: { minWidth: 56, minHeight: 44, paddingHorizontal: spacing.sm, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
})
