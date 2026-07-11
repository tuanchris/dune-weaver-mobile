// Settings card: app + table firmware versions, with update actions.
// - App: compares the running version to the store's latest; "Update" deep-
//   links to the App Store / Play Store page.
// - Firmware: compares the active table's reported version (status.fw) to the
//   latest GitHub release and flashes it over OTA right from the app.

import React, { useCallback, useState } from 'react'
import { Alert, Linking, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect } from '@react-navigation/native'
import { isDemoBase } from '../api/demoBoard'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { useUpdates, appUpdateAvailable, fwUpdateAvailable, APP_VERSION } from '../stores/useUpdates'
import { toast } from '../stores/useToast'
import { runFirmwareUpdate, FW_STAGE_LABELS, type FwUpdateStage } from '../lib/firmwareUpdate'
import { FwUpdateSplash } from './FwUpdateSplash'
import { Button, Card, CardTitle } from './ui'
import { spacing, font } from '../theme'

export function UpdatesCard({ base }: { base: string | null }) {
  const colors = useTheme((s) => s.colors)
  const appLatest = useUpdates((s) => s.appLatest)
  const fwLatest = useUpdates((s) => s.fwLatest)
  const check = useUpdates((s) => s.check)
  const tableFw = useStatus((s) => s.status?.fw ?? null)
  const [stage, setStage] = useState<FwUpdateStage | null>(null)

  // Refresh whenever Settings gains focus (the tab stays mounted, so a mount
  // effect would only ever run once per session). Allow a re-check every
  // 10 min here — cheap, and it picks up releases published mid-session.
  useFocusEffect(
    useCallback(() => {
      void check(10 * 60_000)
    }, [check])
  )

  const appNew = appUpdateAvailable(appLatest)
  const fwNew = fwUpdateAvailable(fwLatest, tableFw)
  // The demo table isn't real hardware — show its version, never an update.
  const canFlash = !!base && !isDemoBase(base) && fwNew && !!fwLatest

  const startFwUpdate = () => {
    if (!base || !fwLatest) return
    Alert.alert(
      'Update firmware',
      `Install ${fwLatest.version}? The table restarts when it finishes (~1 minute). Keep the app open and don't power off the table.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Update',
          onPress: async () => {
            setStage('download')
            try {
              const newFw = await runFirmwareUpdate(base, fwLatest.firmwareUrl, setStage)
              toast.success(newFw ? `Firmware updated to ${newFw}` : 'Firmware updated')
            } catch (e) {
              toast.error((e as Error).message || 'Firmware update failed')
            } finally {
              setStage(null)
            }
          },
        },
      ]
    )
  }

  return (
    <Card>
      {/* Full-screen splash while an update runs; during the reboot it shows
          a 60s countdown and closes on reconnect or zero, whichever first. */}
      <FwUpdateSplash stage={stage} version={fwLatest?.version} />
      <CardTitle>About</CardTitle>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>App</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>
            v{APP_VERSION}
            {appNew ? ` · v${appLatest!.version.replace(/^v/, '')} available` : appLatest ? ' · up to date' : ''}
          </Text>
        </View>
        {appNew ? (
          <Button
            title="Update"
            icon="system-update"
            variant="secondary"
            onPress={() => Linking.openURL(appLatest!.url).catch(() => toast.error('Could not open the store'))}
          />
        ) : null}
      </View>

      {base ? (
        <>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>Table firmware</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>
                {tableFw ?? 'Unknown — table offline or firmware too old'}
                {tableFw && fwLatest ? (fwNew ? ` · ${fwLatest.version} available` : ' · up to date') : ''}
              </Text>
            </View>
          </View>
          {canFlash ? (
            <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
              <Button
                title={stage ? FW_STAGE_LABELS[stage] : `Update to ${fwLatest!.version}`}
                icon={stage ? undefined : 'system-update-alt'}
                loading={stage != null}
                onPress={startFwUpdate}
              />
              {stage ? (
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, textAlign: 'center' }}>
                  Keep the app open — the table restarts by itself when done.
                </Text>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 36 },
  divider: { height: 1, marginVertical: spacing.md },
})
