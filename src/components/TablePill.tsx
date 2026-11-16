import React, { useState } from 'react'
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { useHubSync } from '../lib/patternHub'
import { useBranding, brandName } from '../stores/useBranding'
import { Sheet } from './Sheet'
import { spacing, font, radius } from '../theme'

const defaultLogo = require('../../assets/dw-logo.png')

/** The brand pill: logo · active table name · connection dot; tap to switch
 * tables when more than one is set up. Heads every tab Screen — or, split,
 * the table's half (NowPlayingPane), since it names the table. */
export function TablePill(): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const boards = useBoards((s) => s.boards)
  const activeId = useBoards((s) => s.activeId)
  const setActive = useBoards((s) => s.setActive)
  const connected = useStatus((s) => !!s.status?.connected)
  // Busy with a sync, not gone: its server answers nothing else meanwhile.
  const base = useStatus((s) => s.base)
  const receiving = useHubSync((s) => !!s.receiving && s.receiving === base)
  const brand = useBranding((s) => s.name)
  const logoUri = useBranding((s) => s.logoUri)
  const [open, setOpen] = useState(false)

  const active = boards.find((b) => b.id === activeId) ?? null
  const multiTable = boards.length > 1
  return (
    <View style={[styles.pill, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Image source={logoUri ? { uri: logoUri } : defaultLogo} style={styles.logo} />
      {/* Active table name doubles as the brand. Connection dot beside it; tap to switch when more than one is set up. */}
      <Pressable
        onPress={() => multiTable && setOpen(true)}
        disabled={!multiTable}
        hitSlop={8}
        accessibilityRole={multiTable ? 'button' : 'text'}
        accessibilityLabel={`${active?.name ?? brandName(brand)}, ${receiving ? 'receiving patterns' : connected ? 'connected' : 'offline'}${multiTable ? '. Switch table' : ''}`}
        style={({ pressed }) => [styles.tableChip, { opacity: pressed && multiTable ? 0.6 : 1 }]}
      >
        <View style={[styles.dot, { backgroundColor: receiving ? colors.live : connected ? colors.success : colors.destructive }]} />
        <Text numberOfLines={1} style={[styles.brand, { color: colors.foreground }]}>{active?.name ?? brandName(brand)}</Text>
        {multiTable ? <MaterialIcons name="expand-more" size={18} color={colors.mutedForeground} /> : null}
      </Pressable>

      <Sheet visible={open} onClose={() => setOpen(false)} title="Switch table">
        <ScrollView contentContainerStyle={styles.switchList}>
          {boards.map((b) => {
            const on = b.id === activeId
            return (
              <Pressable
                key={b.id}
                onPress={() => {
                  if (b.id !== activeId) setActive(b.id)
                  setOpen(false)
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
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start', // hug logo + chip
    flexShrink: 1,
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
})
