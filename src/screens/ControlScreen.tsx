import React, { useCallback, useEffect, useState } from 'react'
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { board } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { toast } from '../stores/useToast'
import { Button, Card, CardTitle } from '../components/ui'
import { Screen } from '../components/Screen'
import { radius, spacing, font } from '../theme'

export function ControlScreen() {
  const colors = useTheme((s) => s.colors)
  const base = useBoards((s) => s.getActiveBase())
  const status = useStatus((s) => s.status)
  const refreshStatus = useStatus((s) => s.refresh)
  const [speed, setSpeed] = useState('')
  const [busy, setBusy] = useState(false)

  // Quiet-hours ("Still Sands") state, seeded from /sand_settings.
  const [quietEnabled, setQuietEnabled] = useState(false)
  const [quietSlots, setQuietSlots] = useState('')

  const loadSettings = useCallback(async () => {
    if (!base) return
    try {
      const s = await board.settings(base)
      setQuietEnabled((s['Sands/Enabled'] ?? '').toUpperCase() === 'ON' || s['Sands/Enabled'] === '1')
      setQuietSlots(s['Sands/Slots'] ?? '')
    } catch {
      // leave defaults
    }
  }, [base])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const act = async (fn: () => Promise<void>, msg: string) => {
    if (!base) return
    setBusy(true)
    try {
      await fn()
      toast.success(msg)
      setTimeout(refreshStatus, 400)
    } catch {
      toast.error('Action failed')
    } finally {
      setBusy(false)
    }
  }

  const submitSpeed = () => {
    const n = parseInt(speed, 10)
    if (isNaN(n) || n < 10 || n > 6000) {
      toast.error('Speed must be 10–6000 mm/min')
      return
    }
    act(() => board.setFeed(base!, n), `Speed set to ${n} mm/min`)
    setSpeed('')
  }

  const toggleQuiet = (on: boolean) => {
    setQuietEnabled(on)
    act(() => board.setQuietEnabled(base!, on), on ? 'Quiet hours on' : 'Quiet hours off')
  }

  const saveSlots = () => {
    act(() => board.setQuietSlots(base!, quietSlots.trim()), 'Quiet hours saved')
  }

  if (!base) {
    return (
      <Screen>
        <View style={{ padding: spacing.xl }}>
          <Text style={{ color: colors.mutedForeground }}>No table connected. Add one in Settings.</Text>
        </View>
      </Screen>
    )
  }

  const isAlarm = status?.state === 'Alarm'

  return (
    <Screen title="Table Control">
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 160, gap: spacing.lg }}>
        <Card>
          <CardTitle>Movement Controls</CardTitle>
          <View style={styles.row}>
            <Button title="Home" icon="home" variant="secondary" flex disabled={busy} onPress={() => act(() => board.home(base), 'Homing')} />
            <Button title="Stop" icon="stop" variant="destructive" flex disabled={busy} onPress={() => act(() => board.stop(base), 'Stopped')} />
          </View>
          {isAlarm ? (
            <Button title="Unlock (clear alarm)" icon="lock-open" variant="secondary" style={{ marginTop: spacing.sm }} disabled={busy} onPress={() => act(() => board.unlock(base), 'Unlocked')} />
          ) : null}
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>Home the table before the first pattern after powering on.</Text>
        </Card>

        <Card>
          <CardTitle>Speed Control</CardTitle>
          <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, marginBottom: spacing.sm }}>
            Current: <Text style={{ color: colors.foreground, fontWeight: font.weight.semibold }}>{status ? `${status.speed} mm/min` : '—'}</Text>
            {status && status.feedOverride !== 100 ? ` (${status.feedOverride}%)` : ''}
          </Text>
          <View style={styles.row}>
            <TextInput
              value={speed}
              onChangeText={setSpeed}
              keyboardType="number-pad"
              placeholder="Enter new speed…"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground }]}
            />
            <Button title="Set Speed" icon="speed" disabled={busy} onPress={submitSpeed} />
          </View>
          <View style={[styles.row, { marginTop: spacing.md }]}>
            <Button title="−" variant="secondary" flex disabled={busy} onPress={() => act(() => board.feedAdjust(base, 'down'), 'Slower')} />
            <Button title="Reset" variant="secondary" flex disabled={busy} onPress={() => act(() => board.feedAdjust(base, 'reset'), 'Speed reset')} />
            <Button title="+" variant="secondary" flex disabled={busy} onPress={() => act(() => board.feedAdjust(base, 'up'), 'Faster')} />
          </View>
        </Card>

        <Card>
          <View style={styles.quietHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: colors.foreground, marginBottom: 2 }]}>Quiet hours</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>“Still Sands” — pauses motion on a schedule.</Text>
            </View>
            <Switch value={quietEnabled} onValueChange={toggleQuiet} disabled={busy} />
          </View>
          <View style={[styles.row, { marginTop: spacing.md }]}>
            <TextInput
              value={quietSlots}
              onChangeText={setQuietSlots}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="21:00-08:00@daily"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground }]}
            />
            <Button title="Save" variant="secondary" disabled={busy} onPress={saveSlots} />
          </View>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>Format: HH:MM-HH:MM@days (e.g. @daily, @mon,tue). Needs the table’s clock set.</Text>
        </Card>

        <Card>
          <CardTitle>Live status</CardTitle>
          <Readout label="State" value={status ? (status.isQuiet ? `${status.state} · quiet` : status.state) : '—'} />
          <Readout label="Feed" value={status ? `${status.speed} mm/min (${status.feedOverride}%)` : '—'} />
          <Readout label="Theta" value={status ? `${status.theta.toFixed(2)} rad` : '—'} />
          <Readout label="Rho" value={status ? status.rho.toFixed(3) : '—'} />
          <Readout label="Progress" value={status?.isClearing ? 'Clearing…' : status?.percentage != null ? `${status.percentage}%` : '—'} />
          {status?.led ? <Readout label="LED" value={`${status.led.effect} · ${status.led.brightness}`} /> : null}
        </Card>
      </ScrollView>
    </Screen>
  )
}

function Readout({ label, value }: { label: string; value: string }) {
  const colors = useTheme((s) => s.colors)
  return (
    <View style={styles.readout}>
      <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>{label}</Text>
      <Text style={{ color: colors.foreground, fontSize: font.size.sm, fontWeight: font.weight.medium }}>{value}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  cardTitle: { fontSize: font.size.md, fontWeight: font.weight.semibold, marginBottom: spacing.md },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  hint: { fontSize: font.size.xs, marginTop: spacing.md },
  input: { flex: 1, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 46, fontSize: font.size.md },
  readout: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  quietHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
})
