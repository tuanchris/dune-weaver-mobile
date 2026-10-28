import React from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { board, CLEAR_MODES, type ClearMode } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useScrollLock } from '../stores/useScrollLock'
import { usePreviews } from '../stores/usePreviews'
import { useTheme } from '../stores/useTheme'
import { bareName, useLibrary } from '../stores/useLibrary'
import { assertNotSyncing } from '../lib/sd'
import { SCROLL_BOTTOM_PAD, useScreenWidth } from '../lib/layout'
import { type Point } from '../lib/patternGeometry'
import { prettyName } from '../lib/patternName'
import { stopAndSettle, stopFirstWarning } from '../lib/stopFirst'
import { useBoardAction } from '../lib/useBoardAction'
import { Button, Card, CardTitle } from '../components/ui'
import { Screen } from '../components/Screen'
import { SpeedControl } from '../components/SpeedControl'
import { EmptyState } from '../components/EmptyState'
import { TableDisc, TableRect, useIsRect, useThumbFrame, useTravel } from '../components/RectTable'
import { PatternThumb } from '../components/PatternThumb'
import { isGcode } from '../lib/gcode'
import { radius, spacing, font } from '../theme'

/** Seconds-since-boot -> compact "2d 3h" / "3h 14m" / "14m" / "9s". */
function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400)
  const h = Math.floor((sec % 86400) / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${Math.floor(sec)}s`
}

// Each tile draws its sweep on a little table: the path, and the ball where it
// starts. (The real previews are too dense to read small, and the two spirals
// look the same.) Points are unit-circle xy, like pattern geometry.
const SPIRAL: Point[] = Array.from({ length: 121 }, (_, i) => {
  const t = i / 120
  const a = t * 3 * 2 * Math.PI // three turns, ending at θ = 0 (the right rim)
  return [t * Math.cos(a), t * Math.sin(a)]
})
const ZIGZAG: Point[] = [-0.72, -0.36, 0, 0.36, 0.72].flatMap((y, k): Point[] => {
  const x = Math.sqrt(1 - y * y) * 0.9
  return k % 2 ? [[x, y], [-x, y]] : [[-x, y], [x, y]]
})

// The firmware's stock clear patterns (the same files dune-weaver uses), run with $SD/Run.
const CLEARS: { mode: ClearMode; file: string; path: Point[]; start: Point }[] = [
  { mode: 'in', file: 'clear_from_in.thr', path: SPIRAL, start: [0, 0] },
  { mode: 'out', file: 'clear_from_out.thr', path: SPIRAL, start: [1, 0] },
  { mode: 'sideway', file: 'clear_sideway.thr', path: ZIGZAG, start: ZIGZAG[0] },
]
const clearLabel = (m: ClearMode): string => CLEAR_MODES.find((c) => c.mode === m)?.label ?? m

// A rectangular table's clears are whatever G-code wipes its card holds, named
// clear_* or wipe_* (the firmware's CoreXY config template) by convention
// ("clear_from_in.gcode" -> "From in"). No stock set.
const isRectClear = (file: string): boolean => isGcode(file) && /^(clear|wipe)/i.test(bareName(file))
const rectClearLabel = (file: string): string => {
  const s = prettyName(file).replace(/^(clear|wipe)[\s_-]*/i, '').replace(/[_-]+/g, ' ')
  return s ? s[0].toUpperCase() + s.slice(1) : 'Clear'
}

export function ControlScreen(): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const width = useScreenWidth()
  const base = useBoards((s) => s.getActiveBase())
  const status = useStatus((s) => s.status)
  const refreshStatus = useStatus((s) => s.refresh)
  const scrollLocked = useScrollLock((s) => s.locked)
  // Block motion-START while the app is streaming previews off the card (shared
  // single-threaded SD). Stop stays enabled — you must always be able to halt.
  const syncing = usePreviews((s) => s.syncing)
  const { busy, act } = useBoardAction()
  const rect = useIsRect()
  const travel = useTravel()
  const frame = useThumbFrame()
  const tablePatterns = useLibrary((s) => s.tablePatterns)
  const rectClears = React.useMemo(() => tablePatterns.filter(isRectClear).sort(), [tablePatterns])

  if (!base) {
    return (
      <Screen>
        <EmptyState icon="cable" text="No table connected. Add one in Settings." />
      </Screen>
    )
  }

  const online = !!status?.connected
  const isAlarm = online && status.state === 'Alarm'
  const moving = online && (status.isRunning || status.isHoming || status.isClearing)
  const runningFile = online && status.isRunning ? bareName(status.currentFile) : ''
  const clearing =
    !runningFile ? null
    : rect ? (isRectClear(runningFile) ? `Clear ${rectClearLabel(runningFile).toLowerCase()}` : null)
    : (() => { const c = CLEARS.find((k) => k.file === runningFile); return c ? clearLabel(c.mode) : null })()

  // Moving the ball / clearing needs an idle, homed table (the firmware answers
  // 409 mid-pattern), and a preview sync holds the SD. Say WHY they're off.
  const lockReason =
    !online ? 'Table offline'
    : syncing ? 'Syncing previews'
    : isAlarm ? 'Home or unlock first'
    : status.playlist ? 'Stop the playlist first'
    : status.isRunning || status.isPaused ? 'Stop the pattern first'
    : status.state !== 'Idle' ? 'Wait until it’s idle'
    : null
  const canPosition = !lockReason

  const stateWord =
    !online ? 'Offline'
    : status.isHoming ? 'Homing'
    : status.isClearing || clearing ? 'Clearing'
    : status.isPaused ? 'Paused'
    : status.isRunning ? 'Drawing'
    : isAlarm ? 'Alarm'
    : status.isQuiet ? 'Quiet hours'
    : 'Idle'
  const pct = status?.percentage != null ? ` · ${status.percentage}%` : ''
  const subline =
    !online ? 'Can’t reach the table'
    : isAlarm ? 'Home or unlock it to carry on'
    : status.isHoming ? 'Finding its home position'
    : clearing ? clearing + pct
    : status.isClearing ? 'Before the next pattern'
    : status.isRunning || status.isPaused ? prettyName(status.currentFile) + pct
    : status.playlist ? 'Between patterns'
    : status.isQuiet ? 'Still Sands — the table is resting'
    : !rect && Math.abs(status.rho) < 0.03 ? 'Ball at center'
    : !rect && Math.abs(status.rho) > 0.97 ? 'Ball at edge'
    : rect && Math.hypot(status.x, status.y) < 2 ? 'Ball at home'
    : 'Ready'
  const ballColor = isAlarm ? colors.destructive : moving ? colors.live : colors.foreground
  const ball = online ? { theta: status.theta, rho: status.rho } : null
  // θ wrapped to a compass-style 0–359° (the firmware's θ is unwound radians).
  const deg = online ? Math.round(((((status.theta * 180) / Math.PI) % 360) + 360) % 360) % 360 : 0

  const move = (rho: 0 | 1) =>
    act(
      () => { assertNotSyncing(); return rho === 0 ? board.moveToCenter(base) : board.moveToPerimeter(base) },
      rho === 0 ? 'Moving to center' : 'Moving to edge',
      'move the ball',
    )
  const moveXY = (x: number, y: number, where: string) =>
    act(() => { assertNotSyncing(); return board.moveToXY(base, x, y) }, `Moving to ${where}`, 'move the ball')

  // A reboot ends whatever is drawing, so stop it first (and say so), like the Wi-Fi and OTA restarts.
  const restart = () =>
    Alert.alert('Restart table?', `${stopFirstWarning(useStatus.getState().status)}It takes about 30 seconds to rejoin Wi-Fi.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restart',
        style: 'destructive',
        onPress: () => act(async () => { await stopAndSettle(base); await board.reboot(base) }, 'Restarting…', 'restart the table'),
      },
    ])

  const tileW = (Math.min(width, 640) - spacing.lg * 4 - spacing.sm * 2) / 3

  return (
    <Screen title="Control">
      <ScrollView scrollEnabled={!scrollLocked} contentContainerStyle={{ padding: spacing.lg, paddingBottom: SCROLL_BOTTOM_PAD, gap: spacing.lg }}>
        {/* The table from above: where the ball is, what it's doing, and the two buttons that always apply. */}
        <Card style={styles.hero}>
          <View style={{ opacity: online ? 1 : 0.5 }}>
            {rect ? (
              <TableRect width={Math.min(340, width - spacing.lg * 4)} ball={online ? [status.x, status.y] : null} color={ballColor} />
            ) : (
              <TableDisc size={Math.min(180, width - spacing.lg * 4)} ball={ball} color={ballColor} />
            )}
          </View>
          <View style={styles.caption}>
            <Text numberOfLines={1} style={[styles.stateWord, { color: colors.foreground }]}>{stateWord}</Text>
            <Text numberOfLines={2} style={[styles.subline, { color: colors.mutedForeground }]}>{subline}</Text>
            {online && rect ? (
              <Text style={[styles.tele, { color: colors.mutedForeground }]}>
                X <Text style={{ color: colors.foreground }}>{Math.round(status.x)}</Text>   Y <Text style={{ color: colors.foreground }}>{Math.round(status.y)}</Text> mm
              </Text>
            ) : online ? (
              <Text style={[styles.tele, { color: colors.mutedForeground }]}>
                θ <Text style={{ color: colors.foreground }}>{deg}°</Text>   ρ <Text style={{ color: colors.foreground }}>{status.rho.toFixed(2)}</Text>
              </Text>
            ) : null}
          </View>
          <View style={styles.row}>
            <Button title="Home" icon="home" variant={moving ? 'secondary' : 'primary'} flex disabled={busy || syncing || !online} onPress={() => act(() => { assertNotSyncing(); return board.home(base) }, 'Homing', 'home the table')} />
            {isAlarm ? (
              <Button title="Unlock" icon="lock-open" variant="secondary" flex disabled={busy} onPress={() => act(() => board.unlock(base), 'Unlocked', 'unlock the table')} />
            ) : null}
            <Button title="Stop" icon="stop" variant="destructive" flex disabled={busy} onPress={() => act(() => board.stop(base), 'Stopped', 'stop the table')} />
          </View>
        </Card>

        <Card>
          <TitleRow title="Clear sand" note={lockReason} />
          {rect ? (
            rectClears.length ? (
              <View style={[styles.tileRow, { flexWrap: 'wrap' }]}>
                {rectClears.map((file) => (
                  <Tile
                    key={file}
                    width={tileW}
                    label={rectClearLabel(file)}
                    disabled={busy || !canPosition}
                    onPress={() => act(() => { assertNotSyncing(); return board.runPattern(base, `/patterns/${file}`) }, `Clearing ${rectClearLabel(file).toLowerCase()}`, 'start the clear pattern')}
                  >
                    <View style={[styles.rectTile, frame(tileW * 0.92), { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
                      <PatternThumb name={file} size={tileW * 0.92 - 4} />
                    </View>
                  </Tile>
                ))}
              </View>
            ) : (
              <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>
                No clear patterns on the table. Clears here are the card’s clear_* and wipe_* G-code files.
              </Text>
            )
          ) : (
          <View style={styles.tileRow}>
            {CLEARS.map((c) => (
              <Tile
                key={c.mode}
                label={clearLabel(c.mode)}
                disabled={busy || !canPosition}
                onPress={() => act(() => { assertNotSyncing(); return board.runPattern(base, `/patterns/${c.file}`) }, `Clearing ${clearLabel(c.mode).toLowerCase()}`, 'start the clear pattern')}
              >
                <TableDisc
                  size={Math.min(84, tileW * 0.66)}
                  path={c.path}
                  ball={{ theta: Math.atan2(c.start[1], c.start[0]), rho: Math.hypot(c.start[0], c.start[1]) }}
                  color={colors.foreground}
                />
              </Tile>
            ))}
          </View>
          )}
          <View style={{ marginTop: spacing.xl }}>
            <CardTitle>Move ball</CardTitle>
          </View>
          {rect ? (
            <MovePad
              width={Math.min(420, width - spacing.lg * 4)}
              travel={travel}
              disabled={busy || !canPosition || !travel}
              onMove={moveXY}
            />
          ) : (
          <View style={styles.row}>
            <Pill label="Center" disabled={busy || !canPosition} onPress={() => move(0)}>
              <TableDisc size={26} ball={{ theta: 0, rho: 0 }} color={colors.foreground} />
            </Pill>
            {/* Edge keeps the arm's angle: the ball lands on the rim where it points now. */}
            <Pill label="Edge" disabled={busy || !canPosition} onPress={() => move(1)}>
              <TableDisc size={26} ball={{ theta: online ? status.theta : 0, rho: 1 }} color={colors.foreground} />
            </Pill>
          </View>
          )}
        </Card>

        <Card>
          <SpeedControl
            percent={rect}
            value={rect ? status?.feedOverride ?? 100 : status?.speed ?? 50}
            feedOverride={status?.feedOverride ?? 100}
            onCommit={(v) => (rect ? board.setFeedPct : board.setFeedLive)(base, v).then(() => setTimeout(refreshStatus, 350)).catch(() => {})}
          />
        </Card>

        <Card style={{ padding: 0 }}>
          <Pressable
            onPress={restart}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={status?.uptime != null ? `Restart table, up ${fmtUptime(status.uptime)}` : 'Restart table'}
            style={({ pressed }) => [styles.actionRow, { opacity: busy ? 0.5 : 1 }, pressed && { backgroundColor: colors.cardElevated }]}
          >
            <MaterialIcons name="restart-alt" size={20} color={colors.foreground} />
            <Text style={{ flex: 1, color: colors.foreground, fontSize: font.size.md, fontWeight: font.weight.medium }}>Restart table</Text>
            {online && status.uptime != null ? (
              <Text style={[styles.tele, { color: colors.mutedForeground }]}>up {fmtUptime(status.uptime)}</Text>
            ) : null}
          </Pressable>
        </Card>
      </ScrollView>
    </Screen>
  )
}

/**
 * Move ball on a rectangular table: a map of it with a target at each corner
 * and the center (G-code's y up, like the hero: home, 0,0, is bottom left).
 */
function MovePad({ width, travel, disabled, onMove }: {
  width: number
  travel: [number, number] | null
  disabled: boolean
  onMove: (x: number, y: number, where: string) => void
}): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const [W, H] = travel ?? [2, 1]
  // Kept tall enough for two rows of 44 pt targets on a very long table.
  const height = Math.max(112, (width * H) / W)
  const T = 44
  const R = width - T - 6
  const B = height - T - 6
  const spots = [
    { where: 'the top left corner', x: 0, y: H, left: 6, top: 6 },
    { where: 'the top right corner', x: W, y: H, left: R, top: 6 },
    { where: 'the center', x: W / 2, y: H / 2, left: (width - T) / 2, top: (height - T) / 2 },
    { where: 'the bottom left corner', x: 0, y: 0, left: 6, top: B },
    { where: 'the bottom right corner', x: W, y: 0, left: R, top: B },
  ]
  return (
    <View style={[styles.pad, { width, height, backgroundColor: colors.cardElevated, borderColor: colors.border, opacity: disabled ? 0.45 : 1 }]}>
      {spots.map((p) => (
        <Pressable
          key={p.where}
          onPress={() => onMove(p.x, p.y, p.where)}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`Move ball to ${p.where}`}
          accessibilityState={{ disabled }}
          style={({ pressed }) => [styles.target, { left: p.left, top: p.top, backgroundColor: pressed ? colors.primary : colors.card, borderColor: colors.border }]}
        >
          {({ pressed }) => <View style={[styles.targetDot, { backgroundColor: pressed ? colors.primaryForeground : colors.foreground }]} />}
        </Pressable>
      ))}
    </View>
  )
}

/** Card label with, on the right, why its buttons are off (if they are). */
function TitleRow({ title, note }: { title: string; note: string | null }): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  return (
    <View style={styles.titleRow}>
      <CardTitle>{title}</CardTitle>
      {note ? (
        <View style={styles.note}>
          <MaterialIcons name="lock-outline" size={14} color={colors.mutedForeground} />
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: font.size.sm, flexShrink: 1 }}>{note}</Text>
        </View>
      ) : null}
    </View>
  )
}

/** `width` fixes the tile's size, for rows that wrap (a card with 4+ wipe files). */
function Tile({ label, onPress, disabled, width, children }: { label: string; onPress: () => void; disabled?: boolean; width?: number; children: React.ReactNode }): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Clear ${label.toLowerCase()}`}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.tile, width ? { flex: 0, width } : null, { opacity: disabled ? 0.45 : pressed ? 0.7 : 1 }]}
    >
      {children}
      <Text style={{ color: colors.foreground, fontSize: font.size.sm, fontWeight: font.weight.medium, textAlign: 'center' }}>{label}</Text>
    </Pressable>
  )
}

function Pill({ label, onPress, disabled, children }: { label: string; onPress: () => void; disabled?: boolean; children: React.ReactNode }): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`Move ball to ${label.toLowerCase()}`}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.pill, { backgroundColor: colors.cardElevated, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }]}
    >
      {children}
      <Text style={{ color: colors.foreground, fontSize: font.size.md, fontWeight: font.weight.semibold }}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.md },
  caption: { alignItems: 'center', gap: 2, alignSelf: 'stretch' },
  stateWord: { fontFamily: font.family.display, fontSize: font.size.xl, letterSpacing: -0.2 },
  subline: { fontSize: font.size.sm, textAlign: 'center' },
  tele: { fontFamily: font.family.mono, fontSize: font.size.sm, marginTop: 2 },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', alignSelf: 'stretch' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md },
  note: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1, marginBottom: spacing.md },
  tileRow: { flexDirection: 'row', gap: spacing.sm },
  tile: { flex: 1, alignItems: 'center', gap: spacing.sm, minHeight: 44, borderRadius: radius.md },
  rectTile: { borderWidth: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  pad: { alignSelf: 'center', borderRadius: radius.lg, borderWidth: 1.5 },
  target: { position: 'absolute', width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  targetDot: { width: 10, height: 10, borderRadius: 5 },
  pill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, minHeight: 48, paddingVertical: spacing.xs, borderRadius: radius.pill },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, paddingVertical: spacing.sm, paddingHorizontal: spacing.lg, borderRadius: radius.lg },
})
