import React from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { board } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { useBoardAction } from '../lib/useBoardAction'
import { Button, Card, CardTitle } from '../components/ui'
import { Screen } from '../components/Screen'
import { SpeedControl } from '../components/SpeedControl'
import { EmptyState } from '../components/EmptyState'
import { radius, spacing, font } from '../theme'

type IconName = React.ComponentProps<typeof MaterialIcons>['name']

// The firmware clears by running its default clear patterns off the SD card
// (same files dune-weaver uses); $SD/Run via board.runPattern.
const CLEAR_ACTIONS: { file: string; icon: IconName; label: string; toast: string }[] = [
  { file: '/patterns/clear_from_in.thr', icon: 'center-focus-strong', label: 'Center', toast: 'Clearing from center' },
  { file: '/patterns/clear_from_out.thr', icon: 'all-out', label: 'Edge', toast: 'Clearing from edge' },
  { file: '/patterns/clear_sideway.thr', icon: 'swap-horiz', label: 'Sideways', toast: 'Clearing sideways' },
]

export function ControlScreen() {
  const colors = useTheme((s) => s.colors)
  const base = useBoards((s) => s.getActiveBase())
  const status = useStatus((s) => s.status)
  const refreshStatus = useStatus((s) => s.refresh)
  const { busy, act } = useBoardAction()

  if (!base) {
    return (
      <Screen>
        <EmptyState icon="cable" text="No table connected. Add one in Settings." />
      </Screen>
    )
  }

  const isAlarm = status?.state === 'Alarm'
  // Moving the ball / clearing needs an idle, homed table (the firmware rejects
  // these mid-pattern with HTTP 409). Disable rather than let them silently fail.
  const canPosition = !!status && status.state === 'Idle' && !status.playlist

  return (
    <Screen title="Table Control">
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 160, gap: spacing.lg }}>
        <Card>
          <CardTitle>Movement Controls</CardTitle>
          <View style={styles.row}>
            <Button title="Home" icon="home" variant="primary" flex disabled={busy} onPress={() => act(() => board.home(base), 'Homing')} />
            <Button title="Stop" icon="stop" variant="destructive" flex disabled={busy} onPress={() => act(() => board.stop(base), 'Stopped')} />
          </View>
          {isAlarm ? (
            <Button title="Unlock (clear alarm)" icon="lock-open" variant="secondary" style={{ marginTop: spacing.sm }} disabled={busy} onPress={() => act(() => board.unlock(base), 'Unlocked')} />
          ) : null}
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>Home the table before the first pattern after powering on.</Text>
        </Card>

        <Card>
          <CardTitle>Move Ball</CardTitle>
          <View style={styles.tileRow}>
            <ActionTile icon="center-focus-strong" label="Center" disabled={busy || !canPosition} onPress={() => act(() => board.moveToCenter(base), 'Moving to center')} />
            <ActionTile icon="trip-origin" label="Perimeter" disabled={busy || !canPosition} onPress={() => act(() => board.moveToPerimeter(base), 'Moving to perimeter')} />
          </View>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>Position the ball between patterns. Needs an idle, homed table.</Text>
        </Card>

        <Card>
          <CardTitle>Clear Sand</CardTitle>
          <View style={styles.tileRow}>
            {CLEAR_ACTIONS.map((c) => (
              <ActionTile key={c.file} icon={c.icon} label={c.label} disabled={busy || !canPosition} onPress={() => act(() => board.runPattern(base, c.file), c.toast)} />
            ))}
          </View>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>Erase the current pattern with a clearing sweep.</Text>
        </Card>

        <Card>
          <CardTitle>Speed Control</CardTitle>
          <SpeedControl
            value={status?.speed ?? 50}
            feedOverride={status?.feedOverride ?? 100}
            onCommit={(v) => board.setFeedLive(base, v).then(() => setTimeout(refreshStatus, 350)).catch(() => {})}
          />
        </Card>
      </ScrollView>
    </Screen>
  )
}

function ActionTile({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  const colors = useTheme((s) => s.colors)
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.tile, { backgroundColor: colors.cardElevated, borderColor: colors.border, opacity: disabled ? 0.45 : pressed ? 0.8 : 1 }]}
    >
      <MaterialIcons name={icon} size={24} color={colors.foreground} />
      <Text style={{ color: colors.foreground, fontSize: font.size.xs, fontWeight: font.weight.medium }}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  tileRow: { flexDirection: 'row', gap: spacing.sm },
  tile: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, height: 72, borderRadius: radius.md, borderWidth: 1 },
  hint: { fontSize: font.size.xs, marginTop: spacing.md },
})
