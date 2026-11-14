// Create's canvas: the DESIGN on the table, the texts and the symbols (popular emoji,
// src/lib/sandText/symbols.mjs) as filled shapes, moved directly. Drag one to move it
// (it snaps to the centre lines; no handles in the way); pinch and twist it with two
// fingers. A TAP shows its controls (box, ✕ to remove, corner to resize, knob to turn,
// snapping to quarter turns), another tap hides them; tap the sand to let go. Nothing here lays out the
// pattern (the ball's path, the fills): that's Preview's and Save's, so moving and
// resizing stay instant. The sheet it's in must be the JS one (Sheet `native={false}`):
// iOS's pageSheet follows vertical drags and cancels the touch.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder, StyleSheet, View } from 'react-native'
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg'
import { SYMBOLS, keepOnTable, keepTextOnTable } from '../lib/sandText/index.mjs'
import type { Frame, Placed, TextPlace, XY } from '../lib/sandText/index.mjs'
import { useScrollLock } from '../stores/useScrollLock'
import { useTheme } from '../stores/useTheme'
import { rectToScreen } from './RectTable'

export type Sym = Placed & { uid: number }

export const MAX_SIZE = 0.8
/** A text's size, a share of the largest that fits (Size, 30–100%). */
export const TEXT_MIN = 0.3
const HANDLE = 22
/** The turn knob sits this far above the selection box. */
const KNOB = 30
/** A turn this close to a quarter turn snaps to it (degrees). */
const SNAP = 5
/** A move this close (points) to a centre line snaps to it. */
const SNAP_PX = 8

/** A text block as the canvas moves it. */
export interface TextItem {
  uid: number
  place: TextPlace
  /** Its size, a share of the largest that fits. */
  size: number
  /** Its outline at `size`, centred and unturned (frame units): hit test, and kept on the table. */
  pts: XY[]
  /** It drawn at `size`, centred and unturned, on a canvas-sized drawing (moved, turned and scaled to its place). */
  drawing: React.ReactNode
  /** False on lines: the rows run to the edge, so it stays put (it can still be selected). */
  movable: boolean
}

/** Frame ↔ canvas points, as the app's previews map them (a disc inset 4%, a rectangle by rectToScreen). */
export function canvasMap(frame: Frame, width: number) {
  if (frame.round) {
    const c = width / 2
    const r = c * (1 - 0.04)
    return { height: width, to: (x: number, y: number): [number, number] => [c + x * r, c - y * r], from: (sx: number, sy: number): [number, number] => [(sx - c) / r, -(sy - c) / r], unit: r }
  }
  const height = (width * frame.H) / frame.W
  const f = rectToScreen([frame.W, frame.H], width, height)
  const [x0, y0] = f(0, 0)
  const [x1, y1] = f(frame.W, frame.H)
  const kx = (x1 - x0) / frame.W
  const ky = (y1 - y0) / frame.H
  return {
    height,
    to: (x: number, y: number): [number, number] => [x0 + (x + frame.W / 2) * kx, y0 + (y + frame.H / 2) * ky],
    from: (sx: number, sy: number): [number, number] => [(sx - x0) / kx - frame.W / 2, (sy - y0) / ky - frame.H / 2],
    unit: kx,
  }
}
type CanvasMap = ReturnType<typeof canvasMap>

const halfOf = (frame: Frame): [number, number] => (frame.round ? [1, 1] : [frame.W / 2, frame.H / 2])

/** A placed symbol in frame units: centre and larger side. */
function placement(frame: Frame, s: Placed) {
  const half = halfOf(frame)
  return { c: [s.x * half[0], s.y * half[1]] as [number, number], side: s.size * (frame.round ? 2 : Math.min(frame.W, frame.H)) }
}

/** On screen (y down) a clockwise turn by `deg` is a plain rotation. */
const rotate = ([x, y]: [number, number], deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]
}

/** A symbol's outline as an SVG path on the canvas (filled even-odd: its holes stay open). */
function symbolPath(frame: Frame, map: CanvasMap, s: Placed): string {
  const sym = SYMBOLS[s.ch]
  if (!sym) return ''
  const { c, side } = placement(frame, s)
  const [cx, cy] = map.to(c[0], c[1])
  const px = side * map.unit
  let d = ''
  for (const region of sym.regions) for (const ring of region as unknown as number[][]) {
    for (let i = 0; i < ring.length; i += 2) {
      const [dx, dy] = rotate([ring[i] * px, -ring[i + 1] * px], s.rot ?? 0)
      d += (i ? 'L' : 'M') + (cx + dx).toFixed(1) + ' ' + (cy + dy).toFixed(1)
    }
    d += 'Z'
  }
  return d
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
/** −180..180. */
const wrap = (deg: number) => ((((deg + 180) % 360) + 360) % 360) - 180

/** A text block's half sides at its drawn size (frame units). */
function textHalf(text: TextItem): [number, number] {
  let hx = 0
  let hy = 0
  for (const [x, y] of text.pts) {
    hx = Math.max(hx, Math.abs(x))
    hy = Math.max(hy, Math.abs(y))
  }
  return [hx, hy]
}

/** A text's live state: place and size (it's drawn at its item's `size`). */
interface LiveText {
  place: TextPlace
  size: number
}
const liveOf = (texts: TextItem[]): Record<number, LiveText> => Object.fromEntries(texts.map((t) => [t.uid, { place: t.place, size: t.size }]))

interface Props {
  frame: Frame
  width: number
  /** The table under the design. */
  pattern: React.ReactNode
  symbols: Sym[]
  texts: TextItem[]
  /** A text's or a symbol's uid, or null (nothing: the pattern's own settings). */
  selected: number | null
  /** A symbol's smallest size on this table. */
  minSize: (ch: string) => number
  onSelect: (uid: number | null) => void
  /** A gesture's result, on release. */
  onChange: (symbols: Sym[]) => void
  onTextChange: (uid: number, place: TextPlace, size: number) => void
  /** The selection's ✕: remove it (shown only when `canRemove`). */
  onRemove: (uid: number) => void
  canRemove: (uid: number) => boolean
}

type Mode = 'move' | 'resize' | 'turn' | null

export function SymbolCanvas({ frame, width, pattern, symbols, texts, selected, minSize, onSelect, onChange, onTextChange, onRemove, canRemove }: Props): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const map = useMemo(() => canvasMap(frame, width), [frame, width])
  // The gesture's state, ahead of the recipe; reset whenever the recipe's change.
  const [live, setLive] = useState(symbols)
  useEffect(() => setLive(symbols), [symbols])
  const [liveTexts, setLiveTexts] = useState(() => liveOf(texts))
  useEffect(() => setLiveTexts(liveOf(texts)), [texts])
  const [guides, setGuides] = useState<{ x: boolean; y: boolean }>({ x: false, y: false })
  // The selection's controls: shown by a tap (or a pick from the strip), hidden by another.
  const [handles, setHandles] = useState(true)
  const picked = useRef(false) // the canvas made this selection (else: the strip, which shows them)
  useEffect(() => {
    if (!picked.current) setHandles(true)
    picked.current = false
  }, [selected])

  // Refs, so the responder (made once) sees the current state.
  const state = useRef({ live, liveTexts, texts, selected, map, frame, minSize, onSelect, onChange, onTextChange, onRemove, canRemove, handles })
  state.current = { live, liveTexts, texts, selected, map, frame, minSize, onSelect, onChange, onTextChange, onRemove, canRemove, handles }
  // `fresh`: this touch picked a new element (a tap on it then shows its controls; on the selected one it toggles them).
  const g = useRef<{ mode: Mode; uid: number | null; offset: [number, number]; two: { d: number; a: number; size: number; rot: number } | null; moved: boolean; fresh: boolean }>({
    mode: null,
    uid: null,
    offset: [0, 0],
    two: null,
    moved: false,
    fresh: false,
  })

  const pan = useMemo(() => {
    const textOf = (uid: number) => state.current.texts.find((t) => t.uid === uid)
    // An element's box on screen: centre, half sides (unturned), turn.
    const box = (uid: number) => {
      const { map: m, frame: f, live: l, liveTexts: lt } = state.current
      const t = textOf(uid)
      if (t) {
        const at = lt[uid]
        if (!at) return null
        const [hx, hy] = textHalf(t)
        const k = at.size / t.size
        const half = halfOf(f)
        const [cx, cy] = m.to(at.place.x * half[0], at.place.y * half[1])
        return { cx, cy, hw: hx * k * m.unit, hh: hy * k * m.unit, rot: at.place.rot }
      }
      const s = l.find((x) => x.uid === uid)
      if (!s) return null
      const { c, side } = placement(f, s)
      const [cx, cy] = m.to(c[0], c[1])
      const sym = SYMBOLS[s.ch]
      const px = side * m.unit
      return { cx, cy, hw: ((sym?.w ?? 1) * px) / 2, hh: ((sym?.h ?? 1) * px) / 2, rot: s.rot ?? 0 }
    }
    type Box = NonNullable<ReturnType<typeof box>>
    // A screen point in the element's own (unturned) frame, from its centre.
    const local = (b: Box, p: [number, number]) => rotate([p[0] - b.cx, p[1] - b.cy], -b.rot)
    const at = (b: Box, q: [number, number]): [number, number] => {
      const [x, y] = rotate(q, b.rot)
      return [b.cx + x, b.cy + y]
    }
    const movable = (uid: number) => textOf(uid)?.movable ?? true
    // Every change stays on the table, as the pattern will draw it.
    const updateSymbol = (uid: number, fn: (s: Sym) => Sym) =>
      setLive((l) =>
        l.map((s) => {
          if (s.uid !== uid) return s
          const next = fn(s)
          return keepOnTable(state.current.frame, { ...next, size: Math.max(next.size, state.current.minSize(next.ch)) })
        }),
      )
    const updateText = (uid: number, fn: (t: LiveText) => LiveText) =>
      setLiveTexts((all) => {
        const t = textOf(uid)
        const cur = all[uid]
        if (!t || !cur) return all
        const next = fn(cur)
        const size = clamp(next.size, TEXT_MIN, 1)
        const k = size / t.size
        const fit = keepTextOnTable(state.current.frame, t.pts.map(([x, y]) => [x * k, y * k] as XY), next.place)
        return { ...all, [uid]: { place: { x: fit.x, y: fit.y, rot: fit.rot }, size: size * fit.k } }
      })
    const finish = () => {
      useScrollLock.getState().unlock()
      const { uid, moved, fresh, mode } = g.current
      if (moved && uid != null) {
        const lt = state.current.liveTexts[uid]
        if (textOf(uid) && lt) state.current.onTextChange(uid, lt.place, lt.size)
        else state.current.onChange(state.current.live)
      } else if (uid != null && mode === 'move') setHandles((h) => (fresh ? true : !h)) // a tap: show, or toggle
      g.current = { mode: null, uid, offset: [0, 0], two: null, moved: false, fresh: false }
      setGuides({ x: false, y: false })
    }
    const touch = (t: { locationX: number; locationY: number }): [number, number] => [t.locationX, t.locationY]
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        useScrollLock.getState().lock()
        const p = touch(e.nativeEvent)
        const { live: l, selected: sel, texts: ts } = state.current
        // The selection's controls, when shown: its ✕ (top left) first, then the knob and the corner.
        const shown = state.current.handles && sel != null ? box(sel) : null
        if (shown && sel != null && state.current.canRemove(sel)) {
          const x = at(shown, [-(shown.hw + 4), -(shown.hh + 4)])
          if (Math.hypot(p[0] - x[0], p[1] - x[1]) < HANDLE * 1.4) {
            g.current = { mode: null, uid: null, offset: [0, 0], two: null, moved: false, fresh: false }
            state.current.onRemove(sel)
            return
          }
        }
        const current = shown && sel != null && movable(sel) ? shown : null
        if (current && sel != null) {
          const corner = at(current, [current.hw + 4, current.hh + 4])
          const knob = at(current, [0, -(current.hh + KNOB)])
          if (Math.hypot(p[0] - knob[0], p[1] - knob[1]) < HANDLE * 1.4) {
            g.current = { mode: 'turn', uid: sel, offset: [0, 0], two: null, moved: false, fresh: false }
            return
          }
          if (Math.hypot(p[0] - corner[0], p[1] - corner[1]) < HANDLE * 1.4) {
            g.current = { mode: 'resize', uid: sel, offset: [0, 0], two: null, moved: false, fresh: false }
            return
          }
        }
        // The topmost element under the finger (a little slack round small ones): symbols, then texts.
        const inside = (uid: number) => {
          const b = box(uid)
          if (!b) return false
          const [x, y] = local(b, p)
          return Math.abs(x) <= Math.max(b.hw, 22) && Math.abs(y) <= Math.max(b.hh, 22)
        }
        const hit = [...l].reverse().find((s) => inside(s.uid))?.uid ?? [...ts].reverse().find((t) => inside(t.uid))?.uid ?? null
        if (hit != null) {
          const b = box(hit)
          const fresh = hit !== sel
          if (fresh) {
            // Picked by a drag: no controls in the way (a tap on release shows them).
            picked.current = true
            setHandles(false)
            state.current.onSelect(hit)
          }
          g.current = { mode: 'move', uid: hit, offset: b ? [p[0] - b.cx, p[1] - b.cy] : [0, 0], two: null, moved: false, fresh }
        } else {
          picked.current = true
          state.current.onSelect(null)
          g.current = { mode: null, uid: null, offset: [0, 0], two: null, moved: false, fresh: false }
        }
      },
      onPanResponderMove: (e) => {
        const { uid, mode } = g.current
        if (uid == null || !movable(uid)) return
        // A finger that hasn't really moved is still a tap.
        if (!g.current.moved && e.nativeEvent.touches.length < 2 && mode === 'move') {
          const b0 = box(uid)
          const p0 = touch(e.nativeEvent)
          if (b0 && Math.hypot(p0[0] - g.current.offset[0] - b0.cx, p0[1] - g.current.offset[1] - b0.cy) < 4) return
        }
        const { map: m, frame: f } = state.current
        const b = box(uid)
        if (!b) return
        const sym = state.current.live.find((s) => s.uid === uid)
        const lt = state.current.liveTexts[uid]
        const touches = e.nativeEvent.touches
        g.current.moved = true
        if (touches.length >= 2) {
          // Two fingers: the size follows their spread, the turn their angle.
          const [a, c] = [touch(touches[0]), touch(touches[1])]
          const d = Math.max(1, Math.hypot(c[0] - a[0], c[1] - a[1]))
          const ang = (Math.atan2(c[1] - a[1], c[0] - a[0]) * 180) / Math.PI
          if (!g.current.two) g.current.two = { d, a: ang, size: sym ? sym.size : (lt?.size ?? 1), rot: sym ? (sym.rot ?? 0) : (lt?.place.rot ?? 0) }
          const t = g.current.two
          const size = (t.size * d) / t.d
          const rot = wrap(t.rot + ang - t.a)
          if (sym) updateSymbol(uid, (s) => ({ ...s, size: Math.min(size, MAX_SIZE), rot }))
          else updateText(uid, (x) => ({ size, place: { ...x.place, rot } }))
          return
        }
        const p = touch(e.nativeEvent)
        if (mode === 'move') {
          // Snaps to the centre lines.
          const [ox, oy] = m.to(0, 0)
          let sx = p[0] - g.current.offset[0]
          let sy = p[1] - g.current.offset[1]
          const snapX = Math.abs(sx - ox) < SNAP_PX
          const snapY = Math.abs(sy - oy) < SNAP_PX
          if (snapX) sx = ox
          if (snapY) sy = oy
          setGuides((gd) => (gd.x === snapX && gd.y === snapY ? gd : { x: snapX, y: snapY }))
          const [x, y] = m.from(sx, sy)
          const half = halfOf(f)
          const nx = clamp(x / half[0], -1, 1)
          const ny = clamp(y / half[1], -1, 1)
          if (sym) updateSymbol(uid, (s) => ({ ...s, x: nx, y: ny }))
          else updateText(uid, (t) => ({ ...t, place: { ...t.place, x: nx, y: ny } }))
        } else if (mode === 'resize') {
          const [lx, ly] = local(b, p)
          // The corner follows the finger.
          const k = Math.max(Math.abs(lx) / b.hw, Math.abs(ly) / b.hh)
          if (sym) updateSymbol(uid, (s) => ({ ...s, size: Math.min(s.size * k, MAX_SIZE) }))
          else updateText(uid, (t) => ({ ...t, size: t.size * k }))
        } else if (mode === 'turn') {
          // The knob points from the centre to the finger; 0 = straight up.
          let rot = (Math.atan2(p[0] - b.cx, -(p[1] - b.cy)) * 180) / Math.PI
          const quarter = Math.round(rot / 90) * 90
          if (Math.abs(rot - quarter) < SNAP) rot = quarter
          if (sym) updateSymbol(uid, (s) => ({ ...s, rot: wrap(rot) }))
          else updateText(uid, (t) => ({ ...t, place: { ...t.place, rot: wrap(rot) } }))
        }
      },
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
    })
  }, [])

  const halfF = halfOf(frame)
  const [ox, oy] = map.to(0, 0)
  // The selection's box (and handles when it moves).
  const sel = (() => {
    if (selected == null || !handles) return null
    const t = texts.find((x) => x.uid === selected)
    if (t) {
      const lt = liveTexts[t.uid]
      if (!lt) return null
      const [hx, hy] = textHalf(t)
      const k = lt.size / t.size
      const [cx, cy] = map.to(lt.place.x * halfF[0], lt.place.y * halfF[1])
      return { cx, cy, w: 2 * hx * k * map.unit, h: 2 * hy * k * map.unit, rot: lt.place.rot, handles: t.movable, remove: canRemove(t.uid) }
    }
    const s = live.find((x) => x.uid === selected)
    if (!s) return null
    const { c, side } = placement(frame, s)
    const [cx, cy] = map.to(c[0], c[1])
    const sym = SYMBOLS[s.ch]
    const px = side * map.unit
    return { cx, cy, w: (sym?.w ?? 1) * px, h: (sym?.h ?? 1) * px, rot: s.rot ?? 0, handles: true, remove: canRemove(s.uid) }
  })()

  return (
    <View style={{ width, height: map.height }} {...pan.panHandlers} accessibilityLabel="The table. Tap a text or a symbol to select it; drag to move it, pinch and twist to resize and turn it.">
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {pattern}
      </View>
      {texts.map((t) => {
        const lt = liveTexts[t.uid]
        if (!lt) return null
        // Its drawing turned, scaled and moved about the table's centre to its place.
        const [cx, cy] = map.to(lt.place.x * halfF[0], lt.place.y * halfF[1])
        return (
          <View
            key={t.uid}
            style={[StyleSheet.absoluteFill, { transform: [{ translateX: cx - ox }, { translateY: cy - oy }, { rotate: `${lt.place.rot}deg` }, { scale: lt.size / t.size }], opacity: selected === t.uid ? 0.9 : 0.7 }]}
            pointerEvents="none"
          >
            {t.drawing}
          </View>
        )
      })}
      <Svg width={width} height={map.height} style={StyleSheet.absoluteFill} pointerEvents="none">
        {live.map((s) => (
          <Path key={s.uid} d={symbolPath(frame, map, s)} fill={colors.foreground} fillRule="evenodd" opacity={s.uid === selected ? 0.9 : 0.7} />
        ))}
        {guides.x ? <Line x1={ox} y1={0} x2={ox} y2={map.height} stroke={colors.primary} strokeWidth={1} /> : null}
        {guides.y ? <Line x1={0} y1={oy} x2={width} y2={oy} stroke={colors.primary} strokeWidth={1} /> : null}
        {sel ? (
          <G transform={`rotate(${sel.rot} ${sel.cx} ${sel.cy})`}>
            <Rect x={sel.cx - sel.w / 2 - 4} y={sel.cy - sel.h / 2 - 4} width={sel.w + 8} height={sel.h + 8} fill="none" stroke={colors.primary} strokeWidth={1.5} strokeDasharray="5 4" />
            {sel.remove ? (
              <G>
                <Circle cx={sel.cx - sel.w / 2 - 4} cy={sel.cy - sel.h / 2 - 4} r={HANDLE / 2} fill={colors.card} stroke={colors.destructive} strokeWidth={2} />
                <Line x1={sel.cx - sel.w / 2 - 8} y1={sel.cy - sel.h / 2 - 8} x2={sel.cx - sel.w / 2} y2={sel.cy - sel.h / 2} stroke={colors.destructive} strokeWidth={2} strokeLinecap="round" />
                <Line x1={sel.cx - sel.w / 2} y1={sel.cy - sel.h / 2 - 8} x2={sel.cx - sel.w / 2 - 8} y2={sel.cy - sel.h / 2} stroke={colors.destructive} strokeWidth={2} strokeLinecap="round" />
              </G>
            ) : null}
            {sel.handles ? (
              <>
                <Line x1={sel.cx} y1={sel.cy - sel.h / 2 - 4} x2={sel.cx} y2={sel.cy - sel.h / 2 - KNOB} stroke={colors.primary} strokeWidth={1.5} />
                <Circle cx={sel.cx} cy={sel.cy - sel.h / 2 - KNOB} r={HANDLE / 2} fill={colors.card} stroke={colors.primary} strokeWidth={2} />
                <Circle cx={sel.cx + sel.w / 2 + 4} cy={sel.cy + sel.h / 2 + 4} r={HANDLE / 2} fill={colors.primary} stroke={colors.card} strokeWidth={2} />
              </>
            ) : null}
          </G>
        ) : null}
      </Svg>
    </View>
  )
}
