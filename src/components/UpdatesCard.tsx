// Settings cards for versions + updates, one per Settings page:
// - FirmwareCard (Settings › Firmware): compares the active table's reported
//   version (status.fw) to the latest GitHub release and flashes it over OTA
//   right from the app — the latest, or any release via the version picker.
// - AppVersionCard (Settings › About): compares the running version to the
//   store's latest; "Update" deep-links to the App Store / Play Store page
//   (desktop: its GitHub release).
// Both expose "What's new" — the app's from the bundled changelog (plus the
// store's own notes for a pending update, where the store publishes them), the
// firmware's from the GitHub release bodies, fetched lazily on first open.
// The background update check runs on the Settings list's focus (SettingsScreen),
// whose Firmware/About rows show what's pending.

import React, { useMemo, useState } from 'react'
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { isDemoBase } from '../api/demoBoard'
import { usePrefs } from '../stores/usePrefs'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { useUpdates, appUpdateAvailable, fwUpdateAvailable, APP_VERSION } from '../stores/useUpdates'
import { toast } from '../stores/useToast'
import { runFirmwareUpdate, FW_STAGE_LABELS, type FwUpdateStage } from '../lib/firmwareUpdate'
import { stopAndSettle, stopFirstWarning } from '../lib/stopFirst'
import { parseVersion, sameVersion } from '../lib/version'
import { APP_CHANGELOG } from '../lib/appChangelog'
import { fetchFirmwareReleases, type BoardMcu, type FirmwareRelease } from '../lib/updates'
import { FwUpdateSplash } from './FwUpdateSplash'
import { FirmwareVersionPicker } from './FirmwareVersionPicker'
import { ReleaseNotesSheet, type NotesEntry } from './ReleaseNotesSheet'
import { Button, Card } from './ui'
import { spacing, font } from '../theme'

/** How a target version relates to what's on the table: 'up'grade, 'down'grade,
 * 're'install, or null when either side is unknown. 're' needs an exact TAG
 * match, not just an equal numeric key — two builds can share a key when one
 * carries a prerelease tail parseVersion doesn't model, and calling that a
 * reinstall would mislabel a real upgrade (null falls back to plain "Install"). */
function relation(target: string, current: string | null): 'up' | 'down' | 're' | null {
  if (sameVersion(target, current)) return 're'
  const pt = parseVersion(target)
  const pc = parseVersion(current)
  if (!pt || !pc) return null
  for (let i = 0; i < pt.length; i++) if (pt[i] !== pc[i]) return pt[i] > pc[i] ? 'up' : 'down'
  return null
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

/** Deliberate re-check: bypasses the 6 h throttle (maxAge 0) and reports the
 * outcome, unlike the silent background check on Settings focus. */
function CheckForUpdates() {
  const check = useUpdates((s) => s.check)
  const [checking, setChecking] = useState(false)
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
  return (
    <View style={{ marginTop: spacing.md }}>
      <Button title="Check for updates" icon="refresh" variant="secondary" loading={checking} onPress={() => void checkNow()} />
    </View>
  )
}

/** Settings › Firmware: the active table's firmware, update + version picker. */
export function FirmwareCard({ base }: { base: string }) {
  const colors = useTheme((s) => s.colors)
  const fwLatest = useUpdates((s) => s.fwLatest)
  const showPre = usePrefs((s) => s.showPrereleaseFirmware)
  const tableFw = useStatus((s) => s.status?.fw ?? null)
  const tableMcu = useStatus((s) => s.status?.mcu ?? null)
  const [stage, setStage] = useState<FwUpdateStage | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  // The version currently being flashed (latest or a picked one) — drives the
  // splash label so it names what's actually installing.
  const [target, setTarget] = useState<FirmwareRelease | null>(null)
  // The release bodies behind "What's new" (fetched once, on first open — same
  // lazy rule as the picker).
  const [notesOpen, setNotesOpen] = useState(false)
  const [fwReleases, setFwReleases] = useState<FirmwareRelease[] | null>(null)
  const [notesLoading, setNotesLoading] = useState(false)

  const openNotes = () => {
    setNotesOpen(true)
    if (fwReleases != null || notesLoading) return
    setNotesLoading(true)
    void fetchFirmwareReleases()
      .then((list) => setFwReleases(list))
      .catch(() => setFwReleases([]))
      .finally(() => setNotesLoading(false))
  }

  const fwNew = fwUpdateAvailable(fwLatest, tableFw)

  // Notes follow the picker's beta toggle — a reader who hides test builds
  // shouldn't have to scroll past their notes. The installed build is always
  // listed, even when it's an rc.
  const fwEntries = useMemo<NotesEntry[]>(
    () =>
      (fwReleases ?? [])
        .filter((r) => showPre || !r.prerelease || sameVersion(r.version, tableFw))
        .map((r) => ({
          version: r.version,
          notes: r.notes.trim() || 'No notes were published for this release.',
          badge:
            relation(r.version, tableFw) === 're' ? 'Installed'
            : r.prerelease ? 'Pre-release'
            : undefined,
          meta: fmtDate(r.publishedAt),
        })),
    [fwReleases, tableFw, showPre]
  )
  // The demo table isn't real hardware — show its version, never an update.
  const isRealTable = !isDemoBase(base)
  const canFlash = isRealTable && fwNew && !!fwLatest

  // The flash itself (after the confirm). `forceMcu` is the user's answer to
  // the which-board dialog below, on firmware too old to report its MCU.
  const doInstall = async (release: FirmwareRelease, forceMcu?: BoardMcu) => {
    setTarget(release)
    setStage('download')
    try {
      await stopAndSettle(base)
      const newFw = await runFirmwareUpdate(base, release, setStage, forceMcu)
      toast.success(newFw ? `Firmware updated to ${newFw}` : `Firmware installed (${release.version})`)
    } catch (e) {
      toast.error((e as Error).message || 'Firmware update failed')
    } finally {
      setStage(null)
      setTarget(null)
    }
  }

  // Start an install, asking WHICH BOARD first when the running firmware is
  // too old to report its MCU (status.mcu absent) and the release ships more
  // than one image — the wrong image uploads completely and is only rejected
  // by the board's final chip-ID check, so guessing wastes a whole flash
  // cycle. Once the table runs mcu-reporting firmware the question disappears.
  const startInstall = (release: FirmwareRelease) => {
    const mcu = useStatus.getState().status?.mcu ?? null
    if (mcu || !release.images.esp32s3) {
      void doInstall(release)
      return
    }
    Alert.alert(
      'Which board is this table?',
      'This firmware is too old to say which chip it has, and each needs its own image. Most tables are ESP32; the MKS DLC32 MAX is an ESP32-S3. A wrong pick is rejected safely — just try again with the other one.',
      [
        { text: 'ESP32 (most tables)', onPress: () => void doInstall(release, 'esp32') },
        { text: 'ESP32-S3 (DLC32 MAX)', onPress: () => void doInstall(release, 'esp32s3') },
        { text: 'Cancel', style: 'cancel' },
      ]
    )
  }

  // Flash any release (the latest, or one picked from the version list). The
  // confirm wording adapts to whether it's an upgrade, downgrade, or reinstall.
  const installFirmware = (release: FirmwareRelease) => {
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
      { text: action, onPress: () => startInstall(release) },
    ])
  }

  return (
    <Card>
      {/* Full-screen splash while an update runs; during the reboot it shows
          a 60s countdown and closes on reconnect or zero, whichever first. */}
      <FwUpdateSplash stage={stage} version={target?.version ?? fwLatest?.version} />

      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>Installed version</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>
            {tableFw ?? 'Unknown — table offline or firmware too old'}
            {tableFw && fwLatest ? (fwNew ? ` · ${fwLatest.version} available` : ' · up to date') : ''}
          </Text>
          <NotesLink onPress={openNotes} />
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
            <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, textAlign: 'center' }}>
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

      <CheckForUpdates />

      <ReleaseNotesSheet
        visible={notesOpen}
        title="What’s new in the firmware"
        entries={fwEntries}
        loading={notesLoading}
        emptyText="Couldn’t load the firmware release notes. Check that this phone is online and try again."
        onClose={() => setNotesOpen(false)}
      />

      <FirmwareVersionPicker
        visible={pickerOpen}
        currentFw={tableFw}
        mcu={tableMcu}
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

/** Settings › About: this app's version, store update link and changelog. */
export function AppVersionCard() {
  const colors = useTheme((s) => s.colors)
  const appLatest = useUpdates((s) => s.appLatest)
  const [notesOpen, setNotesOpen] = useState(false)
  const appNew = appUpdateAvailable(appLatest)

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

  return (
    <Card>
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>App version</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>
            v{APP_VERSION}
            {appNew ? ` · v${appLatest!.version.replace(/^v/, '')} available` : appLatest ? ' · up to date' : ''}
          </Text>
          <NotesLink onPress={() => setNotesOpen(true)} />
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

      <CheckForUpdates />

      <ReleaseNotesSheet visible={notesOpen} title="What’s new in the app" entries={appEntries} onClose={() => setNotesOpen(false)} />
    </Card>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 36 },
  notesLink: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 4, alignSelf: 'flex-start' },
})
