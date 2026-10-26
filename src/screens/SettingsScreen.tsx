// Settings, the list: saved tables first, then one row per settings page,
// grouped by WHERE the setting lives — on the active table (its name heads the
// group; these lock while it draws, see IdleGate.tsx) or on this phone. Each row
// shows the current value so the whole setup reads at a glance; the pages
// themselves are in screens/settings/ (SettingsStack.tsx).
import React, { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect, useNavigation, useTheme as useNavTheme } from '@react-navigation/native'
import { board, normalizeBase, testBoard } from '../api/board'
import { isDemoBase } from '../api/demoBoard'
import { isSettingsLocked } from '../api/status'
import { useBoards, type Board } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { useBranding, brandName } from '../stores/useBranding'
import { usePreviews } from '../stores/usePreviews'
import { useUpdates, appUpdateAvailable, fwUpdateAvailable, APP_VERSION } from '../stores/useUpdates'
import { toast } from '../stores/useToast'
import { Button, Card, IconButton } from '../components/ui'
import { Screen } from '../components/Screen'
import { useDiscovery, type DiscoveredTable } from '../lib/discovery'
import { syncHostname, renameMessage } from '../lib/renameTable'
import { parseSlots } from '../lib/quietSlots'
import { SCROLL_BOTTOM_PAD } from '../lib/layout'
import type { SettingsNav, SettingsStackParamList } from '../navigation'
import { radius, spacing, font } from '../theme'

type Icon = keyof typeof MaterialIcons.glyphMap

/** Row values read from the table's settings, tagged with the base they came from. */
interface TableValues {
  base: string
  playback: string
  stillSands: string
  homing: string
  /** "60 LEDs · GRB"; undefined when the table has no LED strip configured. */
  ledStrip?: string
}

function summarize(base: string, s: Record<string, string>): TableValues {
  const on = (v?: string) => (v ?? '').toUpperCase() === 'ON' || v === '1'
  const autostart = s['Playlist/Autostart'] ?? ''
  const slots = parseSlots(s['Sands/Slots'] ?? '')
  return {
    base,
    playback: autostart ? `Auto-play · ${autostart}` : 'Auto-play off',
    stillSands: !on(s['Sands/Enabled'])
      ? 'Off'
      : slots.length === 1 ? `${slots[0].start}–${slots[0].end}`
      : slots.length > 1 ? `${slots.length} periods`
      : 'On',
    homing: (s['Sand/HomingMode'] ?? 'sensor').toLowerCase() === 'crash' ? 'Crash' : 'Sensor',
    ledStrip: s['LED/Count'] == null
      ? undefined
      : [`${s['LED/Count']} LEDs`, s['LED/Order']?.toUpperCase()].filter(Boolean).join(' · '),
  }
}

export function SettingsScreen(): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const navigation = useNavigation<SettingsNav>()
  const { boards, activeId, addBoard, removeBoard, renameBoard, updateBase, setActive, getActiveBase } = useBoards()
  const base = getActiveBase()
  const active = boards.find((b) => b.id === activeId) ?? null

  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [testing, setTesting] = useState(false)
  // The add-by-address form is a once-per-table job — keep it folded behind a
  // button so the saved tables lead the card.
  const [showAdd, setShowAdd] = useState(false)
  // Inline rename of an existing table row. Renaming here also renames the
  // table ON the network ($Hostname) when its firmware supports it — see
  // lib/renameTable.ts; the local rename lands first and always sticks.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  // The row's TextInput fires onSubmitEditing AND onBlur, which can both
  // land before a re-render — a ref (not the state) is what makes commit
  // idempotent, so the hostname push never runs twice.
  const editingIdRef = useRef<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const startEdit = (id: string, current: string) => {
    editingIdRef.current = id
    setEditingId(id)
    setEditName(current)
  }
  const commitEdit = () => {
    const id = editingIdRef.current
    if (!id) return
    editingIdRef.current = null
    setEditingId(null)
    const before = useBoards.getState().boards.find((b) => b.id === id)
    const next = editName.trim()
    if (!before || !next || next === before.name) return
    renameBoard(id, next)
    setRenamingId(id)
    void syncHostname(id, next)
      .then((outcome) => {
        const msg = renameMessage(outcome, next)
        if (msg) toast[msg.kind](msg.text)
      })
      .finally(() => setRenamingId((cur) => (cur === id ? null : cur)))
  }

  const { available: discoveryAvailable, scanning, tables: found, start, stop } = useDiscovery()
  const knownBases = new Set(boards.map((b) => b.base))

  // One /sand_settings read per visit to the list (re-read on focus, so a value
  // changed on a page is current when you come back). Pages read their own.
  const [values, setValues] = useState<TableValues | null>(null)
  useFocusEffect(
    useCallback(() => {
      if (!base) return
      let live = true
      board
        .settings(base)
        .then((s) => { if (live) setValues(summarize(base, s)) })
        .catch(() => {}) // offline: rows just show no value
      return () => { live = false }
    }, [base])
  )
  const tv = values && values.base === base ? values : null

  // Background update check whenever Settings is shown (the tab stays mounted,
  // so a mount effect would run once per session). 10 min max-age: cheap, and
  // it picks up releases published mid-session.
  const check = useUpdates((s) => s.check)
  useFocusEffect(
    useCallback(() => {
      void check(10 * 60_000)
    }, [check])
  )
  const tableFw = useStatus((s) => s.status?.fw ?? null)
  const fwNew = fwUpdateAvailable(useUpdates((s) => s.fwLatest), tableFw)
  const appNew = appUpdateAvailable(useUpdates((s) => s.appLatest))
  const locked = useStatus((s) => isSettingsLocked(s.status))
  const previewCount = usePreviews((s) => Object.keys(s.map).length)
  const brand = useBranding((s) => s.name)
  const go = (page: keyof SettingsStackParamList) => navigation.navigate(page)

  const addDiscovered = (t: DiscoveredTable) => {
    if (knownBases.has(t.base)) {
      toast.error('Already added')
      return
    }
    // Same table, new DHCP address? Prefer the hardware MAC (from the mDNS TXT
    // record / a status poll) when both sides have one — it survives hostname
    // edits and distinguishes two tables with the same name. Fall back to the
    // stored mDNS hostname (display name for boards saved before hostnames
    // were stored). Repoint the existing entry instead of duplicating.
    const moved = boards.find((b) =>
      t.mac && b.mac
        ? b.mac === t.mac
        : (b.hostname ?? b.name).trim().toLowerCase() === t.name.trim().toLowerCase()
    )
    if (moved) {
      updateBase(moved.id, t.base, t.name, t.mac)
      toast.success(`${moved.name} updated to ${t.address}`)
      return
    }
    addBoard(t.name, t.base, t.name, t.mac)
    toast.success(`Added ${t.name}`)
  }

  // removeBoard drops the entry (and its password); the collected table log is
  // keyed by board id, so a re-add starts a fresh one.
  const confirmRemove = (b: Board) =>
    Alert.alert(
      `Remove “${b.name}”?`,
      `This phone forgets the table${b.key ? ' and its saved API password' : ''}, along with the table logs it collected. Nothing on the table changes, and you can add it again any time.${boards.length === 1 ? ' This is your only table, so the app returns to the welcome screen.' : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => removeBoard(b.id) },
      ]
    )

  const add = async () => {
    if (!host.trim()) {
      toast.error('Enter an IP or hostname')
      return
    }
    setTesting(true)
    try {
      const ok = await testBoard(normalizeBase(host))
      if (!ok) {
        toast.error('Could not reach that table')
        return
      }
      addBoard(name, host)
      toast.success('Table added')
      setName('')
      setHost('')
      setShowAdd(false)
    } finally {
      setTesting(false)
    }
  }

  return (
    <Screen title="Settings">
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: SCROLL_BOTTOM_PAD, gap: spacing.xl }}>
        <View style={styles.group}>
          <SectionHeader title="Tables" />
          <Card>
            {boards.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>No tables yet. Add one below.</Text>
            ) : (
              boards.map((b) => {
                const active = b.id === activeId
                const editing = editingId === b.id
                return (
                  <Pressable
                    key={b.id}
                    onPress={() => { if (!editing) setActive(b.id) }}
                    style={[styles.boardRow, { borderColor: active ? colors.primary : colors.border }]}
                  >
                    <MaterialIcons name={active ? 'radio-button-checked' : 'radio-button-unchecked'} size={20} color={active ? colors.primary : colors.mutedForeground} />
                    <View style={{ flex: 1 }}>
                      {editing ? (
                        <TextInput
                          value={editName}
                          onChangeText={setEditName}
                          onSubmitEditing={commitEdit}
                          // onBlur, not onEndEditing: react-native-web (desktop) never fires onEndEditing.
                          onBlur={commitEdit}
                          autoFocus
                          returnKeyType="done"
                          placeholder={b.base}
                          placeholderTextColor={colors.mutedForeground}
                          style={[styles.renameInput, { color: colors.foreground, backgroundColor: colors.inputBackground, borderColor: colors.border }]}
                        />
                      ) : (
                        <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>{b.name}</Text>
                      )}
                      <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>
                        {b.base}
                        {/* The name the network knows it by — only worth showing
                            when it differs from the display name above. */}
                        {b.hostname && b.hostname.toLowerCase() !== b.name.trim().toLowerCase() ? ` · ${b.hostname}.local` : ''}
                      </Text>
                    </View>
                    {renamingId === b.id ? (
                      <ActivityIndicator color={colors.primary} style={{ width: 34 }} />
                    ) : editing ? (
                      <IconButton icon="check" size={20} color={colors.primary} onPress={commitEdit} />
                    ) : (
                      <IconButton icon="edit" size={18} color={colors.mutedForeground} onPress={() => startEdit(b.id, b.name)} />
                    )}
                    <IconButton icon="delete-outline" size={20} color={colors.mutedForeground} onPress={() => confirmRemove(b)} />
                  </Pressable>
                )
              })
            )}

            {discoveryAvailable ? (
              <View style={styles.discover}>
                <Button
                  title={scanning ? 'Scanning…' : 'Find tables on Wi-Fi'}
                  icon={scanning ? undefined : 'wifi-find'}
                  variant="secondary"
                  loading={scanning && found.length === 0}
                  onPress={scanning ? stop : start}
                />
                {found.map((t) => (
                  <Pressable
                    key={t.key}
                    onPress={() => addDiscovered(t)}
                    style={[styles.foundRow, { borderColor: colors.border, backgroundColor: colors.cardElevated }]}
                  >
                    <MaterialIcons name="cast-connected" size={20} color={colors.primary} />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>{t.name}</Text>
                      <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>{t.base}</Text>
                    </View>
                    <MaterialIcons name={knownBases.has(t.base) ? 'check' : 'add'} size={22} color={knownBases.has(t.base) ? colors.success : colors.primary} />
                  </Pressable>
                ))}
                {scanning && found.length > 0 ? (
                  <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, textAlign: 'center' }}>Still scanning…</Text>
                ) : null}
                {!scanning && found.length === 0 ? (
                  <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, textAlign: 'center' }}>
                    Tip: the phone and table must be on the same Wi-Fi.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {showAdd || boards.length === 0 ? (
              <View style={styles.addForm}>
                {/* The required field first, focused on open; the name is optional. */}
                <TextInput
                  value={host}
                  onChangeText={setHost}
                  autoFocus={boards.length > 0}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  placeholder="IP or host (e.g. 192.168.68.160)"
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground }]}
                />
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Name (optional)"
                  placeholderTextColor={colors.mutedForeground}
                  style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground }]}
                />
                <Button title="Test & add table" icon="add" loading={testing} onPress={add} />
              </View>
            ) : (
              <Button title="Add by IP address" icon="add" variant="ghost" onPress={() => setShowAdd(true)} style={{ marginTop: spacing.sm }} />
            )}
          </Card>
        </View>

        {base && active ? (
          <View style={styles.group}>
            <SectionHeader title={active.name} note={locked ? 'Locked while drawing' : undefined} />
            <Section>
              <NavRow icon="play-circle-outline" label="Playback" value={tv?.playback} onPress={() => go('Playback')} />
              <NavRow icon="bedtime" label="Still Sands" value={tv?.stillSands} onPress={() => go('StillSands')} />
              <NavRow icon="my-location" label="Homing" value={tv?.homing} onPress={() => go('Homing')} />
              {/* Only tables with an LED strip (firmware with $LED/Count) report one. */}
              {tv?.ledStrip ? (
                <NavRow icon="lightbulb-outline" label="LED strip" value={tv.ledStrip} onPress={() => go('LedStrip')} />
              ) : null}
              <NavRow icon="wifi" label="Wi-Fi" onPress={() => go('Wifi')} />
              {/* The demo table has no lock to manage. */}
              {isDemoBase(base) ? null : (
                <NavRow icon="lock-outline" label="Password" value={active.key ? 'On' : undefined} onPress={() => go('Password')} />
              )}
              <NavRow icon="memory" label="Firmware" value={fwNew ? 'Update available' : tableFw ?? undefined} badge={fwNew} onPress={() => go('Firmware')} />
            </Section>
          </View>
        ) : null}

        <View style={styles.group}>
          <SectionHeader title="On this phone" />
          <Section>
            <NavRow icon="grid-view" label="Patterns" value={previewCount > 0 ? `${previewCount} previews` : undefined} onPress={() => go('Patterns')} />
            <NavRow icon="palette" label="Branding" value={brandName(brand)} onPress={() => go('Branding')} />
            <NavRow icon="receipt-long" label="Diagnostics" onPress={() => go('Diagnostics')} />
            <NavRow icon="info-outline" label="About" value={appNew ? 'Update available' : `v${APP_VERSION}`} badge={appNew} onPress={() => go('About')} />
          </Section>
        </View>
      </ScrollView>
    </Screen>
  )
}

/** Group label above a card: whose settings these are. */
function SectionHeader({ title, note }: { title: string; note?: string }): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  return (
    <View style={styles.sectionHeader}>
      <Text numberOfLines={1} style={[styles.sectionTitle, { color: colors.mutedForeground }]}>{title}</Text>
      {note ? (
        <View style={styles.sectionNote}>
          <MaterialIcons name="lock-outline" size={14} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>{note}</Text>
        </View>
      ) : null}
    </View>
  )
}

/** A card of navigation rows, hairline-separated. */
function Section({ children }: { children: React.ReactNode }): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const rows = React.Children.toArray(children).filter(Boolean)
  return (
    <View style={[styles.section, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {rows.map((row, i) => (
        <View key={i}>
          {row}
          {/* Inset to the label, like iOS lists: the icons read as one column. */}
          {i > 0 ? <View style={[styles.separator, { backgroundColor: colors.border }]} /> : null}
        </View>
      ))}
    </View>
  )
}

/** One settings page: icon, name, current value, chevron. */
function NavRow({
  icon,
  label,
  value,
  badge,
  onPress,
}: {
  icon: Icon
  label: string
  value?: string
  /** An update is waiting — the same red as the tab's badge. */
  badge?: boolean
  onPress: () => void
}): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const notification = useNavTheme().colors.notification
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}, ${value}` : label}
      style={({ pressed }) => [styles.navRow, pressed && { backgroundColor: colors.cardElevated }]}
    >
      <View style={[styles.navIcon, { backgroundColor: colors.cardElevated }]}>
        <MaterialIcons name={icon} size={18} color={colors.primary} />
      </View>
      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: font.size.md, fontWeight: font.weight.medium, flexShrink: 0 }}>
        {label}
      </Text>
      <View style={styles.navValue}>
        {badge ? <View style={[styles.badgeDot, { backgroundColor: notification }]} /> : null}
        {value ? (
          <Text numberOfLines={1} style={{ color: badge ? colors.foreground : colors.mutedForeground, fontSize: font.size.md, flexShrink: 1 }}>
            {value}
          </Text>
        ) : null}
      </View>
      <MaterialIcons name="chevron-right" size={22} color={colors.mutedForeground} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, paddingHorizontal: spacing.md },
  sectionTitle: { flexShrink: 1, fontSize: font.size.sm, fontWeight: font.weight.semibold, letterSpacing: 0.6, textTransform: 'uppercase' },
  sectionNote: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  section: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden' },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  navIcon: { width: 30, height: 30, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  navValue: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs },
  badgeDot: { width: 8, height: 8, borderRadius: 4 },
  // Row padding (12) + icon (30) + gap (12): starts under the label.
  separator: { position: 'absolute', top: 0, left: 54, right: 0, height: StyleSheet.hairlineWidth },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.sm },
  discover: { gap: spacing.sm, marginTop: spacing.sm },
  foundRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  addForm: { gap: spacing.sm, marginTop: spacing.md },
  input: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, minHeight: 46, fontSize: font.size.md },
  renameInput: { borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: spacing.sm, minHeight: 38, fontSize: font.size.md, fontWeight: font.weight.medium },
})
