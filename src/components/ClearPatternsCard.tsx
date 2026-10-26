// Settings card: custom clear patterns + clear speed ($Playlist/ClearIn,
// ClearOut, ClearSpeed — firmware ≥ v0.1.11). Point the "from center" / "from
// edge" clears at any pattern on the card (non-destructively — the firmware
// keeps its built-in clears and just runs the chosen file instead), and give
// clear moves their own feed. Table-wide settings, idle-gated by the firmware.

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { board } from '../api/board'
import { isSettingsLocked } from '../api/status'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { useLibrary, patternKey } from '../stores/useLibrary'
import { toast } from '../stores/useToast'
import { prettyName } from '../lib/patternName'
import { userMessage } from '../lib/errors'
import { Button, Card, CardTitle, IconButton } from './ui'
import { PatternThumb } from './PatternThumb'
import { EmptyState } from './EmptyState'
import { Sheet, useSheetWidth } from './Sheet'
import { thumbGrid } from '../lib/layout'
import { radius, spacing, font } from '../theme'

// The firmware's built-in clear files (a ClearIn/ClearOut equal to these — or
// empty — means "use the built-in", so we show it as the default).
const STOCK_IN = '/patterns/clear_from_in.thr'
const STOCK_OUT = '/patterns/clear_from_out.thr'

type Slot = 'in' | 'out'

/** A stored ClearIn/ClearOut path -> the pattern key, or null when it's the
 * built-in (empty or the stock path). */
function customKey(path: string, stock: string): string | null {
  if (!path || path === stock) return null
  return patternKey(path)
}

export function ClearPatternsCard({ base }: { base: string }) {
  const colors = useTheme((s) => s.colors)
  // Writable whenever the settings lock is open — which now includes a paused
  // table, not just an idle one ($Playlist/Clear* accept writes in Hold).
  const writable = useStatus((s) => !isSettingsLocked(s.status))
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
      toast.error(writable ? userMessage(e, 'save the clear pattern') : 'Pause or stop the table to change the clear pattern')
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
      toast.error(writable ? userMessage(e, 'save the clear speed') : 'Pause or stop the table to change the clear speed')
      load()
    })
  }

  const openPicker = (slot: Slot) => {
    setQuery('')
    setPicker(slot)
    loadTable(base) // no-op if already loaded; deferred to idle if mid-pattern
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
      <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, marginBottom: spacing.md }}>
        Choose which pattern erases the sand before the next one. The built-ins work for most tables; pick your own for a custom look. Needs firmware v0.1.11 or newer.
      </Text>

      <ClearRow label="Clear from center" iconKey={inKey} disabled={!writable} onChange={() => openPicker('in')} />
      <ClearRow label="Clear from edge" iconKey={outKey} disabled={!writable} onChange={() => openPicker('out')} />

      <View style={{ marginTop: spacing.md }}>
        <Text style={[styles.label, { color: colors.foreground }]}>Clear speed (mm/min)</Text>
        <TextInput
          value={speed}
          onChangeText={(t) => setSpeed(t.replace(/[^0-9]/g, ''))}
          onBlur={commitSpeed}
          editable={writable}
          keyboardType="number-pad"
          style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground, opacity: writable ? 1 : 0.5 }]}
        />
        <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, marginTop: spacing.sm }}>
          How fast the clear runs. 0 = same speed as the pattern.
        </Text>
      </View>

      {!writable ? (
        <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, marginTop: spacing.sm }}>
          Pause or stop the table to change the clear settings.
        </Text>
      ) : null}

      {/* Single-select pattern picker */}
      <Sheet variant="page" visible={picker !== null} onClose={() => setPicker(null)} title={picker === 'in' ? 'Clear from center' : 'Clear from edge'}>
        <View style={[styles.search, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
          <MaterialIcons name="search" size={18} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search"
            placeholderTextColor={colors.mutedForeground}
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
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

        <PickerGrid
          data={visible}
          selectedKey={selectedKey}
          empty={tablePatterns.length === 0 ? 'No patterns on the table. Send some from Browse first.' : 'No matches'}
          onPick={(key) => picker && choose(picker, key)}
        />
      </Sheet>
    </Card>
  )
}

/** Rendered INSIDE the Sheet so it sizes from the sheet's width (an iPad
 * pageSheet is narrower than the window). */
function PickerGrid({ data, selectedKey, empty, onPick }: { data: string[]; selectedKey: string | null; empty: string; onPick: (key: string) => void }) {
  const colors = useTheme((s) => s.colors)
  const { cols, thumb } = thumbGrid(useSheetWidth())
  return (
    <FlatList
      data={data}
      key={cols}
      numColumns={cols}
      keyExtractor={(p) => p}
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={{ padding: spacing.md, gap: spacing.md }}
      columnWrapperStyle={{ gap: spacing.md }}
      ListEmptyComponent={<EmptyState icon="grid-off" text={empty} />}
      renderItem={({ item }) => {
        const on = item === selectedKey
        return (
          <Pressable onPress={() => onPick(item)} style={[styles.cell, { flex: 1 / cols }]}>
            <View style={[styles.thumb, { width: thumb, height: thumb, borderRadius: thumb / 2, backgroundColor: colors.card, borderColor: on ? colors.primary : 'transparent' }]}>
              <PatternThumb name={item} size={thumb - 4} />
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
        <Text numberOfLines={2} style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>
          {iconKey ? prettyName(iconKey) : 'Built-in'}
        </Text>
      </View>
      <Button title="Change" variant="secondary" disabled={disabled} onPress={onChange} />
    </View>
  )
}

const styles = StyleSheet.create({
  label: { fontSize: font.size.sm, fontWeight: font.weight.medium, marginBottom: spacing.sm },
  input: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, minHeight: 46, fontSize: font.size.md },
  clearRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  rowThumb: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  search: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, minHeight: 40, marginHorizontal: spacing.md },
  searchInput: { flex: 1, fontSize: font.size.md, paddingVertical: 0 },
  builtinRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, marginHorizontal: spacing.md, marginTop: spacing.sm, borderRadius: radius.lg, borderWidth: 1 },
  cell: { alignItems: 'center', gap: spacing.xs },
  thumb: { borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'visible' },
  check: { position: 'absolute', top: 2, right: 2, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
})
