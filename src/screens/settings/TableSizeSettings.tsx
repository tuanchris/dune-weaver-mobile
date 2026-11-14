import React, { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { useBoards } from '../../stores/useBoards'
import { useTheme } from '../../stores/useTheme'
import { MODELS, modelOf, roundSize } from '../../lib/tableSize'
import { Card } from '../../components/ui'
import { CREATE_TEXT } from '../../components/TextGenerator'
import { SettingsPage } from './SettingsPage'
import { font, radius, spacing } from '../../theme'

/**
 * A round table's size (lib/tableSize.ts): its model's, from the config name the
 * table reports, or set by hand. Stored on this phone, per table. Create sizes its
 * patterns by it: the raking's spacing, the gap kept round finished letters, and when
 * letters get too small to read.
 */
export function TableSizeSettings(): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const active = useBoards((s) => s.getActive())
  const setSize = useBoards((s) => s.setSize)
  const size = roundSize(active)
  const model = modelOf(active?.model)
  const preset = active?.size ? MODELS.find((m) => m.diameter === active.size?.diameter && m.ball === active.size?.ball) : undefined
  const [custom, setCustom] = useState(!!active?.size && !preset)
  const [diameter, setDiameter] = useState(String(size.diameter))
  const [ball, setBall] = useState(String(size.ball))
  if (!active) return <SettingsPage title="Table size">{null}</SettingsPage>

  const choose = (s: { diameter: number; ball: number } | null) => {
    setCustom(false)
    setSize(active.id, s)
    const next = s ?? roundSize({ ...active, size: undefined })
    setDiameter(String(next.diameter))
    setBall(String(next.ball))
  }
  // Typed sizes save when the field is left, and only when they make sense.
  const commit = () => {
    const d = Number(diameter)
    const b = Number(ball)
    if (d >= 100 && d <= 3000 && b >= 3 && b <= 40) setSize(active.id, { diameter: Math.round(d), ball: Math.round(b * 10) / 10 })
    else {
      setDiameter(String(size.diameter))
      setBall(String(size.ball))
    }
  }

  const said = active.model
    ? `The table reports “${active.model}”${model ? `: a ${model.label}.` : ', a model the app doesn’t know, so it’s taken for a DW Pro.'}`
    : 'The table hasn’t said which model it is yet. It does once it’s connected and idle.'
  const Row = ({ label, detail, on, onPress }: { label: string; detail: string; on: boolean; onPress: () => void }) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      style={({ pressed }) => [styles.row, { borderColor: on ? colors.primary : colors.border, backgroundColor: pressed ? colors.cardElevated : 'transparent' }]}
    >
      <View style={styles.flex}>
        <Text style={[styles.rowText, { color: colors.foreground }]}>{label}</Text>
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>{detail}</Text>
      </View>
      {on ? <MaterialIcons name="check-circle" size={22} color={colors.primary} /> : null}
    </Pressable>
  )
  const fromTable = model ?? MODELS[2]

  return (
    <SettingsPage title="Table size" table>
      <Card style={styles.card}>
        <Text style={[styles.body, { color: colors.foreground }]}>
          {CREATE_TEXT ? 'Create sizes text for the table: how closely it rakes, the gap it keeps round finished letters, and when letters get too small to read. ' : ''}
          Sand previews are simulated on a table this size, and the Pattern Hub picks the version of each pattern made for it: a DW Gold, or any size
          between a Mini Pro and a Pro, takes the DW Pro ones unless you switch them in the hub.
        </Text>
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>{said}</Text>
        <Row label="From the table" detail={`${fromTable.label}: ${fromTable.diameter} mm of sand, ${fromTable.ball} mm ball`} on={!active.size && !custom} onPress={() => choose(null)} />
        {MODELS.map((m) => (
          <Row key={m.id} label={m.label} detail={`${m.diameter} mm of sand, ${m.ball} mm ball`} on={!custom && preset?.id === m.id} onPress={() => choose({ diameter: m.diameter, ball: m.ball })} />
        ))}
        <Row label="Custom" detail="Your own build" on={custom} onPress={() => setCustom(true)} />
        {custom ? (
          <View style={styles.fields}>
            <View style={styles.flex}>
              <Text style={[styles.label, { color: colors.foreground }]}>Sand diameter (mm)</Text>
              <TextInput
                value={diameter}
                onChangeText={setDiameter}
                onBlur={commit}
                keyboardType="number-pad"
                returnKeyType="done"
                accessibilityLabel="Sand diameter in millimetres"
                style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground }]}
              />
            </View>
            <View style={styles.flex}>
              <Text style={[styles.label, { color: colors.foreground }]}>Ball (mm)</Text>
              <TextInput
                value={ball}
                onChangeText={setBall}
                onBlur={commit}
                keyboardType="decimal-pad"
                returnKeyType="done"
                accessibilityLabel="Ball diameter in millimetres"
                style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground }]}
              />
            </View>
          </View>
        ) : null}
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>Stored on this phone, for this table.</Text>
      </Card>
    </SettingsPage>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: spacing.sm },
  body: { fontSize: font.size.md },
  hint: { fontSize: font.size.sm },
  rowText: { fontSize: font.size.md, fontWeight: font.weight.medium },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.lg, borderWidth: 1 },
  fields: { flexDirection: 'row', gap: spacing.md },
  label: { fontSize: font.size.sm, marginBottom: spacing.xs },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 46, fontSize: font.size.md },
})
