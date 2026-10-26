import React from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { FullWindowOverlay } from 'react-native-screens'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MaterialIcons } from '@expo/vector-icons'
import { useToast } from '../stores/useToast'
import { useTheme } from '../stores/useTheme'
import { radius, spacing, font } from '../theme'

export function Toaster() {
  const { message, type } = useToast()
  const colors = useTheme((s) => s.colors)
  const insets = useSafeAreaInsets()
  if (!message) return null

  const accent = type === 'error' ? colors.destructive : type === 'success' ? colors.success : colors.primary
  const icon = type === 'error' ? 'error-outline' : type === 'success' ? 'check-circle-outline' : 'info-outline'

  const content = (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + spacing.sm }]}>
      <View style={[styles.toast, { backgroundColor: colors.cardElevated, borderColor: accent }]}>
        <MaterialIcons name={icon as any} size={18} color={accent} />
        <Text style={[styles.text, { color: colors.foreground }]} numberOfLines={4}>
          {message}
        </Text>
      </View>
    </View>
  )
  // iOS: a native pageSheet/Modal is its own view controller and covers the root
  // view, so draw the toast in a window-level overlay above it (touches pass
  // through — pointerEvents none). The overlay is stacked when it MOUNTS (a sheet
  // presented later covers it), so remount it per toast (key) to land on top.
  return Platform.OS === 'ios' ? <FullWindowOverlay key={message}>{content}</FullWindowOverlay> : content
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 1000, paddingHorizontal: spacing.lg },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderLeftWidth: 3,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    maxWidth: 460,
  },
  text: { flex: 1, fontSize: font.size.sm, fontWeight: font.weight.medium },
})
