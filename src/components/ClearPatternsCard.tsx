// Settings card: custom clear patterns + clear speed ($Playlist/ClearIn,
// ClearOut, ClearSpeed — firmware ≥ v0.1.11). Point the "from center" / "from
// edge" clears at any pattern on the card (non-destructively — the firmware
// keeps its built-in clears and just runs the chosen file instead), and give
// clear moves their own feed. Table-wide settings, idle-gated by the firmware.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MaterialIcons } from '@expo/vector-icons'
import { board } from '../api/board'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { useLibrary, patternKey } from '../stores/useLibrary'
import { toast } from '../stores/useToast'
import { prettyName } from '../lib/patternName'
import { userMessage } from '../lib/errors'
import { Button, Card, CardTitle, IconButton } from './ui'
import { PatternThumb } from './PatternThumb'
import { EmptyState } from './EmptyState'
import { radius, spacing, font } from '../theme'

// The firmware's built-in clear files (a ClearIn/ClearOut equal to these — or
// empty — means "use the built-in", so we show it as the default).
const STOCK_IN = '/patterns/clear_from_in.thr'
const STOCK_OUT = '/patterns/clear_from_out.thr'

const GRID_COLS = 3

type Slot = 'in' | 'out'

/** A stored ClearIn/ClearOut path -> the pattern key, or null when it's the
 * built-in (empty or the stock path). */
function customKey(path: string, stock: string): string | null {
  if (!path || path === stock) return null
  return patternKey(path)
}

export function ClearPatternsCard({ base }: { base: string }) {
  const { width: winW } = useWindowDimensions()
  const gridThumb = Math.floor((winW - spacing.md * 2 - spacing.md * (GRID_COLS - 1)) / GRID_COLS)
  const colors = useTheme((s) => s.colors)
  const tableIdle = useStatus((s) => (s.status?.state ?? 'Idle') === 'Idle')
  const tablePatterns = useLibrary((s) => s.tablePatterns)
  const loadTable = useLibrary((s) => s.loadTable)

  const [inPath, setInPath] = useState('')
  const [outPath, setOutPath] = useState('')
  const [speed, setSpeed] = useState('0')
  const [picker, setPicker] = useState<Slot | null>(null)
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    try {
      const s = await board.settings(base)
      setInPath(s['Playlist/ClearIn'] ?? '')
      setOutPath(s['Playlist/ClearOut'] ?? '')
      setSpeed(String(parseInt(s['Playlist/ClearSpeed'] ?? '0', 10) || 0))
    } catch {
      // keep whatever we had
    }
  }, [base])
  useEffect(() => {
    load()
  }, [load])


  const inKey = customKey(inPath, STOCK_IN)
  const outKey = customKey(outPath, STOCK_OUT)

  const commit = (slot: Slot, sdPath: string) => {
    const prevIn = inPath
    const prevOut = outPath
    if (slot === 'in') setInPath(sdPath)
    else setOutPath(sdPath)
    const fn = slot === 'in' ? board.setPlaylistClearIn : board.setPlaylistClearOut
    fn(base, sdPath).catch((e) => {
      toast.error(tableIdle ? userMessage(e, 'save the clear pattern') : 'Stop the pattern to change the clear pattern')
      setInPath(prevIn)
      setOutPath(prevOut)
    })
  }

  const choose = (slot: Slot, key: string | null) => {
    // null = built-in: clear the override ('' -> firmware falls back to config).
    commit(slot, key ? `/patterns/${key}` : '')
    setPicker(null)
  }

  const commitSpeed = () => {
    const n = Math.max(0, Math.round(Number(speed) || 0))
    setSpeed(String(n))
    board.setPlaylistClearSpeed(base, n).catch((e) => {
      toast.error(tableIdle ? userMessage(e, 'save the clear speed') : 'Stop the pattern to change the clear speed')
      load()
    })
  }

  const openPicker = (slot: Slot) => {
    setQuery('')
    setPicker(slot)
    loadTable(base) // no-op if already loaded; never re-reads mid-job
  }

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? tablePatterns.filter((p) => p.toLowerCase().includes(q)) : tablePatterns
    return [...list].sort((a, b) => a.localeCompare(b))
  }, [tablePatterns, query])

  const selectedKey = picker === 'in' ? inKey : picker === 'out' ? outKey : null

  return (
    <Card>
      <CardTitle>Clear patterns</CardTitle>
      <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginBottom: spacing.md }}>
        Choose which pattern erases the sand before the next one. The built-ins work for most tables; pick your own for a custom look. Needs firmware v0.1.11 or newer.
      </Text>

      <ClearRow label="Clear from center" iconKey={inKey} disabled={!tableIdle} onChange={() => openPicker('in')} />
      <ClearRow label="Clear from edge" iconKey={outKey} disabled={!tableIdle} onChange={() => openPicker('out')} />

      <View style={{ marginTop: spacing.md }}>
        <Text style={[styles.label, { color: colors.foreground }]}>Clear speed (mm/min)</Text>
        <TextInput
          value={speed}
          onChangeText={(t) => setSpeed(t.replace(/[^0-9]/g, ''))}
          onEndEditing={commitSpeed}
          editable={tableIdle}
          keyboardType="number-pad"
          style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground, opacity: tableIdle ? 1 : 0.5 }]}
        />
        <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginTop: spacing.sm }}>
          How fast the clear runs. 0 = same speed as the pattern.
        </Text>
      </View>

      {!tableIdle ? (
        <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginTop: spacing.sm }}>
          Clear settings can only change while the table is idle.
        </Text>
      ) : null}

      {/* Single-select pattern picker */}
      <Modal visible={picker !== null} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <View style={styles.backdrop}>
          <SafeAreaView edges={['bottom']} style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={styles.header}>
              <IconButton icon="close" size={26} color={colors.foreground} onPress={() => setPicker(null)} />
              <Text style={{ color: colors.foreground, fontSize: font.size.lg, fontWeight: font.weight.semibold }}>
                {picker === 'in' ? 'Clear from center' : 'Clear from edge'}
              </Text>
              <View style={{ width: 32 }} />
            </View>

            <View style={[styles.search, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
              <MaterialIcons name="search" size={18} color={colors.mutedForeground} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search"
                placeholderTextColor={colors.mutedForeground}
                style={[styles.searchInput, { color: colors.foreground }]}
              />
              {query ? <IconButton icon="close" size={18} color={colors.mutedForeground} onPress={() => setQuery('')} /> : null}
            </View>

            {/* Built-in (reset) option */}
            <Pressable
              onPress={() => picker && choose(picker, null)}
              style={[styles.builtinRow, { borderColor: selectedKey === null ? colors.primary : colors.border, backgroundColor: colors.card }]}
            >
              <MaterialIcons name="auto-fix-high" size={22} color={colors.foreground} />
              <Text style={{ flex: 1, color: colors.foreground, fontWeight: font.weight.medium }}>Use built-in clear</Text>
              {selectedKey === null ? <MaterialIcons name="check-circle" size={22} color={colors.primary} /> : null}
            </Pressable>

            <FlatList
              data={visible}
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
                const on = item === selectedKey
                return (
                  <Pressable onPress={() => picker && choose(picker, item)} style={styles.cell}>
                    <View style={[styles.thumb, { width: gridThumb, height: gridThumb, borderRadius: gridThumb / 2, backgroundColor: colors.card, borderColor: on ? colors.primary : 'transparent' }]}>
                      <PatternThumb name={item} size={gridThumb - 4} />
                      {on ? (
                        <View style={[styles.check, { backgroundColor: colors.primary }]}>
                          <MaterialIcons name="check" size={14} color={colors.primaryForeground} />
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
          </SafeAreaView>
        </View>
      </Modal>
    </Card>
  )
}

function ClearRow({ label, iconKey, disabled, onChange }: { label: string; iconKey: string | null; disabled: boolean; onChange: () => void }) {
  const colors = useTheme((s) => s.colors)
  return (
    <View style={[styles.clearRow, { borderColor: colors.border }]}>
      <View style={[styles.rowThumb, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {iconKey ? <PatternThumb name={iconKey} size={40} /> : <MaterialIcons name="auto-fix-high" size={22} color={colors.mutedForeground} />}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>{label}</Text>
        <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>
          {iconKey ? prettyName(iconKey) : 'Built-in'}
        </Text>
      </View>
      <Button title="Change" variant="secondary" disabled={disabled} onPress={onChange} />
    </View>
  )
}

const styles = StyleSheet.create({
  label: { fontSize: font.size.sm, fontWeight: font.weight.medium, marginBottom: spacing.sm },
  input: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 46, fontSize: font.size.md },
  clearRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  rowThumb: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { height: '86%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 40, marginHorizontal: spacing.md },
  searchInput: { flex: 1, fontSize: font.size.md, paddingVertical: 0 },
  builtinRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginHorizontal: spacing.md, marginTop: spacing.sm, borderRadius: radius.lg, borderWidth: 1 },
  cell: { flex: 1 / GRID_COLS, alignItems: 'center', gap: spacing.xs },
  thumb: { borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  check: { position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
})
