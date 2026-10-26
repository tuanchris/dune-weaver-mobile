import React, { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TextInput, View, Pressable } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { board } from '../api/board'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { toast } from '../stores/useToast'
import { userMessage } from '../lib/errors'
import { Button, Card, IconButton, Segmented, Toggle } from './ui'
import { devicePosixTz } from '../lib/clock'
import {
  DAYS,
  DAY_LABELS,
  DEFAULT_SLOT,
  normalizeTime,
  parseSlots,
  serializeSlots,
  type DayPreset,
  type QuietSlot,
} from '../lib/quietSlots'
import { radius, spacing, font } from '../theme'

const isOn = (v?: string) => (v ?? '').toUpperCase() === 'ON' || v === '1'

const PRESETS: { value: DayPreset; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekends', label: 'Weekends' },
  { value: 'custom', label: 'Custom' },
]

/** Settings › Still Sands: the quiet-hours editor (mirroring dw) + the table clock it runs on. */
export function StillSands({ base }: { base: string }) {
  const colors = useTheme((s) => s.colors)
  const clock = useStatus((s) => s.status?.clock ?? null)
  const refresh = useStatus((s) => s.refresh)

  const [enabled, setEnabled] = useState(false)
  const [ledOff, setLedOff] = useState(false)
  const [finish, setFinish] = useState(true)
  const [slots, setSlots] = useState<QuietSlot[]>([])
  const [dirty, setDirty] = useState(false)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    let cancelled = false
    board
      .settings(base)
      .then((s) => {
        if (cancelled) return
        setEnabled(isOn(s['Sands/Enabled']))
        setLedOff(isOn(s['Sands/LedOff']))
        setFinish(s['Sands/FinishPattern'] == null ? true : isOn(s['Sands/FinishPattern']))
        setSlots(parseSlots(s['Sands/Slots'] ?? ''))
        setDirty(false)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [base])

  const apply = (fn: () => Promise<void>) => {
    fn().catch((e) => toast.error(userMessage(e, 'save Still Sands')))
  }

  const syncNow = () => {
    setSyncing(true)
    board
      .syncTime(base, { epoch: Math.floor(Date.now() / 1000), tz: devicePosixTz() })
      .then(() => {
        toast.success('Clock synced')
        setTimeout(refresh, 400)
      })
      .catch(() => toast.error('Could not sync clock'))
      .finally(() => setSyncing(false))
  }

  // --- slot editing (local; committed to the firmware with "Save schedule") ---
  const addSlot = () => {
    setSlots((s) => [...s, { ...DEFAULT_SLOT }])
    setDirty(true)
  }
  const removeSlot = (i: number) => {
    setSlots((s) => s.filter((_, idx) => idx !== i))
    setDirty(true)
  }
  const updateSlot = (i: number, patch: Partial<QuietSlot>) => {
    setSlots((s) => s.map((sl, idx) => (idx === i ? { ...sl, ...patch } : sl)))
    setDirty(true)
  }
  const toggleCustomDay = (i: number, day: string) => {
    setSlots((s) =>
      s.map((sl, idx) => {
        if (idx !== i) return sl
        const has = sl.customDays.includes(day)
        return { ...sl, customDays: has ? sl.customDays.filter((d) => d !== day) : [...sl.customDays, day] }
      })
    )
    setDirty(true)
  }
  const saveSlots = () => {
    apply(() => board.setQuietSlots(base, serializeSlots(slots)).then(() => { setDirty(false); toast.success('Schedule saved') }))
  }

  const synced = clock?.synced ?? true
  // "2026-10-25 12:07:36" -> "12:07": the date and seconds are noise here.
  const clockTime = clock?.local.match(/\d{1,2}:\d{2}/)?.[0] ?? clock?.local

  return (
    <Card>
      <View style={styles.row}>
        <View style={{ flex: 1, paddingRight: spacing.md }}>
          <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>Still Sands</Text>
          <Text style={[styles.desc, { color: colors.mutedForeground }]}>Pause the table at set times.</Text>
        </View>
        <Toggle value={enabled} onValueChange={(v) => { setEnabled(v); apply(() => board.setQuietEnabled(base, v)) }} />
      </View>

      {enabled ? (
        <>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.row}>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Text style={{ color: colors.foreground }}>Finish current pattern</Text>
              <Text style={[styles.desc, { color: colors.mutedForeground }]}>Let the pattern complete before going still.</Text>
            </View>
            <Toggle value={finish} onValueChange={(v) => { setFinish(v); apply(() => board.setQuietFinishPattern(base, v)) }} />
          </View>
          <View style={styles.row}>
            <Text style={{ flex: 1, color: colors.foreground }}>Turn off LEDs</Text>
            <Toggle value={ledOff} onValueChange={(v) => { setLedOff(v); apply(() => board.setQuietLedOff(base, v)) }} />
          </View>
          {/* The schedule runs on the table's clock, and nothing else reads it, so it lives here. */}
          <View style={styles.row}>
            <Text style={{ flex: 1, color: colors.foreground }}>Table clock</Text>
            <Text style={{ color: synced ? colors.mutedForeground : colors.destructive, fontFamily: font.family.mono, fontSize: font.size.md }}>
              {!clock ? '—' : synced ? clockTime : 'Not set'}
            </Text>
            {syncing ? (
              <ActivityIndicator color={colors.primary} style={styles.syncSlot} />
            ) : (
              <IconButton icon="sync" size={20} color={colors.primary} label="Sync the table clock to this device" onPress={syncNow} />
            )}
          </View>
          {!synced ? (
            <Text style={[styles.desc, { color: colors.destructive }]}>
              The table’s clock isn’t set, so Still Sands won’t run. Tap sync to set it from this device.
            </Text>
          ) : null}

          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          {slots.map((slot, i) => (
            <View key={i} style={[styles.period, i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }]}>
              <View style={styles.timeRow}>
                <TimeField value={slot.start} label="From" onChange={(t) => updateSlot(i, { start: t })} />
                <MaterialIcons name="arrow-forward" size={16} color={colors.mutedForeground} />
                <TimeField value={slot.end} label="To" onChange={(t) => updateSlot(i, { end: t })} />
                {/* Replaces the old "end before start spans midnight" footnote, in place. */}
                <Text numberOfLines={1} style={[styles.desc, { flex: 1, color: colors.mutedForeground }]}>
                  {slot.end < slot.start ? 'next day' : ''}
                </Text>
                <IconButton icon="delete-outline" size={20} color={colors.mutedForeground} label="Remove period" onPress={() => removeSlot(i)} />
              </View>
              <Segmented fill value={slot.days} options={PRESETS} onChange={(days) => updateSlot(i, { days })} />
              {slot.days === 'custom' ? (
                <View style={styles.dayRow}>
                  {DAYS.map((d) => {
                    const on = slot.customDays.includes(d)
                    return (
                      <Pressable
                        key={d}
                        onPress={() => toggleCustomDay(i, d)}
                        hitSlop={4}
                        accessibilityRole="button"
                        accessibilityState={{ selected: on }}
                        style={[styles.day, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : 'transparent' }]}
                      >
                        <Text numberOfLines={1} style={{ color: on ? colors.primaryForeground : colors.foreground, fontSize: font.size.sm, fontWeight: font.weight.medium }}>
                          {DAY_LABELS[d]}
                        </Text>
                      </Pressable>
                    )
                  })}
                </View>
              ) : null}
            </View>
          ))}

          <View style={styles.actions}>
            <Button title="Add period" icon="add" variant="ghost" onPress={addSlot} />
            {dirty ? <Button title="Save schedule" icon="check" onPress={saveSlots} /> : null}
          </View>
        </>
      ) : null}
    </Card>
  )
}

/** Compact HH:MM field, normalized on blur. */
function TimeField({ value, label, onChange }: { value: string; label: string; onChange: (v: string) => void }) {
  const colors = useTheme((s) => s.colors)
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <TextInput
      value={text}
      onChangeText={(t) => setText(t.replace(/[^0-9:]/g, '').slice(0, 5))}
      // onBlur, not onEndEditing: react-native-web (desktop) never fires onEndEditing.
      onBlur={() => {
        const n = normalizeTime(text)
        if (n) onChange(n)
        else setText(value)
      }}
      keyboardType="numbers-and-punctuation"
      placeholder="HH:MM"
      placeholderTextColor={colors.mutedForeground}
      accessibilityLabel={label}
      style={[styles.timeInput, { color: colors.foreground, backgroundColor: colors.inputBackground, borderColor: colors.border }]}
    />
  )
}

const styles = StyleSheet.create({
  // Every control row shares one height, so toggles, the clock and the header line up.
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  desc: { fontSize: font.size.sm },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.sm },
  syncSlot: { width: 28 },
  period: { gap: spacing.sm, paddingVertical: spacing.sm },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  timeInput: { width: 76, minHeight: 40, paddingVertical: 0, borderRadius: radius.pill, borderWidth: 1, fontFamily: font.family.monoMedium, fontSize: font.size.md, textAlign: 'center' },
  dayRow: { flexDirection: 'row', gap: spacing.xs },
  day: { flex: 1, minHeight: 36, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  actions: { gap: spacing.sm, marginTop: spacing.sm },
})
