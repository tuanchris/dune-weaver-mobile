import React, { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MaterialIcons } from '@expo/vector-icons'
import { board, type ClearMode } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { usePrefs } from '../stores/usePrefs'
import { toast } from '../stores/useToast'
import { useLibrary, previewNames, bareName } from '../stores/useLibrary'
import { pushToTable } from '../lib/pushPattern'
import { assertSdIdle, assertNotSyncing } from '../lib/sd'
import { updateTableManifest } from '../lib/tableManifest'
import { importThr, type ImportedThr } from '../lib/importPattern'
import { PatternThumb } from '../components/PatternThumb'
import { PolarPattern } from '../components/PolarPattern'
import { Button, IconButton } from '../components/ui'
import { Screen } from '../components/Screen'
import { EmptyState } from '../components/EmptyState'
import { prettyName } from '../lib/patternName'
import { userMessage } from '../lib/errors'
import { radius, spacing, font } from '../theme'

const COLS = 3


// dw "Pre-Execution Action" choices (a clear sequenced before the pattern runs).
const PRE_EXEC: { mode: ClearMode; label: string }[] = [
  { mode: 'adaptive', label: 'Adaptive' },
  { mode: 'in', label: 'Clear From Center' },
  { mode: 'out', label: 'Clear From Perimeter' },
  { mode: 'sideway', label: 'Clear Sideway' },
  { mode: 'none', label: 'None' },
]

/** Subfolder a pattern lives in ("custom_patterns/x.thr" -> "custom_patterns"); "" for top level. */
function folderOf(name: string): string {
  const i = name.lastIndexOf('/')
  return i > 0 ? name.slice(0, i) : ''
}

/** Display label for a folder chip ("custom_patterns" -> "custom patterns"). */
function folderLabel(folder: string): string {
  return (folder.split('/').pop() ?? folder).replace(/_/g, ' ')
}

// Fuzzy-ish search matching dw: lowercase, collapse spaces/underscores/dashes,
// then substring. So "sea star" matches "sea_star" and "Sea-Star".
function normalizeForSearch(s: string): string {
  return s.toLowerCase().replace(/[\s_-]+/g, ' ').trim()
}
function fuzzyMatch(target: string, query: string): boolean {
  return normalizeForSearch(target).includes(normalizeForSearch(query))
}

const ALL_FOLDERS = '__all__'
const TOP_LEVEL = '__top__'
const FAVORITES = '__fav__'

export function BrowseScreen() {
  const colors = useTheme((s) => s.colors)
  // Thumb size tracks the live window width (rotation / iPad split view safe).
  const { width } = useWindowDimensions()
  const thumb = Math.floor((width - spacing.md * 2 - spacing.md * (COLS - 1)) / COLS)
  const base = useBoards((s) => s.getActiveBase())
  const refreshStatus = useStatus((s) => s.refresh)
  const imported = useLibrary((s) => s.patterns)
  const addImported = useLibrary((s) => s.addImported)
  const setXY = useLibrary((s) => s.setXY)
  // On-table pattern list is fetched once (App startup) and cached in the store.
  const patterns = useLibrary((s) => s.tablePatterns)
  const loading = useLibrary((s) => s.tableLoading)
  const loadTable = useLibrary((s) => s.loadTable)

  const [query, setQuery] = useState('')
  const [asc, setAsc] = useState(true)
  // Single-select filter: everything, favorites, top-level, or one subfolder.
  const [filter, setFilter] = useState<string>(ALL_FOLDERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const favorites = usePrefs((s) => s.favorites)
  const toggleFavorite = usePrefs((s) => s.toggleFavorite)
  const [selected, setSelected] = useState<string | null>(null)
  // Pre-Execution Action is a remembered preference (persisted across launches).
  const clearMode = usePrefs((s) => s.clearMode)
  const setClearMode = usePrefs((s) => s.setClearMode)
  const [running, setRunning] = useState(false)
  const [pushing, setPushing] = useState(false)
  // 0..1 while an upload is in flight — drives the progress bar in the detail sheet.
  const [pushPct, setPushPct] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importPreview, setImportPreview] = useState<ImportedThr | null>(null)

  // Load the full on-table manifest once (App also kicks this off at startup);
  // no-op if already loaded. /sand_patterns is motion-safe, so this works even
  // while a pattern is playing — that's how custom_patterns/ show up.
  useEffect(() => {
    loadTable(base)
  }, [base, loadTable])

  // Pull-to-refresh: user-initiated re-read of the manifest (motion-safe).
  const refreshTable = () => loadTable(base, true)

  // One unified library: every bundled preview (~1080: built-ins + custom_patterns)
  // + imported patterns + anything else on the table, deduped by name.
  const allNames = useMemo(() => {
    const set = new Set<string>(previewNames())
    for (const p of imported) set.add(p.name)
    for (const p of patterns) set.add(p)
    return [...set]
  }, [imported, patterns])

  const onTableSet = useMemo(() => new Set(patterns), [patterns])

  // Distinct subfolders present in the library. Only worth showing the filter
  // when patterns actually live in subfolders (e.g. custom_patterns/).
  const folders = useMemo(() => {
    const set = new Set<string>()
    for (const n of allNames) set.add(folderOf(n))
    return [...set].filter((f) => f !== '').sort((a, b) => a.localeCompare(b))
  }, [allNames])
  const hasTopLevel = useMemo(() => allNames.some((n) => folderOf(n) === ''), [allNames])
  const hasFavorites = Object.keys(favorites).length > 0

  // Reset a folder filter whose folder disappears (e.g. on table reload).
  useEffect(() => {
    if (filter !== ALL_FOLDERS && filter !== TOP_LEVEL && filter !== FAVORITES && !folders.includes(filter)) {
      setFilter(ALL_FOLDERS)
    }
  }, [folders, filter])

  const visible = useMemo(() => {
    const q = query.trim()
    let list = allNames
    if (filter === FAVORITES) list = list.filter((p) => favorites[p])
    else if (filter !== ALL_FOLDERS) {
      list = list.filter((p) => (filter === TOP_LEVEL ? folderOf(p) === '' : folderOf(p) === filter))
    }
    if (q) list = list.filter((p) => fuzzyMatch(p.replace(/\.thr$/i, ''), q))
    list = [...list].sort((a, b) => prettyName(a).localeCompare(prettyName(b)) * (asc ? 1 : -1))
    return list
  }, [allNames, query, asc, filter, favorites])

  // Dropdown options: everything / favorites / default (top-level) / each subfolder.
  const filterOptions = useMemo(
    () => [
      { key: ALL_FOLDERS, label: 'All patterns', icon: 'apps' as const },
      { key: FAVORITES, label: 'Favorites', icon: 'favorite' as const },
      ...(folders.length > 0 && hasTopLevel ? [{ key: TOP_LEVEL, label: 'Default', icon: 'folder' as const }] : []),
      ...folders.map((f) => ({ key: f, label: folderLabel(f), icon: 'folder' as const })),
    ],
    [folders, hasTopLevel],
  )
  const filterActive = filter !== ALL_FOLDERS

  const run = async (file: string) => {
    if (!base) return
    setRunning(true)
    try {
      assertNotSyncing()
      await board.runPattern(base, file, clearMode)
      toast.success(`Running ${prettyName(file)}`)
      setSelected(null)
      setTimeout(refreshStatus, 400)
    } catch (e) {
      toast.error(clearMode === 'none' ? userMessage(e, 'run the pattern') : 'Run failed (clear needs a playlist config)')
    } finally {
      setRunning(false)
    }
  }

  const doPush = async (name: string) => {
    if (!base) return
    const replace = onTableSet.has(name)
    const go = async () => {
      setPushing(true)
      setPushPct(0)
      try {
        await pushToTable(base, name, setPushPct)
        toast.success(`Sent ${prettyName(name)} to table`)
        setSelected(null)
        useLibrary.getState().addTablePattern(bareName(name))
      } catch (e) {
        toast.error(userMessage(e, 'send the pattern'))
      } finally {
        setPushing(false)
        setPushPct(null)
      }
    }
    if (replace) {
      Alert.alert('Already on table', `"${prettyName(name)}" already exists on the table. Replace it?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Replace', style: 'destructive', onPress: go },
      ])
    } else {
      go()
    }
  }

  const doImport = async () => {
    setImporting(true)
    try {
      const result = await importThr()
      if (!result) return // cancelled
      const { imported, failed } = result
      if (imported.length === 0) {
        toast.error(failed.length ? `No valid .thr files (skipped ${failed.length})` : 'No valid .thr files')
        return
      }
      // A single clean pick keeps the preview/confirm sheet (with push option).
      if (imported.length === 1 && failed.length === 0) {
        setXY(imported[0].name, imported[0].xy) // preview immediately
        setImportPreview(imported[0])
        return
      }
      // Multiple files: add them all to the library directly, then summarize.
      for (const p of imported) addImported(p.name, p.thrUri, p.sizeBytes, p.xy)
      const added = `Added ${imported.length} pattern${imported.length > 1 ? 's' : ''} to library`
      toast.success(failed.length ? `${added}, skipped ${failed.length} invalid` : added)
    } catch (e) {
      toast.error(userMessage(e, 'import the pattern'))
    } finally {
      setImporting(false)
    }
  }

  // Delete the selected pattern: from the SD card if it's on the table, and/or
  // from the local library if it was imported. Bundled defaults can't be deleted.
  const del = (file: string) => {
    const onTable = onTableSet.has(file)
    const importedMatch = imported.find((p) => p.name === bareName(file))
    if (!onTable && !importedMatch) return
    Alert.alert('Delete pattern', `Delete "${prettyName(file)}"?${onTable ? ' This removes it from the table.' : ''}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true)
          try {
            if (onTable && base) {
              assertSdIdle()
              await board.deleteSdFile(base, '/patterns/', file)
              await updateTableManifest(base, { remove: file })
              useLibrary.getState().removeTablePattern(file)
            }
            if (importedMatch) useLibrary.getState().remove(importedMatch.id)
            toast.success('Deleted')
            setSelected(null)
          } catch (e) {
            toast.error(userMessage(e, 'delete the pattern'))
          } finally {
            setDeleting(false)
          }
        },
      },
    ])
  }

  const confirmImport = async (push: boolean) => {
    const p = importPreview
    if (!p) return
    addImported(p.name, p.thrUri, p.sizeBytes, p.xy)
    setImportPreview(null)
    if (push && base) {
      // Open the pattern detail sheet first so the upload progress bar is
      // visible for the (possibly long) transfer.
      setSelected(p.name)
      await doPush(p.name)
    } else {
      toast.success(`Added ${prettyName(p.name)} to library`)
    }
  }

  if (!base) {
    return (
      <Screen>
        <EmptyState icon="cable" text="No table connected. Add one in Settings." />
      </Screen>
    )
  }

  const selOnTable = selected ? onTableSet.has(selected) : false
  const selInLibrary = selected ? useLibrary.getState().has(selected) : false
  // A table-bound action (play/send/delete) is in flight — block dismissing the
  // sheet and every other action until it finishes so we can't fire overlapping
  // SD operations or lose the in-progress feedback.
  const busy = running || pushing || deleting

  return (
    <Screen title="Browse Patterns">
      <View style={styles.searchRow}>
        <View style={[styles.control, styles.search, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
          <MaterialIcons name="search" size={18} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search patterns"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
          />
          {query ? <IconButton icon="close" size={18} color={colors.mutedForeground} onPress={() => setQuery('')} /> : null}
        </View>
        <Pressable
          onPress={() => setAsc((v) => !v)}
          style={[styles.control, styles.sortBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <MaterialIcons name={asc ? 'arrow-upward' : 'arrow-downward'} size={18} color={colors.foreground} />
          <Text style={{ color: colors.foreground, fontSize: font.size.sm }}>{asc ? 'A–Z' : 'Z–A'}</Text>
        </Pressable>
        <Pressable
          onPress={() => setFilterOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Filter patterns${filterActive ? ` (${filterOptions.find((o) => o.key === filter)?.label ?? ''} active)` : ''}`}
          style={[
            styles.control,
            styles.iconBtn,
            filter === FAVORITES
              ? { backgroundColor: colors.destructive, borderColor: colors.destructive }
              : filterActive
                ? { backgroundColor: colors.primary, borderColor: colors.primary }
                : { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <MaterialIcons
            name={filter === FAVORITES ? 'favorite' : 'filter-list'}
            size={22}
            color={filter === FAVORITES ? colors.destructiveForeground : filterActive ? colors.primaryForeground : colors.foreground}
          />
        </Pressable>
        <Pressable
          onPress={doImport}
          disabled={importing}
          style={[styles.control, styles.iconBtn, { backgroundColor: colors.primary, borderColor: colors.primary, opacity: importing ? 0.5 : 1 }]}
        >
          {importing ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <MaterialIcons name="add" size={24} color={colors.primaryForeground} />
          )}
        </Pressable>
      </View>

      {/* Filter dropdown — bottom sheet listing All / Favorites / folders */}
      <Modal visible={filterOpen} transparent animationType="slide" onRequestClose={() => setFilterOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setFilterOpen(false)}>
          <Pressable style={[styles.detailSheet, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => {}}>
            <View style={styles.detailHeader}>
              <Text numberOfLines={1} style={[styles.detailTitle, { color: colors.foreground }]}>
                Show
              </Text>
              <IconButton icon="close" size={26} color={colors.foreground} onPress={() => setFilterOpen(false)} />
            </View>
            <View style={[styles.detailRule, { backgroundColor: colors.border }]} />
            <View style={styles.filterList}>
              {filterOptions.map(({ key, label, icon }) => {
                const on = filter === key
                const fav = key === FAVORITES
                return (
                  <Pressable
                    key={key}
                    onPress={() => {
                      setFilter(key)
                      setFilterOpen(false)
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    style={[styles.filterRow, { backgroundColor: on ? colors.cardElevated : 'transparent' }]}
                  >
                    <MaterialIcons name={icon} size={20} color={fav ? colors.destructive : colors.mutedForeground} />
                    <Text style={[styles.filterLabel, { color: colors.foreground }]}>{label}</Text>
                    {fav && hasFavorites ? (
                      <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, fontFamily: font.family.mono }}>
                        {Object.keys(favorites).length}
                      </Text>
                    ) : null}
                    {on ? <MaterialIcons name="check" size={20} color={colors.primary} /> : null}
                  </Pressable>
                )
              })}
            </View>
            <SafeAreaView edges={['bottom']} />
          </Pressable>
        </Pressable>
      </Modal>

      <FlatList
        data={visible}
        key={COLS}
        numColumns={COLS}
        keyExtractor={(item) => item}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 160 }}
        columnWrapperStyle={{ gap: spacing.md }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={refreshTable} tintColor={colors.primary} />}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : filter === FAVORITES && !hasFavorites ? (
            <EmptyState icon="favorite-border" text="No favorites yet — tap the heart on a pattern." />
          ) : (
            <EmptyState icon="grid-off" text="No patterns" />
          )
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => setSelected(item)} style={styles.tile}>
            <View style={[styles.tileThumb, { width: thumb, height: thumb, borderRadius: thumb / 2, backgroundColor: colors.card, borderColor: colors.border }]}>
              <PatternThumb name={item} size={thumb - 4} />
            </View>
            <Pressable
              onPress={() => toggleFavorite(item)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={favorites[item] ? `Remove ${prettyName(item)} from favorites` : `Add ${prettyName(item)} to favorites`}
              style={[styles.favBadge, { backgroundColor: colors.card, borderColor: colors.border }]}
            >
              <MaterialIcons
                name={favorites[item] ? 'favorite' : 'favorite-border'}
                size={14}
                color={favorites[item] ? colors.destructive : colors.mutedForeground}
              />
            </Pressable>
            <Text numberOfLines={1} style={[styles.tileName, { color: colors.foreground }]}>
              {prettyName(item)}
            </Text>
          </Pressable>
        )}
      />

      {/* Pattern detail sheet — mirrors the dw pattern dialog */}
      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => !busy && setSelected(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => !busy && setSelected(null)}>
          <Pressable style={[styles.detailSheet, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => {}}>
            <View style={styles.detailHeader}>
              <Text numberOfLines={1} style={[styles.detailTitle, { color: colors.foreground }]}>
                {selected ? prettyName(selected) : ''}
              </Text>
              <IconButton
                icon={selected && favorites[selected] ? 'favorite' : 'favorite-border'}
                label={selected && favorites[selected] ? 'Remove from favorites' : 'Add to favorites'}
                size={26}
                color={selected && favorites[selected] ? colors.destructive : colors.mutedForeground}
                onPress={() => selected && toggleFavorite(selected)}
              />
              <IconButton icon="close" size={26} color={colors.foreground} disabled={busy} onPress={() => setSelected(null)} />
            </View>
            <View style={[styles.detailRule, { backgroundColor: colors.border }]} />

            <View style={{ alignItems: 'center', marginVertical: spacing.md }}>
              {selected ? <PatternThumb name={selected} size={240} /> : null}
            </View>

            {selOnTable ? (
              <View style={styles.preExecWrap}>
                <Text style={[styles.preExecLabel, { color: colors.foreground }]}>Pre-Execution Action</Text>
                <View style={styles.preExecGrid}>
                  {PRE_EXEC.map(({ mode, label }) => {
                    const on = clearMode === mode
                    return (
                      <Pressable
                        key={mode}
                        onPress={() => setClearMode(mode)}
                        disabled={busy}
                        style={[styles.preExecBtn, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.cardElevated, opacity: busy ? 0.5 : 1 }]}
                      >
                        <Text style={{ color: on ? colors.primaryForeground : colors.foreground, fontSize: font.size.sm, fontWeight: font.weight.medium, textAlign: 'center' }}>{label}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>
            ) : null}

            {pushPct != null ? (
              <View style={styles.pushProgress}>
                <View style={[styles.pushTrack, { backgroundColor: colors.border }]}>
                  <View style={[styles.pushFill, { width: `${Math.round(pushPct * 100)}%`, backgroundColor: colors.primary }]} />
                </View>
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, textAlign: 'center', marginTop: 4 }}>
                  {pushPct >= 1 ? 'Waiting for the table to finish writing…' : `Sending to table · ${Math.round(pushPct * 100)}%`}
                </Text>
              </View>
            ) : null}

            <View style={styles.detailActions}>
              {selOnTable ? (
                <Button title="Play" icon="play-arrow" loading={running} disabled={busy} onPress={() => selected && run(selected)} />
              ) : null}
              {selInLibrary ? (
                <Button
                  title={selOnTable ? 'Re-send to table' : 'Send to table'}
                  icon="cloud-upload"
                  variant="secondary"
                  loading={pushing}
                  disabled={busy}
                  onPress={() => selected && doPush(selected)}
                />
              ) : null}
              {selected && (selOnTable || imported.some((p) => p.name === bareName(selected))) ? (
                <Button title="Delete" icon="delete-outline" variant="ghost" loading={deleting} disabled={busy} onPress={() => selected && del(selected)} />
              ) : null}
              {!selOnTable && !selInLibrary ? (
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, textAlign: 'center' }}>Not in your library or on the table.</Text>
              ) : null}
            </View>
            {/* Spacer sized to the modal window's bottom inset (Android nav bar / iOS home indicator) */}
            <SafeAreaView edges={['bottom']} />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Import preview sheet */}
      <Modal visible={!!importPreview} transparent animationType="slide" onRequestClose={() => setImportPreview(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setImportPreview(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => {}}>
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <PolarPattern name={importPreview?.name} size={240} showRings />
            <Text numberOfLines={2} style={[styles.sheetTitle, { color: colors.foreground }]}>
              {importPreview ? prettyName(importPreview.name) : ''}
            </Text>
            <View style={styles.sheetActions}>
              <Button title="Add" icon="library-add" variant="secondary" onPress={() => confirmImport(false)} flex />
              <Button title="Add & send" icon="cloud-upload" loading={pushing} onPress={() => confirmImport(true)} flex />
            </View>
            <SafeAreaView edges={['bottom']} />
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  )
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, marginBottom: spacing.sm },
  favBadge: { position: 'absolute', top: -2, right: -2, width: 26, height: 26, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  filterList: { marginTop: spacing.sm, gap: 2 },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, borderRadius: radius.md, paddingHorizontal: spacing.md },
  filterLabel: { flex: 1, fontSize: font.size.md, fontWeight: font.weight.medium, textTransform: 'capitalize' },
  control: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: spacing.md, height: 44 },
  searchInput: { flex: 1, fontSize: font.size.md, paddingVertical: 0 },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: spacing.md, height: 44 },
  iconBtn: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, width: 44, height: 44 },
  tile: { flex: 1 / COLS, alignItems: 'center', gap: spacing.xs, marginBottom: spacing.md },
  tileThumb: { borderWidth: 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  tileName: { fontSize: font.size.xs, fontWeight: font.weight.medium, maxWidth: '100%', textAlign: 'center' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, padding: spacing.xl, alignItems: 'center', gap: spacing.md },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, marginBottom: spacing.sm },
  sheetTitle: { fontSize: font.size.lg, fontFamily: font.family.displaySemi, textAlign: 'center' },
  sheetActions: { flexDirection: 'row', gap: spacing.md, alignSelf: 'stretch' },
  detailSheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, padding: spacing.xl, paddingTop: spacing.lg },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  detailTitle: { fontSize: font.size.lg, fontFamily: font.family.displaySemi, flex: 1 },
  detailRule: { height: 1, marginTop: spacing.sm },
  preExecWrap: { marginBottom: spacing.md },
  preExecLabel: { fontSize: font.size.sm, fontWeight: font.weight.semibold, marginBottom: spacing.sm },
  preExecGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  preExecBtn: { width: '48%', minHeight: 46, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  detailActions: { gap: spacing.sm },
  pushProgress: { marginBottom: spacing.md },
  pushTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  pushFill: { height: 6, borderRadius: 3 },
})
