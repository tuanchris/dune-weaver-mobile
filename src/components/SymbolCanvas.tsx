// Create › Arrange: symbols (popular emoji, src/lib/sandText/symbols.mjs) placed
// freely on the table. A large drawing of the table with the text faint under the
// symbols: drag a symbol to move it; pinch and twist it with two fingers; drag the
// selected one's corner to resize it or the knob above it to turn it (snapping to
// quarter turns); tap the sand to let go. A gesture moves only this drawing; the
// pattern redraws on release. The sheet it's in must be the JS one (Sheet
// `native={false}`): iOS's pageSheet follows vertical drags and cancels the touch.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder, StyleSheet, View } from 'react-native'
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg'
import { SYMBOLS, keepOnTable } from '../lib/sandText/index.mjs'
import type { Frame, Placed } from '../lib/sandText/index.mjs'
import { useScrollLock } from '../stores/useScrollLock'
import { useTheme } from '../stores/useTheme'
import { rectToScreen } from './RectTable'

export type Sym = Placed & { uid: number }

export const MIN_SIZE = 0.05
export const MAX_SIZE = 0.8
const HANDLE = 22
/** The turn knob sits this far above the selection box. */
const KNOB = 30
/** A turn this close to a quarter turn snaps to it (degrees). */
const SNAP = 5

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

/** A placed symbol in frame units: centre and larger side. */
function placement(frame: Frame, s: Placed) {
  const half = frame.round ? [1, 1] : [frame.W / 2, frame.H / 2]
  return { c: [s.x * half[0], s.y * half[1]] as [number, number], side: s.size * (frame.round ? 2 : Math.min(frame.W, frame.H)) }
}

/** On screen (y down) a clockwise turn by `deg` is a plain rotation. */
const rotate = ([x, y]: [number, number], deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]
}

/** A symbol's outline as an SVG path on the canvas (filled even-odd: its holes stay open). */
function symbolPath(frame: Frame, map: ReturnType<typeof canvasMap>, s: Placed): string {
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

interface Props {
  frame: Frame
  width: number
  /** What's under the symbols: the table and the text's drawing. */
  under: React.ReactNode
  symbols: Sym[]
  selected: number | null
  onSelect: (uid: number | null) => void
  /** A gesture's result, on release. */
  onChange: (symbols: Sym[]) => void
}

type Mode = 'move' | 'resize' | 'turn' | null

export function SymbolCanvas({ frame, width, under, symbols, selected, onSelect, onChange }: Props): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const map = useMemo(() => canvasMap(frame, width), [frame, width])
  // The gesture's symbols, ahead of the pattern; reset whenever the recipe's change.
  const [live, setLive] = useState(symbols)
  useEffect(() => setLive(symbols), [symbols])

  // Refs, so the responder (made once) sees the current state.
  const state = useRef({ live, selected, map, frame, onSelect, onChange })
  state.current = { live, selected, map, frame, onSelect, onChange }
  const g = useRef<{ mode: Mode; uid: number | null; offset: [number, number]; two: { d: number; a: number; size: number; rot: number } | null }>({ mode: null, uid: null, offset: [0, 0], two: null })

  const pan = useMemo(() => {
    // The symbol's box on screen: centre, half sides (unturned), turn.
    const box = (s: Placed) => {
      const { map: m, frame: f } = state.current
      const { c, side } = placement(f, s)
      const [cx, cy] = m.to(c[0], c[1])
      const sym = SYMBOLS[s.ch]
      const px = side * m.unit
      return { cx, cy, hw: ((sym?.w ?? 1) * px) / 2, hh: ((sym?.h ?? 1) * px) / 2, rot: s.rot ?? 0 }
    }
    // A screen point in the symbol's own (unturned) frame, from its centre.
    const local = (b: ReturnType<typeof box>, p: [number, number]) => rotate([p[0] - b.cx, p[1] - b.cy], -b.rot)
    const at = (b: ReturnType<typeof box>, q: [number, number]): [number, number] => {
      const [x, y] = rotate(q, b.rot)
      return [b.cx + x, b.cy + y]
    }
    // Every change stays on the table, as the pattern will draw it (keepOnTable).
    const update = (uid: number, fn: (s: Sym) => Sym) => setLive((l) => l.map((s) => (s.uid === uid ? keepOnTable(state.current.frame, fn(s)) : s)))
    const finish = () => {
      useScrollLock.getState().unlock()
      if (g.current.mode || g.current.two) state.current.onChange(state.current.live)
      g.current = { mode: null, uid: g.current.uid, offset: [0, 0], two: null }
    }
    const touch = (t: { locationX: number; locationY: number }): [number, number] => [t.locationX, t.locationY]
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        useScrollLock.getState().lock()
        const p = touch(e.nativeEvent)
        const { live: l, selected: sel } = state.current
        const current = l.find((s) => s.uid === sel)
        if (current) {
          const b = box(current)
          const corner = at(b, [b.hw + 4, b.hh + 4])
          const knob = at(b, [0, -(b.hh + KNOB)])
          if (Math.hypot(p[0] - knob[0], p[1] - knob[1]) < HANDLE * 1.4) {
            g.current = { mode: 'turn', uid: current.uid, offset: [0, 0], two: null }
            return
          }
          if (Math.hypot(p[0] - corner[0], p[1] - corner[1]) < HANDLE * 1.4) {
            g.current = { mode: 'resize', uid: current.uid, offset: [0, 0], two: null }
            return
          }
        }
        // The topmost symbol under the finger (a little slack round small ones).
        const hit = [...l].reverse().find((s) => {
          const b = box(s)
          const [x, y] = local(b, p)
          return Math.abs(x) <= Math.max(b.hw, 22) && Math.abs(y) <= Math.max(b.hh, 22)
        })
        if (hit) {
          const b = box(hit)
          state.current.onSelect(hit.uid)
          g.current = { mode: 'move', uid: hit.uid, offset: [p[0] - b.cx, p[1] - b.cy], two: null }
        } else {
          state.current.onSelect(null)
          g.current = { mode: null, uid: null, offset: [0, 0], two: null }
        }
      },
      onPanResponderMove: (e) => {
        const { uid } = g.current
        if (uid == null) return
        const { map: m, frame: f } = state.current
        const cur = state.current.live.find((s) => s.uid === uid)
        if (!cur) return
        const touches = e.nativeEvent.touches
        if (touches.length >= 2) {
          // Two fingers: the size follows their spread, the turn their angle.
          const [a, b] = [touch(touches[0]), touch(touches[1])]
          const d = Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]))
          const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI
          if (!g.current.two) g.current.two = { d, a: ang, size: cur.size, rot: cur.rot ?? 0 }
          const t = g.current.two
          update(uid, (s) => ({ ...s, size: clamp((t.size * d) / t.d, MIN_SIZE, MAX_SIZE), rot: wrap(t.rot + ang - t.a) }))
          return
        }
        const p = touch(e.nativeEvent)
        if (g.current.mode === 'move') {
          const [x, y] = m.from(p[0] - g.current.offset[0], p[1] - g.current.offset[1])
          const half = f.round ? [1, 1] : [f.W / 2, f.H / 2]
          update(uid, (s) => ({ ...s, x: clamp(x / half[0], -1, 1), y: clamp(y / half[1], -1, 1) }))
        } else if (g.current.mode === 'resize') {
          const bx = box(cur)
          const [lx, ly] = local(bx, p)
          const sym = SYMBOLS[cur.ch]
          // The corner follows the finger: the box's larger side over the symbol's own.
          const k = Math.max(Math.abs(lx) / ((sym?.w ?? 1) / 2), Math.abs(ly) / ((sym?.h ?? 1) / 2))
          const side = f.round ? 2 : Math.min(f.W, f.H)
          update(uid, (s) => ({ ...s, size: clamp(k / m.unit / side, MIN_SIZE, MAX_SIZE) }))
        } else if (g.current.mode === 'turn') {
          const bx = box(cur)
          // The knob points from the centre to the finger; 0 = straight up.
          let rot = (Math.atan2(p[0] - bx.cx, -(p[1] - bx.cy)) * 180) / Math.PI
          const quarter = Math.round(rot / 90) * 90
          if (Math.abs(rot - quarter) < SNAP) rot = quarter
          update(uid, (s) => ({ ...s, rot: wrap(rot) }))
        }
      },
      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
    })
  }, [])

  const sel = live.find((s) => s.uid === selected)
  const b = (() => {
    if (!sel) return null
    const { c, side } = placement(frame, sel)
    const [cx, cy] = map.to(c[0], c[1])
    const sym = SYMBOLS[sel.ch]
    const px = side * map.unit
    return { cx, cy, w: (sym?.w ?? 1) * px, h: (sym?.h ?? 1) * px, rot: sel.rot ?? 0 }
  })()

  return (
    <View style={{ width, height: map.height }} {...pan.panHandlers} accessibilityLabel="Symbols on the table. Drag to move; pinch and twist to resize and turn.">
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {under}
      </View>
      <Svg width={width} height={map.height} style={StyleSheet.absoluteFill} pointerEvents="none">
        {live.map((s) => (
          <Path key={s.uid} d={symbolPath(frame, map, s)} fill={colors.foreground} fillRule="evenodd" opacity={s.uid === selected ? 0.9 : 0.6} />
        ))}
        {b ? (
          <G transform={`rotate(${b.rot} ${b.cx} ${b.cy})`}>
            <Rect x={b.cx - b.w / 2 - 4} y={b.cy - b.h / 2 - 4} width={b.w + 8} height={b.h + 8} fill="none" stroke={colors.primary} strokeWidth={1.5} strokeDasharray="5 4" />
            <Line x1={b.cx} y1={b.cy - b.h / 2 - 4} x2={b.cx} y2={b.cy - b.h / 2 - KNOB} stroke={colors.primary} strokeWidth={1.5} />
            <Circle cx={b.cx} cy={b.cy - b.h / 2 - KNOB} r={HANDLE / 2} fill={colors.card} stroke={colors.primary} strokeWidth={2} />
            <Circle cx={b.cx + b.w / 2 + 4} cy={b.cy + b.h / 2 + 4} r={HANDLE / 2} fill={colors.primary} stroke={colors.card} strokeWidth={2} />
          </G>
        ) : null}
      </Svg>
    </View>
  )
}
