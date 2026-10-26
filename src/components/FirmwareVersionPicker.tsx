// Bottom-sheet picker for installing a SPECIFIC firmware version (not just the
// latest). Lists every GitHub release that ships a flashable image, newest
// first, marks the one currently on the table, and flags downgrades. Picking a
// row hands the release back to FirmwareCard (UpdatesCard.tsx), which runs the same confirm + OTA
// flow as the "Update to latest" button (runFirmwareUpdate picks the image
// matching the table's MCU from the release's per-board assets).

import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { fetchFirmwareReleases, firmwareUrlFor, type FirmwareRelease } from '../lib/updates'
import { parseVersion, sameVersion } from '../lib/version'
import { usePrefs } from '../stores/usePrefs'
import { useTheme } from '../stores/useTheme'
import { Button, Toggle } from './ui'
import { Sheet } from './Sheet'
import { Notes, notesSummary } from './ReleaseNotesSheet'
import { radius, spacing, font } from '../theme'

/** -1 = older than current, 0 = same, 1 = newer, null = can't tell. */
function relativeTo(version: string, current: string | null | undefined): -1 | 0 | 1 | null {
  const pv = parseVersion(version)
  const pc = parseVersion(current)
  if (!pv || !pc) return null
  for (let i = 0; i < pv.length; i++) if (pv[i] !== pc[i]) return pv[i] > pc[i] ? 1 : -1
  return 0
}

function fmtDate(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function FirmwareVersionPicker({
  visible,
  currentFw,
  mcu,
  busy,
  onClose,
  onSelect,
}: {
  visible: boolean
  currentFw: string | null
  /** The table's reported board MCU (status.mcu). When known, releases with
   * no image for it — e.g. pre-S3 releases on an S3 table — are shown but not
   * installable. null (older firmware) leaves every row tappable; the OTA
   * flow's ESP32 fallback + retry prompt handles the guess. */
  mcu: string | null
  /** An install is already running — disable row taps. */
  busy: boolean
  onClose: () => void
  onSelect: (release: FirmwareRelease) => void
}) {
  const colors = useTheme((s) => s.colors)
  const showPre = usePrefs((s) => s.showPrereleaseFirmware)
  const setShowPre = usePrefs((s) => s.setShowPrereleaseFirmware)
  const [releases, setReleases] = useState<FirmwareRelease[] | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  // The release whose notes are open (an in-sheet page: iOS shows one sheet at a time).
  const [open, setOpen] = useState<FirmwareRelease | null>(null)
  useEffect(() => {
    if (!visible) setOpen(null)
  }, [visible])

  // Betas are hidden by default. The build ON THE TABLE is always listed even
  // when it's an rc — a tester who is on one has to be able to see (and
  // re-flash) where they are, and hiding it would make the list look like the
  // table is running something it isn't.
  const shown = (releases ?? []).filter((r) => showPre || !r.prerelease || sameVersion(r.version, currentFw))
  const hiddenCount = (releases ?? []).length - shown.length

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      const list = await fetchFirmwareReleases()
      setReleases(list)
      if (list.length === 0) setError(true)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }

  // Fetch once per open (releases rarely change within a session).
  useEffect(() => {
    if (visible && releases == null && !loading) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible])

  return (
    <Sheet
      variant="page"
      visible={visible}
      onClose={onClose}
      title={open ? open.version : 'Firmware versions'}
      onBack={open ? () => setOpen(null) : undefined}
    >
      <View style={styles.body}>
        {open ? (
          <ReleaseDetail release={open} currentFw={currentFw} mcu={mcu} busy={busy} onInstall={() => onSelect(open)} />
        ) : loading ? (
          <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.xl }} />
        ) : error ? (
          <View style={{ paddingVertical: spacing.lg, gap: spacing.md }}>
            <Text style={{ color: colors.mutedForeground }}>
              Couldn’t load the version list. Check that this phone is online and try again.
            </Text>
            <Button title="Try again" icon="refresh" variant="secondary" onPress={() => void load()} />
          </View>
        ) : (
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: spacing.md, gap: spacing.sm }}>
            <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, marginBottom: spacing.xs }}>
              Any version can be installed: an older one is a downgrade, and the installed one re-flashes. The app asks you
              to confirm, and the table restarts after any install.
            </Text>

            <View style={[styles.betaRow, { borderColor: colors.border }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontSize: font.size.md, fontWeight: font.weight.medium }}>
                  Show beta versions
                </Text>
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, marginTop: 2 }}>
                  {showPre
                    ? 'Release candidates are test builds — install one only if you mean to.'
                    : hiddenCount > 0
                      ? `${hiddenCount} test build${hiddenCount === 1 ? '' : 's'} hidden.`
                      : 'Release candidates and other test builds.'}
                </Text>
              </View>
              <Toggle value={showPre} onValueChange={setShowPre} />
            </View>

            {shown.map((r) => {
              const installed = sameVersion(r.version, currentFw)
              const rel = relativeTo(r.version, currentFw)
              // A release with no image for this table's KNOWN board can only
              // ever be rejected by it (pre-S3 releases on an S3 table) — the
              // one exception to every-row-is-tappable.
              const noImage = mcu != null && firmwareUrlFor(r, mcu) == null
              const summary = r.notes ? notesSummary(r.notes) : ''
              return (
                <Pressable
                  key={r.version}
                  // Every row opens its notes, the board-less ones too (worth
                  // reading); Install lives on that page.
                  onPress={() => setOpen(r)}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.version}, release notes`}
                  style={({ pressed }) => [
                    styles.item,
                    {
                      borderColor: installed ? colors.primary : colors.border,
                      backgroundColor: installed || pressed ? colors.cardElevated : 'transparent',
                    },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <View style={styles.itemTop}>
                      <Text style={{ color: colors.foreground, fontFamily: font.family.mono, fontSize: font.size.md }}>
                        {r.version}
                      </Text>
                      {installed ? (
                        <Text style={[styles.tag, { color: colors.primary, borderColor: colors.primary }]}>Installed</Text>
                      ) : rel === -1 ? (
                        <Text style={[styles.tag, { color: colors.mutedForeground, borderColor: colors.border }]}>Older</Text>
                      ) : rel === 1 ? (
                        <Text style={[styles.tag, { color: colors.live, borderColor: colors.live }]}>Newer</Text>
                      ) : null}
                      {r.prerelease ? (
                        <Text style={[styles.tag, { color: colors.mutedForeground, borderColor: colors.border }]}>Pre-release</Text>
                      ) : null}
                      {noImage ? (
                        <Text style={[styles.tag, { color: colors.mutedForeground, borderColor: colors.border }]}>Not for this board</Text>
                      ) : null}
                    </View>
                    {r.publishedAt ? (
                      <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, marginTop: 2 }}>{fmtDate(r.publishedAt)}</Text>
                    ) : null}
                    {summary ? (
                      <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: font.size.sm, marginTop: 4 }}>
                        {summary}
                      </Text>
                    ) : null}
                  </View>
                  <MaterialIcons name="chevron-right" size={22} color={colors.mutedForeground} />
                </Pressable>
              )
            })}
          </ScrollView>
        )}
      </View>
    </Sheet>
  )
}

/** One release: its notes, and the install button pinned at the bottom (thumb reach). */
function ReleaseDetail({
  release: r,
  currentFw,
  mcu,
  busy,
  onInstall,
}: {
  release: FirmwareRelease
  currentFw: string | null
  mcu: string | null
  busy: boolean
  onInstall: () => void
}): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const installed = sameVersion(r.version, currentFw)
  const rel = relativeTo(r.version, currentFw)
  // No image for this table's KNOWN board: it could only ever be rejected
  // (pre-S3 releases on an S3 table). The installed one stays installable —
  // that's the reinstall path, and the way out if the app misreads the table.
  const noImage = mcu != null && firmwareUrlFor(r, mcu) == null
  const meta = [fmtDate(r.publishedAt), r.prerelease ? 'Pre-release' : ''].filter(Boolean).join(' · ')
  return (
    <>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.lg, gap: spacing.md }}>
        {meta ? <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>{meta}</Text> : null}
        {r.notes ? <Notes notes={r.notes} /> : <Text style={{ color: colors.mutedForeground }}>No release notes.</Text>}
      </ScrollView>
      <View style={[styles.installBar, { borderColor: colors.border }]}>
        {noImage ? (
          <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, textAlign: 'center' }}>
            This version has no image for this table’s board.
          </Text>
        ) : (
          <Button
            title={installed ? 'Reinstall' : rel === -1 ? `Downgrade to ${r.version}` : `Install ${r.version}`}
            icon={installed ? 'refresh' : 'system-update-alt'}
            variant={installed || rel === -1 ? 'secondary' : 'primary'}
            disabled={busy}
            onPress={onInstall}
          />
        )}
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  installBar: { paddingTop: spacing.sm, paddingBottom: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  body: { flex: 1, paddingHorizontal: spacing.lg },
  betaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, marginBottom: spacing.xs },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  tag: { fontSize: font.size.xs, fontWeight: font.weight.medium, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1, overflow: 'hidden' },
})
