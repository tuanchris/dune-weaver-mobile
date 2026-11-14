// Browse › Create: words written on the table in one continuous line
// (src/lib/sandText): on joining lines, or inlaid in a raked band or table. Saved
// into the library like an imported pattern. One `page` sheet: the drawing stays
// pinned on top while the controls below scroll.
import React, { useMemo, useState } from 'react'
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { Directory, File, Paths } from 'expo-file-system'
import { FONTS, FONT_IDS, MAX_CHARS, MAX_LINES, SYMBOLS, SYMBOL_IDS, ballOf, keepOnTable, layoutText, textRows, toGcode, toThr } from '../lib/sandText/index.mjs'
import type { FontId, Frame, Join, Layout, Letters, RowSize, Style, XY } from '../lib/sandText/index.mjs'
// @ts-ignore - shared plain-ESM module (Metro resolves .mjs; allowJs covers TS)
import { decimate } from '../lib/thrGeometry.mjs'
import { buildPath } from '../lib/patternGeometry'
import { PATTERN_EXT } from '../lib/patternName'
import { savePatternText } from '../lib/importPattern'
import { userMessage } from '../lib/errors'
import type { roundSize } from '../lib/tableSize'
import { useLibrary, type Point } from '../stores/useLibrary'
import { useScrollLock } from '../stores/useScrollLock'
import { useTheme } from '../stores/useTheme'
import { toast } from '../stores/useToast'
import { rectPathD } from './RectTable'
import { Sheet, SheetButton, useSheetWidth } from './Sheet'
import { Button, Card, CardTitle, Segmented, Slider } from './ui'
import { MAX_SIZE, MIN_SIZE, SymbolCanvas, type Sym } from './SymbolCanvas'
import { font, radius, spacing } from '../theme'

interface Recipe {
  text: string
  font: FontId
  /** % of the largest that fits. */
  size: number
  rowSize: RowSize
  style: Style
  /** Lines style: how a row joins the next. */
  join: Join
  /** Inlay style, outline fonts: filled or traced. */
  letters: Letters
  /** Inlay style: how much is raked round the letters, % from just round them to the whole table. */
  rake: number
  /** Inlay style: symbols placed freely (Arrange). */
  symbols: Sym[]
}

const DEFAULT: Recipe = { text: 'Dune\nWeaver', font: 'geometric', size: 100, rowSize: 'same', style: 'inlay', join: 'edge', letters: 'solid', rake: 100, symbols: [] }
type Page = 'main' | 'pick' | 'arrange'
const MAX_SYMBOLS = 40
/** Where a new symbol goes: the first of these spots no symbol is near (−1..1 of the half width / height). */
const SPOTS: [number, number][] = [[0, -0.62], [0, 0.62], [-0.62, 0], [0.62, 0], [-0.45, -0.45], [0.45, 0.45], [-0.45, 0.45], [0.45, -0.45]]
let nextUid = 1
const HERO_POINTS = 6000
const TILE_W = 112
const TILE_H = 40
/** Below this capital height, in balls, letters blur in the sand (sand-weaver's DW Pro sim, 10 mm ball: 38 mm reads, 26 mm doesn't). */
const SMALL_BALLS = 3.2

const ROW_SIZES: { value: RowSize; label: string }[] = [
  { value: 'same', label: 'Same size' },
  { value: 'fill', label: 'Fill each row' },
]
const JOINS: { value: Join; label: string }[] = [
  { value: 'edge', label: 'Along the edge' },
  { value: 'beside', label: 'Beside the text' },
]
const STYLES: { value: Style; label: string }[] = [
  { value: 'lines', label: 'On lines' },
  { value: 'inlay', label: 'Inlaid' },
]
const STYLE_HINT: Record<Style, string> = {
  lines: 'The letters sit on a line the ball runs along.',
  inlay: 'The sand round the letters is raked, and each letter is drawn into it: no lines join them. It takes longer to draw.',
}
const LETTERS: { value: Letters; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'outline', label: 'Outline' },
]
const JOIN_HINT: Record<Join, string> = {
  edge: 'Every row’s line runs to the edge, and the ball moves along the edge to the next row.',
  beside: 'The ball moves to the next row beside the text. Only the first and last lines reach the edge.',
}

/** The last recipe per kind of table, for this app session. */
const remembered = new Map<string, Recipe>()

/** A file-name-safe pattern name (ASCII, no path characters, no pattern extension). */
export function cleanName(raw: string): string {
  return raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 _\-().,'&!+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+/, '')
    .trim()
    .replace(PATTERN_EXT, '')
    .slice(0, 40)
    .trim()
}

/**
 * Points as the app draws the saved file: unit disc (y down) for .thr, mm (y up) for
 * G-code. Points closer than about a pixel of the drawing are dropped (a stride would
 * drop a letter's detail among long lanes).
 */
function toScreen(path: XY[], frame: Frame): Point[] {
  const eps = frame.round ? 1 / 400 : Math.max(frame.W, frame.H) / 800
  const out: Point[] = []
  let last: XY | null = null
  for (const p of path) {
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < eps) continue
    out.push(frame.round ? [p[0], -p[1]] : [p[0] + frame.W / 2, p[1] + frame.H / 2])
    last = p
  }
  return decimate(out, HERO_POINTS) as Point[]
}

/** The drawing: the letters in ink; an inlay's raked host faint under them. */
function previewOf(layout: Layout, frame: Frame): { ink: Point[][]; faint: Point[][] } {
  if (!layout.visits?.length) return { ink: [toScreen(layout.path, frame)], faint: [] }
  const host: XY[] = []
  let at = 0
  for (const v of layout.visits) {
    host.push(...layout.path.slice(at, v.from + 1))
    at = v.to
  }
  host.push(...layout.path.slice(at))
  return { ink: layout.visits.map((v) => toScreen(layout.path.slice(v.from, v.to + 1), frame)), faint: [toScreen(host, frame)] }
}

interface Props {
  visible: boolean
  rect: boolean
  /** The rectangular table's size in mm (required when `rect`). */
  travel: [number, number] | null
  /** A round table's sand diameter and ball, and where they came from (lib/tableSize.ts). */
  size: ReturnType<typeof roundSize>
  /** Is a pattern name (no extension) already used in the library or on the table? */
  taken: (name: string) => boolean
  onClose: () => void
  /** Saved to the library as this file name. */
  onSaved: (name: string) => void
}

export function TextGenerator({ visible, rect, travel, size, taken, onClose, onSaved }: Props): React.JSX.Element {
  const frame: Frame = useMemo(
    () => (rect && travel ? { round: false, W: travel[0], H: travel[1] } : { round: true, diameter: size.diameter, ball: size.ball }),
    [rect, travel?.[0], travel?.[1], size.diameter, size.ball],
  )
  const kind = frame.round ? `round:${frame.diameter}` : `rect:${frame.W}x${frame.H}`
  const [recipe, setRecipe] = useState<Recipe>(() => remembered.get(kind) ?? DEFAULT)
  const [initial, setInitial] = useState(recipe)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [page, setPage] = useState<Page>('main')
  const [selected, setSelected] = useState<number | null>(null)

  // Each opening starts from the last recipe for this kind of table. Reset while
  // rendering, so the previous session's text is never drawn.
  const [open, setOpen] = useState(false)
  if (visible !== open) {
    setOpen(visible)
    if (visible) {
      const r = remembered.get(kind) ?? DEFAULT
      setRecipe(r)
      setInitial(r)
      setName('')
      setPage('main')
      setSelected(null)
    }
  }

  const layout = useMemo(
    () =>
      layoutText({
        text: recipe.text,
        font: recipe.font,
        frame,
        size: recipe.size / 100,
        rowSize: recipe.rowSize,
        style: recipe.style,
        join: recipe.join,
        letters: recipe.letters,
        rake: recipe.rake / 100,
        symbols: recipe.symbols,
      }),
    [recipe, frame],
  )
  const dirty = recipe !== initial

  const suggested = cleanName(textRows(recipe.text)[0] ?? '') || (recipe.style === 'inlay' && recipe.symbols[0] ? SYMBOLS[recipe.symbols[0].ch]?.label : '') || 'Text'
  const wanted = cleanName(name) || suggested
  const fileStem = useMemo(() => {
    if (!taken(wanted)) return wanted
    for (let n = 2; ; n++) if (!taken(`${wanted} ${n}`)) return `${wanted} ${n}`
  }, [wanted, taken])

  const save = () => {
    if (!layout || saving) return
    setSaving(true)
    try {
      // Never overwrite a file already in the library folder (imports, Pattern Hub downloads).
      const ext = frame.round ? '.thr' : '.gcode'
      const dir = new Directory(Paths.document, 'thr')
      let stem = fileStem
      for (let n = 2; new File(dir, stem + ext).exists; n++) stem = `${fileStem} ${n}`
      const text = frame.round ? toThr(layout.path) : toGcode(layout.path, frame.W, frame.H)
      const p = savePatternText(stem, text, !frame.round)
      useLibrary.getState().addImported(p.name, p.thrUri, p.sizeBytes, p.xy)
      remembered.set(kind, recipe)
      setInitial(recipe)
      onSaved(p.name)
    } catch (e) {
      toast.error(userMessage(e, 'save the pattern'))
    } finally {
      setSaving(false)
    }
  }

  const requestClose = () => {
    if (saving) return
    if (!dirty) return onClose()
    Alert.alert('Discard this pattern?', 'It isn’t in your library yet.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
      ...(layout ? [{ text: 'Save', onPress: save }] : []),
    ])
  }

  return (
    // The JS sheet on iOS too: Arrange's canvas has its own drags, which a pageSheet would take.
    <Sheet
      variant="page"
      native={false}
      visible={visible}
      onClose={requestClose}
      dismissible={!dirty && !saving}
      title={page === 'pick' ? 'Add a symbol' : page === 'arrange' ? 'Arrange' : 'New text'}
      onBack={page === 'main' ? undefined : () => setPage(page === 'pick' && recipe.symbols.length ? 'arrange' : 'main')}
      leading={<SheetButton title="Cancel" onPress={requestClose} disabled={saving} />}
      trailing={page === 'main' ? <SheetButton title="Save" prominent onPress={save} loading={saving} disabled={!layout} /> : <SheetButton title="Done" onPress={() => setPage('main')} />}
    >
      <Body
        recipe={recipe}
        setRecipe={setRecipe}
        frame={frame}
        size={size}
        layout={layout}
        name={name}
        setName={setName}
        suggested={suggested}
        fileStem={fileStem}
        page={page}
        setPage={setPage}
        selected={selected}
        setSelected={setSelected}
      />
    </Sheet>
  )
}

interface BodyProps {
  recipe: Recipe
  setRecipe: React.Dispatch<React.SetStateAction<Recipe>>
  frame: Frame
  size: ReturnType<typeof roundSize>
  layout: Layout | null
  name: string
  setName: (s: string) => void
  suggested: string
  fileStem: string
  page: Page
  setPage: (p: Page) => void
  selected: number | null
  setSelected: (uid: number | null) => void
}

function Body({ recipe, setRecipe, frame, size, layout, name, setName, suggested, fileStem, page, setPage, selected, setSelected }: BodyProps) {
  const colors = useTheme((s) => s.colors)
  const sheetW = useSheetWidth()
  const { height: winH } = useWindowDimensions()
  // Sliders lock the scroll while dragged (iOS would scroll along otherwise).
  const scrollLocked = useScrollLock((s) => s.locked)
  // The drawing stays pinned while the controls scroll: about a third of the sheet
  // (measured: half folded, an iPhone Duo's sheet is half the window).
  const [bodyH, setBodyH] = useState(0)
  const room = bodyH || winH * 0.8
  const travel: [number, number] = frame.round ? [2, 2] : [frame.W, frame.H]
  const heroW = frame.round ? Math.min(sheetW - spacing.xl * 2, room * 0.38, 340) : Math.min(sheetW - spacing.xl * 2, (room * 0.34 * frame.W) / frame.H, 520)

  // Every setter hands back the same recipe when nothing changed, so a tap on the
  // current choice doesn't count as an edit (Cancel would ask to discard it).
  const set = <K extends keyof Recipe>(key: K, v: Recipe[K]) => setRecipe((r) => (r[key] === v ? r : { ...r, [key]: v }))

  const shown = useMemo(() => (layout ? previewOf(layout, frame) : null), [layout, frame])
  const outline = FONTS[recipe.font].outline
  const inlay = recipe.style === 'inlay'
  const small = layout && layout.capHeight / ballOf(frame) < SMALL_BALLS
  let status: { text: string; error: boolean } | null = null
  if (!layout) status = { text: inlay ? 'Type something to write, or add a symbol.' : 'Type something to write.', error: false }
  else if (layout.missing.length) status = { text: `Can’t write ${layout.missing.map((c) => `“${c}”`).join(' ')}. Left out.`, error: true }
  else if (small) status = { text: 'Letters this small blur in the sand. Use fewer or shorter rows.', error: false }

  // Symbols: added at a free spot, then arranged on the canvas.
  const setSymbols = (fn: (l: Sym[]) => Sym[]) => setRecipe((r) => ({ ...r, symbols: fn(r.symbols) }))
  const addSymbol = (ch: string) => {
    const free = SPOTS.find(([x, y]) => !recipe.symbols.some((s) => Math.hypot(s.x - x, s.y - y) < 0.3)) ?? [0, 0]
    const sym: Sym = { uid: nextUid++, ch, x: free[0], y: free[1], size: 0.22, rot: 0 }
    setSymbols((l) => [...l, sym])
    setSelected(sym.uid)
    setPage('arrange')
  }
  const current = recipe.symbols.find((s) => s.uid === selected)

  // The canvas shows the text alone under the symbols (it doesn't change while they move).
  const textOnly = useMemo(
    () => layoutText({ text: recipe.text, font: recipe.font, frame, size: recipe.size / 100, rowSize: recipe.rowSize, style: 'inlay', letters: recipe.letters, rake: 0 }),
    [recipe.text, recipe.font, recipe.size, recipe.rowSize, recipe.letters, frame],
  )
  const canvasW = Math.min(sheetW - spacing.md * 2, frame.round ? room * 0.62 : ((room * 0.55) * frame.W) / frame.H, 560)
  const under = useMemo(() => {
    if (!textOnly) return null
    const p = previewOf(textOnly, frame)
    return <Drawing ink={p.ink} round={frame.round} travel={travel} width={canvasW} faintInk />
  }, [textOnly, frame, canvasW])

  if (page === 'pick') {
    const cols = Math.max(4, Math.floor((sheetW - spacing.md * 2) / 64))
    const cell = (sheetW - spacing.md * 2 - spacing.sm * (cols - 1)) / cols
    return (
      <ScrollView style={styles.flex} contentContainerStyle={styles.scroll}>
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>Drawn into the raking like the letters, filled or outlined. Up to {MAX_SYMBOLS}.</Text>
        <View style={styles.grid}>
          {SYMBOL_IDS.map((ch) => (
            <Pressable
              key={ch}
              onPress={() => addSymbol(ch)}
              disabled={recipe.symbols.length >= MAX_SYMBOLS}
              accessibilityRole="button"
              accessibilityLabel={`Add ${SYMBOLS[ch].label}`}
              style={({ pressed }) => [styles.symbolTile, { width: cell, height: cell, backgroundColor: pressed ? colors.cardElevated : colors.card, borderColor: colors.border }]}
            >
              <Text style={styles.emoji}>{ch}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    )
  }

  if (page === 'arrange') {
    return (
      <View style={styles.flex} onLayout={(e) => setBodyH(e.nativeEvent.layout.height)}>
        <View style={styles.hero}>
          <SymbolCanvas
            frame={frame}
            width={canvasW}
            under={
              <View>
                <FrameOnly round={frame.round} travel={travel} width={canvasW} />
                <View style={StyleSheet.absoluteFill}>{under}</View>
              </View>
            }
            symbols={recipe.symbols}
            selected={selected}
            onSelect={setSelected}
            onChange={(l) => setSymbols(() => l)}
          />
          <Text style={[styles.status, { color: colors.mutedForeground }]} numberOfLines={2}>
            Drag a symbol to move it. Pinch and twist it, or drag its corner or the knob above it.
          </Text>
        </View>
        <ScrollView style={styles.flex} contentContainerStyle={styles.scroll} scrollEnabled={!scrollLocked}>
          {current ? (
            <Card style={styles.card}>
              <View style={styles.numberHead}>
                <Text style={styles.emojiSmall}>{current.ch}</Text>
                <Text style={[styles.flex, styles.rowText, { color: colors.foreground }]}>{SYMBOLS[current.ch]?.label}</Text>
                <Text style={[styles.value, { color: colors.mutedForeground }]}>{Math.round(current.size * 100)}%</Text>
              </View>
              <Slider
                value={Math.round(current.size * 100)}
                min={MIN_SIZE * 100}
                max={MAX_SIZE * 100}
                step={1}
                onChange={(v) => setSymbols((l) => l.map((s) => (s.uid === current.uid ? keepOnTable(frame, { ...s, size: v / 100 }) : s)))}
              />
              <View style={[styles.numberHead, { marginTop: spacing.sm }]}>
                <Text style={[styles.flex, styles.rowText, { color: colors.foreground }]}>Turn</Text>
                <Text style={[styles.value, { color: colors.mutedForeground }]}>{Math.round(current.rot ?? 0)}°</Text>
              </View>
              <Slider
                value={Math.round(current.rot ?? 0)}
                min={-180}
                max={180}
                step={1}
                onChange={(v) => setSymbols((l) => l.map((s) => (s.uid === current.uid ? keepOnTable(frame, { ...s, rot: v }) : s)))}
              />
              <Button
                title="Remove"
                icon="remove-circle-outline"
                variant="ghost"
                onPress={() => {
                  setSymbols((l) => l.filter((s) => s.uid !== current.uid))
                  setSelected(null)
                }}
              />
            </Card>
          ) : (
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>Tap a symbol to change its size or remove it.</Text>
          )}
          <Button title="Add symbol" icon="add" variant="secondary" disabled={recipe.symbols.length >= MAX_SYMBOLS} onPress={() => setPage('pick')} />
        </ScrollView>
      </View>
    )
  }

  return (
    <View style={styles.flex} onLayout={(e) => setBodyH(e.nativeEvent.layout.height)}>
      <View style={styles.hero}>
        <Drawing ink={shown?.ink ?? null} faint={shown?.faint} round={frame.round} travel={travel} width={heroW} />
        <Text style={[styles.status, { color: status?.error ? colors.destructive : colors.mutedForeground }]} numberOfLines={2} accessibilityLiveRegion="polite">
          {status?.text ?? ' '}
        </Text>
      </View>

      {/* A multi-line field has no Done key: dragging the controls puts the keyboard away. */}
      <ScrollView
        style={styles.flex}
        contentContainerStyle={styles.scroll}
        scrollEnabled={!scrollLocked}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <CardTitle>Font</CardTitle>
        <ScrollView horizontal showsHorizontalScrollIndicator={Platform.OS === 'web'} contentContainerStyle={styles.tiles} style={styles.strip}>
          {FONT_IDS.map((id, i) => (
            <React.Fragment key={id}>
              {/* Outline fonts, then single-line fonts. */}
              {i > 0 && !FONTS[id].outline !== !FONTS[FONT_IDS[i - 1]].outline ? <View style={[styles.tileDivider, { backgroundColor: colors.border }]} /> : null}
              <FontTile id={id} on={recipe.font === id} onPress={() => set('font', id)} />
            </React.Fragment>
          ))}
        </ScrollView>

        <Card style={styles.card}>
          <CardTitle>Text</CardTitle>
          <TextInput
            value={recipe.text}
            onChangeText={(t) => set('text', t.split('\n').slice(0, MAX_LINES).join('\n'))}
            placeholder="What should the table say?"
            placeholderTextColor={colors.mutedForeground}
            multiline
            maxLength={MAX_CHARS}
            autoCorrect={false}
            accessibilityLabel="Text to write"
            style={[styles.input, styles.textArea, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground }]}
          />
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>Each line is a row on the table, up to {MAX_LINES}. Emoji like ♥ ⭐ 😊 draw too.</Text>
        </Card>

        <Card style={styles.card}>
          <CardTitle>Name</CardTitle>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={suggested}
            placeholderTextColor={colors.mutedForeground}
            maxLength={40}
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="done"
            accessibilityLabel="Pattern name"
            style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground }]}
          />
          {fileStem !== (name.trim() || suggested) ? <Text style={[styles.hint, { color: colors.mutedForeground }]}>Saves as “{fileStem}”.</Text> : null}
        </Card>

        {inlay ? (
          <Card style={styles.card}>
            <CardTitle>Symbols</CardTitle>
            {recipe.symbols.length ? (
              <View style={styles.chips}>
                {recipe.symbols.map((s) => (
                  <Pressable
                    key={s.uid}
                    onPress={() => {
                      setSelected(s.uid)
                      setPage('arrange')
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Arrange ${SYMBOLS[s.ch]?.label}`}
                    style={({ pressed }) => [styles.chip, { backgroundColor: pressed ? colors.cardElevated : colors.card, borderColor: colors.border }]}
                  >
                    <Text style={styles.emojiSmall}>{s.ch}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>Emoji placed anywhere on the table, drawn into the raking.</Text>
            )}
            <View style={styles.buttonRow}>
              <Button title="Add symbol" icon="add" variant="secondary" flex disabled={recipe.symbols.length >= MAX_SYMBOLS} onPress={() => setPage('pick')} />
              {recipe.symbols.length ? <Button title="Arrange" icon="open-with" variant="secondary" flex onPress={() => setPage('arrange')} /> : null}
            </View>
          </Card>
        ) : null}

        <Card style={styles.card}>
          <CardTitle>Layout</CardTitle>
          <View style={styles.numberHead}>
            <Text style={[styles.flex, styles.rowText, { color: colors.foreground }]}>Size</Text>
            <Text style={[styles.value, { color: colors.mutedForeground }]}>{recipe.size}%</Text>
          </View>
          <Slider value={recipe.size} min={30} max={100} step={5} onChange={(v) => set('size', v)} />
          <Text style={[styles.label, { color: colors.foreground, marginTop: spacing.sm }]}>Rows</Text>
          <Segmented fill value={recipe.rowSize} options={ROW_SIZES} onChange={(v) => set('rowSize', v)} />
          {frame.round ? (
            <Text style={[styles.hint, { color: colors.mutedForeground }]}>
              {size.from === 'set'
                ? `Sized for this table: ${size.diameter} mm of sand, a ${size.ball} mm ball.`
                : size.from === 'model'
                  ? `Sized for a ${size.label}: ${size.diameter} mm of sand, a ${size.ball} mm ball.`
                  : `Sized for a ${size.label}: the table hasn’t said which model it is yet.`}{' '}
              Change it in Settings › Table size.
            </Text>
          ) : null}
        </Card>

        <Card style={styles.card}>
          <CardTitle>Style</CardTitle>
          <Segmented fill value={recipe.style} options={STYLES} onChange={(v) => set('style', v)} />
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            {STYLE_HINT[recipe.style]}
            {!inlay && recipe.symbols.length ? ' Placed symbols are drawn only when inlaid.' : ''}
          </Text>
          {recipe.style === 'lines' ? (
            <>
              <Text style={[styles.label, { color: colors.foreground, marginTop: spacing.sm }]}>Next row</Text>
              <Segmented fill value={recipe.join} options={JOINS} onChange={(v) => set('join', v)} />
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>{JOIN_HINT[recipe.join]}</Text>
            </>
          ) : (
            <>
              <View style={[styles.numberHead, { marginTop: spacing.sm }]}>
                <Text style={[styles.flex, styles.rowText, { color: colors.foreground }]}>Raked area</Text>
                <Text style={[styles.value, { color: colors.mutedForeground }]}>{recipe.rake === 0 ? 'Round the text' : recipe.rake === 100 ? 'Whole table' : `${recipe.rake}%`}</Text>
              </View>
              <Slider value={recipe.rake} min={0} max={100} step={5} onChange={(v) => set('rake', v)} />
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>A band across the table round the text, up to the whole table. More area takes longer to draw.</Text>
              <Text style={[styles.label, { color: colors.foreground, marginTop: spacing.sm }]}>Letters and symbols</Text>
              <Segmented fill value={recipe.letters} options={LETTERS} onChange={(v) => set('letters', v)} />
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                {recipe.letters === 'solid' ? 'Raked across the background’s lines.' : 'Each outline traced twice.'}
                {outline ? '' : ' Single-line fonts draw each word as one line either way.'}
              </Text>
            </>
          )}
        </Card>
      </ScrollView>
    </View>
  )
}

/** The table's outline alone (under the canvas's drawings). */
function FrameOnly({ round, travel, width }: { round: boolean; travel: [number, number]; width: number }) {
  return <Drawing ink={null} round={round} travel={travel} width={width} />
}

/** A font's tile: "Abc" written in it, as the table draws it, over its name (`on` = picked). */
function FontTile({ id, on, onPress }: { id: FontId; on: boolean; onPress: () => void }) {
  const colors = useTheme((s) => s.colors)
  const label = FONTS[id].label
  const pts = useMemo(() => {
    const frame: Frame = { round: false, W: TILE_W, H: TILE_H }
    const l = layoutText({ text: 'Abc', font: id, frame, join: 'beside' })
    return l ? [toScreen(l.path, frame)] : null
  }, [id])
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label} font`}
      accessibilityState={{ selected: on }}
      style={({ pressed }) => [styles.tile, { backgroundColor: colors.card, borderColor: on ? colors.primary : colors.border, opacity: pressed ? 0.7 : 1 }]}
    >
      <Drawing ink={pts} round={false} travel={[TILE_W, TILE_H]} width={TILE_W} bare />
      <Text numberOfLines={1} style={[styles.tileLabel, { color: on ? colors.foreground : colors.mutedForeground }]}>
        {label}
      </Text>
    </Pressable>
  )
}

/**
 * The pattern on its table: a disc or the rectangle, the letters' grooves in ink and
 * `faint` (an inlay's raked background) thin beneath them. `bare` = the drawing only.
 */
function Drawing({ ink, faint, round, travel, width, bare, faintInk }: { ink: Point[][] | null; faint?: Point[][]; round: boolean; travel: [number, number]; width: number; bare?: boolean; faintInk?: boolean }) {
  const colors = useTheme((s) => s.colors)
  const height = round ? width : (width * travel[1]) / travel[0]
  const pathOf = (pts: Point[]) => (!pts.length ? '' : round ? buildPath(pts, width, { pad: 0.04 }) : rectPathD(pts, travel, width, height))
  const d = useMemo(() => (ink ?? []).map(pathOf).join(' '), [ink, round, travel[0], travel[1], width, height])
  const under = useMemo(() => (faint ?? []).map(pathOf).join(' '), [faint, round, travel[0], travel[1], width, height])
  const sw = bare ? 1 : Math.max(1, width / 220)
  return (
    <Svg width={width} height={height}>
      {bare || faintInk ? null : round ? (
        <Circle cx={width / 2} cy={width / 2} r={width / 2 - 1} fill={colors.card} stroke={colors.border} strokeWidth={1.5} />
      ) : (
        <Rect x={1} y={1} width={width - 2} height={height - 2} rx={Math.min(8, height * 0.08)} fill={colors.card} stroke={colors.border} strokeWidth={1.5} />
      )}
      {under.trim() ? <Path d={under} stroke={colors.foreground} strokeWidth={0.5} fill="none" opacity={0.22} /> : null}
      {d.trim() ? <Path d={d} stroke={colors.foreground} strokeWidth={sw} fill="none" strokeLinejoin="round" strokeLinecap="round" opacity={faintInk ? 0.3 : 0.9} /> : null}
    </Svg>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { alignItems: 'center', paddingTop: spacing.xs, paddingHorizontal: spacing.xl },
  status: { fontSize: font.size.sm, textAlign: 'center', marginTop: spacing.xs, minHeight: 18 },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  strip: { marginHorizontal: -spacing.md, marginTop: -spacing.sm, flexGrow: 0 },
  tiles: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs, gap: spacing.sm },
  tile: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: radius.lg, borderWidth: 2 },
  tileLabel: { fontSize: font.size.sm },
  tileDivider: { width: 1, alignSelf: 'stretch', marginVertical: spacing.md },
  card: { gap: spacing.sm },
  numberHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 24 },
  value: { fontFamily: font.family.mono, fontSize: font.size.sm },
  rowText: { fontSize: font.size.md },
  label: { fontSize: font.size.md, marginBottom: spacing.sm },
  hint: { fontSize: font.size.sm },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: spacing.md, minHeight: 46, fontSize: font.size.md },
  textArea: { minHeight: 96, paddingTop: spacing.sm, paddingBottom: spacing.sm, textAlignVertical: 'top' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  symbolTile: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.lg, borderWidth: 1 },
  emoji: { fontSize: 30 },
  emojiSmall: { fontSize: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1 },
  buttonRow: { flexDirection: 'row', gap: spacing.sm },
})
