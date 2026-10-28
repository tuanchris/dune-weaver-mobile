import React, { useEffect, useRef, useState } from 'react'
import { FlatList, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { create } from 'zustand'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { board } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useScrollLock } from '../stores/useScrollLock'
import { useTheme } from '../stores/useTheme'
import { isActive, type Status } from '../api/status'
import { loadPlaylist } from '../lib/playlists'
import { prettyName } from '../lib/patternName'
import { useBoardAction } from '../lib/useBoardAction'
import { NATIVE_ACCESSORY, useScreenWidth, useSplit, type Split } from '../lib/layout'
import { PatternThumb } from './PatternThumb'
import { LiveDrawing } from './LiveDrawing'
import { TableDisc, TableRect, useIsRect, useThumbFrame } from './RectTable'
import { patternKey } from '../stores/useLibrary'
import { IconButton } from './ui'
import { Sheet, useAnySheetOpen } from './Sheet'
import { SpeedControl } from './SpeedControl'
import { FullscreenPlayer } from './FullscreenPlayer'
import { TablePill } from './TablePill'
import { radius, spacing, font } from '../theme'

/** ms -> "M:SS", or "H:MM:SS" once it's an hour or more (a long between-patterns
 * pause can run to hours — "98:23" reads as nonsense). */
function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Whether the expanded player sheet is up. A store, not state: the mini player
 * lives in the tab bar's accessory (or each Screen), the sheet once in App.tsx. */
export const usePlayerSheet = create<{ expanded: boolean; setExpanded: (v: boolean) => void }>((set) => ({
  expanded: false,
  setExpanded: (expanded) => set({ expanded }),
}))

// ONE clock for every copy of the player: the iOS accessory mounts two, the
// fallback one per visited tab, plus the sheet. Per-instance refs would disagree
// (and reset whenever a copy mounts late).
//  - file/at: when the current pattern started (the firmware reports only 0..100
//    progress, no clock) → elapsed + estimated remaining.
//  - lastFile: last pattern we had a file for, kept on screen while idle/paused.
//  - pause: anchored between-patterns window { startAt (epoch ms), totalMs }.
const session: { file: string | null; at: number; lastFile: string | null; pause: { startAt: number; totalMs: number } | null } = {
  file: null,
  at: Date.now(),
  lastFile: null,
  pause: null,
}

interface NowPlaying {
  status: Status
  base: string
  displayFile: string | null
  name: string
  pausing: boolean
  pct: number
  /** How much of the pattern on show the table has drawn, 0..1, for the drawing
   * to follow: all of it between patterns, null (show it whole) while clearing
   * or homing, when the table's progress is about another file's moves. */
  drawn: number | null
  /** Where the ball is, polled: mm on a rectangular table, the unit disc on a round one. */
  ball: [number, number]
  hasProgress: boolean
  elapsedMs: number
  remainingMs: number | null
  subtitle: string
}

/** Everything the player shows, derived from status + the shared session. null = nothing playing. */
function useNowPlaying(): NowPlaying | null {
  const status = useStatus((s) => s.status)
  const base = useBoards((s) => s.getActiveBase())
  const currentFile = status?.currentFile ?? null
  // Render-time and idempotent (a mount effect would reset the clock whenever a copy mounts).
  if (session.file !== currentFile) {
    session.file = currentFile
    session.at = Date.now()
  }

  // Between-patterns pause progress is anchored to a local start timestamp and
  // driven by the device clock (below), not recomputed from the coarse,
  // once-per-poll `pause_remaining`. This ticker advances it smoothly between
  // status polls (a long pause would otherwise sit frozen for seconds).
  const pausing = status?.pauseRemaining != null && status?.pauseTotal != null
  const [, forcePauseTick] = useState(0)
  useEffect(() => {
    if (!pausing) return
    const id = setInterval(() => forcePauseTick((n) => n + 1), 250)
    return () => clearInterval(id)
  }, [pausing])

  if (!isActive(status) || !status || !base) return null

  // During the between-patterns pause (state=Idle) the firmware reports no
  // current file, so show the pattern that just finished — it's what's on the
  // sand right now. Firmware ≥ v0.1.13 names it (playlist.last), which also
  // survives opening the app mid-pause — but ONLY the pause means "waiting for
  // the next pattern"; in other file-less moments (homing, clearing lead-in)
  // stick to the in-memory last file, which also covers older firmware.
  if (currentFile) session.lastFile = currentFile
  const waitingNext = status.pauseRemaining != null
  const displayFile = currentFile ?? (waitingNext ? status.playlist?.last : null) ?? session.lastFile

  // The between-patterns pause drives the same progress bar. Rather than
  // recompute the fill from (pause_total − pause_remaining) every poll — which
  // ticks in whole seconds and freezes the bar between polls — anchor the
  // pause's START once and measure elapsed from the device clock. That gives a
  // smooth, accurate fill (and countdown) that keeps advancing between polls.
  // The anchor is seeded from the reported remaining and only re-synced when it
  // drifts > 1.5s from the firmware (a new pause, or clock skew over a long one).
  let pauseElapsedMs = 0
  let pauseRemainMs = 0
  if (pausing) {
    const totalMs = status.pauseTotal! * 1000
    const reportedRemainMs = status.pauseRemaining! * 1000
    const a = session.pause
    const predictedRemainMs = a ? a.totalMs - (Date.now() - a.startAt) : Infinity
    const anchor =
      !a || a.totalMs !== totalMs || Math.abs(predictedRemainMs - reportedRemainMs) > 1500
        ? // (Re)anchor: start = now − already-elapsed. From here elapsed comes
          // from the clock, so it advances smoothly instead of derived from remaining.
          { startAt: Date.now() - (totalMs - reportedRemainMs), totalMs }
        : a
    session.pause = anchor
    pauseElapsedMs = Math.min(totalMs, Math.max(0, Date.now() - anchor.startAt))
    pauseRemainMs = Math.max(0, totalMs - pauseElapsedMs)
  } else {
    session.pause = null
  }

  const pct = pausing
    ? (status.pauseTotal! > 0 ? Math.round((pauseElapsedMs / (status.pauseTotal! * 1000)) * 100) : 0)
    : status.percentage ?? 0

  // Elapsed / estimated remaining. Only meaningful while a pattern is actually
  // progressing; remaining is a linear extrapolation, hence "~".
  const hasProgress = pausing || (status.percentage != null && !status.isHoming && !status.isClearing)
  const elapsedMs = pausing ? pauseElapsedMs : Date.now() - session.at
  const remainingMs = pausing ? pauseRemainMs : hasProgress && pct > 1 && pct < 100 ? (elapsedMs * (100 - pct)) / pct : null

  const subtitle =
    status.isHoming ? 'Homing…'
    : status.isClearing ? 'Clearing…'
    : status.isQuiet ? 'Quiet hours'
    // Between-patterns wait: the firmware reports Idle, but a playlist is mid-run.
    // Say so plainly instead of showing the playlist line (which reads as "playing").
    : pausing ? `Between patterns${status.playlist ? ` · ${status.playlist.index + 1}/${status.playlist.total}` : ''}`
    : status.playlist ? `${status.playlist.name ?? 'Playlist'} · ${status.playlist.index + 1}/${status.playlist.total}`
    : status.isPaused ? 'Paused'
    : status.state

  const drawn = pausing ? 1 : status.isClearing || status.isHoming ? null : status.fraction

  const ball: [number, number] = status.cartesian
    ? [status.x, status.y]
    : [status.rho * Math.cos(status.theta), status.rho * Math.sin(status.theta)]

  return { status, base, displayFile, name: prettyName(displayFile), pausing, pct, drawn, ball, hasProgress, elapsedMs, remainingMs, subtitle }
}

type Act = ReturnType<typeof useBoardAction>['act']
const togglePause = (np: NowPlaying, act: Act) =>
  np.status.isPaused ? act(() => board.resume(np.base), 'Resumed', 'resume the pattern') : act(() => board.pause(np.base), 'Paused', 'pause the pattern')
const skip = (np: NowPlaying, act: Act) => act(() => board.skip(np.base), 'Skipping', 'skip to the next pattern')
const openPlayer = () => usePlayerSheet.getState().setExpanded(true)

function PlayPause({ np, act, size }: { np: NowPlaying; act: Act; size: number }) {
  const colors = useTheme((s) => s.colors)
  return (
    <Pressable
      onPress={() => togglePause(np, act)}
      accessibilityRole="button"
      accessibilityLabel={np.status.isPaused ? 'Resume' : 'Pause'}
      style={[styles.playBtn, { backgroundColor: colors.primary, width: size, height: size }]}
    >
      <MaterialIcons name={np.status.isPaused ? 'play-arrow' : 'pause'} size={Math.round(size * 0.58)} color={colors.primaryForeground} />
    </Pressable>
  )
}

// Dynamic Type cap inside the system-sized accessory capsule (it can't grow).
const CAPSULE_TEXT_MAX = 1.2

/** The playing pattern's thumbnail. A rectangular table's is a short strip, so
 * it sits on a little table of its own (framed like Browse's tiles) to read. */
function MiniThumb({ name, size }: { name: string; size: number }) {
  const rect = useIsRect()
  const frame = useThumbFrame()
  const colors = useTheme((s) => s.colors)
  if (!rect) return <PatternThumb name={name} size={size} />
  const w = Math.round(size * 1.75)
  return (
    <View style={[frame(w), styles.miniRect, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <PatternThumb name={name} size={w - 2} />
    </View>
  )
}

/**
 * The mini player: Pause/Resume + Skip, tap to open the full player. Stop lives
 * only in the expanded player (a one-tap stop here was too easy to hit).
 * Stateless and safe to mount several times (no Modals, no fetches):
 *  - 'regular' / 'inline': iOS 26 tab-bar `bottomAccessory` (the system draws the glass capsule).
 *    Both copies draw the SAME thing: they're stacked in one capsule and
 *    react-native-screens 4.25.2 hides one by layer opacity, which UIKit can
 *    reset, leaving both on screen (fixed upstream in 4.30 with `hidden`; Expo
 *    SDK 56 pins 4.25.2). Identical copies line up exactly when that happens.
 *    The tab bar never minimizes (no tabBarMinimizeBehavior), so 'inline' is the
 *    hidden copy anyway.
 *  - 'floating': in-flow card at the bottom of each Screen everywhere else.
 */
export function MiniPlayer({ placement }: { placement: 'regular' | 'inline' | 'floating' }) {
  const colors = useTheme((s) => s.colors)
  const np = useNowPlaying()
  const { act } = useBoardAction(350)
  const swipeUp = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      onPanResponderRelease: (_, g) => {
        if (g.dy <= -30) openPlayer()
      },
    })
  ).current
  if (!np) return null

  const skipBtn = np.status.playlist ? (
    <IconButton icon="skip-next" size={26} color={colors.foreground} label="Skip to next pattern" onPress={() => skip(np, act)} />
  ) : null

  if (placement !== 'floating') {
    return (
      <Pressable onPress={openPlayer} style={[styles.capsule, { gap: spacing.md }]}>
        <MiniThumb name={patternKey(np.displayFile)} size={32} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} maxFontSizeMultiplier={CAPSULE_TEXT_MAX} style={[styles.capsuleTitle, { color: colors.foreground }]}>
            {np.name || 'Idle'}
          </Text>
          <Text numberOfLines={1} maxFontSizeMultiplier={CAPSULE_TEXT_MAX} style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>
            {np.subtitle}
          </Text>
        </View>
        <IconButton
          icon={np.status.isPaused ? 'play-arrow' : 'pause'}
          size={28}
          color={colors.foreground}
          label={np.status.isPaused ? 'Resume' : 'Pause'}
          onPress={() => togglePause(np, act)}
        />
        {skipBtn}
      </Pressable>
    )
  }

  return (
    <View {...swipeUp.panHandlers} style={styles.barWrap}>
      <Pressable onPress={openPlayer} style={[styles.bar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <MiniThumb name={patternKey(np.displayFile)} size={46} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>{np.name || 'Idle'}</Text>
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>{np.subtitle}</Text>
          <View style={[styles.miniTrack, { backgroundColor: colors.border }]}>
            <View style={[styles.miniFill, { width: `${np.pct}%`, backgroundColor: colors.live }]} />
          </View>
          {np.hasProgress ? (
            <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontFamily: font.family.mono, fontSize: font.size.xs, marginTop: 3 }}>
              {fmt(np.elapsedMs)} · {np.pct}%{np.remainingMs != null ? ` · -${fmt(np.remainingMs)}` : ''}
            </Text>
          ) : null}
        </View>
        <View style={styles.controls}>
          <PlayPause np={np} act={act} size={48} />
          {skipBtn}
        </View>
      </Pressable>
    </View>
  )
}

// The active playlist's file list, read ONCE per playlist however many players
// show it (the sheet and the unfolded pane): two reads of one file at a playlist
// start would both queue on the board's single-threaded server.
const usePlaylistFile = create<{ key: string | null; items: string[] | null }>(() => ({ key: null, items: null }))

/** "Up next" + the queue for the pattern on show. */
function useUpcoming(shown: NowPlaying | null): { upNextFile: string | undefined; upcoming: string[] } {
  const base = useBoards((s) => s.getActiveBase())
  const plName = useStatus((s) => s.status?.playlist?.name ?? null)
  const key = base && plName ? `${base}\u001F${plName}` : null
  const file = usePlaylistFile()
  useEffect(() => {
    if (usePlaylistFile.getState().key === key) return
    usePlaylistFile.setState({ key, items: null })
    if (!key || !base || !plName) return
    loadPlaylist(base, `${plName}.txt`)
      .then((items) => {
        if (usePlaylistFile.getState().key === key) usePlaylistFile.setState({ items })
      })
      .catch(() => {})
  }, [key])
  if (!shown) return { upNextFile: undefined, upcoming: [] }

  // Up-next comes straight from the firmware (playlist.next) — it resolves the
  // real next pattern even under shuffle, where the order is internal to the
  // board. (The old code used playlistItems[index+1], which always showed file
  // line 2 while shuffling.) "" / null = unknown (last of a pass / single run)
  // -> no "up next".
  const st = shown.status
  const upNextFile = st.playlist?.next ? patternKey(st.playlist.next) : undefined

  // The full upcoming queue is only knowable in file order, which is truthful
  // ONLY when not shuffling. When the firmware's next disagrees with the
  // file-order next, the playlist is shuffled and the rest of the order isn't
  // exposed — show just the one known next item rather than a wrong list.
  const fileUpcoming = st.playlist && file.key === key && file.items ? file.items.slice(st.playlist.index + 1) : []
  const shuffled = !!upNextFile && fileUpcoming.length > 0 && upNextFile !== fileUpcoming[0]
  return { upNextFile, upcoming: shuffled ? [upNextFile] : fileUpcoming }
}

/** The expanded player (+ its queue as a sub-page). Rendered ONCE, from App.tsx. */
export function NowPlayingSheet() {
  // A rectangular table's patterns sit on rectangles (wider: they're short).
  const rect = useIsRect()
  const colors = useTheme((s) => s.colors)
  const scrollLocked = useScrollLock((s) => s.locked)
  const status = useStatus((s) => s.status)
  const winWidth = useScreenWidth()
  const expanded = usePlayerSheet((s) => s.expanded)
  const setExpanded = usePlayerSheet((s) => s.setExpanded)
  const anySheetOpen = useAnySheetOpen()
  const split = !!useSplit() // the unfolded pane already shows the player: never pop the sheet over it
  const [page, setPage] = useState<'player' | 'queue'>('player')
  const np = useNowPlaying()
  // Keep the last frame on screen while the sheet slides away after playback ends.
  const lastNp = useRef<NowPlaying | null>(null)
  if (np) lastNp.current = np
  const shown = np ?? lastNp.current
  const { upNextFile, upcoming } = useUpcoming(shown)

  // Maximize the player when a playlist starts. Tracked on the rising edge of
  // "a playlist is active"; prev starts null so opening the app onto an
  // already-running playlist doesn't pop the sheet unprompted. The edge often
  // lands while the editor's sheet is still animating out — iOS silently drops
  // a second present, so wait (pending) until no sheet is up.
  // ponytail: waits on EVERY sheet; exclude self if the player ever registers before opening.
  // null = no status yet (launch / table switch reset it): it seeds `prev`, never an edge.
  // Full screen (rectangular tables): FullscreenPlayer is a Modal of its own and
  // iOS shows one at a time, so the sheet closes first, the player opens once it's
  // gone, and the sheet comes back after (on iOS once the player is dismissed).
  const [full, setFull] = useState(false)
  const [pendingFull, setPendingFull] = useState(false)
  const reopenAfterFull = useRef(false)
  useEffect(() => {
    if (pendingFull && !anySheetOpen) {
      setPendingFull(false)
      setFull(true)
    }
  }, [pendingFull, anySheetOpen])

  const playlistActive = status ? !!status.playlist : null
  const prevPlaylistActive = useRef<boolean | null>(null)
  const [pendingExpand, setPendingExpand] = useState(false)
  useEffect(() => {
    if (playlistActive === null) { prevPlaylistActive.current = null; return }
    if (prevPlaylistActive.current === false && playlistActive) setPendingExpand(true)
    prevPlaylistActive.current = playlistActive
  }, [playlistActive])
  useEffect(() => {
    if (!pendingExpand) return
    if (expanded || split) setPendingExpand(false)
    else if (!anySheetOpen && !full && !pendingFull) {
      setPendingExpand(false)
      setExpanded(true)
    }
  }, [pendingExpand, anySheetOpen, expanded, setExpanded, full, pendingFull, split])

  // Playback ended → close (and drop a pending auto-open).
  const active = !!np
  useEffect(() => {
    if (active) return
    setExpanded(false)
    setPendingExpand(false)
    setFull(false)
    setPendingFull(false)
    reopenAfterFull.current = false
  }, [active, setExpanded])
  // Every open starts on the player, not wherever the queue was left.
  useEffect(() => {
    if (expanded) setPage('player')
  }, [expanded])

  if (!shown) return null

  const st = shown.status

  // Sized so disc + title + up-next + progress + controls + speed fit the sheet
  // without scrolling on a phone (capped, so an iPad sheet doesn't balloon it).
  const vizSize = Math.min(winWidth - spacing.xl * 2, rect ? 340 : 290)
  const close = () => setExpanded(false)
  const openFull = () => {
    setPendingFull(true)
    setExpanded(false)
  }
  const closeFull = () => {
    setFull(false)
    if (Platform.OS === 'ios') reopenAfterFull.current = true
    else setExpanded(true)
  }
  const afterFull = () => {
    if (!reopenAfterFull.current) return
    reopenAfterFull.current = false
    setExpanded(true)
  }
  const queue = page === 'queue'
  return (
    <>
    <Sheet
      visible={expanded && active}
      onClose={close}
      // Content height, not a full page: a rectangular table's frame is short,
      // and a page sheet left half the screen empty under the speed slider.
      variant="fit"
      title={queue ? st.playlist?.name ?? 'Queue' : shown.subtitle}
      onBack={queue ? () => setPage('player') : undefined}
      leading={<IconButton icon="expand-more" size={28} color={colors.foreground} label="Collapse player" onPress={close} />}
      trailing={
        queue ? undefined : st.playlist ? (
          <IconButton icon="queue-music" size={26} color={colors.foreground} label="Show queue" onPress={() => setPage('queue')} />
        ) : (
          <View />
        )
      }
    >
      {queue ? (
        <QueueList upcoming={upcoming} />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          scrollEnabled={!scrollLocked}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
        >
          <PlayerBody shown={shown} size={vizSize} upNextFile={upNextFile} onUpNext={() => setPage('queue')} onFull={openFull} />
        </ScrollView>
      )}
    </Sheet>
    <FullPlayer shown={shown} open={full} onClose={closeFull} onDismissed={afterFull} />
    </>
  )
}

/** The player itself, shared by the sheet and the unfolded pane: the drawing,
 * name, up next, progress, transport and speed. */
function PlayerBody({ shown, size, upNextFile, onUpNext, onFull, horizontal, compact, onRestHeight, eyebrow }: {
  shown: NowPlaying
  size: number
  upNextFile: string | undefined
  onUpNext: () => void
  /** Rectangular tables: a tap on the drawing shows it full screen. */
  onFull: () => void
  /** The drawing beside the rest, not above it (the half-folded pane: wide and short). */
  horizontal?: boolean
  /** The pane's fit-the-page form: a one-line name, "up next" as one short row, a smaller play button. */
  compact?: boolean
  /** The height of everything but the drawing, so the pane can size the drawing to fit. */
  onRestHeight?: (h: number) => void
  /** A small line above the name (the pane's; the sheet shows it as its title). */
  eyebrow?: string
}): React.JSX.Element {
  const rect = useIsRect()
  const frame = useThumbFrame()
  const colors = useTheme((s) => s.colors)
  const refresh = useStatus((s) => s.refresh)
  const scrollLocked = useScrollLock((s) => s.locked)
  const { act } = useBoardAction(350)
  const st = shown.status
  const drawing = (
      <View style={{ alignItems: 'center', marginVertical: spacing.md }}>
        {/* The signature view: the pattern drawing itself as the table draws it, progress as the glowing rim.
            On a rectangular table a tap (the badge says so) shows it full screen, sideways. */}
        <Pressable
          onPress={onFull}
          disabled={!rect}
          accessibilityRole={rect ? 'button' : undefined}
          accessibilityLabel={rect ? 'Full screen' : undefined}
        >
          <LiveDrawing name={shown.displayFile} size={size} pct={shown.pct} drawn={shown.drawn} ball={shown.ball} />
          {rect ? (
            <View style={[styles.fullBadge, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <MaterialIcons name="fullscreen" size={20} color={colors.foreground} />
            </View>
          ) : null}
        </Pressable>
      </View>
  )
  const rest = (
    <>
      {eyebrow ? <Text numberOfLines={1} style={[styles.bodyEyebrow, { color: colors.mutedForeground }]}>{eyebrow}</Text> : null}
      <Text numberOfLines={compact ? 1 : 2} style={[styles.bigTitle, { color: colors.foreground }]}>{shown.name || 'Idle'}</Text>
      {/* Between-patterns wait: the name/preview above is what's on the sand
          now; make it unmistakable that we're waiting, not still drawing it. */}
      {shown.pausing ? (
        <View style={[styles.pausePill, { borderColor: colors.live }]}>
          <MaterialIcons name="hourglass-top" size={14} color={colors.live} />
          <Text style={{ color: colors.live, fontSize: font.size.sm, fontWeight: font.weight.medium }}>
            Waiting for the next pattern
          </Text>
        </View>
      ) : null}
      {upNextFile ? (
        // In the pane it's one short row: the player has to fit its half without scrolling.
        <Pressable onPress={onUpNext} style={[styles.upNextRow, compact ? styles.upNextInline : null]}>
          <View style={[styles.upNextThumb, frame(compact ? (rect ? 52 : 36) : rect ? 88 : 64), { backgroundColor: colors.card, borderColor: colors.border }]}>
            <PatternThumb name={upNextFile} size={compact ? (rect ? 50 : 36) : rect ? 84 : 64} />
          </View>
          <Text numberOfLines={2} style={[styles.upNext, { color: colors.mutedForeground }]}>
            Up next: {prettyName(upNextFile)}
          </Text>
        </Pressable>
      ) : null}

      <ProgressBar pct={shown.pct} elapsedMs={shown.hasProgress ? shown.elapsedMs : null} remainingMs={shown.remainingMs} />
      <View style={styles.controls}>
        <IconButton icon="stop" size={30} color={colors.foreground} label="Stop" onPress={() => act(() => board.stop(shown.base), 'Stopped', 'stop the table')} />
        <PlayPause np={shown} act={act} size={compact ? 52 : 60} />
        {st.playlist ? (
          <IconButton icon="skip-next" size={30} color={colors.foreground} label="Skip to next pattern" onPress={() => skip(shown, act)} />
        ) : (
          <View style={{ width: 38 }} />
        )}
      </View>

      <View style={[styles.speedWrap, compact ? styles.speedTight : null, { borderTopColor: colors.border }]}>
        <SpeedControl
          percent={st.cartesian}
          value={st.cartesian ? st.feedOverride : st.speed}
          feedOverride={st.feedOverride}
          onCommit={(v) => (st.cartesian ? board.setFeedPct : board.setFeedLive)(shown.base, v).then(() => setTimeout(refresh, 350)).catch(() => {})}
        />
      </View>
    </>
  )
  // Side by side: the drawing holds still at the top; only the details beside it
  // scroll (centred against them, a long column pushed it down onto the fold).
  return horizontal ? (
    <View style={styles.bodyRow}>
      {drawing}
      {/* Spread over the column's full height (it still scrolls if a small window can't hold it). */}
      <ScrollView style={{ flex: 1, alignSelf: 'stretch' }} showsVerticalScrollIndicator={false} scrollEnabled={!scrollLocked} contentContainerStyle={styles.sideColumn}>
        {rest}
      </ScrollView>
    </View>
  ) : (
    <>
      {drawing}
      <View onLayout={onRestHeight ? (e) => onRestHeight(e.nativeEvent.layout.height) : undefined}>{rest}</View>
    </>
  )
}

function QueueList({ upcoming }: { upcoming: string[] }): React.JSX.Element {
  const rect = useIsRect()
  const frame = useThumbFrame()
  const colors = useTheme((s) => s.colors)
  return (
    <FlatList
      data={upcoming}
      keyExtractor={(it, i) => `${it}-${i}`}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.lg }}
      ListEmptyComponent={
        <Text style={{ color: colors.mutedForeground, textAlign: 'center', marginTop: 40 }}>No upcoming patterns.</Text>
      }
      renderItem={({ item, index }) => (
        <View style={[styles.queueRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
          <Text style={{ color: colors.mutedForeground, minWidth: 24, textAlign: 'center', fontSize: font.size.sm }}>{index + 1}</Text>
          <View style={[styles.queueThumb, frame(rect ? 52 : 36)]}>
            <PatternThumb name={item} size={rect ? 52 : 36} />
          </View>
          <Text numberOfLines={2} style={{ flex: 1, color: colors.foreground }}>{prettyName(item)}</Text>
        </View>
      )}
    />
  )
}

/** The live drawing full screen, sideways (rectangular tables). */
function FullPlayer({ shown, open, onClose, onDismissed }: { shown: NowPlaying; open: boolean; onClose: () => void; onDismissed: () => void }): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const timeLine = shown.hasProgress
    ? `${fmt(shown.elapsedMs)} · ${shown.pct}%${shown.remainingMs != null ? ` · -${fmt(shown.remainingMs)}` : ''}`
    : `${shown.pct}%`
  return (
    <FullscreenPlayer title={open ? shown.name || 'Now playing' : null} onClose={onClose} onDismissed={onDismissed}>
      {(w) => (
        <View style={{ width: w, alignItems: 'center', gap: spacing.sm }}>
          <LiveDrawing name={shown.displayFile} size={w} pct={shown.pct} drawn={shown.drawn} ball={shown.ball} />
          <Text style={{ color: colors.mutedForeground, fontFamily: font.family.mono, fontSize: font.size.xs }}>{timeLine}</Text>
        </View>
      )}
    </FullscreenPlayer>
  )
}

/**
 * Unfolded (useSplit): the table's half of the window, mounted ONCE from App.tsx
 * over the half Screen gives up. Always up while split, so nothing jumps as
 * patterns start and stop: the player while something plays (between-patterns
 * waits included), else the table at rest. The mini player and the sheet's
 * auto-open stand down meanwhile — this is the same player, bigger.
 */
export function NowPlayingPane(): React.JSX.Element | null {
  const split = useSplit()
  return split ? <Pane split={split} /> : null // folded / phones: no player hooks at all
}

function Pane({ split }: { split: Split }): React.JSX.Element {
  const np = useNowPlaying()
  const { upNextFile, upcoming } = useUpcoming(np)
  const colors = useTheme((s) => s.colors)
  const insets = useSafeAreaInsets()
  const [queue, setQueue] = useState(false)
  const [full, setFull] = useState(false)
  const [restH, setRestH] = useState(320) // measured: everything but the drawing (book mode); a guess till then
  const playing = !!np
  useEffect(() => {
    if (!playing) setFull(false)
  }, [playing])

  const { pane, side } = split
  const top = side === 'top' // half folded: the standing half, wide and short — drawing beside the rest
  const underBar = top && pane.y < insets.top // it runs up under the status bar (iOS)
  const playlist = np?.status.playlist ?? null
  const showQueue = queue && !!playlist
  // As big as the half allows: under the header (60 pt; 68 up under the status bar) and the
  // drawing's 12 pt above and below, with the rest beside it — or with ~360 pt of it below.
  const size = top
    ? Math.max(120, Math.min(pane.height - (underBar ? 68 : 60) - spacing.md * 2, pane.width * 0.45))
    : Math.max(160, Math.min(pane.width - spacing.xl * 2, pane.height - 360))
  // iOS 26: the box runs to the window's bottom edge (content goes under the bars), so clear the home indicator.
  const bottomPad = (NATIVE_ACCESSORY ? insets.bottom : 0) + spacing.md
  // Book mode fits the page: the drawing gets the height left under the 60 pt header,
  // its 12 pt margins and the rest of the player (square-sized: a rectangle is shorter).
  const fitSize = Math.max(120, Math.min(pane.width - spacing.xl * 2, pane.height - 60 - spacing.md * 2 - restH - bottomPad))
  return (
    <View
      style={[
        styles.pane,
        { left: pane.x, top: pane.y, width: pane.width, height: pane.height, backgroundColor: colors.background, borderColor: colors.border },
        { [side === 'right' ? 'borderLeftWidth' : side === 'left' ? 'borderRightWidth' : 'borderBottomWidth']: StyleSheet.hairlineWidth },
      ]}
    >
      {/* The table's half names the table: the pill (and its switcher) moves here from Screen while split.
          Up under the status bar (laptop mode on iOS) it all stays top left: the status bar's items are top right. */}
      <View style={[styles.paneHeader, underBar ? { paddingTop: spacing.lg } : null]}>
        <TablePill />
        {underBar ? null : <View style={{ flex: 1 }} />}
        {playlist ? (
          <IconButton icon={showQueue ? 'close' : 'queue-music'} size={24} color={colors.foreground} label={showQueue ? 'Hide queue' : 'Show queue'} onPress={() => setQueue(!showQueue)} />
        ) : null}
      </View>
      {!np ? (
        <IdleTable size={top ? Math.max(100, Math.min(size, pane.height - 200)) : Math.min(size, 320)} />
      ) : showQueue ? (
        <>
          <Text numberOfLines={1} style={[styles.paneEyebrow, { color: colors.mutedForeground }]}>Queue · {playlist?.name}</Text>
          <QueueList upcoming={upcoming} />
        </>
      ) : top ? (
        <PlayerBody shown={np} size={size} upNextFile={upNextFile} onUpNext={() => setQueue(true)} onFull={() => setFull(true)} horizontal compact eyebrow={np.subtitle} />
      ) : (
        // Book mode: one page, no scrolling — the drawing takes what the rest leaves.
        <View style={[styles.paneFit, { paddingBottom: bottomPad }]}>
          <PlayerBody shown={np} size={fitSize} upNextFile={upNextFile} onUpNext={() => setQueue(true)} onFull={() => setFull(true)} compact onRestHeight={setRestH} eyebrow={np.subtitle} />
        </View>
      )}
      {np ? <FullPlayer shown={np} open={full} onClose={() => setFull(false)} onDismissed={() => {}} /> : null}
    </View>
  )
}

/** The pane while nothing plays: the table from above, the ball where it rests. */
function IdleTable({ size }: { size: number }): React.JSX.Element {
  const status = useStatus((s) => s.status)
  const colors = useTheme((s) => s.colors)
  const rect = useIsRect()
  const online = status?.connected ? status : null
  return (
    <View style={styles.idle}>
      {rect ? (
        <TableRect width={size} ball={online ? [online.x, online.y] : null} color={colors.foreground} />
      ) : (
        <TableDisc size={size} ball={online ? { theta: online.theta, rho: online.rho } : null} color={colors.foreground} />
      )}
      <Text style={[styles.bigTitle, { color: colors.foreground }]}>{online ? 'Nothing playing' : 'Table offline'}</Text>
      <Text style={{ color: colors.mutedForeground, textAlign: 'center' }}>
        {online ? 'Play a pattern from Browse or Playlists.' : 'Waiting for the table to come back.'}
      </Text>
    </View>
  )
}

function ProgressBar({ pct, elapsedMs, remainingMs }: { pct: number; elapsedMs: number | null; remainingMs: number | null }) {
  const colors = useTheme((s) => s.colors)
  return (
    <View style={{ paddingHorizontal: spacing.lg, marginVertical: spacing.md }}>
      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: colors.live }]} />
      </View>
      <View style={styles.timeRow}>
        <Text style={{ color: colors.mutedForeground, fontFamily: font.family.mono, fontSize: font.size.xs }}>{elapsedMs != null ? fmt(elapsedMs) : ''}</Text>
        <Text style={{ color: colors.foreground, fontFamily: font.family.monoMedium, fontSize: font.size.xs }}>{pct}%</Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: font.family.mono, fontSize: font.size.xs }}>{remainingMs != null ? `-${fmt(remainingMs)}` : ''}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  pane: { position: 'absolute' },
  bodyRow: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.lg, paddingHorizontal: spacing.lg },
  paneFit: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
  sideColumn: { flexGrow: 1, justifyContent: 'space-between', paddingVertical: spacing.sm },
  upNextInline: { flexDirection: 'row', gap: spacing.sm },
  speedTight: { marginTop: spacing.xs, paddingTop: spacing.sm },
  bodyEyebrow: { fontSize: font.size.sm, fontWeight: font.weight.semibold, letterSpacing: 0.6, textTransform: 'uppercase', textAlign: 'center', marginBottom: spacing.xs },
  paneHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  paneEyebrow: { fontSize: font.size.sm, fontWeight: font.weight.semibold, letterSpacing: 0.6, textTransform: 'uppercase', paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  idle: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md, padding: spacing.xl },
  barWrap: { marginHorizontal: spacing.sm, marginBottom: spacing.sm },
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm, paddingRight: spacing.md, borderRadius: radius.lg, borderWidth: 1 },
  capsule: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md },
  capsuleTitle: { fontSize: font.size.sm, fontWeight: font.weight.semibold },
  fullBadge: { position: 'absolute', right: spacing.sm, bottom: spacing.sm, width: 32, height: 32, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  miniRect: { borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: font.size.md, fontWeight: font.weight.semibold },
  miniTrack: { height: 3, borderRadius: 2, marginTop: 5, overflow: 'hidden' },
  miniFill: { height: 3, borderRadius: 2 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  playBtn: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  bigTitle: { fontSize: font.size.xl + 2, fontFamily: font.family.display, letterSpacing: -0.3, textAlign: 'center' },
  pausePill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: spacing.xs, marginTop: spacing.sm, borderWidth: 1, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: spacing.md },
  upNextRow: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.sm },
  upNextThumb: { borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  upNext: { fontSize: font.size.sm, textAlign: 'center', flexShrink: 1, maxWidth: '100%' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 5 },
  speedWrap: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, gap: spacing.sm },
  queueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.sm },
  queueThumb: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
})
