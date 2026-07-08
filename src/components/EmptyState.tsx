import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { useTheme } from '../stores/useTheme'
import { spacing } from '../theme'

/** Centered icon + muted message — the shared "nothing here" / "no table" view. */
export function EmptyState({ icon, text }: { icon: keyof typeof MaterialIcons.glyphMap; text: string }) {
  const colors = useTheme((s) => s.colors)
  return (
    <View style={styles.empty}>
      <MaterialIcons name={icon} size={40} color={colors.mutedForeground} />
      <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm, textAlign: 'center' }}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, width: '100%' },
})
