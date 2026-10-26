import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { board, CLEAR_DESC, CLEAR_MODES, type ClearMode } from '../api/board'
import { isBusy } from '../api/status'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { toast } from '../stores/useToast'
import { Button, IconButton, Segmented, Toggle } from '../components/ui'
import { Screen } from '../components/Screen'
import { Sheet, SheetButton, useSheetWidth } from '../components/Sheet'
import { thumbGrid, SCROLL_BOTTOM_PAD } from '../lib/layout'
import { PatternThumb } from '../components/PatternThumb'
import { EmptyState } from '../components/EmptyState'
import { bareName, useLibrary, type PlaylistCover } from '../stores/useLibrary'
import { usePrefs, type PauseUnit, type PlaylistPref } from '../stores/usePrefs'
import { loadPlaylist, savePlaylist, deletePlaylist, copyPlaylistTo, fillPlaylistCovers, playlistName } from '../lib/playlists'
import { isDemoBase } from '../api/demoBoard'
import { prettyName } from '../lib/patternName'
import { assertNotSyncing } from '../lib/sd'
import { usePreviews } from '../stores/usePreviews'
import { useBoardAction } from '../lib/useBoardAction'
import { pauseToSeconds } from '../lib/pauseUnits'
import { userMessage } from '../lib/errors'
import { radius, spacing, font } from '../theme'

// The ONE editor sheet's pages: iOS can't present a second sheet over it, so
// the pickers are in-sheet sub-pages.
type Page = 'create' | 'edit' | 'add' | 'clear' | 'copy'
const PAGE_TITLE: Record<Exclude<Page, 'edit'>, string> = {
  create: 'New playlist',
  add: 'Add patterns',
  clear: 'Clear before each pattern',
  copy: 'Copy to table',
}
const UNITS: PauseUnit[] = ['sec', 'min', 'hr']

/** How a playlist plays until the user says otherwise: repeat forever, shuffled,
 * three hours of stillness between patterns, and an adaptive clear before each
 * one — the "living sand sculpture" cadence rather than a back-to-back slideshow. */
const DEFAULT_PREF: PlaylistPref = { loop: true, shuffle: true, pauseTime: 3, pauseUnit: 'hr', clearMode: 'adaptive' }

/** Grid size from the presenting sheet's width: useSheetWidth only sees the
 * sheet from inside its tree, so the grids render through this. */
function SheetGridSize({ children }: { children: (g: { cols: number; thumb: number }) => React.ReactElement }) {
  return children(thumbGrid(useSheetWidth()))
}

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
  const { busy, setBusy } = useBoardAction()
  // What each playlist holds, as far as the app has seen (lib/playlists records it on every read/write).
  const covers = useLibrary((s) => (base ? s.tableCache[base]?.playlistCovers : undefined))

  // The one sheet: create page (name only, like dw — an empty playlist, then the
  // same sheet flips to the editor) and the editor with its sub-pages.
  const [sheetOpen, setSheetOpen] = useState(false)
  const [page, setPage] = useState<Page>('edit')
  const [newName, setNewName] = useState('')

  // Editor state. `current` is the open playlist's filename (null on the create page).
  const [current, setCurrent] = useState<string | null>(null)
  const [name, setName] = useState('')
  // `items` is the working list (edited locally); `baseline` is what's on flash.
  // Edits are batched and only written to the SD card on Save, on a (confirmed)
  // close, or when the playlist is played — not on every add/remove.
  const [items, setItems] = useState<string[]>([])
  const [baseline, setBaseline] = useState<string[]>([])
  const dirty = useMemo(() => items.length !== baseline.length || items.some((p, i) => p !== baseline[i]), [items, baseline])

  // Playback options for the open playlist. Remembered per-playlist (see
  // usePrefs) and applied to the board when Play is pressed — dw passes them as
  // run params; the firmware only holds a single global set, so we re-apply the
  // saved one each time a playlist runs.
  const getPlaylistPref = usePrefs((s) => s.playlistPref)
  const setPlaylistPref = usePrefs((s) => s.setPlaylistPref)
  const [pref, setPref] = useState<PlaylistPref>(DEFAULT_PREF)

  // "Copy to another table" — other saved (non-demo) tables we can write this
  // playlist's .txt to. Demo tables aren't real SD targets.
  const copyTargets = useMemo(
    () => boards.filter((b) => b.id !== activeId && !isDemoBase(b.base)),
    [boards, activeId]
  )

  // Update one or more options and remember them for the open playlist. Saved
  // instantly and NOT part of `dirty`: Cancel/Discard only reverts the pattern list.
  const updatePref = (patch: Partial<PlaylistPref>) => {
    const next = { ...pref, ...patch }
    setPref(next)
    if (current && base) setPlaylistPref(base, current, next)
  }

  // Pattern picker state. The on-table list comes from the shared store (fetched
  // once at startup) — the picker never triggers its own manifest read.
  const tablePatterns = useLibrary((s) => s.tablePatterns)
  const loadTable = useLibrary((s) => s.loadTable)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [pickerQuery, setPickerQuery] = useState('')

  // force=true is the pull-to-refresh / post-mutation path (re-reads the board);
  // the bare on-focus call is stale-while-revalidate (cache, first-load fetch).
  const load = useCallback((force?: boolean) => loadPlaylists(base, force), [base, loadPlaylists])
  // Pull-to-refresh: deferred to idle while the table is running (loadPlaylists
  // records it) — tell the user, then it refreshes when the table is free.
  const refreshPlaylists = useCallback(() => {
    if (isBusy(useStatus.getState().status)) {
      toast.info('Table is running — playlists will refresh when it’s idle')
    }
    // Re-read every cover too: a playlist edited elsewhere (the web app) would keep a stale one.
    load(true).then(() => { if (base) fillPlaylistCovers(base, useLibrary.getState().tablePlaylists, true) })
  }, [load, base])

  const activePlaylist = status?.playlist
  useEffect(() => {
    load()
  }, [load])
  // Covers for playlists the app hasn't read yet, one file at a time in the background.
  useEffect(() => {
    if (base) fillPlaylistCovers(base, playlists)
  }, [base, playlists])

  // Load the saved playback options for a playlist, or DEFAULT_PREF if it has
  // none yet. It deliberately does NOT seed from the board's global
  // $Playlist/* settings any more: those hold whatever the last-run playlist
  // pushed, so seeding from them made a brand-new playlist inherit an
  // unrelated one's options instead of the intended defaults.
  const loadPref = (filename: string) => {
    setPref(getPlaylistPref(base, filename) ?? DEFAULT_PREF)
  }

  const openCreate = () => {
    setNewName('')
    setCurrent(null)
    setItems([])
    setBaseline([])
    setPage('create')
    setSheetOpen(true)
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
      setNewName('')
      // The same sheet flips to the (empty) playlist's editor: no dismiss/present hand-off.
      setCurrent(fname)
      setName(trimmed)
      loadPref(fname)
      setPage('edit')
      await load(true)
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
    setPage('edit')
    setSheetOpen(true)
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
  // commitItems (Save, close or play). Returns false if the write failed so callers
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

  // The sheet's onClose (✕, Cancel, backdrop, swipe, Android back). Closing with
  // unsaved edits asks deliberately — silently writing (or losing) a changed
  // pattern list is too easy to miss. The sheet is non-dismissible while dirty or
  // busy, so refusing here never leaves a swiped-away sheet "open".
  const closeDetail = () => {
    if (busy) return
    // Add-patterns page: the picks live in `picked`, not `items`, so a swipe/backdrop
    // close would drop them silently. It's non-dismissible; leave via Back or Add.
    if (page === 'add') return
    if (!current || !dirty) {
      setSheetOpen(false)
      return
    }
    Alert.alert('Save changes?', `“${name}” has unsaved changes to its pattern list.`, [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          setItems(baseline)
          setSheetOpen(false)
        },
      },
      {
        text: 'Save',
        isPreferred: true,
        onPress: async () => {
          const ok = await commitItems()
          if (ok) {
            toast.success('Playlist saved')
            setSheetOpen(false)
          }
          // failed write: keep the sheet open with the edits; the error toast draws above it
        },
      },
    ])
  }

  // Header Save commits and stays open — Play lives in this sheet.
  const save = async () => {
    if (await commitItems()) toast.success('Playlist saved')
  }

  const removeItem = (i: number) => setItems(items.filter((_, idx) => idx !== i))

  const openPicker = () => {
    if (!base) return
    // Pre-select the current patterns so the picker both adds and removes,
    // matching dw — saving replaces the list with the full selection.
    setPicked(new Set(items))
    setPickerQuery('')
    setPage('add')
    loadTable(base) // no-op if already loaded; deferred to idle if mid-pattern
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
    // Local only — the change is written on Save, close or Play.
    const kept = items.filter((p) => picked.has(p))
    const added = [...picked].filter((p) => !items.includes(p))
    setItems([...kept, ...added])
    setPage('edit')
  }

  // Save any pending edits, apply the chosen options to the board, then run — dw
  // launches playback from the detail view via the pinned Play bar.
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
      setSheetOpen(false)
      setTimeout(refreshStatus, 400)
    } catch (e) {
      toast.error(userMessage(e, 'start the playlist'))
    } finally {
      setBusy(false)
    }
  }

  // Copy the on-screen pattern list to another table as a .txt. Items are
  // resolved against the TARGET's own pattern catalog (re-pointed by file name
  // when filed elsewhere; missing ones dropped — no pattern push). Uses the
  // working `items` so any unsaved edits go along too.
  const doCopy = async (targetBase: string, targetName: string) => {
    if (!current) return
    setBusy(true)
    try {
      const res = await copyPlaylistTo(targetBase, playlistName(current), items)
      if (res.dropped.length > 0) {
        toast.info(
          `Copied “${name}” to ${targetName} — skipped ${res.dropped.length} pattern${res.dropped.length > 1 ? 's' : ''} that table doesn’t have`
        )
      } else {
        toast.success(`Copied “${name}” to ${targetName}`)
      }
      setPage('edit')
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
            setSheetOpen(false)
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

  // The firmware names the running playlist by its file ("Evening" or "Evening.txt").
  const sameName = (a: string, b: string) => playlistName(bareName(a)).toLowerCase() === playlistName(bareName(b)).toLowerCase()
  const playingFile = activePlaylist?.name ? playlists.find((p) => sameName(p, activePlaylist.name!)) : undefined

  const pauseStep = pref.pauseUnit === 'hr' ? 0.5 : 1
  const clearLabel = CLEAR_MODES.find((c) => c.mode === pref.clearMode)?.label
  const subPage = page === 'add' || page === 'clear' || page === 'copy'

  // Editor options, the grid's scrolling header: state shown as text, never only by tint.
  const options = (
    <View style={[styles.options, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.toggleRow}>
        <Text style={[styles.optionLabel, { flex: 1, color: colors.foreground }]}>Shuffle</Text>
        <Toggle value={pref.shuffle} onValueChange={(v) => updatePref({ shuffle: v })} />
      </View>
      <View style={styles.toggleRow}>
        <Text style={[styles.optionLabel, { flex: 1, color: colors.foreground }]}>Repeat</Text>
        <Toggle value={pref.loop} onValueChange={(v) => updatePref({ loop: v })} />
      </View>
      <View style={[styles.optionDivider, { backgroundColor: colors.border }]} />
      <Text style={[styles.optionLabel, { color: colors.foreground }]}>Pause between patterns</Text>
      <View style={styles.pauseRow}>
        <IconButton icon="remove" label="Shorter pause" onPress={() => updatePref({ pauseTime: Math.max(0, pref.pauseTime - pauseStep) })} />
        <Text style={[styles.pauseValue, { color: colors.foreground }]}>{pref.pauseTime}</Text>
        <IconButton icon="add" label="Longer pause" onPress={() => updatePref({ pauseTime: pref.pauseTime + pauseStep })} />
        <View style={{ flex: 1 }} />
        {/* Inline segments, not a Select: a Select would stack a second sheet. */}
        <Segmented
          value={pref.pauseUnit}
          options={UNITS.map((u) => ({ value: u, label: u }))}
          // Round when leaving hours so a 0.5 step doesn't carry into sec/min.
          onChange={(u) => updatePref({ pauseUnit: u, pauseTime: u === 'hr' ? pref.pauseTime : Math.round(pref.pauseTime) })}
        />
      </View>
      <View style={[styles.optionDivider, { backgroundColor: colors.border }]} />
      <Pressable onPress={() => setPage('clear')} style={styles.clearRow}>
        <Text style={[styles.optionLabel, { flex: 1, color: colors.foreground }]}>Clear before each pattern</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: font.size.md }}>{clearLabel}</Text>
        <MaterialIcons name="chevron-right" size={22} color={colors.mutedForeground} />
      </Pressable>
    </View>
  )

  // Rare actions sit at the foot of the editor, away from Add patterns and the grid's remove badges.
  const footer = (
    <View style={[styles.footer, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {copyTargets.length > 0 ? (
        <Pressable onPress={() => setPage('copy')} disabled={busy} accessibilityRole="button" style={({ pressed }) => [styles.footerRow, pressed && { backgroundColor: colors.cardElevated }]}>
          <MaterialIcons name="content-copy" size={20} color={colors.foreground} />
          <Text style={[styles.optionLabel, { flex: 1, color: colors.foreground }]}>Copy to another table</Text>
          <MaterialIcons name="chevron-right" size={22} color={colors.mutedForeground} />
        </Pressable>
      ) : null}
      {copyTargets.length > 0 ? <View style={[styles.optionDivider, { backgroundColor: colors.border }]} /> : null}
      <Pressable onPress={del} disabled={busy} accessibilityRole="button" style={({ pressed }) => [styles.footerRow, pressed && { backgroundColor: colors.cardElevated }]}>
        <MaterialIcons name="delete-outline" size={20} color={colors.destructive} />
        <Text style={[styles.optionLabel, { flex: 1, color: colors.destructive }]}>Delete playlist</Text>
      </Pressable>
    </View>
  )

  return (
    <Screen title="Playlists" action={<Button title="New" icon="add" onPress={openCreate} />}>
      <FlatList
        data={playlists}
        keyExtractor={(p) => p}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: SCROLL_BOTTOM_PAD }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refreshPlaylists} tintColor={colors.primary} />}
        ListEmptyComponent={
          loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} /> : (
            <EmptyState icon="playlist-remove" text="No playlists. Tap “New” to create one." />
          )
        }
        renderItem={({ item }) => {
          const cover = covers?.[item]
          const playing = item === playingFile && activePlaylist
          const sub = playing
            ? `Playing · ${activePlaylist.index + 1} of ${activePlaylist.total}`
            : cover ? `${cover.n} pattern${cover.n === 1 ? '' : 's'}` : null
          return (
            <Pressable
              onPress={() => openDetail(item)}
              accessibilityRole="button"
              accessibilityLabel={sub ? `${playlistName(item)}, ${sub}` : playlistName(item)}
              style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.cardElevated : colors.card, borderColor: playing ? colors.live : colors.border }]}
            >
              <Cover cover={cover} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text numberOfLines={2} style={[styles.rowName, { color: colors.foreground }]}>{playlistName(item)}</Text>
                {sub ? (
                  <View style={styles.subRow}>
                    {playing ? <View style={[styles.liveDot, { backgroundColor: colors.live }]} /> : null}
                    <Text style={{ color: playing ? colors.live : colors.mutedForeground, fontSize: font.size.sm, fontWeight: playing ? font.weight.medium : font.weight.regular }}>{sub}</Text>
                  </View>
                ) : null}
              </View>
              <MaterialIcons name="chevron-right" size={24} color={colors.mutedForeground} />
            </Pressable>
          )
        }}
      />

      <Sheet
        variant="page"
        visible={sheetOpen}
        onClose={closeDetail}
        dismissible={page !== 'add' && !dirty && !busy}
        title={page === 'edit' ? name : PAGE_TITLE[page]}
        onBack={subPage ? () => setPage('edit') : undefined}
        // Sub-pages show Back instead; a clean editor gets the default ✕.
        leading={page === 'create' || dirty ? <SheetButton title="Cancel" onPress={closeDetail} /> : undefined}
        trailing={
          page === 'create' ? <SheetButton prominent title="Create" loading={busy} disabled={!newName.trim()} onPress={createPlaylist} />
          : page === 'add' ? <SheetButton prominent title="Add" onPress={confirmPicker} />
          : page === 'edit' && dirty ? <SheetButton prominent title="Save" loading={busy} onPress={save} />
          : undefined
        }
      >
        {page === 'create' ? (
          <View style={{ padding: spacing.md }}>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              autoFocus
              placeholder="Playlist name"
              placeholderTextColor={colors.mutedForeground}
              onSubmitEditing={createPlaylist}
              style={[styles.input, { color: colors.foreground, backgroundColor: colors.inputBackground, borderColor: colors.border }]}
            />
          </View>
        ) : null}

        {page === 'edit' ? (
          <View style={{ flex: 1 }}>
            <View style={styles.detailSub}>
              <Text style={{ flex: 1, color: dirty ? colors.foreground : colors.mutedForeground, fontSize: font.size.sm }}>
                {items.length} pattern{items.length === 1 ? '' : 's'}{dirty ? ' · unsaved' : ''}
              </Text>
              <Button title="Add patterns" icon="add" variant="secondary" onPress={openPicker} />
            </View>

            <SheetGridSize>
              {({ cols, thumb }) => (
                <FlatList
                  data={items}
                  key={cols}
                  numColumns={cols}
                  keyExtractor={(p, i) => `${p}-${i}`}
                  contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
                  columnWrapperStyle={{ gap: spacing.md }}
                  ListHeaderComponent={options}
                  ListFooterComponent={footer}
                  ListEmptyComponent={
                    <EmptyState icon="library-music" text="Empty playlist. Tap “Add patterns” to get started." />
                  }
                  renderItem={({ item, index }) => (
                    <View style={[styles.gridCell, { flex: 1 / cols }]}>
                      <View style={[styles.gridThumb, { width: thumb, height: thumb, borderRadius: thumb / 2, backgroundColor: colors.card, borderColor: colors.border }]}>
                        <PatternThumb name={item} size={thumb - 4} />
                        {/* Neutral, not ember: removing is undone by discarding the edit. */}
                        <Pressable onPress={() => removeItem(index)} hitSlop={8} style={[styles.removeBadge, { backgroundColor: colors.foreground }]}>
                          <MaterialIcons name="close" size={13} color={colors.background} />
                        </Pressable>
                      </View>
                      <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: font.size.sm, fontWeight: font.weight.medium, maxWidth: '100%', textAlign: 'center' }}>
                        {prettyName(item)}
                      </Text>
                    </View>
                  )}
                />
              )}
            </SheetGridSize>

            {/* Pinned in flow at the sheet's bottom (thumb reach); never floats over the grid. */}
            <View style={[styles.playBar, { borderColor: colors.border }]}>
              <Button title="Play" icon="play-arrow" onPress={run} loading={busy} disabled={items.length === 0 || syncing} />
            </View>
          </View>
        ) : null}

        {page === 'clear' ? (
          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
            {CLEAR_MODES.map((c) => {
              const active = c.mode === pref.clearMode
              return (
                <Pressable
                  key={c.mode}
                  onPress={() => {
                    updatePref({ clearMode: c.mode })
                    setPage('edit')
                  }}
                  style={[styles.clearOption, { backgroundColor: colors.card, borderColor: active ? colors.primary : colors.border }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.foreground, fontSize: font.size.md, fontWeight: font.weight.medium }}>{c.label}</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, marginTop: 2 }}>{CLEAR_DESC[c.mode]}</Text>
                  </View>
                  {active ? <MaterialIcons name="check-circle" size={22} color={colors.primary} /> : null}
                </Pressable>
              )
            })}
          </ScrollView>
        ) : null}

        {page === 'copy' ? (
          <ScrollView contentContainerStyle={{ padding: spacing.md, gap: spacing.sm }}>
            <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>
              Copies “{name}” ({items.length} pattern{items.length === 1 ? '' : 's'}) to another table, matched to that table’s own patterns by file name. Patterns it doesn’t have are left out.
            </Text>
            {copyTargets.map((b) => (
              <Pressable
                key={b.id}
                disabled={busy}
                onPress={() => doCopy(b.base, b.name)}
                style={[styles.clearOption, { backgroundColor: colors.card, borderColor: colors.border, opacity: busy ? 0.6 : 1 }]}
              >
                <MaterialIcons name="table-restaurant" size={22} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: font.size.md, fontWeight: font.weight.medium }}>{b.name}</Text>
                  <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: font.size.sm, fontFamily: font.family.mono }}>{b.base.replace(/^https?:\/\//, '')}</Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color={colors.mutedForeground} />
              </Pressable>
            ))}
          </ScrollView>
        ) : null}

        {page === 'add' ? (
          <>
            <View style={styles.pickerControls}>
              <View style={[styles.search, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
                <MaterialIcons name="search" size={18} color={colors.mutedForeground} />
                <TextInput
                  value={pickerQuery}
                  onChangeText={setPickerQuery}
                  placeholder="Search"
                  placeholderTextColor={colors.mutedForeground}
                  autoCorrect={false}
                  autoCapitalize="none"
                  spellCheck={false}
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

            <SheetGridSize>
              {({ cols, thumb }) => (
                <FlatList
                  data={pickerVisible}
                  key={cols}
                  numColumns={cols}
                  keyExtractor={(p) => p}
                  // iOS pageSheet has no KeyboardAvoidingView: inset the list instead.
                  keyboardDismissMode="on-drag"
                  automaticallyAdjustKeyboardInsets
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
                      <Pressable onPress={() => togglePick(item)} style={[styles.gridCell, { flex: 1 / cols }]}>
                        <View
                          style={[
                            styles.gridThumb,
                            { width: thumb, height: thumb, borderRadius: thumb / 2 },
                            { backgroundColor: colors.card, borderColor: on ? colors.primary : 'transparent' },
                          ]}
                        >
                          <PatternThumb name={item} size={thumb - 4} />
                          {on ? (
                            <View style={[styles.pickCheck, { backgroundColor: colors.primary }]}>
                              <MaterialIcons name="check" size={14} color={colors.primaryForeground} />
                            </View>
                          ) : null}
                        </View>
                        <Text numberOfLines={1} style={{ color: on ? colors.primary : colors.foreground, fontSize: font.size.sm, fontWeight: font.weight.medium, maxWidth: '100%', textAlign: 'center' }}>
                          {prettyName(item)}
                        </Text>
                      </Pressable>
                    )
                  }}
                />
              )}
            </SheetGridSize>
          </>
        ) : null}
      </Sheet>
    </Screen>
  )
}

const COVER_D = 40
const COVER_STEP = 14
const COVER_W = COVER_D + COVER_STEP * 2

/** A playlist's cover: its first patterns as overlapping sand discs. Before the
 * app has seen what's in it (never opened here), a plain disc. */
function Cover({ cover }: { cover?: PlaylistCover }): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const first = cover?.first ?? []
  return (
    <View style={styles.cover}>
      {first.length === 0 ? (
        <View style={[styles.coverDisc, { left: 0, backgroundColor: colors.cardElevated, borderColor: colors.card }]}>
          <MaterialIcons name="queue-music" size={20} color={colors.mutedForeground} />
        </View>
      ) : (
        // Drawn back to front, so the first pattern sits on top at the left.
        [...first].reverse().map((p, i) => (
          <View key={p + i} style={[styles.coverDisc, { left: (first.length - 1 - i) * COVER_STEP, backgroundColor: colors.cardElevated, borderColor: colors.card }]}>
            <PatternThumb name={p} size={COVER_D - 6} />
          </View>
        ))
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 72, paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radius.lg, borderWidth: 1, marginBottom: spacing.sm },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  cover: { width: COVER_W, height: COVER_D },
  coverDisc: { position: 'absolute', top: 0, width: COVER_D, height: COVER_D, borderRadius: COVER_D / 2, borderWidth: 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  footer: { borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden', marginTop: spacing.sm },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48, paddingHorizontal: spacing.md },
  rowName: { fontSize: font.size.md, fontWeight: font.weight.medium },
  detailSub: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  input: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, minHeight: 46, fontSize: font.size.md },
  gridCell: { alignItems: 'center', gap: spacing.xs },
  gridThumb: { borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  removeBadge: { position: 'absolute', top: -4, right: -4, width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  pickCheck: { position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  // Editor options (grid header)
  options: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.md, gap: spacing.sm },
  optionLabel: { fontSize: font.size.md, fontWeight: font.weight.medium },
  pauseRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  pauseValue: { minWidth: 36, textAlign: 'center', fontFamily: font.family.mono, fontSize: font.size.md },
  optionDivider: { height: StyleSheet.hairlineWidth },
  clearRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  // Pinned Play bar
  playBar: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  // Clear / copy rows
  clearOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1 },
  // Picker
  pickerControls: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, minHeight: 40 },
  searchInput: { flex: 1, fontSize: font.size.md, paddingVertical: 0 },
  selectAll: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, minHeight: 40 },
})
