// Bottom-sheet picker for installing a SPECIFIC firmware version (not just the
// latest). Lists every GitHub release that ships a firmware.bin, newest first,
// marks the one currently on the table, and flags downgrades. Picking a row
// hands the release back to UpdatesCard, which runs the same confirm + OTA flow
// as the "Update to latest" button (runFirmwareUpdate takes any firmware URL).

import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MaterialIcons } from '@expo/vector-icons'
import { fetchFirmwareReleases, type FirmwareRelease } from '../lib/updates'
import { parseVersion } from '../lib/version'
import { useTheme } from '../stores/useTheme'
import { Button, IconButton } from './ui'
import { radius, spacing, font } from '../theme'

/** Same parsed version? (normalizes the `v` prefix and firmware's git_info tail). */
function sameVersion(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) return false
  return pa.every((n, i) => n === pb[i])
}

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
  busy,
  onClose,
  onSelect,
}: {
  visible: boolean
  currentFw: string | null
  /** An install is already running — disable row taps. */
  busy: boolean
  onClose: () => void
  onSelect: (release: FirmwareRelease) => void
}) {
  const colors = useTheme((s) => s.colors)
  const [releases, setReleases] = useState<FirmwareRelease[] | null>(null)
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.header}>
            <Text style={{ color: colors.foreground, fontSize: font.size.lg, fontWeight: font.weight.semibold, flex: 1 }}>
              Firmware versions
            </Text>
            <IconButton icon="close" size={22} color={colors.mutedForeground} label="Close" onPress={onClose} />
          </View>

          {loading ? (
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
              <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginBottom: spacing.xs }}>
                Installing an older version is a downgrade — the app will ask you to confirm. The table restarts after any install.
              </Text>
              {(releases ?? []).map((r) => {
                const installed = sameVersion(r.version, currentFw)
                const rel = relativeTo(r.version, currentFw)
                return (
                  <Pressable
                    key={r.version}
                    disabled={busy || installed}
                    onPress={() => onSelect(r)}
                    style={[
                      styles.item,
                      {
                        borderColor: installed ? colors.primary : colors.border,
                        backgroundColor: installed ? colors.cardElevated : 'transparent',
                        opacity: busy && !installed ? 0.5 : 1,
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
                      </View>
                      {r.publishedAt ? (
                        <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginTop: 2 }}>{fmtDate(r.publishedAt)}</Text>
                      ) : null}
                      {r.notes ? (
                        <Text numberOfLines={2} style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginTop: 4 }}>
                          {r.notes.replace(/\r?\n+/g, ' ').trim()}
                        </Text>
                      ) : null}
                    </View>
                    {!installed ? <MaterialIcons name="system-update-alt" size={22} color={colors.primary} /> : null}
                  </Pressable>
                )
              })}
            </ScrollView>
          )}
          <SafeAreaView edges={['bottom']} />
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '85%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, paddingTop: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  tag: { fontSize: font.size.xs, fontWeight: font.weight.medium, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 1, overflow: 'hidden' },
})
