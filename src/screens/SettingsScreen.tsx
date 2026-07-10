import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Image, ScrollView, StyleSheet, Switch, Text, TextInput, View, Pressable } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { board, normalizeBase, testBoard, CLEAR_MODES, type ClearMode } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { useBranding, DEFAULT_BRAND } from '../stores/useBranding'
import { usePreviews } from '../stores/usePreviews'
import { toast } from '../stores/useToast'
import { importPreviews } from '../lib/importPreviews'
import { syncPreviewBundle } from '../lib/previewSync'
import { Button, Card, CardTitle, IconButton, Select } from '../components/ui'
import { Screen } from '../components/Screen'
import { StillSands } from '../components/StillSands'
import { UpdatesCard } from '../components/UpdatesCard'
import { useDiscovery, type DiscoveredTable } from '../lib/discovery'
import { playlistName } from '../lib/playlists'
import { pickLogo, clearLogo } from '../lib/branding'
import { pauseToSeconds, secondsToPause } from '../lib/pauseUnits'
import { radius, spacing, font } from '../theme'

// Homing modes the firmware exposes via $Sand/HomingMode (mirrors dw).
const HOMING_MODES: { mode: 'crash' | 'sensor'; label: string; desc: string }[] = [
  { mode: 'crash', label: 'Crash homing', desc: 'Y axis moves until a physical stop, then theta and rho are set to 0.' },
  { mode: 'sensor', label: 'Sensor homing', desc: 'Homes both X and Y axes using sensors.' },
]

// dw-style clear-pattern labels for the auto-play selector.
const CLEAR_LABELS: Record<ClearMode, string> = {
  none: 'None',
  adaptive: 'Adaptive',
  in: 'Clear from center',
  out: 'Clear from perimeter',
  sideway: 'Clear sideways',
  random: 'Random',
}

export function SettingsScreen() {
  const colors = useTheme((s) => s.colors)
  const { boards, activeId, addBoard, removeBoard, renameBoard, updateBase, setActive, getActiveBase } = useBoards()
  const base = getActiveBase()

  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [testing, setTesting] = useState(false)
  // Inline rename of an existing table row.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const startEdit = (id: string, current: string) => {
    setEditingId(id)
    setEditName(current)
  }
  const commitEdit = () => {
    if (!editingId) return
    renameBoard(editingId, editName)
    setEditingId(null)
  }
  // Auto-play on boot: which playlist runs after the table powers on + homes,
  // plus the boot-run options (separate from the manual-run $Playlist/* settings).
  const [autostart, setAutostart] = useState('')
  const [playlistNames, setPlaylistNames] = useState<string[]>([])
  const [bootLoop, setBootLoop] = useState(true)
  const [bootShuffle, setBootShuffle] = useState(false)
  const [bootPauseVal, setBootPauseVal] = useState('0')
  const [bootPauseUnit, setBootPauseUnit] = useState<'sec' | 'min' | 'hr'>('sec')
  const [bootPauseFromStart, setBootPauseFromStart] = useState(false)
  const [bootClear, setBootClear] = useState<ClearMode>('none')
  // Homing mode ($Sand/HomingMode) + sensor offset ($Sand/ThetaOffset, degrees).
  // Both are idle-gated by the firmware, so we only allow changes when idle.
  const [homingMode, setHomingMode] = useState<'crash' | 'sensor'>('sensor')
  const [thetaOffset, setThetaOffset] = useState('0')
  // Auto-home during playlists ($Playlist/AutoHome=<n>, 0 = off): re-home every N
  // patterns to correct mechanical drift over long runs.
  const [autoHomeEnabled, setAutoHomeEnabled] = useState(false)
  const [autoHomeEvery, setAutoHomeEvery] = useState('5')
  // The firmware rejects homing-mode/offset writes unless the table is Idle.
  const tableIdle = useStatus((s) => (s.status?.state ?? 'Idle') === 'Idle')
  // Remember the last playlist so the Enable toggle can restore it.
  const lastPlaylistRef = useRef('')

  const { available: discoveryAvailable, scanning, tables: found, start, stop } = useDiscovery()
  const knownBases = new Set(boards.map((b) => b.base))

  // App branding (custom name + logo), stored locally on this device.
  const brand = useBranding((s) => s.name)
  const setBrandName = useBranding((s) => s.setName)
  const brandLogo = useBranding((s) => s.logoUri)
  const setBrandLogo = useBranding((s) => s.setLogo)
  const chooseLogo = async () => {
    try {
      const uri = await pickLogo()
      if (uri) {
        setBrandLogo(uri)
        toast.success('Logo updated')
      }
    } catch (e) {
      toast.error((e as Error).message || 'Could not load that image')
    }
  }
  const removeLogo = () => {
    clearLogo()
    setBrandLogo(null)
  }

  // User-ingested pattern previews (matched to patterns by file name).
  const previewCount = usePreviews((s) => Object.keys(s.map).length)
  const addPreviews = usePreviews((s) => s.addMany)
  const clearPreviews = usePreviews((s) => s.clear)
  const [importingPreviews, setImportingPreviews] = useState(false)
  const [syncingPreviews, setSyncingPreviews] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  // Pull the preview bundle the SD Card Pattern Manager writes to the card.
  // This also runs automatically once per session; the button is for "I just
  // updated the card" moments and for making the outcome visible.
  const doSyncPreviews = async () => {
    if (!base) return
    setSyncingPreviews(true)
    setSyncMsg(null)
    try {
      const res = await syncPreviewBundle(base, (p) => {
        if (p.stage === 'checking') {
          setSyncMsg('Checking the card for a preview bundle…')
        } else if (p.stage === 'downloading') {
          setSyncMsg(
            `Downloading bundle ${p.shard} of ${p.totalShards} (${Math.max(1, Math.round(p.bytes / 1024))} KB)…`
          )
        } else {
          setSyncMsg(
            `Saved ${p.images} preview${p.images === 1 ? '' : 's'} (bundle ${p.shard} of ${p.totalShards})…`
          )
        }
      })
      if (res.status === 'busy') {
        toast.error('The table is running — try again when it’s idle')
      } else if (res.status === 'no-bundle') {
        toast.error('No preview bundle on the card — build one with the SD Card Pattern Manager (duneweaver.com/install)')
      } else if (res.imagesIngested === 0) {
        toast.success('Previews already up to date')
      } else {
        toast.success(`Synced ${res.imagesIngested} preview${res.imagesIngested > 1 ? 's' : ''} from the table`)
      }
    } finally {
      setSyncingPreviews(false)
      setSyncMsg(null)
    }
  }

  const doImportPreviews = async () => {
    setImportingPreviews(true)
    try {
      const res = await importPreviews()
      if (!res) return // cancelled
      const { entries, failed } = res
      addPreviews(entries)
      if (entries.length === 0) {
        toast.error(failed.length ? `No usable images (skipped ${failed.length})` : 'No images selected')
        return
      }
      const added = `Imported ${entries.length} preview${entries.length > 1 ? 's' : ''}`
      toast.success(failed.length ? `${added}, skipped ${failed.length}` : added)
    } catch (e) {
      toast.error((e as Error).message || 'Import failed')
    } finally {
      setImportingPreviews(false)
    }
  }

  const confirmClearPreviews = () => {
    if (previewCount === 0) return
    Alert.alert('Clear previews', `Remove all ${previewCount} imported preview image${previewCount > 1 ? 's' : ''}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => { clearPreviews(); toast.success('Previews cleared') } },
    ])
  }

  const addDiscovered = (t: DiscoveredTable) => {
    if (knownBases.has(t.base)) {
      toast.error('Already added')
      return
    }
    // Same table, new DHCP address? Match on the stored mDNS hostname (display
    // name as fallback for boards saved before hostnames were stored) and
    // repoint the existing entry instead of creating a duplicate.
    const moved = boards.find((b) => (b.hostname ?? b.name).trim().toLowerCase() === t.name.trim().toLowerCase())
    if (moved) {
      updateBase(moved.id, t.base, t.name)
      toast.success(`${moved.name} updated to ${t.address}`)
      return
    }
    addBoard(t.name, t.base, t.name)
    toast.success(`Added ${t.name}`)
  }

  const loadSettings = useCallback(async () => {
    if (!base) {
      setAutostart('')
      setPlaylistNames([])
      return
    }
    try {
      const s = await board.settings(base)
      setAutostart(s['Playlist/Autostart'] ?? '')
      setBootLoop((s['Playlist/AutostartMode'] ?? 'loop').toLowerCase() !== 'single')
      setBootShuffle((s['Playlist/AutostartShuffle'] ?? '').toUpperCase() === 'ON' || s['Playlist/AutostartShuffle'] === '1')
      setBootPauseFromStart((s['Playlist/AutostartPauseFromStart'] ?? '').toUpperCase() === 'ON' || s['Playlist/AutostartPauseFromStart'] === '1')
      setBootClear(CLEAR_MODES.find((c) => c.mode === s['Playlist/AutostartClear'])?.mode ?? 'none')
      const ah = parseInt(s['Playlist/AutoHome'] ?? '0', 10) || 0
      setAutoHomeEnabled(ah > 0)
      if (ah > 0) setAutoHomeEvery(String(ah))
      setHomingMode((s['Sand/HomingMode'] ?? 'sensor').toLowerCase() === 'crash' ? 'crash' : 'sensor')
      setThetaOffset(String(parseInt(s['Sand/ThetaOffset'] ?? '0', 10) || 0))
      // Derive a friendly unit from the stored seconds.
      const { unit, value } = secondsToPause(parseInt(s['Playlist/AutostartPause'] ?? '0', 10) || 0)
      setBootPauseUnit(unit)
      setBootPauseVal(String(value))
    } catch {
      // keep whatever we had
    }
    try {
      setPlaylistNames((await board.playlists(base)).map(playlistName))
    } catch {
      // keep whatever we had
    }
  }, [base])

  // Apply a boot-setting change optimistically; roll back (reload) on failure.
  const saveBoot = (apply: () => Promise<void>) => {
    apply().catch(() => {
      toast.error('Could not save auto-play setting')
      loadSettings()
    })
  }

  const setBootPlaylist = (next: string) => {
    if (!base) return
    setAutostart(next)
    saveBoot(() => board.setPlaylistAutostart(base, next))
  }

  const toggleAutoplay = (on: boolean) => {
    if (on) {
      const pl = autostart || lastPlaylistRef.current || playlistNames[0] || ''
      if (!pl) {
        toast.error('Create a playlist first')
        return
      }
      setBootPlaylist(pl)
    } else {
      if (autostart) lastPlaylistRef.current = autostart
      setBootPlaylist('')
    }
  }

  // Homing-mode change (idle-gated). Optimistic; revert + reload on rejection.
  const changeHomingMode = (mode: 'crash' | 'sensor') => {
    if (!base || mode === homingMode) return
    const prev = homingMode
    setHomingMode(mode)
    board.setHomingMode(base, mode).catch(() => {
      toast.error(tableIdle ? 'Could not save homing mode' : 'Stop the pattern to change homing mode')
      setHomingMode(prev)
      loadSettings()
    })
  }
  const commitThetaOffset = () => {
    if (!base) return
    const deg = (((Math.round(Number(thetaOffset) || 0)) % 360) + 360) % 360 // 0..359
    setThetaOffset(String(deg))
    board.setThetaOffset(base, deg).catch(() => {
      toast.error(tableIdle ? 'Could not save sensor offset' : 'Stop the pattern to change sensor offset')
      loadSettings()
    })
  }

  // Push an AutoHome change; roll back (reload) on failure.
  const commitAutoHome = (every: number) => {
    if (!base) return
    board.setPlaylistAutoHome(base, every).catch(() => {
      toast.error('Could not save homing setting')
      loadSettings()
    })
  }
  const toggleAutoHome = (on: boolean) => {
    setAutoHomeEnabled(on)
    commitAutoHome(on ? Math.max(1, Number(autoHomeEvery) || 5) : 0)
  }
  const commitAutoHomeEvery = () => {
    const n = Math.max(1, Number(autoHomeEvery) || 1)
    setAutoHomeEvery(String(n))
    if (autoHomeEnabled) commitAutoHome(n)
  }

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

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
    } finally {
      setTesting(false)
    }
  }

  return (
    <Screen title="Settings">
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 160, gap: spacing.lg }}>
        <Card>
          <CardTitle>Tables</CardTitle>
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
                        onEndEditing={commitEdit}
                        autoFocus
                        returnKeyType="done"
                        placeholder={b.base}
                        placeholderTextColor={colors.mutedForeground}
                        style={[styles.renameInput, { color: colors.foreground, backgroundColor: colors.inputBackground, borderColor: colors.border }]}
                      />
                    ) : (
                      <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>{b.name}</Text>
                    )}
                    <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>{b.base}</Text>
                  </View>
                  {editing ? (
                    <IconButton icon="check" size={20} color={colors.primary} onPress={commitEdit} />
                  ) : (
                    <IconButton icon="edit" size={18} color={colors.mutedForeground} onPress={() => startEdit(b.id, b.name)} />
                  )}
                  <IconButton icon="delete-outline" size={20} color={colors.mutedForeground} onPress={() => removeBoard(b.id)} />
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
                    <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>{t.base}</Text>
                  </View>
                  <MaterialIcons name={knownBases.has(t.base) ? 'check' : 'add'} size={22} color={knownBases.has(t.base) ? colors.success : colors.primary} />
                </Pressable>
              ))}
              {scanning && found.length > 0 ? (
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, textAlign: 'center' }}>Still scanning…</Text>
              ) : null}
              {!scanning && found.length === 0 ? (
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, textAlign: 'center' }}>
                  Tip: the phone and table must be on the same Wi-Fi.
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.addForm}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Name (optional)"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground }]}
            />
            <TextInput
              value={host}
              onChangeText={setHost}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="IP or host (e.g. 192.168.68.160)"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground }]}
            />
            <Button title="Test & add table" icon="add" loading={testing} onPress={add} />
          </View>
        </Card>

        {base ? (
          <Card>
            <CardTitle>Auto-play on boot</CardTitle>
            <View style={styles.bootRow}>
              <View style={{ flex: 1, paddingRight: spacing.md }}>
                <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>Enable auto-play</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>Automatically start a playlist after the table powers on and homes.</Text>
              </View>
              <Switch value={!!autostart} onValueChange={toggleAutoplay} />
            </View>

            {autostart ? (
              <View style={{ marginTop: spacing.md, gap: spacing.md }}>
                <View>
                  <Text style={[styles.bootLabel, { color: colors.foreground }]}>Startup playlist</Text>
                  <Select
                    value={autostart}
                    options={[
                      ...playlistNames.map((n) => ({ value: n, label: n })),
                      ...(autostart && !playlistNames.includes(autostart) ? [{ value: autostart, label: autostart }] : []),
                    ]}
                    onChange={setBootPlaylist}
                  />
                </View>

                <View>
                  <Text style={[styles.bootLabel, { color: colors.foreground }]}>Run mode</Text>
                  <Select
                    value={bootLoop ? 'loop' : 'single'}
                    options={[
                      { value: 'single', label: 'Single (play once)' },
                      { value: 'loop', label: 'Loop (repeat forever)' },
                    ]}
                    onChange={(v) => { const loop = v === 'loop'; setBootLoop(loop); saveBoot(() => board.setPlaylistAutostartMode(base, loop ? 'loop' : 'single')) }}
                  />
                </View>

                <View>
                  <Text style={[styles.bootLabel, { color: colors.foreground }]}>Pause between patterns</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                    <TextInput
                      value={bootPauseVal}
                      onChangeText={(t) => setBootPauseVal(t.replace(/[^0-9]/g, ''))}
                      onEndEditing={() => saveBoot(() => board.setPlaylistAutostartPause(base, pauseToSeconds(Number(bootPauseVal) || 0, bootPauseUnit)))}
                      keyboardType="number-pad"
                      style={[styles.numInput, { color: colors.foreground, backgroundColor: colors.inputBackground, borderColor: colors.border }]}
                    />
                    <View style={{ flex: 1 }}>
                      <Select
                        value={bootPauseUnit}
                        options={[{ value: 'sec', label: 'seconds' }, { value: 'min', label: 'minutes' }, { value: 'hr', label: 'hours' }]}
                        onChange={(u) => { setBootPauseUnit(u); saveBoot(() => board.setPlaylistAutostartPause(base, pauseToSeconds(Number(bootPauseVal) || 0, u))) }}
                      />
                    </View>
                  </View>
                </View>

                <View>
                  <Text style={[styles.bootLabel, { color: colors.foreground }]}>Clear before each pattern</Text>
                  <Select
                    value={bootClear}
                    options={CLEAR_MODES.map((c) => ({ value: c.mode, label: CLEAR_LABELS[c.mode] }))}
                    onChange={(m) => { setBootClear(m); saveBoot(() => board.setPlaylistAutostartClear(base, m)) }}
                  />
                </View>

                <View style={styles.bootRow}>
                  <View style={{ flex: 1, paddingRight: spacing.md }}>
                    <Text style={{ color: colors.foreground }}>Pause from start</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>Measure the gap from each pattern’s start, not its end.</Text>
                  </View>
                  <Switch value={bootPauseFromStart} onValueChange={(v) => { setBootPauseFromStart(v); saveBoot(() => board.setPlaylistAutostartPauseFromStart(base, v)) }} />
                </View>

                <View style={styles.bootRow}>
                  <View style={{ flex: 1, paddingRight: spacing.md }}>
                    <Text style={{ color: colors.foreground }}>Shuffle</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>Randomize the pattern order.</Text>
                  </View>
                  <Switch value={bootShuffle} onValueChange={(v) => { setBootShuffle(v); saveBoot(() => board.setPlaylistAutostartShuffle(base, v)) }} />
                </View>
              </View>
            ) : null}
          </Card>
        ) : null}

        {base ? (
          <Card>
            <CardTitle>Homing</CardTitle>

            <Text style={[styles.bootLabel, { color: colors.foreground }]}>Homing mode</Text>
            {HOMING_MODES.map(({ mode, label, desc }) => {
              const on = homingMode === mode
              return (
                <Pressable
                  key={mode}
                  onPress={() => changeHomingMode(mode)}
                  disabled={!tableIdle}
                  style={[styles.homingOpt, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.cardElevated : 'transparent', opacity: tableIdle ? 1 : 0.5 }]}
                >
                  <MaterialIcons name={on ? 'radio-button-checked' : 'radio-button-unchecked'} size={20} color={on ? colors.primary : colors.mutedForeground} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>{label}</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>{desc}</Text>
                  </View>
                </Pressable>
              )
            })}

            {homingMode === 'sensor' ? (
              <View style={{ marginTop: spacing.sm }}>
                <Text style={[styles.bootLabel, { color: colors.foreground }]}>Sensor offset (degrees)</Text>
                <TextInput
                  value={thetaOffset}
                  onChangeText={(t) => setThetaOffset(t.replace(/[^0-9]/g, ''))}
                  onEndEditing={commitThetaOffset}
                  editable={tableIdle}
                  keyboardType="number-pad"
                  style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground, opacity: tableIdle ? 1 : 0.5 }]}
                />
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginTop: spacing.sm }}>
                  Angle the radial arm is offset by — pick a value so it points East.
                </Text>
              </View>
            ) : null}

            {!tableIdle ? (
              <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginTop: spacing.sm }}>
                Homing mode and offset can only change while the table is idle.
              </Text>
            ) : null}

            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: spacing.md }} />

            <View style={styles.bootRow}>
              <View style={{ flex: 1, paddingRight: spacing.md }}>
                <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>Auto-home during playlists</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>Re-home the table every so often while a playlist runs to correct mechanical drift.</Text>
              </View>
              <Switch value={autoHomeEnabled} onValueChange={toggleAutoHome} />
            </View>
            {autoHomeEnabled ? (
              <View style={{ marginTop: spacing.md }}>
                <Text style={[styles.bootLabel, { color: colors.foreground }]}>Home after every</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                  <TextInput
                    value={autoHomeEvery}
                    onChangeText={(t) => setAutoHomeEvery(t.replace(/[^0-9]/g, ''))}
                    onEndEditing={commitAutoHomeEvery}
                    keyboardType="number-pad"
                    style={[styles.numInput, { color: colors.foreground, backgroundColor: colors.inputBackground, borderColor: colors.border }]}
                  />
                  <Text style={{ color: colors.mutedForeground }}>patterns</Text>
                </View>
              </View>
            ) : null}
            <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginTop: spacing.md }}>
              Tip: home the table manually any time from the Control tab.
            </Text>
          </Card>
        ) : null}

        {base ? <StillSands base={base} /> : null}

        <Card>
          <CardTitle>Pattern previews</CardTitle>
          <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginBottom: spacing.md }}>
            Thumbnails for patterns loaded straight onto the SD card. “Sync previews from table” pulls the preview bundle the SD Card Pattern Manager writes to the card (it also happens automatically once per session). Or import images manually — they’re matched to patterns by file name (e.g. “star.thr.webp” → the “star.thr” pattern); use black-on-transparent exports like the built-in library.
          </Text>
          {base ? (
            <View style={{ marginBottom: spacing.sm }}>
              <Button
                title="Sync previews from table"
                icon="sync"
                variant="secondary"
                loading={syncingPreviews}
                onPress={doSyncPreviews}
              />
              {syncingPreviews ? (
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontSize: font.size.xs,
                    marginTop: spacing.xs,
                    textAlign: 'center',
                  }}
                >
                  {syncMsg ?? 'Checking the card for a preview bundle…'}
                  {'\n'}This can take a while — keep the app open.
                </Text>
              ) : null}
            </View>
          ) : null}
          <Button
            title="Import preview images"
            icon="add-photo-alternate"
            variant="secondary"
            loading={importingPreviews}
            onPress={doImportPreviews}
          />
          {previewCount > 0 ? (
            <View style={styles.previewMeta}>
              <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>{previewCount} imported</Text>
              <IconButton icon="delete-outline" size={22} color={colors.mutedForeground} onPress={confirmClearPreviews} />
            </View>
          ) : null}
        </Card>

        <Card>
          <CardTitle>App branding</CardTitle>
          <View style={styles.brandRow}>
            <Image source={brandLogo ? { uri: brandLogo } : require('../../assets/dw-logo.png')} style={[styles.brandPreview, { borderColor: colors.border }]} />
            <View style={{ flex: 1, gap: spacing.sm }}>
              <Button title={brandLogo ? 'Change logo' : 'Choose logo'} icon="image" variant="secondary" onPress={chooseLogo} />
              {brandLogo ? <Button title="Remove logo" icon="close" variant="secondary" onPress={removeLogo} /> : null}
            </View>
          </View>
          <TextInput
            value={brand}
            onChangeText={setBrandName}
            placeholder={DEFAULT_BRAND}
            placeholderTextColor={colors.mutedForeground}
            style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground, marginTop: spacing.md }]}
          />
          <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginTop: spacing.sm }}>
            Shown in the app header and welcome screen. Stored on this device only.
          </Text>
        </Card>

        <UpdatesCard base={base} />
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.sm },
  discover: { gap: spacing.sm, marginTop: spacing.sm },
  foundRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  addForm: { gap: spacing.sm, marginTop: spacing.md },
  input: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 46, fontSize: font.size.md },
  renameInput: { borderRadius: radius.sm, borderWidth: 1, paddingHorizontal: spacing.sm, height: 38, fontSize: font.size.md, fontWeight: font.weight.medium },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  previewMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  homingOpt: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.sm },
  brandPreview: { width: 64, height: 64, borderRadius: 14, borderWidth: 1 },
  bootLabel: { fontSize: font.size.sm, fontWeight: font.weight.medium, marginBottom: spacing.sm, marginTop: spacing.sm },
  bootRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
  numInput: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 40, width: 90, textAlign: 'center', fontSize: font.size.md },
})
