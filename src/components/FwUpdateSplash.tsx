// Full-screen splash shown while a firmware update runs (UpdatesCard drives
// it via the update's stage). Download/flash show a spinner; the reboot stage
// shows a 60-second countdown. The splash closes on reconnect or when the
// countdown runs out — whichever comes first. Running out doesn't fail the
// update: the flow keeps polling in the background (up to its own 2-minute
// deadline) and the inline card button keeps reporting the stage.

import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { useTheme } from '../stores/useTheme'
import { spacing, font } from '../theme'
import { FW_STAGE_LABELS, type FwUpdateStage } from '../lib/firmwareUpdate'

const REBOOT_COUNTDOWN_S = 60

const STAGE_ICONS: Record<FwUpdateStage, keyof typeof MaterialIcons.glyphMap> = {
  download: 'cloud-download',
  flash: 'memory',
  reboot: 'restart-alt',
}

const STAGE_HINTS: Record<FwUpdateStage, string> = {
  download: 'Fetching the release from GitHub.',
  flash: 'Writing the new firmware to the table.',
  reboot: 'The table is restarting and rejoining Wi-Fi.',
}

export function FwUpdateSplash({ stage, version }: { stage: FwUpdateStage | null; version?: string }) {
  const colors = useTheme((s) => s.colors)
  const [secondsLeft, setSecondsLeft] = useState(REBOOT_COUNTDOWN_S)

  // (Re)arm the countdown each time the reboot stage begins.
  useEffect(() => {
    if (stage !== 'reboot') return
    setSecondsLeft(REBOOT_COUNTDOWN_S)
    const t = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [stage])

  // Reconnected (stage → null) or the countdown hit zero → hand back to the
  // inline card UI.
  const visible = stage != null && !(stage === 'reboot' && secondsLeft === 0)
  if (!visible || !stage) return null

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={[styles.fill, { backgroundColor: colors.background }]}>
        <View style={[styles.iconCircle, { backgroundColor: colors.cardElevated }]}>
          <MaterialIcons name={STAGE_ICONS[stage]} size={40} color={colors.primary} />
        </View>

        <Text style={[styles.title, { color: colors.foreground }]}>
          {version ? `Updating to ${version}` : 'Updating firmware'}
        </Text>
        <Text style={[styles.stage, { color: colors.mutedForeground }]}>{FW_STAGE_LABELS[stage]}</Text>

        <View style={styles.center}>
          {stage === 'reboot' ? (
            <>
              <Text style={[styles.countdown, { color: colors.foreground }]}>{secondsLeft}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>
                waiting for the table to come back…
              </Text>
            </>
          ) : (
            <ActivityIndicator size="large" color={colors.primary} />
          )}
        </View>

        <Text style={[styles.hint, { color: colors.mutedForeground }]}>{STAGE_HINTS[stage]}</Text>
        <Text style={[styles.footer, { color: colors.mutedForeground }]}>
          Keep the app open and don’t power off the table.
        </Text>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  iconCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  title: { fontSize: font.size.xl, fontWeight: font.weight.semibold, marginBottom: spacing.xs },
  stage: { fontSize: font.size.md },
  center: { height: 120, alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
  countdown: { fontSize: 64, fontWeight: font.weight.bold, fontVariant: ['tabular-nums'] },
  hint: { fontSize: font.size.sm, textAlign: 'center' },
  footer: { fontSize: font.size.xs, textAlign: 'center', marginTop: spacing.lg, opacity: 0.8 },
})
