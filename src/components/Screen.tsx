import React, { useState } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
// The screens SafeAreaView, not safe-area-context's: inside a native tab its
// insets include the tab bar (and iPadOS 18+'s TOP bar); on Android, the bar height.
import { SafeAreaView } from 'react-native-screens/experimental'
import { MaterialIcons } from '@expo/vector-icons'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { useBranding, brandName } from '../stores/useBranding'
import { MiniPlayer } from './NowPlayingBar'
import { Sheet } from './Sheet'
import { NATIVE_ACCESSORY } from '../lib/layout'
import { spacing, font, radius } from '../theme'

const defaultLogo = require('../../assets/dw-logo.png')

/**
 * App chrome shared by every tab screen, mirroring the dw web UI:
 *  - a floating pill "brand" header (logo · active table name · connection dot; tap to switch tables)
 *  - a large page title row below it, with an optional right-aligned action
 *  - the fallback mini player, in flow at the bottom, wherever the tab bar has no native accessory.
 */
export function Screen({
  children,
  title,
  action,
  back,
  eyebrow,
}: {
  children: React.ReactNode
  title?: string
  action?: React.ReactNode
  /** A pushed page (Settings' stack): a back row replaces the brand pill. */
  back?: { label: string; onPress: () => void }
  /** Small label above the title — whose settings these are (the table's name). */
  eyebrow?: string
}) {
  const colors = useTheme((s) => s.colors)
  const boards = useBoards((s) => s.boards)
  const activeId = useBoards((s) => s.activeId)
  const setActive = useBoards((s) => s.setActive)
  const status = useStatus((s) => s.status)
  const connected = !!status?.connected
  const brand = useBranding((s) => s.name)
  const logoUri = useBranding((s) => s.logoUri)

  const active = boards.find((b) => b.id === activeId) ?? null
  const multiTable = boards.length > 1
  const [switcherOpen, setSwitcherOpen] = useState(false)

  return (
    // Exactly ONE screens SafeAreaView per Screen (Android keeps a single insets listener).
    // Bottom unpadded on iOS 26: content scrolls under the glass bar + accessory.
    <SafeAreaView edges={{ top: true, bottom: !NATIVE_ACCESSORY }} style={{ flex: 1, backgroundColor: colors.background }}>
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
      ) : (
        <View style={styles.headerWrap}>
          <View style={[styles.pill, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Image source={logoUri ? { uri: logoUri } : defaultLogo} style={styles.logo} />
            {/* Active table name doubles as the brand. Connection dot beside it; tap to switch when more than one is set up. */}
            <Pressable
              onPress={() => multiTable && setSwitcherOpen(true)}
              disabled={!multiTable}
              hitSlop={8}
              accessibilityRole={multiTable ? 'button' : 'text'}
              accessibilityLabel={`${active?.name ?? brandName(brand)}, ${connected ? 'connected' : 'offline'}${multiTable ? '. Switch table' : ''}`}
              style={({ pressed }) => [styles.tableChip, { opacity: pressed && multiTable ? 0.6 : 1 }]}
            >
              <View style={[styles.dot, { backgroundColor: connected ? colors.success : colors.destructive }]} />
              <Text numberOfLines={1} style={[styles.brand, { color: colors.foreground }]}>{active?.name ?? brandName(brand)}</Text>
              {multiTable ? <MaterialIcons name="expand-more" size={18} color={colors.mutedForeground} /> : null}
            </Pressable>
          </View>
        </View>
      )}

      {/* Table switcher — opened from the header chip when multiple tables exist. */}
      <Sheet visible={switcherOpen} onClose={() => setSwitcherOpen(false)} title="Switch table">
        <ScrollView contentContainerStyle={styles.switchList}>
          {boards.map((b) => {
            const on = b.id === activeId
            return (
              <Pressable
                key={b.id}
                onPress={() => {
                  if (b.id !== activeId) setActive(b.id)
                  setSwitcherOpen(false)
                }}
                style={[styles.switchRow, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.cardElevated }]}
              >
                <MaterialIcons name={on ? 'radio-button-checked' : 'radio-button-unchecked'} size={20} color={on ? colors.primaryForeground : colors.mutedForeground} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={2} style={{ color: on ? colors.primaryForeground : colors.foreground, fontWeight: font.weight.medium }}>{b.name}</Text>
                  <Text numberOfLines={1} style={{ color: on ? colors.primaryForeground : colors.mutedForeground, fontSize: font.size.xs }}>{b.base}</Text>
                </View>
              </Pressable>
            )
          })}
        </ScrollView>
      </Sheet>

      {title ? (
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

      <View style={{ flex: 1 }}>{children}</View>
      {NATIVE_ACCESSORY ? null : <MiniPlayer placement="floating" />}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  headerWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start', // hug logo + chip
    gap: spacing.sm,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  logo: { width: 30, height: 30, borderRadius: 15 },
  brand: { fontSize: font.size.md, fontFamily: font.family.displaySemi, flexShrink: 1 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  tableChip: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexShrink: 1 },
  switchList: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
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
