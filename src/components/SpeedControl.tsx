import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../stores/useTheme'
import { Slider } from './ui'
import { spacing, font } from '../theme'

/**
 * Speed (feed-rate) slider with its live readout. The label shows the value
 * being dragged and holds it briefly after release so it doesn't snap back to a
 * stale board value before the next status poll lands. `onCommit` fires only on
 * release, so we don't spam the firmware mid-drag. Shared by Control + Now Playing.
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
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (holdRef.current) clearTimeout(holdRef.current) }, [])

  return (
    <>
      <View style={styles.header}>
        <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>Speed</Text>
        <Text style={{ color: colors.foreground, fontFamily: font.family.monoMedium, fontSize: font.size.sm }}>
          {drag ?? value} mm/min{feedOverride !== 100 ? ` · ${feedOverride}%` : ''}
        </Text>
      </View>
      <Slider
        value={drag ?? value}
        min={50}
        max={500}
        step={50}
        onChange={(v) => {
          if (holdRef.current) clearTimeout(holdRef.current)
          setDrag(v)
        }}
        onComplete={(v) => {
          setDrag(v)
          onCommit(v)
          if (holdRef.current) clearTimeout(holdRef.current)
          holdRef.current = setTimeout(() => setDrag(null), 1200)
        }}
      />
    </>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
})
