// Locks Settings while the table is mid-job. The firmware idle-gates most
// settings writes anyway (they'd fail or busy-retry); this surfaces the rule
// before the tap. Two pieces:
//  - IdleGateBanner: ONE notice strip with an inline Stop — repeating a
//    banner per card read as nagging, and "stop it first" without a Stop
//    button made the user go find one.
//  - IdleGate: ONE wrapper around everything below the banner, softly dimming
//    it and blocking touches. Values stay readable (0.55, not 0.4) — viewing
//    settings while a pattern runs is harmless, only changing them isn't.
//    Its dimmed view re-applies the Settings ScrollView's card gap, since
//    wrapping the cards in a View takes them out of the container's `gap`.
// Locking follows isSettingsLocked (busy OR playlist active), so the lock
// holds steady across a playlist's between-patterns pause instead of flapping
// open on the firmware's momentary Idle. The Tables card sits ABOVE the
// banner and never locks — switching tables stays possible.

import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { board } from '../api/board'
import { isSettingsLocked } from '../api/status'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { toast } from '../stores/useToast'
import { userMessage } from '../lib/errors'
import { Button } from './ui'
import { radius, spacing, font } from '../theme'

export function IdleGate({ children }: { children: React.ReactNode }) {
  const locked = useStatus((s) => isSettingsLocked(s.status))
  if (!locked) return <>{children}</>
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ opacity: 0.55, gap: spacing.lg }}
    >
      {children}
    </View>
  )
}

/** The single explanation + way out, rendered once above the first gated card. */
export function IdleGateBanner({ base }: { base: string | null }) {
  const colors = useTheme((s) => s.colors)
  const locked = useStatus((s) => isSettingsLocked(s.status))
  const [stopping, setStopping] = useState(false)
  if (!locked || !base) return null

  const stop = async () => {
    setStopping(true)
    try {
      await board.stop(base)
      toast.success('Stopped')
      setTimeout(() => void useStatus.getState().refresh(), 400)
    } catch (e) {
      toast.error(userMessage(e, 'stop the table'))
    } finally {
      setStopping(false)
    }
  }

  return (
    <View style={[styles.banner, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
      <MaterialIcons name="lock-outline" size={18} color={colors.live} />
      <Text style={{ color: colors.foreground, fontSize: font.size.sm, flex: 1 }}>
        Table running — settings locked.
      </Text>
      <Button title="Stop" icon="stop" variant="destructive" loading={stopping} onPress={() => void stop()} />
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
  },
})
