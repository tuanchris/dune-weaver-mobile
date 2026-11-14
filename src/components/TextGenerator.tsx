// Browse › Create: words written on the table in one continuous line
// (src/lib/sandText): on joining lines, or inlaid in a raked band or table. Saved
// into the library like an imported pattern. A full-screen sheet: the canvas, as wide as
// the screen, stays pinned on top while the controls below scroll.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { MaterialIcons } from '@expo/vector-icons'
import { ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { Directory, File, Paths } from 'expo-file-system'
import {
  FONTS,
  FONT_IDS,
  MAX_CHARS,
  MAX_LINES,
  SYMBOLS,
  SYMBOL_IDS,
  ballOf,
  goodSymbolSize,
  keepOnTable,
  layoutText,
  minSymbolSize,
  symbolBalls,
  textRows,
  toGcode,
  toThr,
} from '../lib/sandText/index.mjs'
import type { FontId, Frame, Host, Join, Layout, Letters, RowSize, Style, TextPlace, XY } from '../lib/sandText/index.mjs'
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
import { MAX_SIZE, SymbolCanvas, TEXT_MIN, canvasMap, type Sym, type TextItem } from './SymbolCanvas'
import { SAND, SandView, sandTable, type SandHandle, type SandState } from './SandView'
import { font, radius, spacing } from '../theme'

/** Create from text is offered only while this is true. Held back from 1.4.0 (owner's call, 2026-11-14): Browse's "+"
 * imports straight away, there's no callout, and Settings › Table size doesn't mention it. */
export const CREATE_TEXT = false

/** One text block on the table (Inlaid: several, each its own; On lines: the first). */
interface TextEl {
  uid: number
  text: string
  font: FontId
  /** % of the largest that fits. */
  size: number
  rowSize: RowSize
  /** Where it goes and its turn (moved on the canvas; Inlaid only). */
  place: TextPlace
}

interface Recipe {
  texts: TextEl[]
  style: Style
  /** Lines style: how a row joins the next. */
  join: Join
  /** Inlay style, outline fonts: filled or traced. */
  letters: Letters
  /** Inlay style: how much is raked round the letters, % from just round them to the whole table. */
  rake: number
  /** Inlay style: what rakes it, a spiral out from the centre or straight lanes. */
  host: Host
  /** Inlay style: symbols placed freely on the canvas. */
  symbols: Sym[]
}

const CENTRED: TextPlace = { x: 0, y: 0, rot: 0 }
const DEFAULT: Recipe = {
  texts: [
    {
      uid: 0,
      text: 'Dune\nWeaver',
      font: 'geometric',
      size: 100,
      rowSize: 'same',
      place: CENTRED,
    },
  ],
  style: 'inlay',
  join: 'edge',
  letters: 'solid',
  rake: 100,
  host: 'spiral',
  symbols: [],
}
type Page = 'main' | 'add' | 'preview'
const MAX_TEXTS = 8
const MAX_SYMBOLS = 40
/** Where a new symbol goes: the first of these spots no symbol is near (−1..1 of the half width / height). */
const SPOTS: [number, number][] = [
  [0, -0.62],
  [0, 0.62],
  [-0.62, 0],
  [0.62, 0],
  [-0.45, -0.45],
  [0.45, 0.45],
  [-0.45, 0.45],
  [0.45, -0.45],
]
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
const HOSTS: { value: Host; label: string }[] = [
  { value: 'spiral', label: 'Spiral' },
  { value: 'lanes', label: 'Lanes' },
]
const HOST_HINT: Record<Host, string> = {
  spiral: 'One line spiralling out from the centre.',
  lanes: 'Straight lines across the table, corner to corner.',
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
  return {
    ink: layout.visits.map((v) => toScreen(layout.path.slice(v.from, v.to + 1), frame)),
    faint: [toScreen(host, frame)],
  }
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

/** The whole pattern's options: every text and symbol inlaid, or the first text on lines. */
function patternOptions(r: Recipe, frame: Frame): Parameters<typeof layoutText>[0] {
  if (r.style === 'inlay')
    return {
      text: '',
      frame,
      style: 'inlay',
      letters: r.letters,
      rake: r.rake / 100,
      host: r.host,
      texts: r.texts.map((t) => ({
        text: t.text,
        font: t.font,
        size: t.size / 100,
        rowSize: t.rowSize,
        place: t.place,
      })),
      symbols: r.symbols,
    }
  const t = r.texts[0]
  return {
    text: t?.text ?? '',
    font: t?.font,
    frame,
    size: (t?.size ?? 100) / 100,
    rowSize: t?.rowSize,
    style: 'lines',
    join: r.join,
  }
}

/** A text block alone, centred and unturned, as letter shapes (no host, no path: instant). */
function textDesign(t: TextEl, frame: Frame, letters: Letters): Layout | null {
  return layoutText({
    text: t.text,
    font: t.font,
    frame,
    size: t.size / 100,
    rowSize: t.rowSize,
    style: 'inlay',
    letters,
    host: 'none',
  })
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
      // The first text: what people come to write.
      setSelected(r.texts[0]?.uid ?? null)
    }
  }

  // The design (cheap, every edit): what can't be written, how small the letters are.
  const designs = useMemo(() => recipe.texts.map((t) => textDesign(t, frame, recipe.letters)), [recipe.texts, recipe.letters, frame])
  const shownTexts = recipe.style === 'inlay' ? designs : designs.slice(0, 1)
  const missing = [...new Set(shownTexts.flatMap((d) => d?.missing ?? []))]
  const capHeight = Math.min(Infinity, ...shownTexts.map((d) => d?.capHeight ?? Infinity))
  const drawable = shownTexts.some(Boolean) || (recipe.style === 'inlay' && recipe.symbols.length > 0)
  const dirty = recipe !== initial

  const first = recipe.texts[0]
  const suggested = cleanName(textRows(first?.text ?? '')[0] ?? '') || (recipe.style === 'inlay' && recipe.symbols[0] ? SYMBOLS[recipe.symbols[0].ch]?.label : '') || 'Text'
  const wanted = cleanName(name) || suggested
  const fileStem = useMemo(() => {
    if (!taken(wanted)) return wanted
    for (let n = 2; ; n++) if (!taken(`${wanted} ${n}`)) return `${wanted} ${n}`
  }, [wanted, taken])

  const save = () => {
    if (!drawable || saving) return
    setSaving(true)
    // The pattern is laid out only now (and in Preview): a beat first, so the button shows it's working.
    setTimeout(() => {
      try {
        const layout = layoutText(patternOptions(recipe, frame))
        if (!layout) throw new Error('There’s nothing to draw.')
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
    }, 50)
  }

  const requestClose = () => {
    if (saving) return
    if (!dirty) return onClose()
    Alert.alert('Discard this pattern?', 'It isn’t in your library yet.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: onClose },
      ...(drawable ? [{ text: 'Save', onPress: save }] : []),
    ])
  }

  return (
    // Full screen, JS on iOS too: the canvas wants the width, and has its own drags, which a pageSheet would take.
    <Sheet
      variant="full"
      visible={visible}
      onClose={requestClose}
      dismissible={!dirty && !saving}
      title={page === 'add' ? 'Add' : page === 'preview' ? 'Preview' : 'New text'}
      onBack={page === 'main' ? undefined : () => setPage('main')}
      leading={<SheetButton title="Cancel" onPress={requestClose} disabled={saving} />}
      trailing={page === 'add' ? undefined : <SheetButton title="Save" prominent onPress={save} loading={saving} disabled={!drawable} />}
    >
      <Body
        recipe={recipe}
        setRecipe={setRecipe}
        frame={frame}
        size={size}
        designs={designs}
        missing={missing}
        capHeight={capHeight}
        drawable={drawable}
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
  designs: (Layout | null)[]
  missing: string[]
  capHeight: number
  drawable: boolean
  name: string
  setName: (s: string) => void
  suggested: string
  fileStem: string
  page: Page
  setPage: (p: Page) => void
  selected: number | null
  setSelected: (uid: number | null) => void
}

function Body({ recipe, setRecipe, frame, size, designs, missing, capHeight, drawable, name, setName, suggested, fileStem, page, setPage, selected, setSelected }: BodyProps) {
  const colors = useTheme((s) => s.colors)
  const sheetW = useSheetWidth()
  const { height: winH } = useWindowDimensions()
  // Sliders and the canvas lock the scroll while dragged (iOS would scroll along otherwise).
  const scrollLocked = useScrollLock((s) => s.locked)
  // The canvas stays pinned while the controls scroll: about half the sheet
  // (measured: half folded, an iPhone Duo's sheet is half the window).
  const [bodyH, setBodyH] = useState(0)
  const room = bodyH || winH * 0.8
  const travel: [number, number] = frame.round ? [2, 2] : [frame.W, frame.H]
  // A wide window (iPad, an open iPhone Duo held sideways, desktop): the table on the left, the
  // controls on the right. Otherwise stacked: the table as wide as the screen, but never more than
  // 45% of the height, so the controls keep the rest (a short window: the Duo's outer display).
  const wide = sheetW > room * 1.15
  const canvasW = wide
    ? frame.round
      ? Math.min(sheetW * 0.5 - spacing.md, room - 150)
      : Math.min(sheetW * 0.55, ((room - 150) * frame.W) / frame.H)
    : frame.round
      ? Math.min(sheetW - spacing.sm * 2, room * 0.45)
      : Math.min(sheetW - spacing.sm * 2, (room * 0.4 * frame.W) / frame.H)

  // Every setter hands back the same recipe when nothing changed, so a tap on the
  // current choice doesn't count as an edit (Cancel would ask to discard it).
  const set = <K extends keyof Recipe>(key: K, v: Recipe[K]) => setRecipe((r) => (r[key] === v ? r : { ...r, [key]: v }))
  const setText = (uid: number, patch: Partial<TextEl>) =>
    setRecipe((r) => ({
      ...r,
      texts: r.texts.map((t) => (t.uid === uid && Object.entries(patch).some(([k, v]) => t[k as keyof TextEl] !== v) ? { ...t, ...patch } : t)),
    }))
  const setSymbols = (fn: (l: Sym[]) => Sym[]) => setRecipe((r) => ({ ...r, symbols: fn(r.symbols) }))

  const inlay = recipe.style === 'inlay'
  const small = capHeight / ballOf(frame) < SMALL_BALLS
  // Symbols under the size they read well at (advice: they may go down to minSymbolSize).
  const blurry = recipe.symbols.filter((s) => s.size < goodSymbolSize(frame, s.ch) - 0.005)

  // Add: a text (a free spot like a symbol's, a third the size) or a symbol (at least the smallest that reads on this table).
  const freeSpot = (): [number, number] =>
    SPOTS.find(([x, y]) => !recipe.symbols.some((s) => Math.hypot(s.x - x, s.y - y) < 0.3) && !recipe.texts.some((t) => Math.hypot(t.place.x - x, t.place.y - y) < 0.3)) ?? [0, 0]
  const addText = () => {
    const [x, y] = freeSpot()
    const t: TextEl = {
      uid: nextUid++,
      text: 'Text',
      font: recipe.texts[recipe.texts.length - 1]?.font ?? 'geometric',
      size: 40,
      rowSize: 'same',
      place: { x, y, rot: 0 },
    }
    setRecipe((r) => ({ ...r, texts: [...r.texts, t] }))
    setSelected(t.uid)
    setPage('main')
  }
  const addSymbol = (ch: string) => {
    const [x, y] = freeSpot()
    const sym: Sym = keepOnTable(frame, {
      uid: nextUid++,
      ch,
      x,
      y,
      size: Math.max(0.22, minSymbolSize(frame)),
      rot: 0,
    })
    setSymbols((l) => [...l, sym])
    setSelected(sym.uid)
    setPage('main')
  }
  const currentText = recipe.texts.find((t) => t.uid === selected)
  // Symbols are drawn only inlaid.
  const current = inlay ? recipe.symbols.find((s) => s.uid === selected) : undefined
  const textIndex = currentText ? recipe.texts.indexOf(currentText) : -1

  // Each text alone, centred and unturned: the canvas moves its drawing to its place.
  const textItems: TextItem[] = useMemo(
    () =>
      recipe.texts.flatMap((t, i) => {
        const d = designs[i]
        if (!d?.textPts?.length || !d.shapes || (!inlay && i > 0)) return []
        return [
          {
            uid: t.uid,
            place: inlay ? t.place : CENTRED,
            size: t.size / 100,
            pts: d.textPts,
            drawing: <Shapes shapes={d.shapes} frame={frame} width={canvasW} />,
            movable: inlay,
          },
        ]
      }),
    [recipe.texts, designs, inlay, frame, canvasW],
  )

  let status: { text: string; error: boolean }
  if (!drawable)
    status = {
      text: inlay ? 'Type something to write, or add a symbol.' : 'Type something to write.',
      error: false,
    }
  else if (missing.length)
    status = {
      text: `Can’t write ${missing.map((c) => `“${c}”`).join(' ')}. Left out.`,
      error: true,
    }
  else if (small)
    status = {
      text: 'Letters this small blur in the sand. Make them bigger, or use fewer or shorter rows.',
      error: false,
    }
  else if (inlay && blurry.length)
    status = {
      text: `${blurry.map((s) => SYMBOLS[s.ch]?.label).join(', ')}: details blur this small. Make ${blurry.length > 1 ? 'them' : 'it'} bigger.`,
      error: false,
    }
  else if (selected == null)
    status = {
      text: inlay ? 'Tap a text or a symbol to change it.' : 'Tap the text to change it.',
      error: false,
    }
  else if (currentText && !inlay)
    status = {
      text: 'On lines, the text fills the table. Inlaid, it moves.',
      error: false,
    }
  else
    status = {
      text: 'Drag to move. Pinch, or drag a handle, to resize and turn.',
      error: false,
    }

  if (page === 'preview') return <PreviewPage recipe={recipe} frame={frame} size={size} width={frame.round ? Math.min(sheetW - spacing.md * 2, room * 0.8) : sheetW - spacing.md * 2} />

  if (page === 'add') {
    const cols = Math.max(4, Math.floor((sheetW - spacing.md * 2) / 64))
    const cell = (sheetW - spacing.md * 2 - spacing.sm * (cols - 1)) / cols
    return (
      <ScrollView style={styles.flex} contentContainerStyle={styles.scroll}>
        <Button title="Add text" icon="text-fields" variant="secondary" disabled={recipe.texts.length >= MAX_TEXTS} onPress={addText} />
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          Each text has its own font, size and place.
          {inlay ? '' : ' On lines, only the first is drawn.'}
        </Text>
        <CardTitle>Symbols</CardTitle>
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>Drawn into the raking like the letters, in lines that follow its shape. Up to {MAX_SYMBOLS}.</Text>
        <View style={styles.grid}>
          {SYMBOL_IDS.map((ch) => (
            <Pressable
              key={ch}
              onPress={() => addSymbol(ch)}
              disabled={recipe.symbols.length >= MAX_SYMBOLS}
              accessibilityRole="button"
              accessibilityLabel={`Add ${SYMBOLS[ch].label}`}
              style={({ pressed }) => [
                styles.symbolTile,
                {
                  width: cell,
                  height: cell,
                  backgroundColor: pressed ? colors.cardElevated : colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <SymbolIcon ch={ch} size={Math.round(cell * 0.62)} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    )
  }

  // What's on the table, as chips: the pattern's own settings, each text, each symbol, then +.
  const chip = (key: string, on: boolean, onPress: () => void, label: string, content: React.ReactNode) => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: on ? colors.primary : pressed ? colors.cardElevated : colors.card,
          borderColor: on ? colors.primary : colors.border,
        },
      ]}
    >
      {content}
    </Pressable>
  )
  const textLabel = (t: TextEl) => {
    const row = textRows(t.text)[0] ?? ''
    return row ? (row.length > 12 ? `${row.slice(0, 11)}…` : row) : 'Text'
  }
  const centre = (uid: number) =>
    recipe.texts.some((t) => t.uid === uid)
      ? setText(uid, {
          place: { ...(currentText?.place ?? CENTRED), x: 0, y: 0 },
        })
      : setSymbols((l) => l.map((s) => (s.uid === uid ? keepOnTable(frame, { ...s, x: 0, y: 0 }) : s)))

  return (
    <View style={[styles.flex, wide && styles.row]} onLayout={(e) => setBodyH(e.nativeEvent.layout.height)}>
      <View style={[styles.hero, wide && { width: canvasW + spacing.md * 2, justifyContent: 'center' }]}>
        <SymbolCanvas
          frame={frame}
          width={canvasW}
          pattern={<Drawing ink={null} round={frame.round} travel={travel} width={canvasW} />}
          symbols={inlay ? recipe.symbols : []}
          texts={textItems}
          selected={selected}
          minSize={() => minSymbolSize(frame)}
          onSelect={setSelected}
          onChange={(l) => setSymbols(() => l)}
          onTextChange={(uid, place, s) => setText(uid, { place, size: Math.round(s * 100) })}
          canRemove={(uid) => (recipe.texts.some((t) => t.uid === uid) ? recipe.texts.length > 1 : true)}
          onRemove={(uid) => {
            setRecipe((r) => ({
              ...r,
              texts: r.texts.filter((t) => t.uid !== uid),
              symbols: r.symbols.filter((s) => s.uid !== uid),
            }))
            setSelected(null)
          }}
        />
        <Text
          style={[
            styles.status,
            {
              color: status.error ? colors.destructive : colors.mutedForeground,
            },
          ]}
          numberOfLines={2}
          accessibilityLiveRegion="polite"
        >
          {status.text}
        </Text>
        <Button title="Preview" icon="visibility" variant="secondary" disabled={!drawable} onPress={() => setPage('preview')} />
      </View>

      <View style={styles.flex}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipStrip} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="handled">
          {chip(
            'pattern',
            selected == null,
            () => setSelected(null),
            'Pattern settings',
            <MaterialIcons name="tune" size={20} color={selected == null ? colors.primaryForeground : colors.foreground} />,
          )}
          {recipe.texts.map((t, i) =>
            inlay || i === 0
              ? chip(
                  `t${t.uid}`,
                  t.uid === selected,
                  () => setSelected(t.uid),
                  `Text: ${textLabel(t)}`,
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.chipText,
                      {
                        color: t.uid === selected ? colors.primaryForeground : colors.foreground,
                      },
                    ]}
                  >
                    {textLabel(t)}
                  </Text>,
                )
              : null,
          )}
          {inlay ? recipe.symbols.map((s) => chip(`s${s.uid}`, s.uid === selected, () => setSelected(s.uid), SYMBOLS[s.ch]?.label ?? 'Symbol', <SymbolIcon ch={s.ch} size={24} color={s.uid === selected ? colors.primaryForeground : undefined} />)) : null}
          {chip('add', false, () => setPage('add'), 'Add a text or a symbol', <MaterialIcons name="add" size={22} color={colors.foreground} />)}
        </ScrollView>

        {/* A multi-line field has no Done key: dragging the controls puts the keyboard away. */}
        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scroll}
          scrollEnabled={!scrollLocked}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets
        >
          {currentText ? (
            <>
              <Card style={styles.card}>
                <TextInput
                  value={currentText.text}
                  onChangeText={(t) =>
                    setText(currentText.uid, {
                      text: t.split('\n').slice(0, MAX_LINES).join('\n'),
                    })
                  }
                  placeholder="What should the table say?"
                  placeholderTextColor={colors.mutedForeground}
                  multiline
                  maxLength={MAX_CHARS}
                  autoCorrect={false}
                  accessibilityLabel="Text to write"
                  style={[
                    styles.input,
                    styles.textArea,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
                  ]}
                />
                <Text style={[styles.hint, { color: colors.mutedForeground }]}>Each line is a row, up to {MAX_LINES}. Emoji like ♥ ⭐ 😊 draw too.</Text>
              </Card>
              <ScrollView horizontal showsHorizontalScrollIndicator={Platform.OS === 'web'} contentContainerStyle={styles.tiles} style={styles.strip}>
                {FONT_IDS.map((id, i) => (
                  <React.Fragment key={id}>
                    {/* Outline fonts, then single-line fonts. */}
                    {i > 0 && !FONTS[id].outline !== !FONTS[FONT_IDS[i - 1]].outline ? <View style={[styles.tileDivider, { backgroundColor: colors.border }]} /> : null}
                    <FontTile id={id} on={currentText.font === id} onPress={() => setText(currentText.uid, { font: id })} />
                  </React.Fragment>
                ))}
              </ScrollView>
              <Card style={styles.card}>
                <View style={styles.numberHead}>
                  <Text style={[styles.flex, styles.rowText, { color: colors.foreground }]}>Size</Text>
                  <Text style={[styles.value, { color: colors.mutedForeground }]}>{currentText.size}%</Text>
                </View>
                <Slider value={currentText.size} min={TEXT_MIN * 100} max={100} step={1} onChange={(v) => setText(currentText.uid, { size: v })} />
                {inlay ? (
                  <>
                    <View style={[styles.numberHead, { marginTop: spacing.sm }]}>
                      <Text style={[styles.flex, styles.rowText, { color: colors.foreground }]}>Turn</Text>
                      <Text style={[styles.value, { color: colors.mutedForeground }]}>{Math.round(currentText.place.rot)}°</Text>
                    </View>
                    <Slider
                      value={Math.round(currentText.place.rot)}
                      min={-180}
                      max={180}
                      step={1}
                      onChange={(v) =>
                        setText(currentText.uid, {
                          place: { ...currentText.place, rot: v },
                        })
                      }
                    />
                  </>
                ) : null}
                <Text style={[styles.label, { color: colors.foreground, marginTop: spacing.sm }]}>Rows</Text>
                <Segmented fill value={currentText.rowSize} options={ROW_SIZES} onChange={(v) => setText(currentText.uid, { rowSize: v })} />
                {inlay || recipe.texts.length > 1 ? (
                  <View style={styles.buttonRow}>
                    {inlay ? (
                      <Button title="Centre" icon="filter-center-focus" variant="ghost" flex disabled={!currentText.place.x && !currentText.place.y} onPress={() => centre(currentText.uid)} />
                    ) : null}
                    {recipe.texts.length > 1 ? (
                      <Button
                        title="Remove"
                        icon="remove-circle-outline"
                        variant="ghost"
                        flex
                        onPress={() => {
                          setRecipe((r) => ({
                            ...r,
                            texts: r.texts.filter((t) => t.uid !== currentText.uid),
                          }))
                          setSelected(null)
                        }}
                      />
                    ) : null}
                  </View>
                ) : null}
                {!inlay && textIndex > 0 ? <Text style={[styles.hint, { color: colors.mutedForeground }]}>On lines, only the first text is drawn.</Text> : null}
              </Card>
            </>
          ) : current ? (
            <Card style={styles.card}>
              <View style={styles.numberHead}>
                <SymbolIcon ch={current.ch} size={28} />
                <Text style={[styles.flex, styles.rowText, { color: colors.foreground }]}>{SYMBOLS[current.ch]?.label}</Text>
                <Text style={[styles.value, { color: colors.mutedForeground }]}>{Math.round(current.size * 100)}%</Text>
              </View>
              <Slider
                value={Math.round(current.size * 100)}
                min={Math.ceil(minSymbolSize(frame) * 100)}
                max={MAX_SIZE * 100}
                step={1}
                onChange={(v) => setSymbols((l) => l.map((s) => (s.uid === current.uid ? keepOnTable(frame, { ...s, size: v / 100 }) : s)))}
              />
              <Text
                style={[
                  styles.hint,
                  {
                    color: current.size < goodSymbolSize(frame, current.ch) - 0.005 ? colors.foreground : colors.mutedForeground,
                  },
                ]}
              >
                {current.size < goodSymbolSize(frame, current.ch) - 0.005 ? 'Details blur this small. ' : ''}
                Reads well from {Math.ceil(goodSymbolSize(frame, current.ch) * 100)}%{frame.round ? ` (${Math.round(symbolBalls(current.ch) * size.ball)} mm)` : ''} on this table.
              </Text>
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
              <View style={styles.buttonRow}>
                <Button title="Centre" icon="filter-center-focus" variant="ghost" flex disabled={!current.x && !current.y} onPress={() => centre(current.uid)} />
                <Button
                  title="Remove"
                  icon="remove-circle-outline"
                  variant="ghost"
                  flex
                  onPress={() => {
                    setSymbols((l) => l.filter((s) => s.uid !== current.uid))
                    setSelected(null)
                  }}
                />
              </View>
            </Card>
          ) : (
            <>
              <Card style={styles.card}>
                <CardTitle>Style</CardTitle>
                <Segmented fill value={recipe.style} options={STYLES} onChange={(v) => set('style', v)} />
                <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                  {STYLE_HINT[recipe.style]}
                  {!inlay && (recipe.symbols.length || recipe.texts.length > 1) ? ' Symbols and other texts are drawn only when inlaid.' : ''}
                </Text>
                {recipe.style === 'lines' ? (
                  <>
                    <Text style={[styles.label, { color: colors.foreground, marginTop: spacing.sm }]}>Next row</Text>
                    <Segmented fill value={recipe.join} options={JOINS} onChange={(v) => set('join', v)} />
                    <Text style={[styles.hint, { color: colors.mutedForeground }]}>{JOIN_HINT[recipe.join]}</Text>
                  </>
                ) : (
                  <>
                    <Text style={[styles.label, { color: colors.foreground, marginTop: spacing.sm }]}>Background</Text>
                    <Segmented fill value={recipe.host} options={HOSTS} onChange={(v) => set('host', v)} />
                    <Text style={[styles.hint, { color: colors.mutedForeground }]}>{HOST_HINT[recipe.host]}</Text>
                    <View style={[styles.numberHead, { marginTop: spacing.sm }]}>
                      <Text style={[styles.flex, styles.rowText, { color: colors.foreground }]}>Raked area</Text>
                      <Text style={[styles.value, { color: colors.mutedForeground }]}>{recipe.rake === 0 ? 'Round the text' : recipe.rake === 100 ? 'Whole table' : `${recipe.rake}%`}</Text>
                    </View>
                    <Slider value={recipe.rake} min={0} max={100} step={5} onChange={(v) => set('rake', v)} />
                    <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                      {recipe.host === 'spiral' ? 'From just round the text and symbols' : 'A band across the table round the text'}, up to the whole table. More area takes longer to draw.
                    </Text>
                    <Text style={[styles.label, { color: colors.foreground, marginTop: spacing.sm }]}>Letters and symbols</Text>
                    <Segmented fill value={recipe.letters} options={LETTERS} onChange={(v) => set('letters', v)} />
                    <Text style={[styles.hint, { color: colors.mutedForeground }]}>
                      {recipe.letters === 'solid' ? 'Letters are raked in straight lines; symbols in lines that follow their shape.' : 'Each outline traced twice.'}
                      {recipe.texts.every((t) => FONTS[t.font].outline) ? '' : ' Single-line fonts draw each word as one line either way.'}
                    </Text>
                  </>
                )}
                {frame.round ? (
                  <Text style={[styles.hint, { color: colors.mutedForeground, marginTop: spacing.sm }]}>
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
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.inputBackground,
                      borderColor: colors.border,
                      color: colors.foreground,
                    },
                  ]}
                />
                {fileStem !== (name.trim() || suggested) ? <Text style={[styles.hint, { color: colors.mutedForeground }]}>Saves as “{fileStem}”.</Text> : null}
              </Card>
            </>
          )}
        </ScrollView>
      </View>
    </View>
  )
}

/**
 * Preview: the pattern laid out (a beat after the page opens, so it shows at once):
 * the ball's path on the table, and on a round table the sand engine simulating it.
 */
function PreviewPage({ recipe, frame, size, width }: { recipe: Recipe; frame: Frame; size: ReturnType<typeof roundSize>; width: number }) {
  const colors = useTheme((s) => s.colors)
  const [layout, setLayout] = useState<Layout | null | undefined>(undefined)
  useEffect(() => {
    const id = setTimeout(() => setLayout(layoutText(patternOptions(recipe, frame))), 50)
    return () => clearTimeout(id)
  }, [recipe, frame])
  const canSand = SAND && frame.round
  const [mode, setMode] = useState<'path' | 'sand'>('path')
  const shown = useMemo(() => (layout ? previewOf(layout, frame) : null), [layout, frame])
  const travel: [number, number] = frame.round ? [2, 2] : [frame.W, frame.H]
  return (
    <ScrollView style={styles.flex} contentContainerStyle={[styles.scroll, { alignItems: 'center' }]}>
      {canSand ? (
        <View style={{ alignSelf: 'stretch' }}>
          <Segmented
            fill
            value={mode}
            options={[
              { value: 'path', label: 'Path' },
              { value: 'sand', label: 'Sand' },
            ]}
            onChange={setMode}
          />
        </View>
      ) : null}
      {layout === undefined ? (
        <View
          style={{
            width,
            height: frame.round ? width : (width * frame.H) / frame.W,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ActivityIndicator color={colors.mutedForeground} />
          <Text style={[styles.status, { color: colors.mutedForeground }]}>Laying out the pattern…</Text>
        </View>
      ) : !layout ? (
        <Text style={[styles.status, { color: colors.mutedForeground }]}>There’s nothing to draw yet.</Text>
      ) : mode === 'sand' && canSand ? (
        <SandPreview layout={layout} diameter={size.diameter} width={width} />
      ) : (
        <>
          <Drawing ink={shown?.ink ?? null} faint={shown?.faint} round={frame.round} travel={travel} width={width} />
          <Text style={[styles.hint, { color: colors.mutedForeground, textAlign: 'center' }]}>
            The ball’s path: the letters and symbols in ink, the raking faint under them.{canSand ? ' Sand simulates how it looks drawn.' : ''}
          </Text>
        </>
      )}
    </ScrollView>
  )
}

/**
 * The pattern in the sand before it's saved: the sand engine (Browse's player, SandView)
 * after the table's clear, on this table's size. Plays on open; Finished shows the end.
 */
function SandPreview({ layout, diameter, width }: { layout: Layout; diameter: number; width: number }) {
  const colors = useTheme((s) => s.colors)
  const thr = useMemo(() => toThr(layout.path), [layout])
  const ref = useRef<SandHandle>(null)
  const [state, setState] = useState<SandState>({
    f: 0,
    playing: false,
    phase: 'loading',
  })
  const [failed, setFailed] = useState<string | null>(null)
  // Commands wait for the page (SandView queues them): start playing at once.
  useEffect(() => ref.current?.play(), [])
  const busy = state.phase === 'loading' || state.phase === 'clearing'
  const line = failed
    ? `The sand preview can’t run here: ${failed}`
    : state.phase === 'loading'
      ? 'Loading the sand…'
      : state.phase === 'clearing'
        ? 'Clearing the table first…'
        : state.phase === 'simulating'
          ? `Simulating the sand… ${Math.round(state.f * 100)}%`
          : `${Math.round(state.f * 100)}%`
  return (
    <View style={styles.sandPage}>
      <View
        style={{
          width,
          height: width,
          borderRadius: width / 2,
          overflow: 'hidden',
          backgroundColor: colors.card,
        }}
      >
        {failed ? null : <SandView ref={ref} name="create-preview" thr={thr} table={sandTable(diameter)} size={width} onState={setState} onError={setFailed} />}
      </View>
      <Text style={[styles.status, { color: failed ? colors.destructive : colors.mutedForeground }]} accessibilityLiveRegion="polite">
        {line}
      </Text>
      {failed ? null : (
        <View style={[styles.buttonRow, { alignSelf: 'stretch' }]}>
          <Button
            title={state.playing ? 'Pause' : state.f >= 1 ? 'Play again' : 'Play'}
            icon={state.playing ? 'pause' : 'play-arrow'}
            variant="secondary"
            flex
            disabled={busy}
            onPress={() => (state.playing ? ref.current?.pause() : (state.f >= 1 && ref.current?.seek(0), ref.current?.play()))}
          />
          <Button title="Finished sand" icon="skip-next" variant="secondary" flex disabled={busy || state.f >= 1} onPress={() => ref.current?.seek(1)} />
        </View>
      )}
      <Text style={[styles.hint, { color: colors.mutedForeground, textAlign: 'center' }]}>Simulated on this table’s size, after its clear. Nothing is sent to the table.</Text>
    </View>
  )
}

/**
 * A symbol as the table draws it: its Noto Emoji line art, filled (holes open). Shown
 * wherever one is picked or listed instead of the system's emoji, which looks different on
 * every platform (Apple's, Google's) and never like what's drawn.
 */
function SymbolIcon({ ch, size, color }: { ch: string; size: number; color?: string }) {
  const colors = useTheme((s) => s.colors)
  const d = useMemo(() => {
    const sym = SYMBOLS[ch]
    if (!sym) return ''
    let out = ''
    for (const region of sym.regions)
      for (const ring of region as unknown as number[][]) {
        for (let i = 0; i < ring.length; i += 2) out += (i ? 'L' : 'M') + ((0.5 + ring[i]) * size).toFixed(1) + ' ' + ((0.5 - ring[i + 1]) * size).toFixed(1)
        out += 'Z'
      }
    return out
  }, [ch, size])
  return (
    <Svg width={size} height={size} accessibilityLabel={SYMBOLS[ch]?.label}>
      <Path d={d} fill={color ?? colors.foreground} fillRule="evenodd" />
    </Svg>
  )
}

/** A text's letters as filled shapes on a canvas-sized drawing (centred where the design put them). */
function Shapes({ shapes, frame, width }: { shapes: NonNullable<Layout['shapes']>; frame: Frame; width: number }) {
  const colors = useTheme((s) => s.colors)
  const map = useMemo(() => canvasMap(frame, width), [frame, width])
  const { fill, line } = useMemo(() => {
    const pt = ([x, y]: XY) =>
      map
        .to(x, y)
        .map((v) => v.toFixed(1))
        .join(' ')
    let f = ''
    let l = ''
    for (const sh of shapes) {
      if ('rings' in sh) for (const ring of sh.rings) f += ring.map((p, i) => (i ? 'L' : 'M') + pt(p)).join('') + 'Z'
      else l += sh.line.map((p, i) => (i ? 'L' : 'M') + pt(p)).join('')
    }
    return { fill: f, line: l }
  }, [shapes, map])
  return (
    <Svg width={width} height={map.height}>
      {fill ? <Path d={fill} fill={colors.foreground} fillRule="evenodd" /> : null}
      {line ? <Path d={line} stroke={colors.foreground} strokeWidth={Math.max(2, width / 120)} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
    </Svg>
  )
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
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: colors.card,
          borderColor: on ? colors.primary : colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
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
function Drawing({
  ink,
  faint,
  round,
  travel,
  width,
  bare,
  inkOnly,
}: {
  ink: Point[][] | null
  faint?: Point[][]
  round: boolean
  travel: [number, number]
  width: number
  bare?: boolean
  inkOnly?: boolean
}) {
  const colors = useTheme((s) => s.colors)
  const height = round ? width : (width * travel[1]) / travel[0]
  const pathOf = (pts: Point[]) => (!pts.length ? '' : round ? buildPath(pts, width, { pad: 0.04 }) : rectPathD(pts, travel, width, height))
  const d = useMemo(() => (ink ?? []).map(pathOf).join(' '), [ink, round, travel[0], travel[1], width, height])
  const under = useMemo(() => (faint ?? []).map(pathOf).join(' '), [faint, round, travel[0], travel[1], width, height])
  const sw = bare ? 1 : Math.max(1, width / 220)
  return (
    <Svg width={width} height={height}>
      {bare || inkOnly ? null : round ? (
        <Circle cx={width / 2} cy={width / 2} r={width / 2 - 1} fill={colors.card} stroke={colors.border} strokeWidth={1.5} />
      ) : (
        <Rect x={1} y={1} width={width - 2} height={height - 2} rx={Math.min(8, height * 0.08)} fill={colors.card} stroke={colors.border} strokeWidth={1.5} />
      )}
      {under.trim() ? <Path d={under} stroke={colors.foreground} strokeWidth={0.5} fill="none" opacity={0.22} /> : null}
      {d.trim() ? <Path d={d} stroke={colors.foreground} strokeWidth={sw} fill="none" strokeLinejoin="round" strokeLinecap="round" opacity={0.9} /> : null}
    </Svg>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: {
    alignItems: 'center',
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },
  status: {
    fontSize: font.size.sm,
    textAlign: 'center',
    marginTop: spacing.xs,
    minHeight: 18,
  },
  scroll: { padding: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
  strip: { marginHorizontal: -spacing.md, marginTop: -spacing.sm, flexGrow: 0 },
  tiles: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  tile: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 2,
  },
  tileLabel: { fontSize: font.size.sm },
  tileDivider: { width: 1, alignSelf: 'stretch', marginVertical: spacing.md },
  card: { gap: spacing.sm },
  numberHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 24,
  },
  value: { fontFamily: font.family.mono, fontSize: font.size.sm },
  rowText: { fontSize: font.size.md },
  label: { fontSize: font.size.md, marginBottom: spacing.sm },
  hint: { fontSize: font.size.sm },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 46,
    fontSize: font.size.md,
  },
  textArea: {
    minHeight: 96,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    textAlignVertical: 'top',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  symbolTile: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  chip: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  chipStrip: { flexGrow: 0 },
  row: { flexDirection: 'row' },
  sandPage: { alignItems: 'center', alignSelf: 'stretch', gap: spacing.md },
  chipRow: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  chipText: { fontSize: font.size.md, fontWeight: font.weight.medium },
  buttonRow: { flexDirection: 'row', gap: spacing.sm },
})
