import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Modal, PanResponder, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import Svg, { Circle, Defs, G, Path, RadialGradient, Stop } from 'react-native-svg'
import { MaterialIcons } from '@expo/vector-icons'
import { board, LED_EFFECTS, LED_PALETTES, ledEffectInputs } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { toast } from '../stores/useToast'
import { Card, CardTitle, IconButton, Select, Slider } from '../components/ui'
import { Screen } from '../components/Screen'
import { radius, spacing, font } from '../theme'

// A curated swatch grid (no native color-picker dep). Bare RRGGBB.
const SWATCHES = [
  '#FF0000', '#FF6000', '#FFB000', '#FFE000', '#A0FF00', '#22FF55',
  '#00FFA0', '#00FFFF', '#0090FF', '#0030FF', '#7000FF', '#B000FF',
  '#FF00E0', '#FF0080', '#FFFFFF', '#FFB060', '#60C0FF', '#FF4040',
]

// 'ball' is promoted to its own card, so keep it out of the generic effect list.
const EFFECT_OPTIONS = LED_EFFECTS.filter((e) => e.name !== 'ball').map((e) => ({ value: e.name, label: e.label }))
const PALETTE_OPTIONS = LED_PALETTES.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))
const HOOK_OPTIONS = [{ value: 'none', label: "Don't override" }, ...LED_EFFECTS.map((e) => ({ value: e.name, label: e.label }))]
// What renders behind the ball's blob: a solid color, black, or a live effect.
const BG_OPTIONS = [
  { value: 'static', label: 'Solid color' },
  { value: 'off', label: 'Off (black)' },
  ...LED_EFFECTS.filter((e) => e.name !== 'ball' && e.name !== 'off' && e.name !== 'static').map((e) => ({ value: e.name, label: e.label })),
]

const HEX_RE = /^#?[0-9a-fA-F]{6}$/

const WHEEL_SIZE = 240

/**
 * Rate-limit live updates (e.g. dragging the color wheel) so we preview on the
 * table without flooding the firmware. `run` fires on the leading edge then at
 * most once per `ms`; `flush` cancels any pending call and fires immediately
 * (use it on release so the final value always lands).
 */
function useThrottledSend(ms: number) {
  const last = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<(() => void) | null>(null)
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  const run = useCallback((fn: () => void) => {
    const wait = ms - (Date.now() - last.current)
    if (wait <= 0) {
      last.current = Date.now()
      fn()
    } else {
      pending.current = fn
      if (!timer.current) {
        timer.current = setTimeout(() => {
          timer.current = null
          last.current = Date.now()
          const f = pending.current
          pending.current = null
          f?.()
        }, wait)
      }
    }
  }, [ms])
  const flush = useCallback((fn: () => void) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    pending.current = null
    last.current = Date.now()
    fn()
  }, [])
  return useMemo(() => ({ run, flush }), [run, flush])
}

export function LedScreen() {
  const colors = useTheme((s) => s.colors)
  const base = useBoards((s) => s.getActiveBase())
  const status = useStatus((s) => s.status)

  const [effect, setEffect] = useState('off')
  const [palette, setPalette] = useState('rainbow')
  const [color, setColor] = useState('#FFB060')
  const [color2, setColor2] = useState('#0040FF')
  const [brightness, setBrightness] = useState(40)
  const [speed, setSpeed] = useState(50)
  const [direction, setDirection] = useState<'cw' | 'ccw'>('cw')
  const [align, setAlign] = useState(0)
  // Ball-effect controls (blob/background brightness, background sub-effect, size).
  const [ballBright, setBallBright] = useState(255)
  const [ballBgBright, setBallBgBright] = useState(255)
  const [ballSize, setBallSize] = useState(3)
  const [ballBg, setBallBg] = useState('static')
  const [runEffect, setRunEffect] = useState('none')
  const [idleEffect, setIdleEffect] = useState('none')
  const [hasLed, setHasLed] = useState<boolean | null>(null)
  // Disabled while dragging the color wheel so the page doesn't scroll under it.
  const [scrollEnabled, setScrollEnabled] = useState(true)
  // Throttle live color previews while dragging the wheel (final value is flushed
  // on release) so we don't fire a command on every move.
  const colorThrottle = useThrottledSend(500)
  const color2Throttle = useThrottledSend(500)
  const alignThrottle = useThrottledSend(150)

  // Remember the last "on" effect so the power button can restore it.
  const lastOnRef = useRef('rainbow')
  // Effect to restore when the ball toggle is turned off.
  const lastNonBallRef = useRef('static')
  // When the user last touched the brightness slider, so the 1s status poll
  // doesn't clobber the value mid-drag / right after release (same idea as the
  // table speed slider holding through the poll).
  const brightnessTouchedRef = useRef(0)

  const loadSettings = useCallback(async () => {
    if (!base) return
    try {
      const s = await board.settings(base)
      if (s['LED/Effect']) setEffect(s['LED/Effect'])
      if (s['LED/Palette']) setPalette(s['LED/Palette'])
      if (s['LED/Color']) setColor(`#${s['LED/Color'].replace(/^#/, '')}`)
      if (s['LED/Color2']) setColor2(`#${s['LED/Color2'].replace(/^#/, '')}`)
      if (s['LED/Brightness']) setBrightness(Number(s['LED/Brightness']))
      if (s['LED/Speed']) setSpeed(Number(s['LED/Speed']))
      if (s['LED/Direction']) setDirection(s['LED/Direction'] === 'ccw' ? 'ccw' : 'cw')
      if (s['LED/Align'] != null) setAlign(Number(s['LED/Align']) || 0)
      if (s['LED/BallSize'] != null) setBallSize(Number(s['LED/BallSize']) || 3)
      if (s['LED/BallBright'] != null) setBallBright(Number(s['LED/BallBright']) || 0)
      if (s['LED/BallBgBright'] != null) setBallBgBright(Number(s['LED/BallBgBright']) || 0)
      if (s['LED/BallBg']) setBallBg(s['LED/BallBg'])
      if (s['LED/RunEffect']) setRunEffect(s['LED/RunEffect'])
      if (s['LED/IdleEffect']) setIdleEffect(s['LED/IdleEffect'])
      if (s['LED/Effect'] && s['LED/Effect'] !== 'off') lastOnRef.current = s['LED/Effect']
      setHasLed('LED/Effect' in s)
    } catch {
      setHasLed(null)
    }
  }, [base])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  useEffect(() => {
    if (status?.led) {
      setEffect(status.led.effect)
      if (Date.now() - brightnessTouchedRef.current > 1500) setBrightness(status.led.brightness)
      if (status.led.effect !== 'off') lastOnRef.current = status.led.effect
    }
  }, [status?.led?.effect, status?.led?.brightness])

  const send = (fn: () => Promise<void>) => {
    if (!base) return
    fn().catch(() => toast.error('LED command failed'))
  }

  const applyEffect = (e: string) => {
    setEffect(e)
    if (e !== 'off') lastOnRef.current = e
    send(() => board.setLedEffect(base!, e))
  }

  const isOn = effect !== 'off'
  const togglePower = () => applyEffect(isOn ? 'off' : lastOnRef.current || 'rainbow')

  const isBall = effect === 'ball'
  // Remember the last non-ball effect so toggling the ball off can restore it.
  useEffect(() => {
    if (effect !== 'ball' && effect !== 'off') lastNonBallRef.current = effect
  }, [effect])
  const toggleBall = (on: boolean) => applyEffect(on ? 'ball' : lastNonBallRef.current || 'static')

  const inputs = ledEffectInputs(effect)
  // What the ball's background sub-effect reads, so we can expose its controls.
  const bgInputs = ledEffectInputs(ballBg)

  if (!base) {
    return (
      <Screen title="DW LEDs">
        <View style={styles.empty}>
          <MaterialIcons name="lightbulb-outline" size={40} color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, marginTop: spacing.sm }}>No table connected. Add one in Settings.</Text>
        </View>
      </Screen>
    )
  }

  const bannerOk = hasLed !== false
  const bannerColor = hasLed === false ? colors.destructive : colors.success

  return (
    <Screen title="DW LEDs">
      <ScrollView scrollEnabled={scrollEnabled} contentContainerStyle={{ padding: spacing.lg, paddingBottom: 160, gap: spacing.lg }}>
        <View style={[styles.banner, { backgroundColor: bannerColor + '22', borderColor: bannerColor + '55' }]}>
          <MaterialIcons name={bannerOk ? 'check-circle' : 'error-outline'} size={20} color={bannerColor} />
          <Text style={{ color: bannerColor, fontSize: font.size.sm, flex: 1, fontWeight: font.weight.medium }}>
            {hasLed === false
              ? 'No LEDs configured on this table.'
              : `LEDs ready · ${isOn ? `${effect} · ${brightness}` : 'Power OFF'}`}
          </Text>
        </View>

        <Card>
          <CardTitle>Power</CardTitle>
          <Pressable
            onPress={togglePower}
            style={({ pressed }) => [styles.power, { backgroundColor: isOn ? colors.cardElevated : colors.success, opacity: pressed ? 0.85 : 1, borderColor: colors.border, borderWidth: isOn ? 1 : 0 }]}
          >
            <MaterialIcons name="power-settings-new" size={20} color={isOn ? colors.foreground : '#fff'} />
            <Text style={{ color: isOn ? colors.foreground : '#fff', fontWeight: font.weight.semibold, fontSize: font.size.md }}>
              {isOn ? 'Turn OFF' : 'Turn ON'}
            </Text>
          </Pressable>
        </Card>

        {/* Ball tracker — promoted out of the effect list so it's easy to find. */}
        <Card>
          <View style={styles.ballHead}>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <CardTitle>Ball tracker</CardTitle>
              <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginTop: -spacing.sm }}>
                A glowing dot that follows the sand ball around the ring.
              </Text>
            </View>
            <Switch value={isBall} onValueChange={toggleBall} />
          </View>

          {isBall ? (
            <View style={{ gap: spacing.md, marginTop: spacing.md }}>
              {/* Blob */}
              <View style={{ marginTop: spacing.sm }}>
                <Text style={{ color: colors.foreground, fontSize: font.size.md, fontWeight: font.weight.semibold }}>Blob</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>The dot that tracks the ball.</Text>
              </View>
              <ColorField
                label="Blob color"
                value={color}
                onChange={(hex) => { setColor(hex); colorThrottle.run(() => board.setLedColor(base, hex).catch(() => {})) }}
                onCommit={(hex) => { setColor(hex); colorThrottle.flush(() => send(() => board.setLedColor(base, hex))) }}
              />
              <SliderRow label="Blob brightness" value={ballBright} min={0} max={255} onChange={setBallBright} onComplete={(v) => send(() => board.setLedBallBright(base, v))} />
              <View>
                <Text style={[styles.label, { color: colors.foreground }]}>Direction</Text>
                <Select value={direction} options={[{ value: 'cw', label: 'Clockwise' }, { value: 'ccw', label: 'Counter-clockwise' }]} onChange={(d) => { setDirection(d); send(() => board.setLedDirection(base, d)) }} />
              </View>
              <SliderRow
                label="Alignment"
                value={align}
                min={0}
                max={359}
                onChange={(v) => { setAlign(v); alignThrottle.run(() => board.setLedAlign(base, v).catch(() => {})) }}
                onComplete={(v) => { setAlign(v); alignThrottle.flush(() => send(() => board.setLedAlign(base, v))) }}
              />
              <SliderRow label="Glow size (LEDs)" value={ballSize} min={1} max={30} onChange={setBallSize} onComplete={(v) => send(() => board.setLedBallSize(base, v))} />

              {/* Background */}
              <View style={[styles.sectionHead, { borderTopColor: colors.border }]}>
                <Text style={{ color: colors.foreground, fontSize: font.size.md, fontWeight: font.weight.semibold }}>Background</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>What renders behind the blob.</Text>
              </View>
              <Select value={ballBg} options={BG_OPTIONS} onChange={(bg) => { setBallBg(bg); send(() => board.setLedBallBg(base, bg)) }} />
              {bgInputs.palette ? (
                <View>
                  <Text style={[styles.label, { color: colors.foreground }]}>Background palette</Text>
                  <Select value={palette} options={PALETTE_OPTIONS} onChange={(p) => { setPalette(p); send(() => board.setLedPalette(base, p)) }} />
                </View>
              ) : null}
              {ballBg === 'static' || bgInputs.color2 ? (
                <ColorField
                  label={ballBg === 'static' ? 'Background color' : 'Background 2nd color'}
                  value={color2}
                  onChange={(hex) => { setColor2(hex); color2Throttle.run(() => board.setLedColor2(base, hex).catch(() => {})) }}
                  onCommit={(hex) => { setColor2(hex); color2Throttle.flush(() => send(() => board.setLedColor2(base, hex))) }}
                />
              ) : null}
              {ballBg !== 'static' && ballBg !== 'off' && bgInputs.color && !bgInputs.color2 && !bgInputs.palette ? (
                <Text style={[styles.hint, { color: colors.mutedForeground }]}>This background reuses the blob color above (the firmware shares one color for both).</Text>
              ) : null}
              {ballBg !== 'off' ? (
                <SliderRow label="Background brightness" value={ballBgBright} min={0} max={255} onChange={setBallBgBright} onComplete={(v) => send(() => board.setLedBallBgBright(base, v))} />
              ) : null}
            </View>
          ) : null}
        </Card>

        {!isBall ? (
          <Card>
            <SliderRow
              label="Brightness"
              value={brightness}
              min={0}
              max={255}
              onChange={(v) => { brightnessTouchedRef.current = Date.now(); setBrightness(v) }}
              onComplete={(v) => { brightnessTouchedRef.current = Date.now(); send(() => board.setLedBrightness(base, v)) }}
            />
            <View style={{ height: spacing.lg }} />
            <SliderRow label="Speed" value={speed} min={1} max={255} onChange={setSpeed} onComplete={(v) => send(() => board.setLedSpeed(base, v))} />
          </Card>
        ) : null}

        {!isBall ? (
          <Card>
            <CardTitle>Effect</CardTitle>
            <Select value={effect} options={EFFECT_OPTIONS} onChange={applyEffect} />

            {inputs.palette ? (
              <View style={{ marginTop: spacing.md }}>
                <Text style={[styles.label, { color: colors.foreground }]}>Palette</Text>
                <Select
                  value={palette}
                  options={PALETTE_OPTIONS}
                  onChange={(p) => {
                    setPalette(p)
                    send(() => board.setLedPalette(base, p))
                  }}
                />
              </View>
            ) : null}

            {inputs.color ? (
              <View style={{ marginTop: spacing.md }}>
                <ColorField
                  label={inputs.color2 ? 'Primary color' : 'Color'}
                  value={color}
                  onChange={(hex) => {
                    setColor(hex)
                    colorThrottle.run(() => board.setLedColor(base, hex).catch(() => {}))
                  }}
                  onCommit={(hex) => {
                    setColor(hex)
                    colorThrottle.flush(() => send(() => board.setLedColor(base, hex)))
                  }}
                />
              </View>
            ) : null}
            {inputs.color2 ? (
              <View style={{ marginTop: spacing.md }}>
                <ColorField
                  label="Secondary color"
                  value={color2}
                  onChange={(hex) => {
                    setColor2(hex)
                    color2Throttle.run(() => board.setLedColor2(base, hex).catch(() => {}))
                  }}
                  onCommit={(hex) => {
                    setColor2(hex)
                    color2Throttle.flush(() => send(() => board.setLedColor2(base, hex)))
                  }}
                />
              </View>
            ) : null}
          </Card>
        ) : null}

        <Card>
          <CardTitle>Motion-reactive</CardTitle>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>Override the effect by machine state. “Don’t override” keeps the effect above.</Text>
          <Text style={[styles.label, { color: colors.foreground, marginTop: spacing.md }]}>While running</Text>
          <Select value={runEffect} options={HOOK_OPTIONS} onChange={(v) => { setRunEffect(v); send(() => board.setLedRunEffect(base, v)) }} />
          <Text style={[styles.label, { color: colors.foreground, marginTop: spacing.md }]}>While idle</Text>
          <Select value={idleEffect} options={HOOK_OPTIONS} onChange={(v) => { setIdleEffect(v); send(() => board.setLedIdleEffect(base, v)) }} />
        </Card>
      </ScrollView>
    </Screen>
  )
}

// ---- color math (HSV<->hex) for the wheel ----
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, max === 0 ? 0 : d / max, max]
}
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace(/^#/, ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('').toUpperCase()
}

/**
 * HSV color wheel: hue around the circle, saturation = radius. Picks at full
 * value (V=1) — the global Brightness slider handles dimming. Drag reports live
 * changes via `onChange`; the released value via `onComplete` (so we only push
 * to the board on release, not every move).
 */
function ColorWheel({ size, value, onChange, onComplete, onActiveChange }: { size: number; value: string; onChange: (hex: string) => void; onComplete: (hex: string) => void; onActiveChange?: (active: boolean) => void }) {
  const R = size / 2
  const [hr, hg, hb] = hexToRgb(value)
  const [h, s] = rgbToHsv(hr, hg, hb)
  const rad = (h * Math.PI) / 180
  const tx = R + s * R * Math.cos(rad)
  const ty = R + s * R * Math.sin(rad)

  // Static hue wedges (full saturation); a radial white overlay fades them to
  // white at the center for the saturation axis. Memoized so only the thumb
  // re-renders while dragging.
  const wedges = useMemo(() => {
    const arr: { d: string; fill: string }[] = []
    const step = 6
    for (let a = 0; a < 360; a += step) {
      const a0 = (a * Math.PI) / 180
      const a1 = ((a + step + 0.6) * Math.PI) / 180
      const x0 = R + R * Math.cos(a0), y0 = R + R * Math.sin(a0)
      const x1 = R + R * Math.cos(a1), y1 = R + R * Math.sin(a1)
      const [r, g, b] = hsvToRgb((a + step / 2) % 360, 1, 1)
      arr.push({ d: `M${R} ${R} L${x0} ${y0} A${R} ${R} 0 0 1 ${x1} ${y1} Z`, fill: rgbToHex(r, g, b) })
    }
    return arr
  }, [R])

  // Keep the latest callbacks in a ref so the once-created PanResponder always
  // calls the current ones.
  const cb = useRef({ onChange, onComplete, onActiveChange })
  cb.current = { onChange, onComplete, onActiveChange }
  const pick = useRef((x: number, y: number, done: boolean) => {})
  pick.current = (x, y, done) => {
    const dx = x - R, dy = y - R
    let deg = (Math.atan2(dy, dx) * 180) / Math.PI
    if (deg < 0) deg += 360
    const sat = Math.min(1, Math.hypot(dx, dy) / R)
    const [r, g, b] = hsvToRgb(deg, sat, 1)
    const hex = rgbToHex(r, g, b)
    done ? cb.current.onComplete(hex) : cb.current.onChange(hex)
  }

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      // Don't hand the gesture back to the enclosing ScrollView when it tries to
      // scroll — keep dragging the wheel instead of scrolling the page.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e) => { cb.current.onActiveChange?.(true); pick.current(e.nativeEvent.locationX, e.nativeEvent.locationY, false) },
      onPanResponderMove: (e) => pick.current(e.nativeEvent.locationX, e.nativeEvent.locationY, false),
      onPanResponderRelease: (e) => { pick.current(e.nativeEvent.locationX, e.nativeEvent.locationY, true); cb.current.onActiveChange?.(false) },
      onPanResponderTerminate: () => cb.current.onActiveChange?.(false),
    })
  ).current

  return (
    <View {...pan.panHandlers} style={{ width: size, height: size }}>
      <View pointerEvents="none">
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id="sat" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#fff" stopOpacity={1} />
              <Stop offset="100%" stopColor="#fff" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <G>
            {wedges.map((w, i) => (
              <Path key={i} d={w.d} fill={w.fill} />
            ))}
          </G>
          <Circle cx={R} cy={R} r={R} fill="url(#sat)" />
          {/* selection thumb */}
          <Circle cx={tx} cy={ty} r={11} fill={value} stroke="#fff" strokeWidth={3} />
          <Circle cx={tx} cy={ty} r={12.5} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={1} />
        </Svg>
      </View>
    </View>
  )
}

// A compact tappable row (label · swatch · hex) that opens a bottom-sheet
// overlay with the wheel, presets, and hex input — so the wheel only takes up
// space when you're actually picking a color.
function ColorField({ label, value, onChange, onCommit }: { label: string; value: string; onChange: (hex: string) => void; onCommit: (hex: string) => void; onActiveChange?: (active: boolean) => void }) {
  const colors = useTheme((s) => s.colors)
  const [open, setOpen] = useState(false)
  const [hex, setHex] = useState(value.replace(/^#/, ''))
  useEffect(() => setHex(value.replace(/^#/, '')), [value])

  const commitHex = () => {
    if (HEX_RE.test(hex)) onCommit(`#${hex.replace(/^#/, '')}`)
    else setHex(value.replace(/^#/, ''))
  }

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.colorTrigger, { borderColor: colors.border, backgroundColor: colors.inputBackground }]}
      >
        <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>{label}</Text>
        <View style={styles.colorValue}>
          <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, fontVariant: ['tabular-nums'] }}>{value.toUpperCase()}</Text>
          <View style={[styles.colorPreview, { backgroundColor: value, borderColor: colors.border }]} />
          <MaterialIcons name="chevron-right" size={20} color={colors.mutedForeground} />
        </View>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.colorBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={[styles.colorSheet, { backgroundColor: colors.background, borderColor: colors.border }]} onPress={() => {}}>
            <View style={styles.colorSheetHead}>
              <Text style={{ color: colors.foreground, fontSize: font.size.lg, fontWeight: font.weight.semibold }}>{label}</Text>
              <IconButton icon="close" size={26} color={colors.foreground} onPress={() => setOpen(false)} />
            </View>

            <View style={styles.wheelWrap}>
              <ColorWheel size={WHEEL_SIZE} value={value} onChange={onChange} onComplete={onCommit} />
            </View>

            <Text style={[styles.presetLabel, { color: colors.mutedForeground }]}>Presets</Text>
            <View style={styles.swatches}>
              {SWATCHES.map((c) => {
                const active = c.toUpperCase() === value.toUpperCase()
                return <Pressable key={c} onPress={() => onCommit(c)} style={[styles.swatch, { backgroundColor: c, borderColor: active ? colors.foreground : colors.border, borderWidth: active ? 3 : 1 }]} />
              })}
            </View>

            <View style={[styles.hexRow, { borderColor: colors.border, backgroundColor: colors.inputBackground }]}>
              <Text style={{ color: colors.mutedForeground, fontSize: font.size.md }}>#</Text>
              <TextInput
                value={hex}
                onChangeText={(t) => setHex(t.replace(/[^0-9a-fA-F]/g, '').slice(0, 6))}
                onBlur={commitHex}
                onSubmitEditing={commitHex}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="RRGGBB"
                placeholderTextColor={colors.mutedForeground}
                style={{ flex: 1, color: colors.foreground, fontSize: font.size.md, letterSpacing: 1 }}
              />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

function SliderRow({ label, value, min, max, onChange, onComplete }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; onComplete: (v: number) => void }) {
  const colors = useTheme((s) => s.colors)
  return (
    <View>
      <View style={styles.sliderLabelRow}>
        <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>{label}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>{Math.round(value)}</Text>
      </View>
      <Slider value={value} min={min} max={max} onChange={onChange} onComplete={onComplete} />
    </View>
  )
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1 },
  label: { fontSize: font.size.sm, fontWeight: font.weight.medium, marginBottom: spacing.sm },
  ballHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionHead: { borderTopWidth: 1, paddingTop: spacing.md, marginTop: spacing.xs },
  hint: { fontSize: font.size.xs },
  power: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, height: 48, borderRadius: radius.md },
  colorHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  colorValue: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  colorPreview: { width: 24, height: 24, borderRadius: 12, borderWidth: 1 },
  colorTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radius.md, borderWidth: 1, paddingLeft: spacing.md, paddingRight: spacing.sm, height: 50 },
  colorBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  colorSheet: { borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, padding: spacing.lg, paddingBottom: spacing.xl },
  colorSheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wheelWrap: { alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.lg },
  presetLabel: { fontSize: font.size.xs, fontWeight: font.weight.medium, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch: { width: 34, height: 34, borderRadius: 17 },
  hexRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.md, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 44 },
  sliderLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
})
