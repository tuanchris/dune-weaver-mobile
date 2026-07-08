import React, { useEffect, useRef, useState } from 'react'
import { Dimensions, FlatList, Modal, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { MaterialIcons } from '@expo/vector-icons'
import { board } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { isActive } from '../api/status'
import { loadPlaylist } from '../lib/playlists'
import { prettyName } from '../lib/patternName'
import { useBoardAction } from '../lib/useBoardAction'
import { PatternThumb } from './PatternThumb'
import { patternKey } from '../stores/useLibrary'
import { IconButton } from './ui'
import { SpeedControl } from './SpeedControl'
import { radius, spacing, font } from '../theme'

const TAB_BAR = 58

/** ms -> "M:SS" */
function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function NowPlayingBar() {
  const colors = useTheme((s) => s.colors)
  const status = useStatus((s) => s.status)
  const refresh = useStatus((s) => s.refresh)
  const base = useBoards((s) => s.getActiveBase())
  const insets = useSafeAreaInsets()
  const [expanded, setExpanded] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [playlistItems, setPlaylistItems] = useState<{ name: string; items: string[] } | null>(null)
  const { act } = useBoardAction(350)

  // Track when the current pattern started so we can show elapsed time and an
  // estimated remaining (the firmware reports only a 0..100 progress, no clock).
  const startRef = useRef<{ file: string | null; at: number }>({ file: null, at: Date.now() })
  // Last pattern we had a file for, so we can keep showing it while idle/paused.
  const lastFileRef = useRef<string | null>(null)
  const currentFile = status?.currentFile ?? null
  useEffect(() => {
    startRef.current = { file: currentFile, at: Date.now() }
  }, [currentFile])

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

  // Maximize the player into the full drawer when a playlist starts. Tracked on
  // the rising edge of "a playlist is active"; prevPl starts null so opening the
  // app onto an already-running playlist doesn't pop the drawer unprompted.
  const playlistActive = !!status?.playlist
  const prevPlaylistActive = useRef<boolean | null>(null)
  useEffect(() => {
    if (prevPlaylistActive.current === false && playlistActive) setExpanded(true)
    prevPlaylistActive.current = playlistActive
  }, [playlistActive])

  const swipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx) * 1.5,
      onPanResponderRelease: (_, g) => {
        if (g.dy <= -30) setExpanded(true)
        else if (g.dy >= 30) setExpanded(false)
      },
    })
  ).current

  if (!isActive(status) || !status || !base) {
    if (expanded) setExpanded(false)
    if (queueOpen) setQueueOpen(false)
    return null
  }

  // During the between-patterns pause (state=Idle) the firmware reports no
  // current file, so fall back to the pattern that just finished — keep its
  // name + preview on screen instead of blanking to "Idle".
  if (currentFile) lastFileRef.current = currentFile
  const displayFile = currentFile ?? lastFileRef.current
  const name = prettyName(displayFile)

  // The between-patterns pause drives the same progress bar: it fills from the
  // elapsed share of the pause (pause_total − pause_remaining), and the time row
  // shows elapsed / -remaining of the pause instead of pattern progress.
  const pausing = status.pauseRemaining != null && status.pauseTotal != null
  const pauseElapsedMs = pausing ? (status.pauseTotal! - status.pauseRemaining!) * 1000 : 0
  const pauseRemainMs = pausing ? status.pauseRemaining! * 1000 : 0

  const pct = pausing
    ? Math.round(((status.pauseTotal! - status.pauseRemaining!) / status.pauseTotal!) * 100)
    : status.percentage ?? 0

  // Elapsed / estimated remaining. Only meaningful while a pattern is actually
  // progressing; remaining is a linear extrapolation, hence "~".
  const hasProgress = pausing || (status.percentage != null && !status.isHoming && !status.isClearing)
  const elapsedMs = pausing ? pauseElapsedMs : startRef.current.file === currentFile ? Date.now() - startRef.current.at : 0
  const remainingMs = pausing ? pauseRemainMs : hasProgress && pct > 1 && pct < 100 ? (elapsedMs * (100 - pct)) / pct : null

  // Up-next from the playlist file (bare ".thr" name).
  const upNextFile =
    status.playlist && playlistItems?.name === plName ? playlistItems.items[status.playlist.index + 1] : undefined
  const upcoming =
    status.playlist && playlistItems?.name === plName ? playlistItems.items.slice(status.playlist.index + 1) : []

  const togglePause = () =>
    status.isPaused ? act(() => board.resume(base), 'Resumed') : act(() => board.pause(base), 'Paused')

  const Controls = ({ big }: { big?: boolean }) => (
    <View style={styles.controls}>
      <IconButton icon="stop" size={big ? 30 : 26} color={colors.foreground} onPress={() => act(() => board.stop(base), 'Stopped')} />
      <Pressable onPress={togglePause} style={[styles.playBtn, { backgroundColor: colors.primary, width: big ? 60 : 48, height: big ? 60 : 48 }]}>
        <MaterialIcons name={status.isPaused ? 'play-arrow' : 'pause'} size={big ? 34 : 28} color="#fff" />
      </Pressable>
      {status.playlist ? (
        <IconButton icon="skip-next" size={big ? 30 : 26} color={colors.foreground} onPress={() => act(() => board.skip(base), 'Skipping')} />
      ) : (
        <View style={{ width: big ? 30 : 26 }} />
      )}
    </View>
  )

  const subtitle =
    status.isHoming ? 'Homing…'
    : status.isClearing ? 'Clearing…'
    : status.isQuiet ? 'Quiet hours'
    : status.playlist ? `${status.playlist.name ?? 'Playlist'} · ${status.playlist.index + 1}/${status.playlist.total}`
    : status.isPaused ? 'Paused'
    : status.state

  const width = Dimensions.get('window').width
  const vizSize = Math.min(width - spacing.xl * 2, 320)

  const queueModal = (
    <Modal visible={queueOpen} transparent animationType="slide" onRequestClose={() => setQueueOpen(false)}>
      <View style={styles.modalBackdrop}>
        {/* Native SafeAreaView: measures the Modal's own window, so the sheet
            clears the Android nav bar (main-window insets don't apply here). */}
        <SafeAreaView edges={['bottom']} style={[styles.queueSheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={styles.queueHeader}>
            <IconButton icon="close" size={26} color={colors.foreground} onPress={() => setQueueOpen(false)} />
            <Text style={{ color: colors.foreground, fontSize: font.size.lg, fontWeight: font.weight.semibold }}>
              {status.playlist?.name ?? 'Queue'}
            </Text>
            <View style={{ width: 32 }} />
          </View>
          <FlatList
            data={upcoming}
            keyExtractor={(it, i) => `${it}-${i}`}
            contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.lg }}
            ListEmptyComponent={
              <Text style={{ color: colors.mutedForeground, textAlign: 'center', marginTop: 40 }}>No upcoming patterns.</Text>
            }
            renderItem={({ item, index }) => (
              <View style={[styles.queueRow, { borderColor: colors.border, backgroundColor: colors.card }]}>
                <Text style={{ color: colors.mutedForeground, width: 24, textAlign: 'center', fontSize: font.size.sm }}>{index + 1}</Text>
                <View style={styles.queueThumb}>
                  <PatternThumb name={item} size={36} />
                </View>
                <Text numberOfLines={1} style={{ flex: 1, color: colors.foreground }}>{prettyName(item)}</Text>
              </View>
            )}
          />
        </SafeAreaView>
      </View>
    </Modal>
  )

  const expandedDrawer = (
    <Modal visible={expanded} transparent animationType="slide" onRequestClose={() => setExpanded(false)}>
      <View style={styles.modalBackdrop}>
        <Pressable style={{ flex: 1 }} onPress={() => setExpanded(false)} />
        <SafeAreaView edges={['bottom']} style={[styles.expandedSheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View {...swipe.panHandlers}>
            <View style={[styles.grabber, { backgroundColor: colors.border }]} />
            <View style={styles.expandedHeader}>
              <IconButton icon="expand-more" size={28} color={colors.foreground} onPress={() => setExpanded(false)} />
              <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>{subtitle}</Text>
              {status.playlist ? (
                <IconButton icon="queue-music" size={26} color={colors.foreground} onPress={() => setQueueOpen(true)} />
              ) : (
                <View style={{ width: 28 }} />
              )}
            </View>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}
          >
            <View style={{ alignItems: 'center', marginVertical: spacing.md }}>
              <PatternThumb name={patternKey(displayFile)} size={vizSize} />
            </View>

            <Text numberOfLines={1} style={[styles.bigTitle, { color: colors.foreground }]}>{name || 'Idle'}</Text>
            {upNextFile ? (
              <Pressable onPress={() => setQueueOpen(true)} style={styles.upNextRow}>
                <View style={[styles.upNextThumb, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <PatternThumb name={upNextFile} size={96} />
                </View>
                <Text numberOfLines={1} style={[styles.upNext, { color: colors.mutedForeground }]}>
                  Up next: {prettyName(upNextFile)}
                </Text>
              </Pressable>
            ) : null}

            <ProgressBar pct={pct} elapsedMs={hasProgress ? elapsedMs : null} remainingMs={remainingMs} />
            <Controls big />

            <View style={[styles.speedWrap, { borderTopColor: colors.border }]}>
              <SpeedControl
                value={status.speed}
                feedOverride={status.feedOverride}
                onCommit={(v) => board.setFeedLive(base, v).then(() => setTimeout(refresh, 350)).catch(() => {})}
              />
            </View>
          </ScrollView>
          {queueModal}
        </SafeAreaView>
      </View>
    </Modal>
  )

  return (
    <View {...swipe.panHandlers} style={[styles.barWrap, { bottom: insets.bottom + TAB_BAR }]}>
      {expandedDrawer}
      <Pressable onPress={() => setExpanded(true)} style={[styles.bar, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <PatternThumb name={patternKey(displayFile)} size={46} />
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>{name || 'Idle'}</Text>
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>{subtitle}</Text>
          <View style={[styles.miniTrack, { backgroundColor: colors.border }]}>
            <View style={[styles.miniFill, { width: `${pct}%`, backgroundColor: colors.primary }]} />
          </View>
          {hasProgress ? (
            <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: 10, marginTop: 3 }}>
              {fmt(elapsedMs)} · {pct}%{remainingMs != null ? ` · -${fmt(remainingMs)}` : ''}
            </Text>
          ) : null}
        </View>
        <Controls />
      </Pressable>
    </View>
  )
}

function ProgressBar({ pct, elapsedMs, remainingMs }: { pct: number; elapsedMs: number | null; remainingMs: number | null }) {
  const colors = useTheme((s) => s.colors)
  return (
    <View style={{ paddingHorizontal: spacing.lg, marginVertical: spacing.md }}>
      <View style={[styles.track, { backgroundColor: colors.border }]}>
        <View style={[styles.fill, { width: `${pct}%`, backgroundColor: colors.primary }]} />
      </View>
      <View style={styles.timeRow}>
        <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>{elapsedMs != null ? fmt(elapsedMs) : ''}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, fontWeight: font.weight.medium }}>{pct}%</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>{remainingMs != null ? `-${fmt(remainingMs)}` : ''}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  barWrap: { position: 'absolute', left: spacing.sm, right: spacing.sm },
  bar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm, paddingRight: spacing.md, borderRadius: radius.lg, borderWidth: 1 },
  title: { fontSize: font.size.md, fontWeight: font.weight.semibold },
  miniTrack: { height: 3, borderRadius: 2, marginTop: 5, overflow: 'hidden' },
  miniFill: { height: 3, borderRadius: 2 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  playBtn: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  expandedSheet: { height: '88%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1 },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginTop: spacing.sm, marginBottom: spacing.xs },
  expandedHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg },
  bigTitle: { fontSize: font.size.xl, fontWeight: font.weight.bold, textAlign: 'center' },
  upNextRow: { alignItems: 'center', justifyContent: 'center', gap: spacing.xs, marginTop: spacing.md },
  upNextThumb: { width: 96, height: 96, borderRadius: 48, borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  upNext: { fontSize: font.size.sm, textAlign: 'center', flexShrink: 1, maxWidth: '100%' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 5 },
  speedWrap: { marginTop: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, gap: spacing.sm },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  queueSheet: { height: '70%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1 },
  queueHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  queueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.sm, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.sm },
  queueThumb: { width: 36, height: 36, borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
})
