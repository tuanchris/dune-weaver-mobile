import React, { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { board } from '../../api/board'
import { isSettingsLocked } from '../../api/status'
import { useStatus } from '../../stores/useStatus'
import { useTheme } from '../../stores/useTheme'
import { toast } from '../../stores/useToast'
import { Card } from '../../components/ui'
import { AlignOrientation } from '../../components/AlignOrientation'
import { SettingsPage, useActiveBase } from './SettingsPage'
import { radius, spacing, font } from '../../theme'

// Homing modes the firmware exposes via $Sand/HomingMode (mirrors dw).
const HOMING_MODES: { mode: 'crash' | 'sensor'; label: string; desc: string }[] = [
  { mode: 'crash', label: 'Crash homing', desc: 'Y axis moves until a physical stop, then theta and rho are set to 0.' },
  { mode: 'sensor', label: 'Sensor homing', desc: 'Homes both X and Y axes using sensors.' },
]

export function HomingSettings(): React.JSX.Element {
  const base = useActiveBase()
  return (
    <SettingsPage title="Homing" table gated>
      {base ? <HomingCard base={base} /> : null}
    </SettingsPage>
  )
}

function HomingCard({ base }: { base: string }): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  // Homing mode ($Sand/HomingMode) + sensor offset ($Sand/ThetaOffset, degrees).
  const [homingMode, setHomingMode] = useState<'crash' | 'sensor'>('sensor')
  const [thetaOffset, setThetaOffset] = useState('0')
  // Homing MODE + sensor offset are consulted at home time only, and resuming a
  // paused job never re-homes — so firmware >= SETTINGS_IN_HOLD_MIN_FW takes
  // these writes during a pause like the other settings (holdOk in the
  // firmware's SettingsDefinitions.cpp).
  const homingWritable = useStatus((s) => !isSettingsLocked(s.status))
  // ALIGNING the orientation is different: it jogs via /sand_goto, and
  // SandApi::goTo requires a true Idle (it 409s in Hold, which the sheet would
  // retry against forever). So that one stays strictly idle-gated.
  const tableIdle = useStatus((s) => (s.status?.state ?? 'Idle') === 'Idle')

  const load = useCallback(async () => {
    try {
      const s = await board.settings(base)
      setHomingMode((s['Sand/HomingMode'] ?? 'sensor').toLowerCase() === 'crash' ? 'crash' : 'sensor')
      setThetaOffset(String(parseInt(s['Sand/ThetaOffset'] ?? '0', 10) || 0))
    } catch {
      // keep whatever we had
    }
  }, [base])
  useEffect(() => {
    load()
  }, [load])

  // Optimistic; revert + reload on rejection.
  const changeHomingMode = (mode: 'crash' | 'sensor') => {
    if (mode === homingMode) return
    const prev = homingMode
    setHomingMode(mode)
    board.setHomingMode(base, mode).catch(() => {
      toast.error(homingWritable ? 'Could not save homing mode' : 'Pause or stop the table to change the homing mode')
      setHomingMode(prev)
      load()
    })
  }
  const commitThetaOffset = () => {
    const deg = (((Math.round(Number(thetaOffset) || 0)) % 360) + 360) % 360 // 0..359
    setThetaOffset(String(deg))
    board.setThetaOffset(base, deg).catch(() => {
      toast.error(homingWritable ? 'Could not save sensor offset' : 'Pause or stop the table to change the sensor offset')
      load()
    })
  }

  return (
    <Card>
      <Text style={[styles.label, { color: colors.foreground, marginTop: 0 }]}>Homing mode</Text>
      {HOMING_MODES.map(({ mode, label, desc }) => {
        const on = homingMode === mode
        return (
          <Pressable
            key={mode}
            onPress={() => changeHomingMode(mode)}
            disabled={!homingWritable}
            style={[styles.option, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.cardElevated : 'transparent', opacity: homingWritable ? 1 : 0.5 }]}
          >
            <MaterialIcons name={on ? 'radio-button-checked' : 'radio-button-unchecked'} size={20} color={on ? colors.primary : colors.mutedForeground} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>{label}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>{desc}</Text>
            </View>
          </Pressable>
        )
      })}

      {homingMode === 'crash' ? (
        <View style={{ marginTop: spacing.sm, opacity: tableIdle ? 1 : 0.5 }} pointerEvents={tableIdle ? 'auto' : 'none'}>
          <AlignOrientation base={base} />
          {!tableIdle ? (
            <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, marginTop: spacing.xs }}>
              Aligning moves the ball, so it needs the table stopped — not just paused.
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={{ marginTop: spacing.sm }}>
          <Text style={[styles.label, { color: colors.foreground }]}>Sensor offset (degrees)</Text>
          <TextInput
            value={thetaOffset}
            onChangeText={(t) => setThetaOffset(t.replace(/[^0-9]/g, ''))}
            // onBlur, not onEndEditing: react-native-web (desktop) never fires onEndEditing.
            onBlur={commitThetaOffset}
            editable={homingWritable}
            keyboardType="number-pad"
            style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground, opacity: homingWritable ? 1 : 0.5 }]}
          />
          <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, marginTop: spacing.sm }}>
            Angle the radial arm is offset by — pick a value so it points East.
          </Text>
        </View>
      )}

      {!homingWritable ? (
        <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, marginTop: spacing.sm }}>
          Pause or stop the table to change the homing mode or offset.
        </Text>
      ) : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  label: { fontSize: font.size.sm, fontWeight: font.weight.medium, marginBottom: spacing.sm, marginTop: spacing.sm },
  option: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.sm },
  input: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, minHeight: 46, fontSize: font.size.md },
})
