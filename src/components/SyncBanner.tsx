import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { useNavigation, type NavigationProp } from '@react-navigation/native'
import { useTheme } from '../stores/useTheme'
import { backgroundLine, stageLabel, useHubSync } from '../lib/patternHub'
import type { TabParamList } from '../navigation'
import { spacing, font, radius } from '../theme'

/**
 * A Pattern Hub sync's progress on every screen while it runs (Screen renders it;
 * the hub tab's own panel shows it there). A tap opens the hub tab, where Stop is.
 */
export function SyncBanner(): React.ReactElement | null {
  const progress = useHubSync((s) => s.progress)
  const receiving = useHubSync((s) => !!s.receiving)
  const colors = useTheme((s) => s.colors)
  const navigation = useNavigation<NavigationProp<TabParamList>>()
  if (!progress) return null
  const pct = Math.round(progress.fraction * 100)
  const bg = progress.since != null
  const line = bg ? backgroundLine(progress) : `${stageLabel(progress.stage)} ${progress.index} of ${progress.total} · ${progress.title}`
  return (
    <Pressable
      onPress={() => navigation.navigate('Browse', { tab: 'hub' })}
      accessibilityRole="button"
      accessibilityLabel={`${line}${bg ? '' : `, ${pct}%`}. Open Pattern Hub`}
      style={({ pressed }) => [styles.banner, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
    >
      <MaterialIcons name={progress.stage === 'phone' ? 'download' : 'cloud-upload'} size={18} color={colors.mutedForeground} />
      <View style={{ flex: 1, gap: spacing.xs }}>
        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: font.size.sm }}>
          {line}
        </Text>
        {receiving ? (
          <Text numberOfLines={2} style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>
            The table can’t do anything else until this is done.
          </Text>
        ) : null}
        {bg ? null : (
          <View style={[styles.track, { backgroundColor: colors.border }]}>
            <View style={[styles.fill, { width: `${pct}%`, backgroundColor: colors.primary }]} />
          </View>
        )}
      </View>
      {bg ? null : <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, fontFamily: font.family.mono }}>{pct}%</Text>}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.lg,
  },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
})
