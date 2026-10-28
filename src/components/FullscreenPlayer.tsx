import React from 'react'
import { Modal, Platform, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useTheme } from '../stores/useTheme'
import { font, spacing } from '../theme'
import { IconButton } from './ui'
import { useAspect } from './RectTable'

/**
 * A rectangular table's drawing, full screen and sideways: a wide pattern gets
 * the phone's whole length. `children` draws it at the width it's given (Browse:
 * the playback preview; the player: the live drawing). The app is portrait-only (no native
 * orientation module), so on an upright phone the content itself is laid out
 * landscape and turned 90° — turn the phone to the left to watch it, top of the
 * phone on the left. In a window that's already landscape (iPad, desktop) it
 * isn't turned.
 *
 * A Modal of its own, so it can't share the screen with a sheet: the caller
 * closes its sheet first and reopens it from `onDismissed`. Shown while `title`
 * is set.
 */
export function FullscreenPlayer({
  title,
  onClose,
  onDismissed,
  children,
}: {
  title: string | null
  onClose: () => void
  onDismissed: () => void
  children: (frameWidth: number) => React.ReactNode
}): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const aspect = useAspect()
  const insets = useSafeAreaInsets()
  const { width: W, height: H } = useWindowDimensions()
  const turn = H > W
  // The landscape box, and the safe-area insets on each of its sides. Turned 90°
  // clockwise, its left edge is the phone's top (Dynamic Island) and its right
  // edge the phone's bottom (home indicator).
  const boxW = turn ? H : W
  const boxH = turn ? W : H
  const pad = turn
    ? { left: insets.top, right: insets.bottom, top: insets.right, bottom: insets.left }
    : { left: insets.left, right: insets.right, top: insets.top, bottom: insets.bottom }
  const ROW = 44
  const innerW = boxW - pad.left - pad.right - spacing.lg * 2
  const innerH = boxH - pad.top - pad.bottom - spacing.md * 2
  // Header row + frame + transport row, with the player's gaps between them.
  const frameW = Math.floor(Math.min(innerW, (innerH - ROW * 2 - spacing.sm * 2) * aspect))

  return (
    <Modal
      visible={title != null}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
      // iOS: present the sheet again only once this one is gone (one Modal at a time).
      onDismiss={Platform.OS === 'ios' ? onDismissed : undefined}
    >
      <StatusBar hidden />
      <View style={[styles.fill, { backgroundColor: colors.background }]}>
        {title != null ? (
          <View
            style={[
              {
                position: 'absolute',
                width: boxW,
                height: boxH,
                left: (W - boxW) / 2,
                top: (H - boxH) / 2,
                paddingLeft: pad.left + spacing.lg,
                paddingRight: pad.right + spacing.lg,
                paddingTop: pad.top + spacing.md,
                paddingBottom: pad.bottom + spacing.md,
                alignItems: 'center',
                justifyContent: 'center',
                gap: spacing.sm,
              },
              turn ? { transform: [{ rotate: '90deg' }] } : null,
            ]}
          >
            <View style={[styles.header, { width: frameW, minHeight: ROW }]}>
              <IconButton icon="close" label="Close full screen" onPress={onClose} />
              <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>{title}</Text>
              <View style={{ width: 32 }} />
            </View>
            {children(frameW)}
          </View>
        ) : null}
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { flex: 1, textAlign: 'center', fontFamily: font.family.display, fontSize: font.size.lg },
})
