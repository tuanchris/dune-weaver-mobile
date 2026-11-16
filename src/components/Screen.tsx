import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
// The screens SafeAreaView, not safe-area-context's: inside a native tab its
// insets include the tab bar (and iPadOS 18+'s TOP bar); on Android, the bar height.
import { SafeAreaView } from 'react-native-screens/experimental'
import { MaterialIcons } from '@expo/vector-icons'
import { useTheme } from '../stores/useTheme'
import { MiniPlayer } from './NowPlayingBar'
import { TablePill } from './TablePill'
import { SyncBanner } from './SyncBanner'
import { NATIVE_ACCESSORY, setScreenBox, setScreenWidth, useSplit } from '../lib/layout'
import { spacing, font } from '../theme'

/**
 * App chrome shared by every tab screen, mirroring the dw web UI:
 *  - a floating pill "brand" header (TablePill: logo · active table name · connection dot; tap to switch tables)
 *  - a large page title row below it, with an optional right-aligned action
 *  - a Pattern Hub sync's progress (SyncBanner) while one runs, except where its own panel shows it (hideSync)
 *  - the fallback mini player, in flow at the bottom, wherever the tab bar has no native accessory.
 */
export function Screen({
  children,
  title,
  action,
  back,
  eyebrow,
  hideSync,
}: {
  children: React.ReactNode
  title?: string
  action?: React.ReactNode
  /** A pushed page (Settings' stack): a back row replaces the brand pill. */
  back?: { label: string; onPress: () => void }
  /** Small label above the title — whose settings these are (the table's name). */
  eyebrow?: string
  /** Browse's Pattern Hub tab: its panel already shows the sync. */
  hideSync?: boolean
}) {
  const colors = useTheme((s) => s.colors)
  const split = useSplit()
  // Half folded, the flat half is short: a tab's big title goes (the tab bar says
  // where you are) unless it carries an action or heads a pushed page.
  const showTitle = !!title && (split?.side !== 'top' || !!back || !!action)

  return (
    // Exactly ONE screens SafeAreaView per Screen (Android keeps a single insets listener).
    // Bottom unpadded on iOS 26: content scrolls under the glass bar + accessory.
    // Left/right: iPhone Duo's rail (and Split View puts it on the left).
    // It insets by MARGIN on itself, so its own frame is the safe box (inside bars +
    // rail), in window points — measured here, before the pane takes its half.
    <SafeAreaView
      edges={{ top: true, bottom: !NATIVE_ACCESSORY, left: true, right: true }}
      onLayout={(e) => setScreenBox(e.nativeEvent.layout)}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      {/* Unfolded / half folded: NowPlayingPane (App.tsx) covers one half of the box; content keeps the other. */}
      <View style={[{ flex: 1 }, split ? { marginLeft: split.inset.left, marginRight: split.inset.right, marginTop: split.inset.top } : null]}>
        {back ? (
          // Same height as the brand pill, so the title doesn't jump on push.
          <View style={styles.headerWrap}>
            <Pressable
              onPress={back.onPress}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Back to ${back.label}`}
              style={({ pressed }) => [styles.back, { opacity: pressed ? 0.6 : 1 }]}
            >
              <MaterialIcons name="chevron-left" size={30} color={colors.primary} />
              <Text style={{ color: colors.primary, fontSize: font.size.lg }}>{back.label}</Text>
            </Pressable>
          </View>
        ) : split ? null : (
          // Split, the pill heads the table's half instead (it names the table).
          <View style={styles.headerWrap}>
            <TablePill />
          </View>
        )}

        {showTitle ? (
          <View style={styles.titleRow}>
            <View style={{ flexShrink: 1 }}>
              {eyebrow ? (
                <Text numberOfLines={1} style={[styles.eyebrow, { color: colors.mutedForeground }]}>{eyebrow}</Text>
              ) : null}
              <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>{title}</Text>
            </View>
            {action ?? null}
          </View>
        ) : null}

        {hideSync ? null : <SyncBanner />}
        <View style={{ flex: 1 }} onLayout={(e) => setScreenWidth(e.nativeEvent.layout.width)}>{children}</View>
        {NATIVE_ACCESSORY || split ? null : <MiniPlayer placement="floating" />}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  headerWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: { fontSize: font.size.xxl, fontFamily: font.family.display, letterSpacing: -0.3, flexShrink: 1 },
  eyebrow: { fontSize: font.size.sm, fontWeight: font.weight.semibold, letterSpacing: 0.6, textTransform: 'uppercase' },
  back: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', minHeight: 48, marginLeft: -spacing.sm },
})
