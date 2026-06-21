import React from 'react'
import { Alert, Image, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { board } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { useBranding, brandName } from '../stores/useBranding'
import { toast } from '../stores/useToast'
import { IconButton } from './ui'
import { spacing, font, radius } from '../theme'

const defaultLogo = require('../../assets/dw-logo.png')

/**
 * App chrome shared by every screen, mirroring the dw web UI:
 *  - a floating pill "brand" header (logo · Dune Weaver · connection dot · theme/power)
 *  - a large page title row below it, with an optional right-aligned action.
 */
export function Screen({
  children,
  title,
  action,
}: {
  children: React.ReactNode
  title?: string
  action?: React.ReactNode
}) {
  const colors = useTheme((s) => s.colors)
  const toggle = useTheme((s) => s.toggle)
  const mode = useTheme((s) => s.mode)
  const base = useBoards((s) => s.getActiveBase())
  const status = useStatus((s) => s.status)
  const connected = !!status?.connected
  const brand = useBranding((s) => s.name)
  const logoUri = useBranding((s) => s.logoUri)

  const power = () => {
    if (!base) return
    Alert.alert('Restart table', 'Reboot the controller? It needs ~25–30s to rejoin Wi-Fi.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restart',
        style: 'destructive',
        onPress: () =>
          board
            .reboot(base)
            .then(() => toast.success('Rebooting…'))
            .catch(() => toast.error('Could not reboot')),
      },
    ])
  }

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.headerWrap}>
        <View style={[styles.pill, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Image source={logoUri ? { uri: logoUri } : defaultLogo} style={styles.logo} />
          <Text numberOfLines={1} style={[styles.brand, { color: colors.foreground }]}>{brandName(brand)}</Text>
          <View style={[styles.dot, { backgroundColor: connected ? colors.success : colors.mutedForeground }]} />
          <View style={{ flex: 1 }} />
          <IconButton icon={mode === 'dark' ? 'light-mode' : 'dark-mode'} size={20} color={colors.mutedForeground} onPress={toggle} />
          <IconButton icon="power-settings-new" size={20} color={colors.destructive} onPress={power} disabled={!base} />
        </View>
      </View>

      {title ? (
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={[styles.title, { color: colors.foreground }]}>{title}</Text>
          {action ?? null}
        </View>
      ) : null}

      <View style={{ flex: 1 }}>{children}</View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  headerWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: 48,
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
  brand: { fontSize: font.size.lg, fontWeight: font.weight.bold, flexShrink: 1 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: { fontSize: font.size.xxl, fontWeight: font.weight.bold, flexShrink: 1 },
})
