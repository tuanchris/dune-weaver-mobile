import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { useNavigation } from '@react-navigation/native'
import { usePrefs } from '../stores/usePrefs'
import { useTheme } from '../stores/useTheme'
import { IconButton } from './ui'
import type { TabNav } from '../navigation'
import { radius, spacing, font } from '../theme'

/**
 * Browse header nudge: some patterns on the table render as a blank placeholder
 * because the app has neither a local .thr nor a preview image for them (the
 * bulk-loaded card case). Opens Settings › Patterns ("Pattern previews"), which is the
 * only place a sync can be started — preview sync is deliberately MANUAL (see
 * lib/previewSync.ts), so the banner ASKS rather than syncing on its own.
 *
 * Dismissal is sticky and persisted: it re-appears only if MORE patterns end up
 * without a thumbnail (a new batch on the card), not after a partial sync.
 */
export function MissingPreviewsBanner({ missing }: { missing: number }) {
  const colors = useTheme((s) => s.colors)
  const dismissedAt = usePrefs((s) => s.previewNagDismissedCount)
  const dismiss = usePrefs((s) => s.dismissPreviewNag)
  const navigation = useNavigation<TabNav>()

  if (missing <= 0 || missing <= dismissedAt) return null

  return (
    <Pressable
      onPress={() => navigation.navigate('Settings', { screen: 'Patterns', initial: false })}
      accessibilityRole="button"
      accessibilityLabel={`${missing} patterns have no thumbnail. Open pattern previews in Settings`}
      style={({ pressed }) => [
        styles.wrap,
        { backgroundColor: colors.cardElevated, borderColor: colors.border, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      {/* Sand = a user action, per the palette rules — this row is a button. */}
      <MaterialIcons name="image-not-supported" size={22} color={colors.primary} />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {missing} pattern{missing === 1 ? '' : 's'} without a thumbnail
        </Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          Tap to open Settings and sync previews from the table.
        </Text>
      </View>
      {/* Nested Pressable — wins the touch over the row, like the grid's heart badge. */}
      <IconButton
        icon="close"
        label="Dismiss preview reminder"
        size={20}
        color={colors.mutedForeground}
        onPress={() => dismiss(missing)}
      />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
    marginBottom: spacing.md,
  },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: font.size.sm, fontWeight: font.weight.semibold },
  body: { fontSize: font.size.xs },
})
