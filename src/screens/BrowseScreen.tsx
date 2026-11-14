import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { useNavigation, useRoute, type NavigationProp, type RouteProp } from '@react-navigation/native'
import type { TabParamList } from '../navigation'
import { board, CLEAR_DESC, CLEAR_MODES } from '../api/board'
import { isBusy } from '../api/status'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { usePrefs } from '../stores/usePrefs'
import { useTheme as useNavTheme } from '@react-navigation/native'
import { toast } from '../stores/useToast'
import { useLibrary, bundledNames, bareName } from '../stores/useLibrary'
import { pushToTable } from '../lib/pushPattern'
import { assertSdIdle, assertNotSyncing } from '../lib/sd'
import { updateTableManifest } from '../lib/tableManifest'
import { importThr, type ImportedThr } from '../lib/importPattern'
import { PatternThumb } from '../components/PatternThumb'
import { PatternPlayer } from '../components/PatternPlayer'
import { PolarPattern } from '../components/PolarPattern'
import { useIsRect, useThumbFrame, useTravel } from '../components/RectTable'
import { TextGenerator } from '../components/TextGenerator'
import { hubTableFor, roundSize } from '../lib/tableSize'
import { isGcode } from '../lib/gcode'
import { MissingPreviewsBanner } from '../components/MissingPreviewsBanner'
import { HubPane } from '../components/HubPane'
import { readCatalogOnce, tagKey, useHubVisible, useNewHubPatterns } from '../lib/patternHub'
import { useMissingPreviewCount } from '../lib/previewCoverage'
import { Button, IconButton, Segmented } from '../components/ui'
import { Screen } from '../components/Screen'
import { EmptyState } from '../components/EmptyState'
import { prettyName, PATTERN_EXT } from '../lib/patternName'
import { userMessage } from '../lib/errors'
import { SCROLL_BOTTOM_PAD, thumbGrid, useScreenWidth } from '../lib/layout'
import { Sheet, useAnySheetOpen } from '../components/Sheet'
import { FullscreenPlayer } from '../components/FullscreenPlayer'
import { radius, spacing, font } from '../theme'

// The clear run before a single pattern (dw's "Pre-Execution Action"). Random is
// a playlist-only mode, so it's left out here.
const BEFORE_DRAWING = CLEAR_MODES.filter((c) => c.mode !== 'random')

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
const ON_PHONE = '__phone__'
const TAG = '__tag__:' // + a Pattern Hub tag

export function BrowseScreen() {
  const colors = useTheme((s) => s.colors)
  // Thumb size tracks the live window width (rotation / iPad split view safe).
  const width = useScreenWidth()
  const { height } = useWindowDimensions()
  // A rectangular table plays G-code, a round one .thr: list only what this one
  // can draw, on frames of its shape.
  const rect = useIsRect()
  const hubVisible = useHubVisible()
  const frame = useThumbFrame()
  const { cols, thumb } = thumbGrid(width, spacing.md, rect)
  // The detail sheet's table: a 248 disc, or the rectangle as wide as fits.
  const heroW = rect ? Math.min(width - spacing.xl * 2, 360) : 248
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
  // Newest first by date added (the bundled set and card-only patterns have no date: they follow, A–Z), or by name.
  const [sort, setSort] = useState<'added' | 'az' | 'za'>('added')
  // Single-select filter: everything, favorites, top-level, or one subfolder.
  const [filter, setFilter] = useState<string>(ALL_FOLDERS)
  const [filterOpen, setFilterOpen] = useState(false)
  const favorites = usePrefs((s) => s.favorites)
  const toggleFavorite = usePrefs((s) => s.toggleFavorite)
  const [selected, setSelected] = useState<string | null>(null)
  // The detail sheet's sub-page: the pattern, or the before-drawing clear choice.
  const [page, setPage] = useState<'detail' | 'clear' | 'preview'>('detail')
  // The before-drawing clear is a remembered preference (persisted across launches).
  const clearMode = usePrefs((s) => s.clearMode)
  const setClearMode = usePrefs((s) => s.setClearMode)
  const [running, setRunning] = useState(false)
  // Which button is sending: plain Send, or Play on a pattern the table doesn't have yet.
  const [pushing, setPushing] = useState<false | 'send' | 'play'>(false)
  // 0..1 while an upload is in flight — drives the progress bar in the detail sheet.
  const [pushPct, setPushPct] = useState<number | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [importing, setImporting] = useState(false)
  // The "+" menu (Create from text / Import from file), dropped down under it; its top is under the search row.
  const [addOpen, setAddOpen] = useState(false)
  const [addTop, setAddTop] = useState(0)
  const [importPreview, setImportPreview] = useState<ImportedThr | null>(null)
  // Library | Pattern Hub. The hub is .thr only, so round tables only; hidden on
  // desktop and until the website launches it (admins see it early). Its tab
  // mounts on the first visit and then stays (hidden), so a sync keeps going.
  const showHub = !rect && hubVisible
  const [tab, setTab] = useState<'library' | 'hub'>('library')
  const newHub = useNewHubPatterns()
  // Opening the hub tab answers the red badge and dot: those patterns are shown.
  const notification = useNavTheme().colors.notification
  useEffect(() => {
    if (tab !== 'hub' || !newHub.length) return
    const p = usePrefs.getState()
    p.setHubShown([...p.hubShown, ...newHub.map((n) => n.id)])
  }, [tab, newHub])
  const hubTab = showHub && tab === 'hub'
  const [hubMounted, setHubMounted] = useState(false)
  useEffect(() => {
    if (hubTab) setHubMounted(true)
  }, [hubTab])
  // Settings › duneweaver.com's "Open Pattern Hub" lands here with { tab: 'hub' }.
  const route = useRoute<RouteProp<TabParamList, 'Browse'>>()
  const navigation = useNavigation<NavigationProp<TabParamList, 'Browse'>>()
  useEffect(() => {
    if (route.params?.tab !== 'hub') return
    setTab('hub')
    navigation.setParams({ tab: undefined })
  }, [route.params?.tab, navigation])

  // Load the full on-table manifest once (App also kicks this off at startup);
  // no-op if already loaded. Deferred to the next idle if the table is
  // mid-pattern — that's how custom_patterns/ show up (a beat later while busy).
  useEffect(() => {
    loadTable(base)
  }, [base, loadTable])

  // Pull-to-refresh: re-read the manifest. While the table is running the read
  // is deferred (loadTable records it) — say so, then it refreshes at idle.
  const refreshTable = () => {
    // Imported catalog is frozen — a board read would defeat the point. Point
    // the user at the switch instead of silently doing nothing.
    if (useLibrary.getState().catalogSource(base) === 'imported') {
      toast.info('Using an imported catalog — switch it off in Settings to refresh from the table')
      return
    }
    if (isBusy(useStatus.getState().status)) {
      toast.info('Table is running — patterns will refresh when it’s idle')
    }
    loadTable(base, true)
  }

  // One unified library: the bundled defaults + imported patterns + anything
  // else on the table, deduped by name.
  const allNames = useMemo(() => {
    const set = new Set<string>(bundledNames(rect))
    for (const p of imported) if (isGcode(p.name) === rect) set.add(p.name)
    for (const p of patterns) if (isGcode(p) === rect) set.add(p)
    return [...set]
  }, [imported, patterns, rect])

  const onTableSet = useMemo(() => new Set(patterns), [patterns])

  // The pattern generator (Create): a name it saves under must not match any
  // pattern here, in any folder, or the table would play the other one.
  const travel = useTravel()
  const activeBoard = useBoards((st) => st.getActive())
  const size = useMemo(() => roundSize(activeBoard), [activeBoard])
  // Hub patterns updated since the table got them (the phone holds the new
  // revision, Board.hubSent the one sent): Play sends the new one first.
  const olderOnTable = useMemo(() => {
    const sent = activeBoard?.hubSent ?? {}
    return new Set(imported.filter((p) => p.hubRev && sent[p.name] && sent[p.name] !== p.hubRev).map((p) => p.name))
  }, [imported, activeBoard])
  // A hub pattern made in versions per table size shows only the one this table
  // takes (patternHub's forTable rule: a Pro-sized table the pro file, a Mini
  // Pro-sized one the mini-pro file, one in between its pick), even when the
  // phone or the card holds both. allNames keeps them all (Create's names).
  const hubVersions = usePrefs((s) => s.hubVersions)
  const libraryNames = useMemo(() => {
    if (rect) return allNames
    const other = new Set<string>()
    for (const [id, files] of Object.entries(hubVersions)) {
      const want = files.find((f) => f.table === hubTableFor(activeBoard, id)) ?? files[0]
      for (const f of files) if (f.key !== want.key) other.add(f.key)
    }
    return other.size ? allNames.filter((n) => !other.has(tagKey(n))) : allNames
  }, [allNames, hubVersions, activeBoard, rect])
  const [genOpen, setGenOpen] = useState(false)
  const [savedName, setSavedName] = useState<string | null>(null)
  const nameKey = (n: string) => n.toLowerCase().replace(/[\s_-]+/g, ' ').trim()
  const takenNames = useMemo(() => new Set(allNames.map((n) => nameKey((n.split('/').pop() ?? n).replace(PATTERN_EXT, '')))), [allNames])
  const taken = useCallback((n: string) => takenNames.has(nameKey(n)), [takenNames])
  const openGenerator = () => {
    // A rectangle's size comes from the table; it's read once it has been online.
    if (rect && !travel) return toast.info('Connect to the table once so the app knows its size')
    setGenOpen(true)
  }

  // Patterns that can only render the blank placeholder — no bundled webp, no
  // ingested preview image, no local geometry. Always on-table ones the card was
  // bulk-loaded with; the banner points at Settings' preview sync.
  // (Not on a rectangular table: the preview bundle is .thr-only, a sync can't help.)
  const missingPreviews = useMissingPreviewCount(rect ? [] : libraryNames)

  // Distinct subfolders present in the library. Only worth showing the filter
  // when patterns actually live in subfolders (e.g. custom_patterns/).
  const folders = useMemo(() => {
    const set = new Set<string>()
    for (const n of libraryNames) set.add(folderOf(n))
    return [...set].filter((f) => f !== '').sort((a, b) => a.localeCompare(b))
  }, [libraryNames])
  const hasTopLevel = useMemo(() => libraryNames.some((n) => folderOf(n) === ''), [libraryNames])
  // Only favorites this table can draw (they're shared across tables of both shapes).
  const hasFavorites = libraryNames.some((n) => favorites[n])
  // What this phone holds beyond the bundled set: imports and Pattern Hub downloads.
  const onPhone = useMemo(() => new Set(imported.filter((p) => isGcode(p.name) === rect).map((p) => p.name)), [imported, rect])
  // Pattern Hub tags (saved on the phone from the catalog) the library's patterns carry, most used first.
  const hubTags = usePrefs((s) => s.hubTags)
  useEffect(() => readCatalogOnce(), [])
  const tags = useMemo(() => {
    const n = new Map<string, number>()
    for (const p of libraryNames) for (const t of hubTags[tagKey(p)] ?? []) n.set(t, (n.get(t) ?? 0) + 1)
    return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [libraryNames, hubTags])

  const visible = useMemo(() => {
    const q = query.trim()
    let list = libraryNames
    if (filter === FAVORITES) list = list.filter((p) => favorites[p])
    else if (filter === ON_PHONE) list = list.filter((p) => onPhone.has(p))
    else if (filter.startsWith(TAG)) list = list.filter((p) => hubTags[tagKey(p)]?.includes(filter.slice(TAG.length)))
    else if (filter !== ALL_FOLDERS) {
      list = list.filter((p) => (filter === TOP_LEVEL ? folderOf(p) === '' : folderOf(p) === filter))
    }
    if (q) list = list.filter((p) => fuzzyMatch(p.replace(PATTERN_EXT, ''), q))
    const byName = (a: string, b: string) => prettyName(a).localeCompare(prettyName(b))
    if (sort === 'added') {
      const added = new Map(imported.map((p) => [p.name, p.addedAt]))
      list = [...list].sort((a, b) => (added.get(b) ?? 0) - (added.get(a) ?? 0) || byName(a, b))
    } else list = [...list].sort((a, b) => byName(a, b) * (sort === 'az' ? 1 : -1))
    return list
  }, [libraryNames, query, sort, filter, favorites, onPhone, hubTags, imported])

  // Dropdown options: everything / favorites / on this phone / default (top-level) / each subfolder / each hub tag.
  const filterOptions = useMemo(
    (): { key: string; label: string; icon: 'apps' | 'favorite' | 'smartphone' | 'folder' | 'sell'; count?: number }[] => [
      { key: ALL_FOLDERS, label: 'All patterns', icon: 'apps' },
      { key: FAVORITES, label: 'Favorites', icon: 'favorite' as const },
      ...(onPhone.size > 0 ? [{ key: ON_PHONE, label: 'On this phone', icon: 'smartphone' as const }] : []),
      ...(folders.length > 0 && hasTopLevel ? [{ key: TOP_LEVEL, label: 'Default', icon: 'folder' as const }] : []),
      ...folders.map((f) => ({ key: f, label: folderLabel(f), icon: 'folder' as const })),
      ...tags.map(([t, n]) => ({ key: TAG + t, label: t, icon: 'sell' as const, count: n })),
    ],
    [folders, hasTopLevel, onPhone, tags],
  )

  // Drop a filter whose option is gone (a folder after a table reload, the last import deleted).
  useEffect(() => {
    if (!filterOptions.some((o) => o.key === filter)) setFilter(ALL_FOLDERS)
  }, [filterOptions, filter])
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

  /** Send a library pattern to the table; `andPlay` then draws it (Play on a
   * pattern that isn't on the table yet), so it's one tap, not send-close-reopen-play. */
  const doPush = async (name: string, andPlay = false) => {
    if (!base) return
    // An update goes over the table's older copy without asking.
    const replace = onTableSet.has(name) && !olderOnTable.has(name)
    const go = async () => {
      setPushing(andPlay ? 'play' : 'send')
      setPushPct(0)
      try {
        await pushToTable(base, name, setPushPct)
        useLibrary.getState().addTablePattern(bareName(name))
        if (andPlay) {
          await run(name)
          return
        }
        toast.success(`Sent ${prettyName(name)} to table`)
        setSelected(null)
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
      const result = await importThr(rect)
      if (!result) return // cancelled
      const { imported, failed } = result
      if (imported.length === 0) {
        const kind = rect ? 'G-code' : '.thr'
        toast.error(failed.length ? `No valid ${kind} files (skipped ${failed.length})` : `No valid ${kind} files`)
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
      setPage('detail')
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
  const busy = running || !!pushing || deleting
  const sheetName = importPreview?.name ?? selected

  // On a rectangular table the preview page can go full screen and sideways
  // (FullscreenPlayer) when asked. That's a Modal of its own and iOS shows one at
  // a time, so the pattern's sheet closes first, the player opens once it's gone,
  // and the sheet comes back on the preview page after.
  const [fullscreen, setFullscreen] = useState<string | null>(null)
  const [pendingFull, setPendingFull] = useState<string | null>(null)
  const reopenAfterFull = useRef<string | null>(null)
  // Back from full screen the preview page shows the finished drawing, not a replay.
  const [backFromFull, setBackFromFull] = useState(false)
  const anySheetOpen = useAnySheetOpen()
  // After Create › Save: the new pattern's own sheet (Play is there), once the generator's is gone.
  useEffect(() => {
    if (!savedName || anySheetOpen) return
    setTab('library')
    setPage('detail')
    setSelected(savedName)
    setSavedName(null)
  }, [savedName, anySheetOpen])
  useEffect(() => {
    if (pendingFull && !anySheetOpen) {
      setFullscreen(pendingFull)
      setPendingFull(null)
    }
  }, [pendingFull, anySheetOpen])
  const openFullscreen = (name: string) => {
    setPendingFull(name)
    setSelected(null)
  }
  const reopenSheet = () => {
    const name = reopenAfterFull.current
    reopenAfterFull.current = null
    if (name) {
      setBackFromFull(true)
      setPage('preview')
      setSelected(name)
    }
  }
  const closeFullscreen = () => {
    reopenAfterFull.current = fullscreen
    setFullscreen(null)
    // Android and web stack modals fine; iOS waits for the player's onDismiss.
    if (Platform.OS !== 'ios') reopenSheet()
  }
  // Play works for anything on the table, and for library patterns by sending them first.
  const canPlay = selOnTable || selInLibrary
  const filterLabel = filterOptions.find((o) => o.key === filter)?.label ?? ''
  // Which tiles aren't on the table — only once we know what IS on it.
  const tableKnown = patterns.length > 0
  const where =
    !selected ? ''
    : olderOnTable.has(selected) ? 'Updated on the Pattern Hub — Play sends the new one to the table first'
    : selOnTable ? (folderOf(selected) ? `On the table · ${folderLabel(folderOf(selected))}` : 'On the table')
    : selInLibrary ? 'On this phone — Play sends it to the table first'
    : 'Not in your library or on the table.'

  return (
    <Screen title="Browse">
      {showHub ? (
        <View style={styles.tabRow}>
          <Segmented
            fill
            value={tab}
            options={[{ value: 'library', label: 'Library' }, { value: 'hub', label: 'Pattern Hub', dot: newHub.length ? notification : undefined }]}
            onChange={(t) => {
              setAddOpen(false)
              setTab(t)
            }}
          />
        </View>
      ) : null}
      {hubMounted && showHub ? (
        <View style={{ flex: 1, display: hubTab ? 'flex' : 'none' }}>
          <HubPane active={hubTab} />
        </View>
      ) : null}
      <View style={{ flex: 1, display: hubTab ? 'none' : 'flex' }}>
        <View style={styles.searchRow} onLayout={(e) => setAddTop(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
          <View style={[styles.control, styles.search, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
            <MaterialIcons name="search" size={18} color={colors.mutedForeground} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={filterActive ? `Search in ${filterLabel}` : `Search ${libraryNames.length} patterns`}
              placeholderTextColor={colors.mutedForeground}
              autoCorrect={false}
              autoCapitalize="none"
              spellCheck={false}
              style={[styles.searchInput, { color: colors.foreground }]}
            />
            {query ? <IconButton icon="close" size={18} color={colors.mutedForeground} onPress={() => setQuery('')} /> : null}
          </View>
          <Pressable
            onPress={() => setFilterOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={`Show and sort${filterActive ? ` (${filterLabel})` : ''}`}
            style={[
              styles.control,
              styles.iconBtn,
              filterActive ? { backgroundColor: colors.primary, borderColor: colors.primary } : { backgroundColor: colors.card, borderColor: colors.border },
            ]}
          >
            <MaterialIcons
              name={filter === FAVORITES ? 'favorite' : 'filter-list'}
              size={22}
              color={filterActive ? colors.primaryForeground : colors.foreground}
            />
          </Pressable>
          <Pressable
            onPress={() => setAddOpen(true)}
            disabled={importing}
            accessibilityRole="button"
            accessibilityLabel="Add patterns"
            accessibilityState={{ expanded: addOpen }}
            style={({ pressed }) => [styles.control, styles.iconBtn, { backgroundColor: colors.card, borderColor: colors.border, opacity: importing ? 0.5 : pressed ? 0.7 : 1 }]}
          >
            {importing ? (
              <ActivityIndicator size="small" color={colors.foreground} />
            ) : (
              <MaterialIcons name="add" size={24} color={colors.foreground} />
            )}
          </Pressable>
        </View>

        {/* Filter dropdown — bottom sheet listing All / Favorites / folders / tags */}
        <Sheet visible={filterOpen} onClose={() => setFilterOpen(false)} title="Show">
          <View style={styles.sortRow}>
            <Segmented
              fill
              value={sort}
              options={[{ value: 'added', label: 'Newest' }, { value: 'az', label: 'A–Z' }, { value: 'za', label: 'Z–A' }]}
              onChange={setSort}
            />
          </View>
          {/* Cap the list height so a big catalog's folders scroll inside the
              sheet instead of overflowing the screen. */}
          <ScrollView
            style={{ maxHeight: height * 0.55 }}
            contentContainerStyle={styles.filterList}
            showsVerticalScrollIndicator
          >
            {filterOptions.map(({ key, label, icon, count }) => {
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
                  <MaterialIcons name={icon} size={20} color={colors.mutedForeground} />
                  <Text style={[styles.filterLabel, { color: colors.foreground }]}>{label}</Text>
                  {count != null || (fav && hasFavorites) ? (
                    <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, fontFamily: font.family.mono }}>
                      {count ?? Object.keys(favorites).length}
                    </Text>
                  ) : null}
                  {on ? <MaterialIcons name="check" size={20} color={colors.primary} /> : null}
                </Pressable>
              )
            })}
          </ScrollView>
        </Sheet>

        <FlatList
          data={visible}
          key={cols}
          numColumns={cols}
          keyExtractor={(item) => item}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: SCROLL_BOTTOM_PAD }}
          columnWrapperStyle={{ gap: spacing.md }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={refreshTable} tintColor={colors.primary} />}
          ListHeaderComponent={<MissingPreviewsBanner missing={missingPreviews} />}
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
            ) : filter === FAVORITES && !hasFavorites ? (
              <EmptyState icon="favorite-border" text="No favorites yet — tap the heart on a pattern." />
            ) : (
              <EmptyState icon="grid-off" text={query.trim() ? `No patterns match “${query.trim()}”` : 'No patterns'} />
            )
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => { setPage('detail'); setSelected(item) }}
              accessibilityRole="button"
              accessibilityLabel={
                tableKnown && olderOnTable.has(item) ? `${prettyName(item)}, older copy on the table`
                : tableKnown && !onTableSet.has(item) ? `${prettyName(item)}, not on the table`
                : prettyName(item)
              }
              style={[styles.tile, { flex: 1 / cols }]}
            >
              <View style={[styles.tileThumb, frame(thumb), { backgroundColor: colors.card, borderColor: colors.border }]}>
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
                  color={favorites[item] ? colors.primary : colors.mutedForeground}
                />
              </Pressable>
              <View style={styles.tileCaption}>
                {tableKnown && olderOnTable.has(item) ? <MaterialIcons name="update" size={13} color={colors.mutedForeground} />
                : tableKnown && !onTableSet.has(item) ? <MaterialIcons name="smartphone" size={13} color={colors.mutedForeground} />
                : null}
                <Text numberOfLines={1} style={[styles.tileName, { color: colors.foreground }]}>
                  {prettyName(item)}
                </Text>
              </View>
            </Pressable>
          )}
        />
        {/* The "+" menu: a pull-down in the view, not a Modal (one Modal at a time on
            iOS — the generator's sheet opens right after). A tap anywhere else, the
            "+" included, closes it. */}
        {addOpen ? (
          <>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setAddOpen(false)} accessibilityLabel="Close menu" />
            <View style={[styles.control, styles.addMenu, { top: addTop, backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
              {(
                [
                  { icon: 'text-fields', label: 'Create from text', run: openGenerator },
                  { icon: 'file-open', label: 'Import from file', run: doImport },
                ] as const
              ).map(({ icon, label, run }) => (
                <Pressable
                  key={label}
                  onPress={() => {
                    setAddOpen(false)
                    run()
                  }}
                  accessibilityRole="menuitem"
                  style={({ pressed }) => [styles.addItem, pressed && { backgroundColor: colors.card }]}
                >
                  <MaterialIcons name={icon} size={20} color={colors.foreground} />
                  <Text style={[styles.addLabel, { color: colors.foreground }]}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </View>

      {/* ONE sheet for the import preview and the pattern detail: "Add & send"
          swaps the preview for the detail body in place, so its upload progress
          shows without handing off between two Modals (iOS drops the second). */}
      <Sheet
        visible={!!sheetName}
        // Nothing closes it while a play/send/delete is in flight.
        dismissible={!busy}
        onClose={() => {
          if (busy) return
          setImportPreview(null)
          setSelected(null)
          setPage('detail')
        }}
        title={page === 'clear' && !importPreview ? 'Before drawing' : sheetName ? prettyName(sheetName) : undefined}
        onBack={page !== 'detail' && !importPreview ? () => setPage('detail') : undefined}
        trailing={
          importPreview || page !== 'detail' ? undefined : (
            <>
              <IconButton
                icon={selected && favorites[selected] ? 'favorite' : 'favorite-border'}
                label={selected && favorites[selected] ? 'Remove from favorites' : 'Add to favorites'}
                color={selected && favorites[selected] ? colors.primary : colors.mutedForeground}
                onPress={() => selected && toggleFavorite(selected)}
              />
              <IconButton icon="close" label="Close" disabled={busy} onPress={() => setSelected(null)} />
            </>
          )
        }
      >
        {importPreview ? (
          <View style={styles.importBody}>
            {rect ? (
              <View style={[styles.detailDisc, frame(heroW), { backgroundColor: colors.card, borderColor: colors.border }]}>
                <PatternThumb name={importPreview.name} size={heroW - 12} />
              </View>
            ) : (
              <PolarPattern name={importPreview.name} size={240} showRings />
            )}
            <View style={styles.sheetActions}>
              <Button title="Add" icon="library-add" variant="secondary" onPress={() => confirmImport(false)} flex />
              <Button title="Add & send" icon="cloud-upload" loading={!!pushing} onPress={() => confirmImport(true)} flex />
            </View>
          </View>
        ) : page === 'preview' && selected ? (
          // The playback preview, opened from the pattern's image (one sheet at a time).
          // Full screen (sideways) only when asked for, on a rectangular table.
          <PatternPlayer key={selected} name={selected} autoplay={!backFromFull} onFullscreen={rect ? () => openFullscreen(selected) : undefined} />
        ) : page === 'clear' ? (
          // The before-drawing clear, picked like a playlist's: a list with what each one does.
          <ScrollView contentContainerStyle={styles.clearList}>
            {BEFORE_DRAWING.map((c) => {
              const on = c.mode === clearMode
              return (
                <Pressable
                  key={c.mode}
                  onPress={() => { setClearMode(c.mode); setPage('detail') }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  style={({ pressed }) => [styles.clearOption, { backgroundColor: pressed ? colors.cardElevated : colors.card, borderColor: on ? colors.primary : colors.border }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.foreground, fontSize: font.size.md, fontWeight: font.weight.medium }}>{c.label}</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, marginTop: 2 }}>{CLEAR_DESC[c.mode]}</Text>
                  </View>
                  {on ? <MaterialIcons name="check-circle" size={22} color={colors.primary} /> : null}
                </Pressable>
              )
            })}
          </ScrollView>
        ) : (
          // Scrolls so large text sizes can't push the actions off-screen.
          <ScrollView contentContainerStyle={styles.detailBody}>
            <View style={styles.detailHero}>
              {selected ? (
                // Tapping the pattern opens its playback preview (dune-weaver-viewer's
                // player), when the app holds a copy to play. No badge on it (owner's call):
                // nothing covers the pattern.
                <Pressable
                  onPress={() => {
                    setBackFromFull(false)
                    setPage('preview')
                  }}
                  disabled={!selInLibrary}
                  accessibilityRole={selInLibrary ? 'button' : 'image'}
                  accessibilityLabel={selInLibrary ? 'Preview drawing' : prettyName(selected)}
                >
                  {({ pressed }) => (
                    <View style={[styles.detailDisc, frame(heroW), { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}>
                      <PatternThumb name={selected} size={heroW - 12} />
                    </View>
                  )}
                </Pressable>
              ) : null}
              <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, textAlign: 'center' }}>{where}</Text>
            </View>

            {pushPct != null ? (
              <View style={styles.pushProgress}>
                <View style={[styles.pushTrack, { backgroundColor: colors.border }]}>
                  <View style={[styles.pushFill, { width: `${Math.round(pushPct * 100)}%`, backgroundColor: colors.primary }]} />
                </View>
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, textAlign: 'center', marginTop: 4 }}>
                  {pushPct >= 1 ? 'Waiting for the table to finish writing…' : `Sending to table · ${Math.round(pushPct * 100)}%`}
                </Text>
              </View>
            ) : null}

            {canPlay ? (
              <View style={styles.detailActions}>
                {/* The clear is a remembered choice, so it's one row, not five buttons beside Play. */}
                <Pressable
                  onPress={() => setPage('clear')}
                  disabled={busy}
                  accessibilityRole="button"
                  accessibilityLabel={`Before drawing, ${BEFORE_DRAWING.find((c) => c.mode === clearMode)?.label ?? ''}`}
                  style={({ pressed }) => [styles.clearRow, { borderColor: colors.border, backgroundColor: pressed ? colors.cardElevated : 'transparent', opacity: busy ? 0.5 : 1 }]}
                >
                  <Text style={{ flex: 1, color: colors.foreground, fontSize: font.size.md }}>Before drawing</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: font.size.md }}>{BEFORE_DRAWING.find((c) => c.mode === clearMode)?.label}</Text>
                  <MaterialIcons name="chevron-right" size={22} color={colors.mutedForeground} />
                </Pressable>
                <Button
                  title="Play"
                  icon="play-arrow"
                  loading={running || pushing === 'play'}
                  disabled={busy}
                  onPress={() => selected && (selOnTable && !olderOnTable.has(selected) ? run(selected) : doPush(selected, true))}
                />
              </View>
            ) : null}

            <View style={[styles.detailActions, { marginTop: spacing.sm }]}>
              {selInLibrary && selOnTable ? (
                <Button title="Re-send to table" icon="cloud-upload" variant="secondary" loading={pushing === 'send'} disabled={busy} onPress={() => selected && doPush(selected)} />
              ) : selInLibrary ? (
                <Button title="Send to table" icon="cloud-upload" variant="secondary" loading={pushing === 'send'} disabled={busy} onPress={() => selected && doPush(selected)} />
              ) : null}
              {selected && (selOnTable || imported.some((p) => p.name === bareName(selected))) ? (
                <Button title="Delete" icon="delete-outline" variant="destructive" loading={deleting} disabled={busy} onPress={() => selected && del(selected)} />
              ) : null}
            </View>
          </ScrollView>
        )}
      </Sheet>
      <TextGenerator
        visible={genOpen}
        rect={rect}
        travel={travel}
        size={size}
        taken={taken}
        onClose={() => setGenOpen(false)}
        onSaved={(name) => {
          setGenOpen(false)
          setSavedName(name)
          toast.success(`Saved ${prettyName(name)} to your library`)
        }}
      />
      <FullscreenPlayer title={fullscreen ? prettyName(fullscreen) : null} onClose={closeFullscreen} onDismissed={reopenSheet}>
        {(w) => (fullscreen ? <PatternPlayer key={fullscreen} name={fullscreen} autoplay frameWidth={w} caption={false} /> : null)}
      </FullscreenPlayer>
    </Screen>
  )
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, marginBottom: spacing.sm },
  tabRow: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs },
  favBadge: { position: 'absolute', top: -2, right: -2, width: 26, height: 26, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  filterList: { gap: 2, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, borderRadius: radius.md, paddingHorizontal: spacing.md },
  filterLabel: { flex: 1, fontSize: font.size.md, fontWeight: font.weight.medium, textTransform: 'capitalize' },
  control: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: spacing.md, minHeight: 44 },
  searchInput: { flex: 1, fontSize: font.size.md, paddingVertical: 0 },
  sortRow: { paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  addMenu: { position: 'absolute', right: spacing.md, minWidth: 220, borderRadius: radius.lg, borderWidth: 1, paddingVertical: spacing.xs, shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  addItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48, paddingHorizontal: spacing.md },
  addLabel: { flexShrink: 1, fontSize: font.size.md, fontWeight: font.weight.medium },
  iconBtn: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, width: 44, height: 44 },
  tile: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.md },
  tileThumb: { borderWidth: 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  tileCaption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, maxWidth: '100%' },
  tileName: { flexShrink: 1, fontSize: font.size.sm, fontWeight: font.weight.medium, textAlign: 'center' },
  importBody: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, alignItems: 'center', gap: spacing.lg },
  sheetActions: { flexDirection: 'row', gap: spacing.md, alignSelf: 'stretch' },
  detailBody: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.lg },
  detailHero: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.lg },
  detailDisc: { borderWidth: 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  clearRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48, paddingLeft: spacing.md, paddingRight: spacing.sm, borderRadius: radius.lg, borderWidth: 1 },
  clearList: { padding: spacing.md, gap: spacing.sm },
  clearOption: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1 },
  detailActions: { gap: spacing.sm },
  pushProgress: { marginBottom: spacing.md },
  pushTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  pushFill: { height: 6, borderRadius: 3 },
})
