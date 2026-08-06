// Locks the board-CONFIG part of Settings while the table is mid-job. The
// firmware idle-gates most of those writes anyway (they'd fail or busy-retry);
// this surfaces the rule before the tap. Two pieces:
//  - IdleGateBanner: ONE notice strip with inline Pause/Stop — repeating a
//    banner per card read as nagging, and "stop it first" without a way out
//    made the user go find one.
//  - IdleGate: ONE wrapper around the config cards, softly dimming them and
//    blocking touches. Values stay readable (0.55, not 0.4) — viewing settings
//    while a pattern runs is harmless, only changing them isn't. Its dimmed
//    view re-applies the Settings ScrollView's card gap, since wrapping the
//    cards in a View takes them out of the container's `gap`.
//
// A PAUSE is not a stop, and the gate reflects that: a paused table is unlocked
// (nothing is stepping, and firmware ≥ v0.1.18-rc2 accepts these NVS writes in
// Hold), so pausing is the quick way to get at Settings mid-playlist.
//
// WHAT IS *NOT* GATED, and why — the gate covers writes to the BOARD, nothing
// else. Reading is always allowed, and so is anything that lives on the phone:
//   - Tables (above the banner) — switching tables is safe.
//   - Diagnostics / "View logs", the app's own branding, and About's release
//     notes + update check: local or off-board (GitHub / the app store). There
//     is nothing to protect, and a locked-out log viewer is worst exactly when
//     something is going wrong mid-pattern.
//   - Pattern catalog: imports from a picked file; its only board read
//     (switching back to the live catalog) already defers itself to idle.
//   - Wi-Fi and firmware updates: these REBOOT the table, which no pause
//     survives — so rather than lock them out they stop the table themselves
//     after saying so in the confirm dialog (lib/stopFirst.ts).
// The one leftover is the preview-bundle SYNC, which streams shards off the
// same single-threaded SD the paused job still holds its .thr open on. That
// single button is disabled on `isJobLocked` where it lives, rather than
// dimming a whole card whose other half (importing from Files) is local.

import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { board } from '../api/board'
import { isJobLocked, isSettingsLocked, settingsWritableInHold } from '../api/status'
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
  // The between-patterns gap leaves Settings open but the next pattern relocks
  // them, so the banner stays up to say so and offer the Pause that holds them
  // open. A MANUAL pause needs no banner: nothing is dimmed and nothing is
  // about to relock — the one thing still unavailable there (syncing previews)
  // explains itself where that button lives.
  const gapOpen = useStatus((s) => !isSettingsLocked(s.status) && isJobLocked(s.status) && !s.status?.isPaused)
  const held = useStatus((s) => !!s.status?.isPaused)
  // PAUSE is the way out of this lock, so it's the button unless it would do
  // nothing: the table must not already BE held, and the firmware has to accept
  // settings writes in Hold (older builds stay locked through a pause, and
  // there Stop is the only way out). Note a feed hold works from Idle too —
  // FluidNC goes straight to Hold — so Pause is also the right button during
  // the between-patterns gap: it keeps the next pattern from starting, and
  // holds Settings open past the gap instead of relocking as it winds down.
  const canPause = useStatus((s) => !!s.status && !s.status.isPaused && settingsWritableInHold(s.status.fw))
  const [working, setWorking] = useState<'pause' | 'stop' | null>(null)
  if ((!locked && !gapOpen) || !base) return null

  const run = async (what: 'pause' | 'stop') => {
    setWorking(what)
    try {
      await (what === 'pause' ? board.pause(base) : board.stop(base))
      toast.success(what === 'pause' ? 'Paused' : 'Stopped')
      setTimeout(() => void useStatus.getState().refresh(), 400)
    } catch (e) {
      toast.error(userMessage(e, what === 'pause' ? 'pause the table' : 'stop the table'))
    } finally {
      setWorking(null)
    }
  }

  return (
    <View style={[styles.banner, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
      <MaterialIcons
        name={locked ? (held ? 'pause-circle-outline' : 'lock-outline') : 'schedule'}
        size={18}
        color={colors.live}
      />
      <Text style={{ color: colors.foreground, fontSize: font.size.sm, flex: 1 }}>
        {locked
          ? held
            ? 'Paused — this firmware still locks settings until the table is stopped.'
            : canPause
              ? 'Table running — pause it to change settings.'
              : 'Table running — settings locked.'
          : canPause
            ? 'Between patterns — pause to keep settings open.'
            : 'Between patterns — settings lock again when the next one starts.'}
      </Text>
      {/* ONE button, and it's Pause wherever pausing would help: it opens these
          settings without ending the run, so pairing it with Stop only invites
          the destructive one. Stop is the button exactly where a pause can't
          help — already held, or firmware too old to unlock on a hold. */}
      {canPause ? (
        <Button
          title="Pause"
          icon="pause"
          variant="secondary"
          loading={working === 'pause'}
          onPress={() => void run('pause')}
        />
      ) : (
        <Button
          title="Stop"
          icon="stop"
          variant="destructive"
          loading={working === 'stop'}
          onPress={() => void run('stop')}
        />
      )}
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
