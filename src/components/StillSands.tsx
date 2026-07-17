import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TextInput, View, Pressable } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { board } from '../api/board'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { toast } from '../stores/useToast'
import { Button, Card, CardTitle, IconButton, Toggle } from './ui'
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

const PRESETS: [DayPreset, string][] = [
  ['daily', 'Every day'],
  ['weekdays', 'Weekdays'],
  ['weekends', 'Weekends'],
  ['custom', 'Custom'],
]

/** Table clock + the full Still Sands (quiet hours) editor, mirroring dw. */
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
    fn().catch(() => toast.error('Could not save'))
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

  return (
    <>
      {/* Table clock */}
      <Card>
        <CardTitle>Table clock</CardTitle>
        <View style={styles.clockRow}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontSize: font.size.lg, fontWeight: font.weight.semibold }}>
              {clock?.local || '—'}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>
              {clock ? `${clock.tz || 'no timezone'} · ${synced ? 'synced' : 'not set'}` : 'No clock reported'}
            </Text>
          </View>
          <Button title={syncing ? 'Syncing…' : 'Sync to device'} icon="sync" variant="secondary" loading={syncing} onPress={syncNow} />
        </View>
        {!synced ? (
          <Text style={[styles.hint, { color: colors.destructive }]}>
            The table clock isn’t set, so Still Sands won’t fire. The app syncs it on launch — tap “Sync to device” to set it now.
          </Text>
        ) : (
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>The app keeps this in sync with your phone on launch.</Text>
        )}
      </Card>

      {/* Still Sands */}
      <Card>
        <View style={styles.headRow}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <CardTitle>Still Sands</CardTitle>
            <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginTop: -spacing.sm }}>
              Pause the table during scheduled quiet periods.
            </Text>
          </View>
          <Toggle value={enabled} onValueChange={(v) => { setEnabled(v); apply(() => board.setQuietEnabled(base, v)) }} />
        </View>

        {enabled ? (
          <View style={{ marginTop: spacing.md, gap: spacing.md }}>
            <View style={styles.optRow}>
              <View style={{ flex: 1, paddingRight: spacing.md }}>
                <Text style={{ color: colors.foreground }}>Finish current pattern</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>Let the pattern complete before going still (off = pause mid-pattern).</Text>
              </View>
              <Toggle value={finish} onValueChange={(v) => { setFinish(v); apply(() => board.setQuietFinishPattern(base, v)) }} />
            </View>
            <View style={styles.optRow}>
              <View style={{ flex: 1, paddingRight: spacing.md }}>
                <Text style={{ color: colors.foreground }}>Turn off LEDs</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>Switch the LED ring off during quiet periods.</Text>
              </View>
              <Toggle value={ledOff} onValueChange={(v) => { setLedOff(v); apply(() => board.setQuietLedOff(base, v)) }} />
            </View>

            <View style={styles.headRow}>
              <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>Still periods</Text>
              <Button title="Add" icon="add" variant="secondary" onPress={addSlot} />
            </View>

            {slots.length === 0 ? (
              <Text style={[styles.hint, { color: colors.mutedForeground, textAlign: 'center', marginTop: 0 }]}>No periods yet. Tap “Add” to schedule one.</Text>
            ) : (
              slots.map((slot, i) => (
                <View key={i} style={[styles.slot, { borderColor: colors.border, backgroundColor: colors.cardElevated }]}>
                  <View style={styles.headRow}>
                    <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, fontWeight: font.weight.medium }}>Period {i + 1}</Text>
                    <IconButton icon="delete-outline" size={20} color={colors.destructive} onPress={() => removeSlot(i)} />
                  </View>
                  <View style={styles.timeRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginBottom: 4 }}>From</Text>
                      <TimeField value={slot.start} onChange={(t) => updateSlot(i, { start: t })} />
                    </View>
                    <MaterialIcons name="arrow-forward" size={18} color={colors.mutedForeground} style={{ marginTop: 18 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginBottom: 4 }}>To</Text>
                      <TimeField value={slot.end} onChange={(t) => updateSlot(i, { end: t })} />
                    </View>
                  </View>
                  <View style={styles.chipRow}>
                    {PRESETS.map(([val, label]) => {
                      const on = slot.days === val
                      return (
                        <Pressable
                          key={val}
                          onPress={() => updateSlot(i, { days: val })}
                          style={[styles.chip, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.card }]}
                        >
                          <Text style={{ color: on ? colors.primaryForeground : colors.foreground, fontSize: font.size.sm, fontWeight: font.weight.medium }}>{label}</Text>
                        </Pressable>
                      )
                    })}
                  </View>
                  {slot.days === 'custom' ? (
                    <View style={styles.chipRow}>
                      {DAYS.map((d) => {
                        const on = slot.customDays.includes(d)
                        return (
                          <Pressable
                            key={d}
                            onPress={() => toggleCustomDay(i, d)}
                            style={[styles.dayChip, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.card }]}
                          >
                            <Text style={{ color: on ? colors.primaryForeground : colors.foreground, fontSize: font.size.xs, fontWeight: font.weight.medium }}>{DAY_LABELS[d]}</Text>
                          </Pressable>
                        )
                      })}
                    </View>
                  ) : null}
                </View>
              ))
            )}

            {dirty ? <Button title="Save schedule" icon="check" onPress={saveSlots} /> : null}
            <Text style={[styles.hint, { color: colors.mutedForeground, marginTop: 0 }]}>A period whose end is before its start spans midnight. Needs the table clock set (above).</Text>
          </View>
        ) : null}
      </Card>
    </>
  )
}

/** HH:MM text field, normalized on blur. */
function TimeField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const colors = useTheme((s) => s.colors)
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  return (
    <TextInput
      value={text}
      onChangeText={(t) => setText(t.replace(/[^0-9:]/g, '').slice(0, 5))}
      onEndEditing={() => {
        const n = normalizeTime(text)
        if (n) onChange(n)
        else setText(value)
      }}
      keyboardType="numbers-and-punctuation"
      placeholder="HH:MM"
      placeholderTextColor={colors.mutedForeground}
      style={[styles.timeInput, { color: colors.foreground, backgroundColor: colors.inputBackground, borderColor: colors.border }]}
    />
  )
}

const styles = StyleSheet.create({
  clockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  optRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hint: { fontSize: font.size.xs, marginTop: spacing.md },
  slot: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.md },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  timeInput: { borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: spacing.md, height: 44, fontSize: font.size.md, fontWeight: font.weight.semibold, textAlign: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, justifyContent: 'center' },
  dayChip: { paddingVertical: spacing.xs, borderRadius: radius.pill, borderWidth: 1, minWidth: 44, alignItems: 'center' },
})
