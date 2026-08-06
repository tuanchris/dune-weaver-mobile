// Settings card: app + table firmware versions, with update actions.
// - App: compares the running version to the store's latest; "Update" deep-
//   links to the App Store / Play Store page.
// - Firmware: compares the active table's reported version (status.fw) to the
//   latest GitHub release and flashes it over OTA right from the app.
// Both rows expose "What's new" — the app's from the bundled changelog (plus
// the store's own notes for a pending update, where the store publishes them),
// the firmware's from the GitHub release bodies, fetched lazily on first open.

import React, { useCallback, useMemo, useState } from 'react'
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { isDemoBase } from '../api/demoBoard'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { useUpdates, appUpdateAvailable, fwUpdateAvailable, APP_VERSION } from '../stores/useUpdates'
import { toast } from '../stores/useToast'
import { runFirmwareUpdate, FW_STAGE_LABELS, type FwUpdateStage } from '../lib/firmwareUpdate'
import { stopAndSettle, stopFirstWarning } from '../lib/stopFirst'
import { parseVersion } from '../lib/version'
import { APP_CHANGELOG } from '../lib/appChangelog'
import { fetchFirmwareReleases, type FirmwareRelease } from '../lib/updates'
import { FwUpdateSplash } from './FwUpdateSplash'
import { FirmwareVersionPicker } from './FirmwareVersionPicker'
import { ReleaseNotesSheet, type NotesEntry } from './ReleaseNotesSheet'
import { Button, Card, CardTitle } from './ui'
import { spacing, font } from '../theme'

/** How a target version relates to what's on the table: 'up'grade, 'down'grade,
 * 're'install, or null when either side is unknown. */
function relation(target: string, current: string | null): 'up' | 'down' | 're' | null {
  const pt = parseVersion(target)
  const pc = parseVersion(current)
  if (!pt || !pc) return null
  for (let i = 0; i < pt.length; i++) if (pt[i] !== pc[i]) return pt[i] > pc[i] ? 'up' : 'down'
  return 're'
}

function fmtDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

/** Compact "What's new ›" link under a version line. */
function NotesLink({ onPress }: { onPress: () => void }) {
  const colors = useTheme((s) => s.colors)
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="What's new"
      hitSlop={8}
      style={({ pressed }) => [styles.notesLink, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text style={{ color: colors.primary, fontSize: font.size.sm, fontWeight: font.weight.medium }}>What’s new</Text>
      <MaterialIcons name="chevron-right" size={16} color={colors.primary} />
    </Pressable>
  )
}

export function UpdatesCard({ base }: { base: string | null }) {
  const colors = useTheme((s) => s.colors)
  const appLatest = useUpdates((s) => s.appLatest)
  const fwLatest = useUpdates((s) => s.fwLatest)
  const check = useUpdates((s) => s.check)
  const tableFw = useStatus((s) => s.status?.fw ?? null)
  const [stage, setStage] = useState<FwUpdateStage | null>(null)
  const [checking, setChecking] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  // The version currently being flashed (latest or a picked one) — drives the
  // splash label so it names what's actually installing.
  const [target, setTarget] = useState<FirmwareRelease | null>(null)
  // Which "What's new" sheet is open, and the firmware release bodies behind it
  // (fetched once per session, on first open — same lazy rule as the picker).
  const [notesFor, setNotesFor] = useState<'app' | 'firmware' | null>(null)
  const [fwReleases, setFwReleases] = useState<FirmwareRelease[] | null>(null)
  const [fwNotesLoading, setFwNotesLoading] = useState(false)

  const openFirmwareNotes = () => {
    setNotesFor('firmware')
    if (fwReleases != null || fwNotesLoading) return
    setFwNotesLoading(true)
    void fetchFirmwareReleases()
      .then((list) => setFwReleases(list))
      .catch(() => setFwReleases([]))
      .finally(() => setFwNotesLoading(false))
  }

  // Deliberate re-check: bypasses the 6 h throttle (maxAge 0) and reports the
  // outcome, unlike the silent background checks on launch / Settings focus.
  const checkNow = async () => {
    setChecking(true)
    const before = useUpdates.getState().checkedAt
    try {
      await check(0)
    } finally {
      setChecking(false)
    }
    const s = useUpdates.getState()
    if (s.checkedAt === before) {
      toast.error('Couldn’t check for updates — is this phone online?')
      return
    }
    const appAvail = appUpdateAvailable(s.appLatest)
    const fwAvail = fwUpdateAvailable(s.fwLatest, useStatus.getState().status?.fw ?? null)
    if (appAvail && fwAvail) toast.info('App and firmware updates available')
    else if (appAvail) toast.info('An app update is available')
    else if (fwAvail) toast.info('A firmware update is available')
    else toast.success('Everything is up to date')
  }

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

  // App notes: the bundled changelog is the spine (it's the only source that
  // works offline and on both stores). A pending update whose version we don't
  // ship notes for yet goes on top, using whatever the store published.
  const appEntries = useMemo<NotesEntry[]>(() => {
    const entries: NotesEntry[] = APP_CHANGELOG.map((e) => ({
      version: `v${e.version}`,
      notes: e.notes,
      badge: e.version === APP_VERSION ? 'Installed' : undefined,
    }))
    const latest = appLatest?.version.replace(/^v/, '')
    if (appNew && latest && appLatest?.notes && !APP_CHANGELOG.some((e) => e.version === latest)) {
      entries.unshift({ version: `v${latest}`, notes: appLatest.notes, badge: 'Available' })
    }
    return entries
  }, [appLatest, appNew])

  const fwEntries = useMemo<NotesEntry[]>(
    () =>
      (fwReleases ?? []).map((r) => ({
        version: r.version,
        notes: r.notes.trim() || 'No notes were published for this release.',
        badge:
          relation(r.version, tableFw) === 're' ? 'Installed'
          : r.prerelease ? 'Pre-release'
          : undefined,
        meta: fmtDate(r.publishedAt),
      })),
    [fwReleases, tableFw]
  )
  // The demo table isn't real hardware — show its version, never an update.
  const isRealTable = !!base && !isDemoBase(base)
  const canFlash = isRealTable && fwNew && !!fwLatest

  // Flash any release (the latest, or one picked from the version list). The
  // confirm wording adapts to whether it's an upgrade, downgrade, or reinstall.
  const installFirmware = (release: FirmwareRelease) => {
    if (!base) return
    const rel = relation(release.version, tableFw)
    // Flashing reboots the board, so a running pattern is stopped first — the
    // confirm says so instead of the card simply being locked out.
    const warn = stopFirstWarning(useStatus.getState().status)
    const tail = "The table restarts when it finishes (~1 minute). Keep the app open and don't power off the table."
    const { title, message, action } =
      rel === 'down'
        ? {
            title: 'Downgrade firmware',
            message: `${warn}Install the older ${release.version} over ${tableFw}? Newer features may stop working until you update again. ${tail}`,
            action: 'Downgrade',
          }
        : rel === 're'
          ? { title: 'Reinstall firmware', message: `${warn}Reinstall ${release.version}? ${tail}`, action: 'Reinstall' }
          : { title: 'Update firmware', message: `${warn}Install ${release.version}? ${tail}`, action: 'Install' }
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: action,
        onPress: async () => {
          setTarget(release)
          setStage('download')
          try {
            await stopAndSettle(base)
            const newFw = await runFirmwareUpdate(base, release.firmwareUrl, setStage)
            toast.success(newFw ? `Firmware updated to ${newFw}` : `Firmware installed (${release.version})`)
          } catch (e) {
            toast.error((e as Error).message || 'Firmware update failed')
          } finally {
            setStage(null)
            setTarget(null)
          }
        },
      },
    ])
  }

  return (
    <Card>
      {/* Full-screen splash while an update runs; during the reboot it shows
          a 60s countdown and closes on reconnect or zero, whichever first. */}
      <FwUpdateSplash stage={stage} version={target?.version ?? fwLatest?.version} />
      <CardTitle>About</CardTitle>

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>App</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>
            v{APP_VERSION}
            {appNew ? ` · v${appLatest!.version.replace(/^v/, '')} available` : appLatest ? ' · up to date' : ''}
          </Text>
          <NotesLink onPress={() => setNotesFor('app')} />
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
              <NotesLink onPress={openFirmwareNotes} />
            </View>
          </View>
          {canFlash ? (
            <View style={{ marginTop: spacing.sm, gap: spacing.sm }}>
              <Button
                title={stage ? FW_STAGE_LABELS[stage] : `Update to ${fwLatest!.version}`}
                icon={stage ? undefined : 'system-update-alt'}
                loading={stage != null}
                onPress={() => installFirmware(fwLatest!)}
              />
              {stage ? (
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, textAlign: 'center' }}>
                  Keep the app open — the table restarts by itself when done.
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Pick any released version (reinstall the current one or roll back).
              Available on real tables whether or not an update is pending. */}
          {isRealTable ? (
            <View style={{ marginTop: spacing.sm }}>
              <Button
                title="Install a specific version…"
                icon="history"
                variant="secondary"
                disabled={stage != null}
                onPress={() => setPickerOpen(true)}
              />
            </View>
          ) : null}
        </>
      ) : null}

      <View style={{ marginTop: spacing.md }}>
        <Button title="Check for updates" icon="refresh" variant="secondary" loading={checking} onPress={() => void checkNow()} />
      </View>

      <ReleaseNotesSheet
        visible={notesFor === 'app'}
        title="What’s new in the app"
        entries={appEntries}
        onClose={() => setNotesFor(null)}
      />
      <ReleaseNotesSheet
        visible={notesFor === 'firmware'}
        title="What’s new in the firmware"
        entries={fwEntries}
        loading={fwNotesLoading}
        emptyText="Couldn’t load the firmware release notes. Check that this phone is online and try again."
        onClose={() => setNotesFor(null)}
      />

      <FirmwareVersionPicker
        visible={pickerOpen}
        currentFw={tableFw}
        busy={stage != null}
        onClose={() => setPickerOpen(false)}
        onSelect={(release) => {
          setPickerOpen(false)
          installFirmware(release)
        }}
      />
    </Card>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 36 },
  divider: { height: 1, marginVertical: spacing.md },
  notesLink: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4, alignSelf: 'flex-start' },
})
