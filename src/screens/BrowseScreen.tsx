import React, { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Alert, Dimensions, FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { board, type ClearMode } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { usePrefs } from '../stores/usePrefs'
import { toast } from '../stores/useToast'
import { useLibrary, previewNames, bareName } from '../stores/useLibrary'
import { pushToTable } from '../lib/pushPattern'
import { assertSdIdle } from '../lib/sd'
import { importThr, type ImportedThr } from '../lib/importPattern'
import { PatternThumb } from '../components/PatternThumb'
import { PolarPattern } from '../components/PolarPattern'
import { Button, IconButton } from '../components/ui'
import { Screen } from '../components/Screen'
import { radius, spacing, font } from '../theme'

const COLS = 3
const THUMB = Math.floor((Dimensions.get('window').width - spacing.md * 2 - spacing.md * (COLS - 1)) / COLS)


// dw "Pre-Execution Action" choices (a clear sequenced before the pattern runs).
const PRE_EXEC: { mode: ClearMode; label: string }[] = [
  { mode: 'adaptive', label: 'Adaptive' },
  { mode: 'in', label: 'Clear From Center' },
  { mode: 'out', label: 'Clear From Perimeter' },
  { mode: 'sideway', label: 'Clear Sideway' },
  { mode: 'none', label: 'None' },
]

function prettyName(file: string): string {
  // Strip the .thr extension and any folder prefix (e.g. "custom_patterns/x").
  return (file.replace(/\.thr$/i, '').split('/').pop() ?? file)
}

export function BrowseScreen() {
  const colors = useTheme((s) => s.colors)
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
  const [selected, setSelected] = useState<string | null>(null)
  // Pre-Execution Action is a remembered preference (persisted across launches).
  const clearMode = usePrefs((s) => s.clearMode)
  const setClearMode = usePrefs((s) => s.setClearMode)
  const [running, setRunning] = useState(false)
  const [pushing, setPushing] = useState(false)
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

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = allNames
    if (q) list = list.filter((p) => p.toLowerCase().includes(q))
    list = [...list].sort((a, b) => a.localeCompare(b) * (asc ? 1 : -1))
    return list
  }, [allNames, query, asc])

  const run = async (file: string) => {
    if (!base) return
    setRunning(true)
    try {
      await board.runPattern(base, file, clearMode)
      toast.success(`Running ${prettyName(file)}`)
      setSelected(null)
      setTimeout(refreshStatus, 400)
    } catch {
      toast.error(clearMode === 'none' ? 'Failed to run pattern' : 'Run failed (clear needs a playlist config)')
    } finally {
      setRunning(false)
    }
  }

  const doPush = async (name: string) => {
    if (!base) return
    const replace = onTableSet.has(name)
    const go = async () => {
      setPushing(true)
      try {
        await pushToTable(base, name)
        toast.success(`Sent ${prettyName(name)} to table`)
        setSelected(null)
        useLibrary.getState().addTablePattern(bareName(name))
      } catch (e) {
        toast.error(`Upload failed: ${(e as Error).message}`)
      } finally {
        setPushing(false)
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
      setXY(result.name, result.xy) // preview immediately
      setImportPreview(result)
    } catch (e) {
      toast.error((e as Error).message || 'Import failed')
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
          try {
            if (onTable && base) {
              assertSdIdle()
              await board.deleteSdFile(base, '/patterns/', file)
              useLibrary.getState().removeTablePattern(file)
            }
            if (importedMatch) useLibrary.getState().remove(importedMatch.id)
            toast.success('Deleted')
            setSelected(null)
          } catch (e) {
            toast.error(`Delete failed: ${(e as Error).message}`)
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
          onPress={doImport}
          disabled={importing}
          style={[styles.control, styles.iconBtn, { backgroundColor: colors.primary, borderColor: colors.primary, opacity: importing ? 0.5 : 1 }]}
        >
          {importing ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <MaterialIcons name="add" size={24} color="#fff" />
          )}
        </Pressable>
      </View>

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
          ) : (
            <EmptyState icon="grid-off" text="No patterns" />
          )
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => setSelected(item)} style={styles.tile}>
            <View style={[styles.tileThumb, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <PatternThumb name={item} size={THUMB - 4} />
            </View>
            <Text numberOfLines={1} style={[styles.tileName, { color: colors.foreground }]}>
              {prettyName(item)}
            </Text>
          </Pressable>
        )}
      />

      {/* Pattern detail sheet — mirrors the dw pattern dialog */}
      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSelected(null)}>
          <Pressable style={[styles.detailSheet, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => {}}>
            <View style={styles.detailHeader}>
              <Text numberOfLines={1} style={[styles.detailTitle, { color: colors.foreground }]}>
                {selected ? prettyName(selected) : ''}
              </Text>
              <IconButton icon="close" size={26} color={colors.foreground} onPress={() => setSelected(null)} />
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
                        style={[styles.preExecBtn, { borderColor: on ? colors.primary : colors.border, backgroundColor: on ? colors.primary : colors.cardElevated }]}
                      >
                        <Text style={{ color: on ? '#fff' : colors.foreground, fontSize: font.size.sm, fontWeight: font.weight.medium, textAlign: 'center' }}>{label}</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </View>
            ) : null}

            <View style={styles.detailActions}>
              {selOnTable ? (
                <Button title="Play" icon="play-arrow" loading={running} onPress={() => selected && run(selected)} />
              ) : null}
              {selInLibrary ? (
                <Button
                  title={selOnTable ? 'Re-send to table' : 'Send to table'}
                  icon="cloud-upload"
                  variant="secondary"
                  loading={pushing}
                  onPress={() => selected && doPush(selected)}
                />
              ) : null}
              {selected && (selOnTable || imported.some((p) => p.name === bareName(selected))) ? (
                <Button title="Delete" icon="delete-outline" variant="ghost" onPress={() => selected && del(selected)} />
              ) : null}
              {!selOnTable && !selInLibrary ? (
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, textAlign: 'center' }}>Not in your library or on the table.</Text>
              ) : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Import preview sheet */}
      <Modal visible={!!importPreview} transparent animationType="slide" onRequestClose={() => setImportPreview(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setImportPreview(null)}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <PolarPattern name={importPreview?.name} size={240} showRings />
            <Text numberOfLines={2} style={[styles.sheetTitle, { color: colors.foreground }]}>
              {importPreview ? prettyName(importPreview.name) : ''}
            </Text>
            <View style={styles.sheetActions}>
              <Button title="Add" icon="library-add" variant="secondary" onPress={() => confirmImport(false)} flex />
              <Button title="Add & send" icon="cloud-upload" loading={pushing} onPress={() => confirmImport(true)} flex />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Screen>
  )
}

function EmptyState({ icon, text }: { icon: keyof typeof MaterialIcons.glyphMap; text: string }) {
  const colors = useTheme((s) => s.colors)
  return (
    <View style={styles.empty}>
      <MaterialIcons name={icon} size={40} color={colors.mutedForeground} />
      <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm, textAlign: 'center' }}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  control: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: spacing.md, height: 44 },
  searchInput: { flex: 1, fontSize: font.size.md, paddingVertical: 0 },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: spacing.md, height: 44 },
  iconBtn: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, width: 44, height: 44 },
  tile: { flex: 1 / COLS, alignItems: 'center', gap: spacing.xs, marginBottom: spacing.md },
  tileThumb: { width: THUMB, height: THUMB, borderRadius: THUMB / 2, borderWidth: 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  tileName: { fontSize: font.size.xs, fontWeight: font.weight.medium, maxWidth: '100%', textAlign: 'center' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, padding: spacing.xl, alignItems: 'center', gap: spacing.md },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#888', marginBottom: spacing.sm },
  sheetTitle: { fontSize: font.size.lg, fontWeight: font.weight.semibold, textAlign: 'center' },
  sheetActions: { flexDirection: 'row', gap: spacing.md, alignSelf: 'stretch' },
  detailSheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, padding: spacing.xl, paddingTop: spacing.lg },
  detailHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  detailTitle: { fontSize: font.size.lg, fontWeight: font.weight.bold, flex: 1 },
  detailRule: { height: 1, marginTop: spacing.sm },
  preExecWrap: { marginBottom: spacing.md },
  preExecLabel: { fontSize: font.size.sm, fontWeight: font.weight.semibold, marginBottom: spacing.sm },
  preExecGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  preExecBtn: { width: '48%', minHeight: 46, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.sm },
  detailActions: { gap: spacing.sm },
})
