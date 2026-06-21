import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Image, ScrollView, StyleSheet, Switch, Text, TextInput, View, Pressable } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import Constants from 'expo-constants'
import { board, normalizeBase, testBoard, CLEAR_MODES, type ClearMode } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { useBranding, DEFAULT_BRAND } from '../stores/useBranding'
import { toast } from '../stores/useToast'
import { Button, Card, CardTitle, IconButton, Select } from '../components/ui'
import { Screen } from '../components/Screen'
import { useDiscovery, type DiscoveredTable } from '../lib/discovery'
import { playlistName } from '../lib/playlists'
import { pickLogo, clearLogo } from '../lib/branding'
import { radius, spacing, font } from '../theme'

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
  const { boards, activeId, addBoard, removeBoard, setActive, getActiveBase } = useBoards()
  const base = getActiveBase()

  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [testing, setTesting] = useState(false)
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

  const addDiscovered = (t: DiscoveredTable) => {
    if (knownBases.has(t.base)) {
      toast.error('Already added')
      return
    }
    addBoard(t.name, t.base)
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
      // Derive a friendly unit from the stored seconds.
      const secs = parseInt(s['Playlist/AutostartPause'] ?? '0', 10) || 0
      if (secs && secs % 3600 === 0) {
        setBootPauseUnit('hr')
        setBootPauseVal(String(secs / 3600))
      } else if (secs && secs % 60 === 0) {
        setBootPauseUnit('min')
        setBootPauseVal(String(secs / 60))
      } else {
        setBootPauseUnit('sec')
        setBootPauseVal(String(secs))
      }
    } catch {
      // keep whatever we had
    }
    try {
      setPlaylistNames((await board.playlists(base)).map(playlistName))
    } catch {
      // keep whatever we had
    }
  }, [base])

  const pauseToSeconds = (val: string, unit: 'sec' | 'min' | 'hr') => {
    const v = Number(val) || 0
    return unit === 'hr' ? Math.round(v * 3600) : unit === 'min' ? Math.round(v * 60) : Math.round(v)
  }

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
              return (
                <Pressable
                  key={b.id}
                  onPress={() => setActive(b.id)}
                  style={[styles.boardRow, { borderColor: active ? colors.primary : colors.border }]}
                >
                  <MaterialIcons name={active ? 'radio-button-checked' : 'radio-button-unchecked'} size={20} color={active ? colors.primary : colors.mutedForeground} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>{b.name}</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>{b.base}</Text>
                  </View>
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
                      onEndEditing={() => saveBoot(() => board.setPlaylistAutostartPause(base, pauseToSeconds(bootPauseVal, bootPauseUnit)))}
                      keyboardType="number-pad"
                      style={[styles.numInput, { color: colors.foreground, backgroundColor: colors.inputBackground, borderColor: colors.border }]}
                    />
                    <View style={{ flex: 1 }}>
                      <Select
                        value={bootPauseUnit}
                        options={[{ value: 'sec', label: 'seconds' }, { value: 'min', label: 'minutes' }, { value: 'hr', label: 'hours' }]}
                        onChange={(u) => { setBootPauseUnit(u); saveBoot(() => board.setPlaylistAutostartPause(base, pauseToSeconds(bootPauseVal, u))) }}
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

        <Text style={{ color: colors.mutedForeground, textAlign: 'center', fontSize: font.size.xs }}>
          Dune Weaver Mobile · v{Constants.expoConfig?.version ?? '1.0.0'}
        </Text>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  cardTitle: { fontSize: font.size.md, fontWeight: font.weight.semibold, marginBottom: spacing.md },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.sm },
  discover: { gap: spacing.sm, marginTop: spacing.sm },
  foundRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  addForm: { gap: spacing.sm, marginTop: spacing.md },
  input: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 46, fontSize: font.size.md },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  brandPreview: { width: 64, height: 64, borderRadius: 14, borderWidth: 1 },
  bootLabel: { fontSize: font.size.sm, fontWeight: font.weight.medium, marginBottom: spacing.sm, marginTop: spacing.sm },
  bootRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
  numInput: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 40, width: 90, textAlign: 'center', fontSize: font.size.md },
})
