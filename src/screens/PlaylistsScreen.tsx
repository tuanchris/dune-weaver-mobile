import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Dimensions, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { board, CLEAR_MODES, type ClearMode } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { toast } from '../stores/useToast'
import { Button, IconButton } from '../components/ui'
import { Screen } from '../components/Screen'
import { PatternThumb } from '../components/PatternThumb'
import { useLibrary } from '../stores/useLibrary'
import { loadPlaylist, savePlaylist, deletePlaylist, playlistName } from '../lib/playlists'
import { radius, spacing, font } from '../theme'

const PICKER_COLS = 3
const PICKER_THUMB = Math.floor((Dimensions.get('window').width - spacing.md * 2 - spacing.md * (PICKER_COLS - 1)) / PICKER_COLS)

function patternLabel(file: string) {
  return file.replace(/\.thr$/i, '').split('/').pop() ?? file
}

export function PlaylistsScreen() {
  const colors = useTheme((s) => s.colors)
  const base = useBoards((s) => s.getActiveBase())
  const status = useStatus((s) => s.status)
  const refreshStatus = useStatus((s) => s.refresh)

  const [playlists, setPlaylists] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  // Editor state
  const [editorOpen, setEditorOpen] = useState(false)
  const [editExisting, setEditExisting] = useState<string | null>(null) // filename or null (new)
  const [name, setName] = useState('')
  const [items, setItems] = useState<string[]>([])
  const [loop, setLoop] = useState(false)
  const [shuffle, setShuffle] = useState(false)
  const [pauseSec, setPauseSec] = useState('0')
  const [pauseFromStart, setPauseFromStart] = useState(false)
  const [clearMode, setClearMode] = useState<ClearMode>('none')
  const [autoHome, setAutoHome] = useState('0')

  // Pattern picker state. The on-table list comes from the shared store (fetched
  // once at startup) — the picker never triggers its own manifest read.
  const [pickerOpen, setPickerOpen] = useState(false)
  const tablePatterns = useLibrary((s) => s.tablePatterns)
  const loadTable = useLibrary((s) => s.loadTable)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [pickerQuery, setPickerQuery] = useState('')

  const load = useCallback(async () => {
    if (!base) return
    setLoading(true)
    try {
      // /sand_playlists is a motion-safe listing — fine to read during playback.
      setPlaylists(await board.playlists(base))
    } catch {
      toast.error('Failed to load playlists')
    } finally {
      setLoading(false)
    }
  }, [base])

  const activePlaylist = status?.playlist
  useEffect(() => {
    load()
  }, [load])

  const act = async (fn: () => Promise<void>, msg: string) => {
    setBusy(true)
    try {
      await fn()
      toast.success(msg)
      setTimeout(refreshStatus, 400)
    } catch {
      toast.error('Action failed')
    } finally {
      setBusy(false)
    }
  }

  // Mode/Shuffle/Pause/Clear/AutoHome are global NVS settings on the board, not
  // per-playlist — seed the editor from the table's current values so toggles
  // reflect reality.
  const seedSettings = async () => {
    if (!base) return
    try {
      const s = await board.settings(base)
      setLoop((s['Playlist/Mode'] ?? '').toLowerCase() === 'loop')
      setShuffle((s['Playlist/Shuffle'] ?? '').toUpperCase() === 'ON' || s['Playlist/Shuffle'] === '1')
      setPauseSec(String(parseInt(s['Playlist/PauseTime'] ?? '0', 10) || 0))
      setPauseFromStart((s['Playlist/PauseFromStart'] ?? '').toUpperCase() === 'ON' || s['Playlist/PauseFromStart'] === '1')
      setClearMode((CLEAR_MODES.find((c) => c.mode === s['Playlist/ClearPattern'])?.mode ?? 'none'))
      setAutoHome(String(parseInt(s['Playlist/AutoHome'] ?? '0', 10) || 0))
    } catch {
      // keep whatever defaults are showing
    }
  }

  const openNew = () => {
    setEditExisting(null)
    setName('')
    setItems([])
    setLoop(false)
    setShuffle(false)
    setPauseSec('0')
    setPauseFromStart(false)
    setClearMode('none')
    setAutoHome('0')
    setEditorOpen(true)
    seedSettings()
  }

  const openEdit = async (filename: string) => {
    if (!base) return
    setEditExisting(filename)
    setName(playlistName(filename))
    setItems([])
    setEditorOpen(true)
    seedSettings()
    try {
      setItems(await loadPlaylist(base, filename))
    } catch {
      toast.error('Could not read playlist')
    }
  }

  const moveItem = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= items.length) return
    const next = [...items]
    ;[next[i], next[j]] = [next[j], next[i]]
    setItems(next)
  }

  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i))

  const openPicker = () => {
    if (!base) return
    setPicked(new Set())
    setPickerQuery('')
    setPickerOpen(true)
    loadTable(base) // no-op if already loaded; never re-reads mid-job
  }

  const pickerVisible = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    const list = q ? tablePatterns.filter((p) => p.toLowerCase().includes(q)) : tablePatterns
    return [...list].sort((a, b) => a.localeCompare(b))
  }, [tablePatterns, pickerQuery])

  const allPickedVisible = pickerVisible.length > 0 && pickerVisible.every((p) => picked.has(p))

  const toggleSelectAll = () => {
    const next = new Set(picked)
    if (allPickedVisible) pickerVisible.forEach((p) => next.delete(p))
    else pickerVisible.forEach((p) => next.add(p))
    setPicked(next)
  }

  const togglePick = (p: string) => {
    const next = new Set(picked)
    next.has(p) ? next.delete(p) : next.add(p)
    setPicked(next)
  }

  const confirmPicker = () => {
    const additions = [...picked].filter((p) => !items.includes(p))
    setItems([...items, ...additions])
    setPickerOpen(false)
  }

  const save = async () => {
    if (!base) return
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Name the playlist')
      return
    }
    if (items.length === 0) {
      toast.error('Add at least one pattern')
      return
    }
    setBusy(true)
    try {
      await savePlaylist(base, trimmed, items)
      // Apply the playlist options to the board, best-effort: a settings hiccup
      // must not make a successful save look like a failure. Playback is started
      // from the playlist list, not from the editor.
      try {
        await board.setPlaylistMode(base, loop ? 'loop' : 'single')
        await board.setPlaylistShuffle(base, shuffle)
        await board.setPlaylistPause(base, Number(pauseSec) || 0)
        await board.setPlaylistPauseFromStart(base, pauseFromStart)
        await board.setPlaylistClearPattern(base, clearMode)
        await board.setPlaylistAutoHome(base, Number(autoHome) || 0)
      } catch {
        // options are non-critical; the playlist file itself saved fine
      }
      toast.success(`Saved ${trimmed}`)
      setEditorOpen(false)
      await load()
    } catch (e) {
      toast.error(`Save failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const del = () => {
    if (!base || !editExisting) return
    const target = editExisting
    Alert.alert('Delete playlist', `Delete "${playlistName(target)}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setBusy(true)
          try {
            await deletePlaylist(base, target)
            toast.success('Deleted')
            setEditorOpen(false)
            await load()
          } catch {
            toast.error('Delete failed')
          } finally {
            setBusy(false)
          }
        },
      },
    ])
  }

  if (!base) {
    return (
      <Screen>
        <View style={styles.empty}>
          <MaterialIcons name="cable" size={40} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm }}>No table connected.</Text>
        </View>
      </Screen>
    )
  }

  return (
    <Screen title="Playlists" action={<Button title="New" icon="add" onPress={openNew} />}>
      {activePlaylist ? (
        <View style={[styles.activeBar, { backgroundColor: colors.card, borderColor: colors.primary }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>NOW PLAYING PLAYLIST</Text>
            <Text style={{ color: colors.foreground, fontSize: font.size.md, fontWeight: font.weight.semibold }}>
              {activePlaylist.name ?? '—'} · {activePlaylist.index + 1}/{activePlaylist.total}
            </Text>
          </View>
          <Button title="Skip" icon="skip-next" variant="secondary" disabled={busy} onPress={() => act(() => board.skip(base), 'Skipping')} />
          <Button title="Stop" icon="stop" variant="destructive" disabled={busy} onPress={() => act(() => board.stopPlaylist(base), 'Stopping after current')} />
        </View>
      ) : null}

      <FlatList
        data={playlists}
        keyExtractor={(p) => p}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 160 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.primary} />}
        ListEmptyComponent={
          loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : (
            <View style={styles.empty}>
              <MaterialIcons name="playlist-remove" size={40} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm }}>No playlists. Tap “New” to create one.</Text>
            </View>
          )
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => openEdit(item)} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <MaterialIcons name="queue-music" size={22} color={colors.primary} />
            <Text numberOfLines={1} style={[styles.rowName, { color: colors.foreground }]}>
              {playlistName(item)}
            </Text>
            <IconButton icon="edit" size={20} color={colors.mutedForeground} onPress={() => openEdit(item)} />
            <Pressable
              onPress={() => act(() => board.runPlaylist(base, item), `Started ${playlistName(item)}`)}
              disabled={busy}
              style={({ pressed }) => [styles.play, { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 }]}
            >
              <MaterialIcons name="play-arrow" size={22} color="#fff" />
            </Pressable>
          </Pressable>
        )}
      />

      {/* Editor */}
      <Modal visible={editorOpen} transparent animationType="slide" onRequestClose={() => setEditorOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.editorSheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={styles.editorHeader}>
              <IconButton icon="close" size={26} color={colors.foreground} onPress={() => setEditorOpen(false)} />
              <Text style={{ color: colors.foreground, fontSize: font.size.lg, fontWeight: font.weight.semibold }}>
                {editExisting ? 'Edit playlist' : 'New playlist'}
              </Text>
              {editExisting ? (
                <IconButton icon="delete" size={24} color={colors.destructive} onPress={del} />
              ) : (
                <View style={{ width: 32 }} />
              )}
            </View>

            <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
              <TextInput
                value={name}
                onChangeText={setName}
                editable={!editExisting}
                placeholder="Playlist name"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.input, { color: colors.foreground, backgroundColor: colors.inputBackground, borderColor: colors.border, opacity: editExisting ? 0.6 : 1 }]}
              />

              <View style={styles.optionRow}>
                <Text style={{ color: colors.foreground }}>Loop</Text>
                <Switch value={loop} onValueChange={setLoop} />
              </View>
              <View style={styles.optionRow}>
                <Text style={{ color: colors.foreground }}>Shuffle</Text>
                <Switch value={shuffle} onValueChange={setShuffle} />
              </View>
              <View style={styles.optionRow}>
                <Text style={{ color: colors.foreground }}>Pause between (s)</Text>
                <TextInput
                  value={pauseSec}
                  onChangeText={(t) => setPauseSec(t.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  style={[styles.numInput, { color: colors.foreground, backgroundColor: colors.inputBackground, borderColor: colors.border }]}
                />
              </View>
              <View style={styles.optionRow}>
                <View style={{ flex: 1, paddingRight: spacing.md }}>
                  <Text style={{ color: colors.foreground }}>Pause from start</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>Measure the gap from each pattern’s start, not its end.</Text>
                </View>
                <Switch value={pauseFromStart} onValueChange={setPauseFromStart} />
              </View>
              <View style={styles.optionRow}>
                <Text style={{ color: colors.foreground }}>Re-home every (patterns)</Text>
                <TextInput
                  value={autoHome}
                  onChangeText={(t) => setAutoHome(t.replace(/[^0-9]/g, ''))}
                  keyboardType="number-pad"
                  style={[styles.numInput, { color: colors.foreground, backgroundColor: colors.inputBackground, borderColor: colors.border }]}
                />
              </View>

              <View>
                <Text style={{ color: colors.foreground, marginBottom: spacing.sm }}>Clear before each pattern</Text>
                <View style={styles.clearChips}>
                  {CLEAR_MODES.map((c) => {
                    const active = c.mode === clearMode
                    return (
                      <Pressable
                        key={c.mode}
                        onPress={() => setClearMode(c.mode)}
                        style={[styles.clearChip, { backgroundColor: active ? colors.primary : colors.card, borderColor: active ? colors.primary : colors.border }]}
                      >
                        <Text style={{ color: active ? '#fff' : colors.foreground, fontSize: font.size.sm, fontWeight: font.weight.medium }}>{c.label}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>

              <View style={styles.itemsHeader}>
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>
                  {items.length} pattern{items.length === 1 ? '' : 's'}
                </Text>
                <Button title="Add patterns" icon="add" variant="secondary" onPress={openPicker} />
              </View>

              {items.map((it, i) => (
                <View key={`${it}-${i}`} style={[styles.itemRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, width: 22, textAlign: 'center' }}>{i + 1}</Text>
                  <View style={[styles.itemThumb, { backgroundColor: colors.background }]}>
                    <PatternThumb name={it} size={36} />
                  </View>
                  <Text numberOfLines={1} style={{ flex: 1, color: colors.foreground }}>
                    {patternLabel(it)}
                  </Text>
                  <IconButton icon="arrow-upward" size={20} color={colors.mutedForeground} disabled={i === 0} onPress={() => moveItem(i, -1)} />
                  <IconButton icon="arrow-downward" size={20} color={colors.mutedForeground} disabled={i === items.length - 1} onPress={() => moveItem(i, 1)} />
                  <IconButton icon="close" size={20} color={colors.destructive} onPress={() => removeItem(i)} />
                </View>
              ))}
            </ScrollView>

            <View style={[styles.editorActions, { borderTopColor: colors.border }]}>
              <Button title="Save" icon="check" loading={busy} onPress={save} flex />
            </View>
          </View>

          {/* Pattern picker — nested inside the editor Modal so it presents on top
              (a sibling Modal would silently fail to appear over the editor). */}
          <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
            <View style={styles.modalBackdrop}>
              <View style={[styles.editorSheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
                <View style={styles.editorHeader}>
                  <IconButton icon="close" size={26} color={colors.foreground} onPress={() => setPickerOpen(false)} />
                  <Text style={{ color: colors.foreground, fontSize: font.size.lg, fontWeight: font.weight.semibold }}>Add patterns</Text>
                  <View style={{ width: 32 }} />
                </View>

                <View style={styles.pickerControls}>
                  <View style={[styles.search, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
                    <MaterialIcons name="search" size={18} color={colors.mutedForeground} />
                    <TextInput
                      value={pickerQuery}
                      onChangeText={setPickerQuery}
                      placeholder="Search"
                      placeholderTextColor={colors.mutedForeground}
                      style={[styles.searchInput, { color: colors.foreground }]}
                    />
                    {pickerQuery ? <IconButton icon="close" size={18} color={colors.mutedForeground} onPress={() => setPickerQuery('')} /> : null}
                  </View>
                  <Pressable
                    onPress={toggleSelectAll}
                    disabled={pickerVisible.length === 0}
                    style={[styles.selectAll, { backgroundColor: colors.card, borderColor: colors.border, opacity: pickerVisible.length === 0 ? 0.5 : 1 }]}
                  >
                    <MaterialIcons name={allPickedVisible ? 'remove-done' : 'done-all'} size={18} color={colors.foreground} />
                    <Text style={{ color: colors.foreground, fontSize: font.size.sm }}>{allPickedVisible ? 'None' : 'All'}</Text>
                  </Pressable>
                </View>

                <FlatList
                  data={pickerVisible}
                  key={PICKER_COLS}
                  numColumns={PICKER_COLS}
                  keyExtractor={(p) => p}
                  contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
                  columnWrapperStyle={{ gap: spacing.md }}
                  ListEmptyComponent={
                    <View style={styles.empty}>
                      <MaterialIcons name="grid-off" size={36} color={colors.mutedForeground} />
                      <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm, textAlign: 'center' }}>
                        {tablePatterns.length === 0 ? 'No patterns on the table. Send some from Browse first.' : 'No matches'}
                      </Text>
                    </View>
                  }
                  renderItem={({ item }) => {
                    const on = picked.has(item)
                    return (
                      <Pressable onPress={() => togglePick(item)} style={styles.pickCell}>
                        <View
                          style={[
                            styles.pickThumb,
                            { backgroundColor: colors.card, borderColor: on ? colors.primary : 'transparent' },
                          ]}
                        >
                          <PatternThumb name={item} size={PICKER_THUMB - 4} />
                          {on ? (
                            <View style={[styles.pickCheck, { backgroundColor: colors.primary }]}>
                              <MaterialIcons name="check" size={14} color="#fff" />
                            </View>
                          ) : null}
                        </View>
                        <Text numberOfLines={1} style={{ color: on ? colors.primary : colors.foreground, fontSize: font.size.xs, fontWeight: font.weight.medium, maxWidth: '100%', textAlign: 'center' }}>
                          {patternLabel(item)}
                        </Text>
                      </Pressable>
                    )
                  }}
                />
                <View style={[styles.editorActions, { borderTopColor: colors.border }]}>
                  <Button title={`Add ${picked.size || ''}`.trim()} icon="check" disabled={picked.size === 0} onPress={confirmPicker} flex />
                </View>
              </View>
            </View>
          </Modal>
        </View>
      </Modal>
    </Screen>
  )
}

const styles = StyleSheet.create({
  activeBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, margin: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderLeftWidth: 3 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing.sm },
  rowName: { flex: 1, fontSize: font.size.md, fontWeight: font.weight.medium },
  play: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  editorSheet: { height: '88%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1 },
  editorHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  input: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 46, fontSize: font.size.md },
  optionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  numInput: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 40, width: 90, textAlign: 'center', fontSize: font.size.md },
  itemsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  clearChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  clearChip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill, borderWidth: 1 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, padding: spacing.sm, paddingLeft: spacing.sm, borderRadius: radius.md, borderWidth: 1 },
  editorActions: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderTopWidth: 1 },
  pickerControls: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 40 },
  searchInput: { flex: 1, fontSize: font.size.md, paddingVertical: 0 },
  selectAll: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 40 },
  pickCell: { flex: 1 / PICKER_COLS, alignItems: 'center', gap: spacing.xs },
  pickThumb: { width: PICKER_THUMB, height: PICKER_THUMB, borderRadius: PICKER_THUMB / 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  pickCheck: { position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  itemThumb: { width: 36, height: 36, borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
})
