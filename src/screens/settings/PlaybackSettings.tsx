import React, { useCallback, useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { board, CLEAR_MODES, type ClearMode } from '../../api/board'
import { useTheme } from '../../stores/useTheme'
import { toast } from '../../stores/useToast'
import { Card, CardTitle, Select, Toggle } from '../../components/ui'
import { ClearPatternsCard } from '../../components/ClearPatternsCard'
import { playlistName } from '../../lib/playlists'
import { pauseToSeconds, secondsToPause } from '../../lib/pauseUnits'
import { SettingsPage, useActiveBase } from './SettingsPage'
import { radius, spacing, font } from '../../theme'

/** How the table plays on its own: auto-play on boot, the clears between
 * patterns, and re-homing during long playlists. */
export function PlaybackSettings(): React.JSX.Element {
  const base = useActiveBase()
  return (
    <SettingsPage title="Playback" table gated>
      {base ? <PlaybackCards base={base} /> : null}
    </SettingsPage>
  )
}

function PlaybackCards({ base }: { base: string }): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
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
  // Auto-home during playlists ($Playlist/AutoHome=<n>, 0 = off): re-home every N
  // patterns to correct mechanical drift over long runs.
  const [autoHomeEnabled, setAutoHomeEnabled] = useState(false)
  const [autoHomeEvery, setAutoHomeEvery] = useState('5')
  // Remember the last playlist so the toggle can restore it.
  const lastPlaylistRef = useRef('')

  const loadSettings = useCallback(async () => {
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

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // Apply a boot-setting change optimistically; roll back (reload) on failure.
  const saveBoot = (apply: () => Promise<void>) => {
    apply().catch(() => {
      toast.error('Could not save auto-play setting')
      loadSettings()
    })
  }

  const setBootPlaylist = (next: string) => {
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

  // Push an AutoHome change; roll back (reload) on failure.
  const commitAutoHome = (every: number) => {
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

  return (
    <>
      <Card>
        <CardTitle>Auto-play on boot</CardTitle>
        <View style={styles.row}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>Play a playlist on startup</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>Automatically start a playlist after the table powers on and homes.</Text>
          </View>
          <Toggle value={!!autostart} onValueChange={toggleAutoplay} />
        </View>

        {autostart ? (
          <View style={{ marginTop: spacing.md, gap: spacing.md }}>
            <View>
              <Text style={[styles.label, { color: colors.foreground }]}>Startup playlist</Text>
              <Select
                value={autostart}
                options={[
                  ...playlistNames.map((n) => ({ value: n, label: n })),
                  ...(autostart && !playlistNames.includes(autostart) ? [{ value: autostart, label: autostart }] : []),
                ]}
                onChange={setBootPlaylist}
              />
            </View>

            {/* Same options, names and order as the Playlists editor. */}
            <View style={styles.row}>
              <Text style={{ flex: 1, color: colors.foreground }}>Shuffle</Text>
              <Toggle value={bootShuffle} onValueChange={(v) => { setBootShuffle(v); saveBoot(() => board.setPlaylistAutostartShuffle(base, v)) }} />
            </View>

            <View style={styles.row}>
              <Text style={{ flex: 1, color: colors.foreground }}>Repeat</Text>
              <Toggle value={bootLoop} onValueChange={(v) => { setBootLoop(v); saveBoot(() => board.setPlaylistAutostartMode(base, v ? 'loop' : 'single')) }} />
            </View>

            <View>
              <Text style={[styles.label, { color: colors.foreground }]}>Pause between patterns</Text>
              <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
                <TextInput
                  value={bootPauseVal}
                  onChangeText={(t) => setBootPauseVal(t.replace(/[^0-9]/g, ''))}
                  // onBlur, not onEndEditing: react-native-web (desktop) never fires onEndEditing.
                  onBlur={() => saveBoot(() => board.setPlaylistAutostartPause(base, pauseToSeconds(Number(bootPauseVal) || 0, bootPauseUnit)))}
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

            <View style={styles.row}>
              <View style={{ flex: 1, paddingRight: spacing.md }}>
                <Text style={{ color: colors.foreground }}>Pause from start</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>Measure the gap from each pattern’s start, not its end.</Text>
              </View>
              <Toggle value={bootPauseFromStart} onValueChange={(v) => { setBootPauseFromStart(v); saveBoot(() => board.setPlaylistAutostartPauseFromStart(base, v)) }} />
            </View>

            <View>
              <Text style={[styles.label, { color: colors.foreground }]}>Clear before each pattern</Text>
              <Select
                value={bootClear}
                options={CLEAR_MODES.map((c) => ({ value: c.mode, label: c.label }))}
                onChange={(m) => { setBootClear(m); saveBoot(() => board.setPlaylistAutostartClear(base, m)) }}
              />
            </View>
          </View>
        ) : null}
      </Card>

      <ClearPatternsCard base={base} />

      {/* $Playlist/AutoHome is a playlist setting, so it lives with playback, not Homing. */}
      <Card>
        <CardTitle>Auto-home</CardTitle>
        <View style={styles.row}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>Re-home during playlists</Text>
            <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>Re-home the table every few patterns to correct mechanical drift.</Text>
          </View>
          <Toggle value={autoHomeEnabled} onValueChange={toggleAutoHome} />
        </View>
        {autoHomeEnabled ? (
          <View style={{ marginTop: spacing.md }}>
            <Text style={[styles.label, { color: colors.foreground }]}>Home after every</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
              <TextInput
                value={autoHomeEvery}
                onChangeText={(t) => setAutoHomeEvery(t.replace(/[^0-9]/g, ''))}
                onBlur={commitAutoHomeEvery}
                keyboardType="number-pad"
                style={[styles.numInput, { color: colors.foreground, backgroundColor: colors.inputBackground, borderColor: colors.border }]}
              />
              <Text style={{ color: colors.mutedForeground }}>patterns</Text>
            </View>
          </View>
        ) : null}
      </Card>
    </>
  )
}

const styles = StyleSheet.create({
  label: { fontSize: font.size.sm, fontWeight: font.weight.medium, marginBottom: spacing.sm, marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
  numInput: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, minHeight: 40, width: 90, textAlign: 'center', fontSize: font.size.md },
})
