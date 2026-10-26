import React, { useEffect, useRef, useState } from 'react'
import { FlatList, PanResponder, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { create } from 'zustand'
import { board } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useScrollLock } from '../stores/useScrollLock'
import { useTheme } from '../stores/useTheme'
import { isActive, type Status } from '../api/status'
import { loadPlaylist } from '../lib/playlists'
import { prettyName } from '../lib/patternName'
import { useBoardAction } from '../lib/useBoardAction'
import { PatternThumb } from './PatternThumb'
import { LiveDrawing } from './LiveDrawing'
import { patternKey } from '../stores/useLibrary'
import { IconButton } from './ui'
import { Sheet, useAnySheetOpen } from './Sheet'
import { SpeedControl } from './SpeedControl'
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

  return { status, base, displayFile, name: prettyName(displayFile), pausing, pct, hasProgress, elapsedMs, remainingMs, subtitle }
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

/**
 * The mini player: Pause/Resume + Skip, tap to open the full player. Stop lives
 * only in the expanded player (a one-tap stop here was too easy to hit).
 * Stateless and safe to mount several times (no Modals, no fetches):
 *  - 'regular' / 'inline': iOS 26 tab-bar `bottomAccessory` (the system draws the glass capsule).
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
    const inline = placement === 'inline'
    return (
      <Pressable onPress={openPlayer} style={[styles.capsule, { gap: inline ? spacing.sm : spacing.md }]}>
        <PatternThumb name={patternKey(np.displayFile)} size={inline ? 24 : 32} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} maxFontSizeMultiplier={CAPSULE_TEXT_MAX} style={[styles.capsuleTitle, { color: colors.foreground }]}>
            {np.name || 'Idle'}
          </Text>
          {inline ? null : (
            <Text numberOfLines={1} maxFontSizeMultiplier={CAPSULE_TEXT_MAX} style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>
              {np.subtitle}
            </Text>
          )}
        </View>
        <IconButton
          icon={np.status.isPaused ? 'play-arrow' : 'pause'}
          size={inline ? 24 : 28}
          color={colors.foreground}
          label={np.status.isPaused ? 'Resume' : 'Pause'}
          onPress={() => togglePause(np, act)}
        />
        {inline ? null : skipBtn}
      </Pressable>
    )
  }

  return (
    <View {...swipeUp.panHandlers} style={styles.barWrap}>
      <Pressable onPress={openPlayer} style={[styles.bar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <PatternThumb name={patternKey(np.displayFile)} size={46} />
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

/** The expanded player (+ its queue as a sub-page). Rendered ONCE, from App.tsx. */
export function NowPlayingSheet() {
  const colors = useTheme((s) => s.colors)
  const scrollLocked = useScrollLock((s) => s.locked)
  const status = useStatus((s) => s.status)
  const refresh = useStatus((s) => s.refresh)
  const base = useBoards((s) => s.getActiveBase())
  const { width: winWidth } = useWindowDimensions()
  const expanded = usePlayerSheet((s) => s.expanded)
  const setExpanded = usePlayerSheet((s) => s.setExpanded)
  const anySheetOpen = useAnySheetOpen()
  const [page, setPage] = useState<'player' | 'queue'>('player')
  const [playlistItems, setPlaylistItems] = useState<{ name: string; items: string[] } | null>(null)
  const { act } = useBoardAction(350)
  const np = useNowPlaying()
  // Keep the last frame on screen while the sheet slides away after playback ends.
  const lastNp = useRef<NowPlaying | null>(null)
  if (np) lastNp.current = np
  const shown = np ?? lastNp.current

  // Pull the active playlist's pattern list so we can show "up next" + a queue.
  const plName = status?.playlist?.name ?? null
  useEffect(() => {
    let cancelled = false
    if (!base || !plName) {
      setPlaylistItems(null)
      return
    }
    loadPlaylist(base, `${plName}.txt`)
      .then((items) => {
        if (!cancelled) setPlaylistItems({ name: plName, items })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [base, plName])

  // Maximize the player when a playlist starts. Tracked on the rising edge of
  // "a playlist is active"; prev starts null so opening the app onto an
  // already-running playlist doesn't pop the sheet unprompted. The edge often
  // lands while the editor's sheet is still animating out — iOS silently drops
  // a second present, so wait (pending) until no sheet is up.
  // ponytail: waits on EVERY sheet; exclude self if the player ever registers before opening.
  // null = no status yet (launch / table switch reset it): it seeds `prev`, never an edge.
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
    if (expanded) setPendingExpand(false)
    else if (!anySheetOpen) {
      setPendingExpand(false)
      setExpanded(true)
    }
  }, [pendingExpand, anySheetOpen, expanded, setExpanded])

  // Playback ended → close (and drop a pending auto-open).
  const active = !!np
  useEffect(() => {
    if (active) return
    setExpanded(false)
    setPendingExpand(false)
  }, [active, setExpanded])
  // Every open starts on the player, not wherever the queue was left.
  useEffect(() => {
    if (expanded) setPage('player')
  }, [expanded])

  if (!shown) return null

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
  const fileUpcoming =
    st.playlist && playlistItems?.name === plName ? playlistItems.items.slice(st.playlist.index + 1) : []
  const shuffled = !!upNextFile && fileUpcoming.length > 0 && upNextFile !== fileUpcoming[0]
  const upcoming = shuffled ? [upNextFile] : fileUpcoming

  // Sized so disc + title + up-next + progress + controls + speed fit the sheet
  // without scrolling on a phone (capped, so an iPad sheet doesn't balloon it).
  const vizSize = Math.min(winWidth - spacing.xl * 2, 290)
  const close = () => setExpanded(false)

  const queue = page === 'queue'
  return (
    <Sheet
      visible={expanded && active}
      onClose={close}
      variant="page"
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
              <View style={styles.queueThumb}>
                <PatternThumb name={item} size={36} />
              </View>
              <Text numberOfLines={2} style={{ flex: 1, color: colors.foreground }}>{prettyName(item)}</Text>
            </View>
          )}
        />
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          scrollEnabled={!scrollLocked}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.xl }}
        >
          <View style={{ alignItems: 'center', marginVertical: spacing.md }}>
            {/* The signature view: full pattern on the sand disc, progress as the glowing rim arc. */}
            <LiveDrawing name={shown.displayFile} size={vizSize} pct={shown.pct} />
          </View>

          <Text numberOfLines={2} style={[styles.bigTitle, { color: colors.foreground }]}>{shown.name || 'Idle'}</Text>
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
            <Pressable onPress={() => setPage('queue')} style={styles.upNextRow}>
              <View style={[styles.upNextThumb, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <PatternThumb name={upNextFile} size={64} />
              </View>
              <Text numberOfLines={2} style={[styles.upNext, { color: colors.mutedForeground }]}>
                Up next: {prettyName(upNextFile)}
              </Text>
            </Pressable>
          ) : null}

          <ProgressBar pct={shown.pct} elapsedMs={shown.hasProgress ? shown.elapsedMs : null} remainingMs={shown.remainingMs} />
          <View style={styles.controls}>
            <IconButton icon="stop" size={30} color={colors.foreground} label="Stop" onPress={() => act(() => board.stop(shown.base), 'Stopped', 'stop the table')} />
            <PlayPause np={shown} act={act} size={60} />
            {st.playlist ? (
              <IconButton icon="skip-next" size={30} color={colors.foreground} label="Skip to next pattern" onPress={() => skip(shown, act)} />
            ) : (
              <View style={{ width: 38 }} />
            )}
          </View>

          <View style={[styles.speedWrap, { borderTopColor: colors.border }]}>
            <SpeedControl
              value={st.speed}
              feedOverride={st.feedOverride}
              onCommit={(v) => board.setFeedLive(shown.base, v).then(() => setTimeout(refresh, 350)).catch(() => {})}
            />
          </View>
        </ScrollView>
      )}
    </Sheet>
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
  barWrap: { marginHorizontal: spacing.sm, marginBottom: spacing.sm },
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm, paddingRight: spacing.md, borderRadius: radius.lg, borderWidth: 1 },
  capsule: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md },
  capsuleTitle: { fontSize: font.size.sm, fontWeight: font.weight.semibold },
  title: { fontSize: font.size.md, fontWeight: font.weight.semibold },
  miniTrack: { height: 3, borderRadius: 2, marginTop: 5, overflow: 'hidden' },
  miniFill: { height: 3, borderRadius: 2 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  playBtn: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  bigTitle: { fontSize: font.size.xl + 2, fontFamily: font.family.display, letterSpacing: -0.3, textAlign: 'center' },
  pausePill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', gap: spacing.xs, marginTop: spacing.sm, borderWidth: 1, borderRadius: radius.pill, paddingVertical: 4, paddingHorizontal: spacing.md },
  upNextRow: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.sm },
  upNextThumb: { width: 64, height: 64, borderRadius: 32, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  upNext: { fontSize: font.size.sm, textAlign: 'center', flexShrink: 1, maxWidth: '100%' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 5 },
  speedWrap: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, gap: spacing.sm },
  queueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.sm },
  queueThumb: { width: 36, height: 36, borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
})
