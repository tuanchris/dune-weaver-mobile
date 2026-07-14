import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Dimensions, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MaterialIcons } from '@expo/vector-icons'
import { board, CLEAR_MODES, type ClearMode } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { toast } from '../stores/useToast'
import { Button, IconButton } from '../components/ui'
import { Screen } from '../components/Screen'
import { PatternThumb } from '../components/PatternThumb'
import { EmptyState } from '../components/EmptyState'
import { useLibrary } from '../stores/useLibrary'
import { usePrefs, type PauseUnit, type PlaylistPref } from '../stores/usePrefs'
import { loadPlaylist, savePlaylist, deletePlaylist, copyPlaylistTo, playlistName } from '../lib/playlists'
import { isDemoBase } from '../api/demoBoard'
import { prettyName } from '../lib/patternName'
import { assertNotSyncing } from '../lib/sd'
import { usePreviews } from '../stores/usePreviews'
import { useBoardAction } from '../lib/useBoardAction'
import { pauseToSeconds, secondsToPause } from '../lib/pauseUnits'
import { userMessage } from '../lib/errors'
import { radius, spacing, font } from '../theme'

const GRID_COLS = 3
const GRID_THUMB = Math.floor((Dimensions.get('window').width - spacing.md * 2 - spacing.md * (GRID_COLS - 1)) / GRID_COLS)

// Mirrors dw's preExecutionOptions copy so the clear selector reads the same.
const CLEAR_DESC: Record<ClearMode, string> = {
  none: 'Start drawing immediately without clearing the sand first',
  adaptive: 'Automatically picks the best clear direction based on where the ball is',
  in: 'Spirals outward from the center to erase the current pattern',
  out: 'Spirals inward from the edge to erase the current pattern',
  sideway: 'Sweeps side-to-side across the sand to erase the current pattern',
  random: 'Picks a random clear direction each run',
}

const UNIT_SUFFIX: Record<PauseUnit, string> = { sec: 's', min: 'm', hr: 'h' }
const DEFAULT_PREF: PlaylistPref = { loop: false, shuffle: false, pauseTime: 0, pauseUnit: 'sec', clearMode: 'none' }

export function PlaylistsScreen() {
  const colors = useTheme((s) => s.colors)
  const base = useBoards((s) => s.getActiveBase())
  const boards = useBoards((s) => s.boards)
  const activeId = useBoards((s) => s.activeId)
  const status = useStatus((s) => s.status)
  const refreshStatus = useStatus((s) => s.refresh)

  // Playlist listing comes from the shared store's per-board cache (persisted):
  // shown instantly on launch/switch, re-read only on pull-to-refresh.
  const playlists = useLibrary((s) => s.tablePlaylists)
  const loading = useLibrary((s) => s.playlistsLoading)
  const loadPlaylists = useLibrary((s) => s.loadPlaylists)
  // A running preview sync blocks starting playback (shared single-threaded SD).
  const syncing = usePreviews((s) => s.syncing)
  const { busy, setBusy, act } = useBoardAction()

  // Create-playlist modal (name only, like dw — empty playlist then open detail).
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')

  // Detail view state. `current` is the open playlist's filename (null = closed).
  const [detailOpen, setDetailOpen] = useState(false)
  const [current, setCurrent] = useState<string | null>(null)
  const [name, setName] = useState('')
  // `items` is the working list (edited locally); `baseline` is what's on flash.
  // Edits are batched and only written to the SD card when the detail closes or
  // the playlist is played — not on every add/remove.
  const [items, setItems] = useState<string[]>([])
  const [baseline, setBaseline] = useState<string[]>([])
  const dirty = useMemo(() => items.length !== baseline.length || items.some((p, i) => p !== baseline[i]), [items, baseline])

  // Playback options for the open playlist. Remembered per-playlist (see
  // usePrefs) and applied to the board when Play is pressed — dw passes them as
  // run params; the firmware only holds a single global set, so we re-apply the
  // saved one each time a playlist runs.
  const savedPrefs = usePrefs((s) => s.playlistPrefs)
  const setPlaylistPref = usePrefs((s) => s.setPlaylistPref)
  const [pref, setPref] = useState<PlaylistPref>(DEFAULT_PREF)
  const [clearOpen, setClearOpen] = useState(false)

  // "Copy to another table" — other saved (non-demo) tables we can write this
  // playlist's .txt to. Demo tables aren't real SD targets.
  const [copyOpen, setCopyOpen] = useState(false)
  const copyTargets = useMemo(
    () => boards.filter((b) => b.id !== activeId && !isDemoBase(b.base)),
    [boards, activeId]
  )

  // Update one or more options and remember them for the open playlist.
  const updatePref = (patch: Partial<PlaylistPref>) => {
    const next = { ...pref, ...patch }
    setPref(next)
    if (current) setPlaylistPref(current, next)
  }

  // Pattern picker state. The on-table list comes from the shared store (fetched
  // once at startup) — the picker never triggers its own manifest read.
  const [pickerOpen, setPickerOpen] = useState(false)
  const tablePatterns = useLibrary((s) => s.tablePatterns)
  const loadTable = useLibrary((s) => s.loadTable)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [pickerQuery, setPickerQuery] = useState('')

  // force=true is the pull-to-refresh / post-mutation path (re-reads the board);
  // the bare on-focus call is stale-while-revalidate (cache, first-load fetch).
  const load = useCallback((force?: boolean) => loadPlaylists(base, force), [base, loadPlaylists])

  const activePlaylist = status?.playlist
  useEffect(() => {
    load()
  }, [load])

  // Load the saved playback options for a playlist. If it has none yet, fall
  // back to the board's current global settings (deriving a friendly pause unit
  // from the stored seconds) so the controls reflect reality the first time.
  const loadPref = async (filename: string) => {
    const saved = savedPrefs[filename]
    if (saved) {
      setPref(saved)
      return
    }
    setPref(DEFAULT_PREF)
    if (!base) return
    try {
      const s = await board.settings(base)
      const secs = parseInt(s['Playlist/PauseTime'] ?? '0', 10) || 0
      const { unit, value } = secondsToPause(secs)
      const seeded: PlaylistPref = {
        loop: (s['Playlist/Mode'] ?? '').toLowerCase() === 'loop',
        shuffle: (s['Playlist/Shuffle'] ?? '').toUpperCase() === 'ON' || s['Playlist/Shuffle'] === '1',
        clearMode: CLEAR_MODES.find((c) => c.mode === s['Playlist/ClearPattern'])?.mode ?? 'none',
        pauseUnit: unit,
        pauseTime: value,
      }
      // Only adopt the board seed if the user hasn't already navigated away.
      setPref((p) => (p === DEFAULT_PREF ? seeded : p))
    } catch {
      // keep defaults
    }
  }

  const openCreate = () => {
    setNewName('')
    setCreateOpen(true)
  }

  const createPlaylist = async () => {
    if (!base) return
    const trimmed = newName.trim()
    if (!trimmed) {
      toast.error('Name the playlist')
      return
    }
    setBusy(true)
    try {
      const fname = await savePlaylist(base, trimmed, [])
      setCreateOpen(false)
      setNewName('')
      await load(true)
      // Open the freshly created (empty) playlist straight into the detail view.
      setCurrent(fname)
      setName(trimmed)
      setItems([])
      setBaseline([])
      setDetailOpen(true)
      loadPref(fname)
    } catch (e) {
      toast.error(userMessage(e, 'create the playlist'))
    } finally {
      setBusy(false)
    }
  }

  const openDetail = async (filename: string) => {
    if (!base) return
    setCurrent(filename)
    setName(playlistName(filename))
    setItems([])
    setBaseline([])
    setDetailOpen(true)
    loadPref(filename)
    try {
      const loaded = await loadPlaylist(base, filename)
      setItems(loaded)
      setBaseline(loaded)
    } catch (e) {
      toast.error(userMessage(e, 'read the playlist'))
    }
  }

  // Edits stay local — `items` is mutated in memory and only written to flash by
  // commitItems (on close or play). Returns false if the write failed so callers
  // can keep the detail open instead of losing the edits.
  const commitItems = async (): Promise<boolean> => {
    if (!base || !current) return true
    setBusy(true)
    try {
      await savePlaylist(base, playlistName(current), items)
      setBaseline(items)
      return true
    } catch (e) {
      toast.error(userMessage(e, 'save the playlist'))
      return false
    } finally {
      setBusy(false)
    }
  }

  // Closing with unsaved edits asks deliberately — silently writing (or losing)
  // a changed pattern list is too easy to miss.
  const closeDetail = () => {
    if (!current || !dirty) {
      setDetailOpen(false)
      return
    }
    Alert.alert('Save changes?', `“${name}” has unsaved changes to its pattern list.`, [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          setItems(baseline)
          setDetailOpen(false)
        },
      },
      {
        text: 'Save',
        isPreferred: true,
        onPress: async () => {
          const ok = await commitItems()
          if (ok) {
            toast.success('Playlist saved')
            setDetailOpen(false)
          }
          // failed write: keep the sheet open; the edits (and the error) are still visible
        },
      },
    ])
  }

  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i))

  const openPicker = () => {
    if (!base) return
    // Pre-select the current patterns so the picker both adds and removes,
    // matching dw — saving replaces the list with the full selection.
    setPicked(new Set(items))
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
    // Keep existing order, append newly-picked at the end, drop deselected.
    // Local only — the change is written when the detail closes or plays.
    const kept = items.filter((p) => picked.has(p))
    const added = [...picked].filter((p) => !items.includes(p))
    setItems([...kept, ...added])
    setPickerOpen(false)
  }

  // Save any pending edits, apply the chosen options to the board, then run — dw
  // launches playback from the detail view via the floating Play button.
  const run = async () => {
    if (!base || !current || items.length === 0) return
    if (syncing) {
      toast.error('Syncing previews from the table — try again in a moment.')
      return
    }
    if (dirty) {
      const ok = await commitItems()
      if (!ok) return
    }
    setBusy(true)
    try {
      assertNotSyncing()
      await board.setPlaylistMode(base, pref.loop ? 'loop' : 'single')
      await board.setPlaylistShuffle(base, pref.shuffle)
      await board.setPlaylistPause(base, pauseToSeconds(pref.pauseTime, pref.pauseUnit))
      await board.setPlaylistClearPattern(base, pref.clearMode)
      await board.runPlaylist(base, current)
      toast.success(`Started ${name}`)
      setDetailOpen(false)
      setTimeout(refreshStatus, 400)
    } catch (e) {
      toast.error(userMessage(e, 'start the playlist'))
    } finally {
      setBusy(false)
    }
  }

  // Copy the on-screen pattern list to another table as a .txt (verbatim — no
  // pattern push; missing patterns just won't play there). Uses the working
  // `items` so any unsaved edits go along too.
  const doCopy = async (targetBase: string, targetName: string) => {
    if (!current) return
    setBusy(true)
    try {
      await copyPlaylistTo(targetBase, playlistName(current), items)
      toast.success(`Copied “${name}” to ${targetName}`)
      setCopyOpen(false)
    } catch (e) {
      toast.error(userMessage(e, `copy the playlist to ${targetName}`))
    } finally {
      setBusy(false)
    }
  }

  const del = () => {
    if (!base || !current) return
    const target = current
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
            setDetailOpen(false)
            await load(true)
          } catch (e) {
            toast.error(userMessage(e, 'delete the playlist'))
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
        <EmptyState icon="cable" text="No table connected." />
      </Screen>
    )
  }

  const pauseStep = pref.pauseUnit === 'hr' ? 0.5 : 1

  return (
    <Screen title="Playlists" action={<Button title="New" icon="add" onPress={openCreate} />}>
      {activePlaylist ? (
        <View style={[styles.activeBar, { backgroundColor: colors.card, borderColor: colors.primary }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>NOW PLAYING PLAYLIST</Text>
            <Text style={{ color: colors.foreground, fontSize: font.size.md, fontWeight: font.weight.semibold }}>
              {activePlaylist.name ?? '—'} · {activePlaylist.index + 1}/{activePlaylist.total}
            </Text>
          </View>
          <Button title="Skip" icon="skip-next" variant="secondary" disabled={busy || syncing} onPress={() => act(() => { assertNotSyncing(); return board.skip(base) }, 'Skipping', 'skip to the next pattern')} />
          <Button title="Stop" icon="stop" variant="destructive" disabled={busy} onPress={() => act(() => board.stopPlaylist(base), 'Stopping after current', 'stop the playlist')} />
        </View>
      ) : null}

      <FlatList
        data={playlists}
        keyExtractor={(p) => p}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 160 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(true)} tintColor={colors.primary} />}
        ListEmptyComponent={
          loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : (
            <EmptyState icon="playlist-remove" text="No playlists. Tap “New” to create one." />
          )
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => openDetail(item)} style={[styles.row, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <MaterialIcons name="queue-music" size={22} color={colors.primary} />
            <Text numberOfLines={1} style={[styles.rowName, { color: colors.foreground }]}>
              {playlistName(item)}
            </Text>
            <MaterialIcons name="chevron-right" size={24} color={colors.mutedForeground} />
          </Pressable>
        )}
      />

      {/* Create playlist (name only) */}
      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <Pressable style={styles.centerBackdrop} onPress={() => setCreateOpen(false)}>
          <Pressable style={[styles.createCard, { backgroundColor: colors.background, borderColor: colors.border }]} onPress={() => {}}>
            <Text style={{ color: colors.foreground, fontSize: font.size.lg, fontWeight: font.weight.semibold }}>New playlist</Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              autoFocus
              placeholder="Playlist name"
              placeholderTextColor={colors.mutedForeground}
              onSubmitEditing={createPlaylist}
              style={[styles.input, { color: colors.foreground, backgroundColor: colors.inputBackground, borderColor: colors.border }]}
            />
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
              <Button title="Cancel" variant="secondary" onPress={() => setCreateOpen(false)} flex />
              <Button title="Create" icon="add" loading={busy} onPress={createPlaylist} flex />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Detail view */}
      <Modal visible={detailOpen} transparent animationType="slide" onRequestClose={closeDetail}>
        <View style={styles.modalBackdrop}>
          {/* Native SafeAreaView: measures the Modal's own window, so the sheet
              clears the Android nav bar (main-window insets don't apply here). */}
          <SafeAreaView edges={['bottom']} style={[styles.editorSheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={styles.editorHeader}>
              <IconButton icon={dirty ? 'check' : 'close'} size={26} color={dirty ? colors.primary : colors.foreground} onPress={closeDetail} />
              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: font.size.lg, fontWeight: font.weight.semibold }}>
                  {name}
                </Text>
                <Text style={{ color: dirty ? colors.primary : colors.mutedForeground, fontSize: font.size.xs }}>
                  {items.length} pattern{items.length === 1 ? '' : 's'}{dirty ? ' · unsaved' : ''}
                </Text>
              </View>
              {copyTargets.length > 0 ? (
                <IconButton icon="content-copy" size={22} color={colors.foreground} onPress={() => setCopyOpen(true)} />
              ) : null}
              <IconButton icon="delete" size={24} color={colors.destructive} onPress={del} />
            </View>

            <View style={styles.detailSub}>
              <Button title="Add patterns" icon="add" variant="secondary" onPress={openPicker} />
            </View>

            <FlatList
              data={items}
              key={GRID_COLS}
              numColumns={GRID_COLS}
              keyExtractor={(p, i) => `${p}-${i}`}
              contentContainerStyle={{ padding: spacing.md, gap: spacing.md, paddingBottom: 160 }}
              columnWrapperStyle={{ gap: spacing.md }}
              ListEmptyComponent={
                <EmptyState icon="library-music" text="Empty playlist. Tap “Add patterns” to get started." />
              }
              renderItem={({ item, index }) => (
                <View style={styles.gridCell}>
                  <View style={[styles.gridThumb, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <PatternThumb name={item} size={GRID_THUMB - 4} />
                    <Pressable onPress={() => removeItem(index)} hitSlop={8} style={[styles.removeBadge, { backgroundColor: colors.destructive }]}>
                      <MaterialIcons name="close" size={13} color="#fff" />
                    </Pressable>
                  </View>
                  <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: font.size.xs, fontWeight: font.weight.medium, maxWidth: '100%', textAlign: 'center' }}>
                    {prettyName(item)}
                  </Text>
                </View>
              )}
            />

            {/* Floating playback controls */}
            <View style={styles.floatWrap} pointerEvents="box-none">
              <View style={[styles.pill, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Pressable
                  onPress={() => updatePref({ shuffle: !pref.shuffle })}
                  style={[styles.pillBtn, pref.shuffle && { backgroundColor: colors.primary + '22' }]}
                >
                  <MaterialIcons name="shuffle" size={20} color={pref.shuffle ? colors.primary : colors.mutedForeground} />
                </Pressable>
                <Pressable
                  onPress={() => updatePref({ loop: !pref.loop })}
                  style={[styles.pillBtn, pref.loop && { backgroundColor: colors.primary + '22' }]}
                >
                  <MaterialIcons name="repeat" size={20} color={pref.loop ? colors.primary : colors.mutedForeground} />
                </Pressable>

                <View style={[styles.pillDivider, { backgroundColor: colors.border }]} />

                <Pressable onPress={() => updatePref({ pauseTime: Math.max(0, pref.pauseTime - pauseStep) })} style={styles.stepBtn}>
                  <MaterialIcons name="remove" size={18} color={colors.foreground} />
                </Pressable>
                <Pressable
                  onPress={() => updatePref({ pauseUnit: pref.pauseUnit === 'sec' ? 'min' : pref.pauseUnit === 'min' ? 'hr' : 'sec' })}
                  style={styles.pauseValue}
                >
                  <Text style={{ color: colors.foreground, fontSize: font.size.sm, fontWeight: font.weight.semibold }}>
                    {pref.pauseTime}{UNIT_SUFFIX[pref.pauseUnit]}
                  </Text>
                  <MaterialIcons name="swap-vert" size={12} color={colors.mutedForeground} />
                </Pressable>
                <Pressable onPress={() => updatePref({ pauseTime: pref.pauseTime + pauseStep })} style={styles.stepBtn}>
                  <MaterialIcons name="add" size={18} color={colors.foreground} />
                </Pressable>

                <View style={[styles.pillDivider, { backgroundColor: colors.border }]} />

                <Pressable
                  onPress={() => setClearOpen(true)}
                  style={[styles.pillBtn, pref.clearMode !== 'none' && { backgroundColor: colors.primary + '22' }]}
                >
                  <MaterialIcons name="cleaning-services" size={20} color={pref.clearMode !== 'none' ? colors.primary : colors.mutedForeground} />
                </Pressable>
              </View>

              <Pressable
                onPress={run}
                disabled={busy || items.length === 0 || syncing}
                style={({ pressed }) => [
                  styles.playBig,
                  { backgroundColor: items.length === 0 || syncing ? colors.border : colors.primary, opacity: pressed ? 0.85 : 1 },
                ]}
              >
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <MaterialIcons name="play-arrow" size={28} color="#fff" />
                )}
              </Pressable>
            </View>
          </SafeAreaView>

          {/* Clear-pattern selector — nested inside the detail Modal so it presents
              on top (a sibling Modal would silently fail to appear). */}
          <Modal visible={clearOpen} transparent animationType="slide" onRequestClose={() => setClearOpen(false)}>
            <Pressable style={styles.modalBackdrop} onPress={() => setClearOpen(false)}>
              <Pressable style={[styles.clearSheet, { backgroundColor: colors.background, borderColor: colors.border }]} onPress={() => {}}>
                <View style={styles.editorHeader}>
                  <View style={{ width: 32 }} />
                  <Text style={{ color: colors.foreground, fontSize: font.size.lg, fontWeight: font.weight.semibold }}>Clear before each pattern</Text>
                  <IconButton icon="close" size={26} color={colors.foreground} onPress={() => setClearOpen(false)} />
                </View>
                <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
                  {CLEAR_MODES.map((c) => {
                    const active = c.mode === pref.clearMode
                    return (
                      <Pressable
                        key={c.mode}
                        onPress={() => {
                          updatePref({ clearMode: c.mode })
                          setClearOpen(false)
                        }}
                        style={[styles.clearOption, { backgroundColor: colors.card, borderColor: active ? colors.primary : colors.border }]}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: colors.foreground, fontSize: font.size.md, fontWeight: font.weight.medium }}>{c.label}</Text>
                          <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginTop: 2 }}>{CLEAR_DESC[c.mode]}</Text>
                        </View>
                        {active ? <MaterialIcons name="check-circle" size={22} color={colors.primary} /> : null}
                      </Pressable>
                    )
                  })}
                </ScrollView>
                <SafeAreaView edges={['bottom']} />
              </Pressable>
            </Pressable>
          </Modal>

          {/* Copy-to-table selector — nested inside the detail Modal so it presents on top. */}
          <Modal visible={copyOpen} transparent animationType="slide" onRequestClose={() => setCopyOpen(false)}>
            <Pressable style={styles.modalBackdrop} onPress={() => setCopyOpen(false)}>
              <Pressable style={[styles.clearSheet, { backgroundColor: colors.background, borderColor: colors.border }]} onPress={() => {}}>
                <View style={styles.editorHeader}>
                  <View style={{ width: 32 }} />
                  <Text style={{ color: colors.foreground, fontSize: font.size.lg, fontWeight: font.weight.semibold }}>Copy to table</Text>
                  <IconButton icon="close" size={26} color={colors.foreground} onPress={() => setCopyOpen(false)} />
                </View>
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, paddingHorizontal: spacing.md }}>
                  Copies “{name}” ({items.length} pattern{items.length === 1 ? '' : 's'}) to another table. Patterns that table doesn’t have won’t play until you add them there.
                </Text>
                <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
                  {copyTargets.map((b) => (
                    <Pressable
                      key={b.id}
                      disabled={busy}
                      onPress={() => doCopy(b.base, b.name)}
                      style={[styles.clearOption, { backgroundColor: colors.card, borderColor: colors.border, opacity: busy ? 0.6 : 1 }]}
                    >
                      <MaterialIcons name="table-restaurant" size={22} color={colors.primary} />
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: font.size.md, fontWeight: font.weight.medium }}>{b.name}</Text>
                        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>{b.base.replace(/^https?:\/\//, '')}</Text>
                      </View>
                      <MaterialIcons name="chevron-right" size={22} color={colors.mutedForeground} />
                    </Pressable>
                  ))}
                </ScrollView>
                <SafeAreaView edges={['bottom']} />
              </Pressable>
            </Pressable>
          </Modal>

          {/* Pattern picker — nested inside the detail Modal so it presents on top. */}
          <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
            <View style={styles.modalBackdrop}>
              <SafeAreaView edges={['bottom']} style={[styles.editorSheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
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
                  key={GRID_COLS}
                  numColumns={GRID_COLS}
                  keyExtractor={(p) => p}
                  contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
                  columnWrapperStyle={{ gap: spacing.md }}
                  ListEmptyComponent={
                    <EmptyState
                      icon="grid-off"
                      text={tablePatterns.length === 0 ? 'No patterns on the table. Send some from Browse first.' : 'No matches'}
                    />
                  }
                  renderItem={({ item }) => {
                    const on = picked.has(item)
                    return (
                      <Pressable onPress={() => togglePick(item)} style={styles.gridCell}>
                        <View
                          style={[
                            styles.gridThumb,
                            { backgroundColor: colors.card, borderColor: on ? colors.primary : 'transparent' },
                          ]}
                        >
                          <PatternThumb name={item} size={GRID_THUMB - 4} />
                          {on ? (
                            <View style={[styles.pickCheck, { backgroundColor: colors.primary }]}>
                              <MaterialIcons name="check" size={14} color="#fff" />
                            </View>
                          ) : null}
                        </View>
                        <Text numberOfLines={1} style={{ color: on ? colors.primary : colors.foreground, fontSize: font.size.xs, fontWeight: font.weight.medium, maxWidth: '100%', textAlign: 'center' }}>
                          {prettyName(item)}
                        </Text>
                      </Pressable>
                    )
                  }}
                />
                <View style={[styles.editorActions, { borderTopColor: colors.border }]}>
                  <Button title="Save selection" icon="check" loading={busy} onPress={confirmPicker} flex />
                </View>
              </SafeAreaView>
            </View>
          </Modal>
        </View>
      </Modal>
    </Screen>
  )
}

const styles = StyleSheet.create({
  activeBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, margin: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderLeftWidth: 3 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing.sm },
  rowName: { flex: 1, fontSize: font.size.md, fontWeight: font.weight.medium },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  centerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: spacing.lg },
  createCard: { width: '100%', maxWidth: 420, borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg, gap: spacing.md },
  editorSheet: { height: '88%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1 },
  editorHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  detailSub: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  input: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 46, fontSize: font.size.md },
  editorActions: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderTopWidth: 1 },
  gridCell: { flex: 1 / GRID_COLS, alignItems: 'center', gap: spacing.xs },
  gridThumb: { width: GRID_THUMB, height: GRID_THUMB, borderRadius: GRID_THUMB / 2, borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  removeBadge: { position: 'absolute', top: -4, right: -4, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  pickCheck: { position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  // Floating controls
  floatWrap: { position: 'absolute', bottom: spacing.xxl + spacing.md, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  pill: { flexDirection: 'row', alignItems: 'center', height: 52, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: 6, gap: 2, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  pillBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  pillDivider: { width: 1, height: 28, marginHorizontal: 4 },
  stepBtn: { width: 30, height: 38, alignItems: 'center', justifyContent: 'center' },
  pauseValue: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minWidth: 44, paddingHorizontal: 2 },
  playBig: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  // Clear selector
  clearSheet: { maxHeight: '70%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1 },
  clearOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1 },
  // Picker
  pickerControls: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 40 },
  searchInput: { flex: 1, fontSize: font.size.md, paddingVertical: 0 },
  selectAll: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 40 },
})
