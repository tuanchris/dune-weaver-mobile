import React, { useEffect, useRef, useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useTheme } from '../stores/useTheme'
import { Slider } from './ui'
import { radius, spacing, font } from '../theme'

/** The speed range the control offers. The firmware takes 0..100000, but the
 * slider has always declared 50..500 as the supported band, so typed values
 * clamp to the same one — typing is here for PRECISION (the slider steps by 50,
 * so 275 was unreachable), not to quietly widen the range. */
const MIN = 50
const MAX = 500

/**
 * Speed (feed-rate) slider with its live readout. The label shows the value
 * being dragged and holds it briefly after release so it doesn't snap back to a
 * stale board value before the next status poll lands. `onCommit` fires only on
 * release, so we don't spam the firmware mid-drag. Shared by Control + Now Playing.
 *
 * The readout is also TAPPABLE: it turns into a number field so an exact feed
 * can be typed instead of dragged onto a multiple of the step.
 */
export function SpeedControl({
  value,
  feedOverride,
  onCommit,
}: {
  value: number
  feedOverride: number
  onCommit: (v: number) => void
}) {
  const colors = useTheme((s) => s.colors)
  const [drag, setDrag] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (holdRef.current) clearTimeout(holdRef.current) }, [])

  const shown = drag ?? value

  /** Hold the just-set value on screen until the board's status catches up. */
  const holdThen = (v: number) => {
    setDrag(v)
    onCommit(v)
    if (holdRef.current) clearTimeout(holdRef.current)
    holdRef.current = setTimeout(() => setDrag(null), 1200)
  }

  const startEdit = () => {
    setText(String(shown))
    setEditing(true)
  }

  const commitEdit = () => {
    setEditing(false)
    const n = parseInt(text, 10)
    // Unparseable or unchanged: leave the board alone rather than committing a
    // guess — an empty field should cancel, not set the speed to the minimum.
    if (!Number.isFinite(n)) return
    const clamped = Math.min(MAX, Math.max(MIN, n))
    if (clamped === value) return
    holdThen(clamped)
  }

  return (
    <>
      <View style={styles.header}>
        <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>Speed</Text>
        {editing ? (
          <View style={styles.editRow}>
            <TextInput
              value={text}
              onChangeText={(t) => setText(t.replace(/[^0-9]/g, ''))}
              onSubmitEditing={commitEdit}
              onBlur={commitEdit}
              autoFocus
              selectTextOnFocus
              keyboardType="number-pad"
              returnKeyType="done"
              maxLength={6}
              accessibilityLabel="Speed in mm per minute"
              style={[
                styles.input,
                { color: colors.foreground, backgroundColor: colors.inputBackground, borderColor: colors.primary },
              ]}
            />
            <Text style={{ color: colors.mutedForeground, fontFamily: font.family.monoMedium, fontSize: font.size.sm }}>
              mm/min
            </Text>
          </View>
        ) : (
          <Pressable
            onPress={startEdit}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Speed ${shown} mm per minute, tap to type an exact value`}
            style={({ pressed }) => [styles.readout, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={{ color: colors.foreground, fontFamily: font.family.monoMedium, fontSize: font.size.sm }}>
              {shown} mm/min{feedOverride !== 100 ? ` · ${feedOverride}%` : ''}
            </Text>
          </Pressable>
        )}
      </View>
      <Slider
        value={shown}
        min={MIN}
        max={MAX}
        step={50}
        onChange={(v) => {
          if (holdRef.current) clearTimeout(holdRef.current)
          setDrag(v)
        }}
        onComplete={holdThen}
      />
    </>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  readout: { paddingVertical: 2 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  input: {
    minWidth: 64,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    textAlign: 'right',
    fontFamily: font.family.monoMedium,
    fontSize: font.size.sm,
  },
})
