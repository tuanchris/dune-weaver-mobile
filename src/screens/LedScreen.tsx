// The LEDs tab, built around the ring itself: a preview of the table's LED ring
// (lib/ledPreview.ts — the effect in the user's own colors, the ball tracker's
// dot where the sand ball is) with power at its center and brightness beneath,
// then a mode switch (Effects | Ball tracker), the controls the chosen effect
// actually reads (WLED's slider meanings — see LED_EFFECTS), and the playing /
// idle hooks. Effects are picked from a gallery sheet of rings, not a list of names.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PanResponder, Pressable, ScrollView, SectionList, StyleSheet, Text, TextInput, View, useWindowDimensions, type ViewToken } from 'react-native'
import Svg, { Circle, Defs, G, Path, RadialGradient, Stop } from 'react-native-svg'
import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native'
import { board, LED_DEFAULT_INTENSITY, LED_DEFAULT_SPEED, LED_EFFECTS, LED_PALETTES, ledEffectInputs } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useScrollLock } from '../stores/useScrollLock'
import { useTheme } from '../stores/useTheme'
import { toast } from '../stores/useToast'
import { userMessage } from '../lib/errors'
import { paletteColor, ringDots, type RingLook } from '../lib/ledPreview'
import type { SimParams } from '../lib/ledSim'
import { thumbGrid, SCROLL_BOTTOM_PAD } from '../lib/layout'
import { Button, Card, CardTitle, IconButton, Segmented, Select, Slider } from '../components/ui'
import { Screen } from '../components/Screen'
import { Sheet, SheetButton, useSheetWidth } from '../components/Sheet'
import { EmptyState } from '../components/EmptyState'
import { AnimatedLedRing, LedRing, useLedClock, useReduceMotion } from '../components/LedRing'
import type { TabNav } from '../navigation'
import { radius, spacing, font } from '../theme'

// A curated swatch grid (no native color-picker dep). Bare RRGGBB.
const SWATCHES = [
  '#FF0000', '#FF6000', '#FFB000', '#FFE000', '#A0FF00', '#22FF55',
  '#00FFA0', '#00FFFF', '#0090FF', '#0030FF', '#7000FF', '#B000FF',
  '#FF00E0', '#FF0080', '#FFFFFF', '#FFB060', '#60C0FF', '#FF4040',
]

// The gallery: every effect but 'ball' (its own mode) and 'off' (the power button).
// The gallery, grouped by character so 37 effects scan as five short rows of
// choices. Every effect but 'ball' (its own mode) and 'off' (the power button)
// appears exactly once — an effect missing from a group lands in "More".
const GROUPS: { title: string; names: string[] }[] = [
  { title: 'Calm', names: ['static', 'breathe', 'candle', 'gradient', 'sine', 'aurora', 'pacifica', 'colorwaves', 'plasma'] },
  { title: 'Color', names: ['rainbow', 'colorloop', 'pride', 'bpm', 'running', 'theater', 'chase', 'railway'] },
  { title: 'Motion', names: ['scan', 'dualscan', 'sinelon', 'juggle', 'multicomet', 'meteor', 'bouncing', 'ripple', 'drip', 'wipe', 'dissolve'] },
  { title: 'Sparkle', names: ['twinkle', 'sparkle', 'glitter', 'fireworks', 'fire'] },
  { title: 'Flash', names: ['lightning', 'strobe', 'heartbeat', 'police'] },
]
// Rainbow's "Size" (WLED) is 16 << (intensity / 29) hue steps across the ring
// (Leds.cpp EFFECT_RAINBOW): only 9 sizes, each double the last. A smooth slider
// sat dead for 29 steps and then jumped, so it snaps to the 9 and names them.
const RAINBOW_STEP = 29
function rainbowSize(ix: number): string {
  const level = Math.min(8, Math.floor(ix / RAINBOW_STEP))
  if (level < 4) return `1/${2 ** (4 - level)} rainbow`
  const n = 2 ** (level - 4)
  return `${n} rainbow${n > 1 ? 's' : ''}`
}
/** Slider step + readout for an effect's intensity (only rainbow is stepped). */
const ixSlider = (effect: string) => (effect === 'rainbow' ? { step: RAINBOW_STEP, format: rainbowSize } : {})

const GALLERY_GROUPS = (() => {
  const all = LED_EFFECTS.filter((e) => e.name !== 'ball' && e.name !== 'off')
  const grouped = new Set(GROUPS.flatMap((g) => g.names))
  const more = all.filter((e) => !grouped.has(e.name))
  return [
    ...GROUPS.map((g) => ({ title: g.title, effects: g.names.flatMap((n) => all.filter((e) => e.name === n)) })),
    ...(more.length ? [{ title: 'More', effects: more }] : []),
  ]
})()
/** Display label for an effect name (falls back to the raw name). */
const effectLabel = (name: string) => LED_EFFECTS.find((e) => e.name === name)?.label ?? name
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
  const navigation = useNavigation<TabNav>()
  const { width } = useWindowDimensions()
  const scrollLocked = useScrollLock((s) => s.locked)
  const focused = useIsFocused()
  const reduceMotion = useReduceMotion()
  const base = useBoards((s) => s.getActiveBase())
  const status = useStatus((s) => s.status)

  const [effect, setEffect] = useState('off')
  // What the strip is really showing, and what is holding it apart from
  // `effect` (a Run/Idle state hook, or Still Sands quiet hours). Reported by
  // firmware v0.1.19+; older boards report only `effect`, so these mirror it.
  const [active, setActive] = useState('off')
  const [override, setOverride] = useState<'run' | 'idle' | 'quiet' | null>(null)
  const [palette, setPalette] = useState('rainbow')
  const [color, setColor] = useState('#FFB060')
  const [color2, setColor2] = useState('#0040FF')
  const [brightness, setBrightness] = useState(40)
  const [speed, setSpeed] = useState(50)
  const [intensity, setIntensity] = useState(128)
  // Older firmware has no $LED/Intensity (and rejects the key): show the slider
  // only when /sand_settings reports it.
  const [hasIntensity, setHasIntensity] = useState(false)
  // Strip length: sizes the ring preview, and (as the $LED/Count feature check)
  // gates the link to Settings › LED strip, where count + color order live.
  const [ledCount, setLedCount] = useState<number | null>(null)
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
  const [galleryOpen, setGalleryOpen] = useState(false)
  // Throttle live color previews while dragging the wheel (final value is flushed
  // on release) so we don't fire a command on every move.
  const colorThrottle = useThrottledSend(500)
  const color2Throttle = useThrottledSend(500)
  const alignThrottle = useThrottledSend(150)

  // Remember the last "on" effect so the power button can restore it.
  const lastOnRef = useRef('rainbow')
  // Effect to restore when switching from Ball tracker back to Effects.
  const lastNonBallRef = useRef('static')
  // When the user last touched the brightness slider, so the 1s status poll
  // doesn't clobber the value mid-drag / right after release (same idea as the
  // table speed slider holding through the poll).
  const brightnessTouchedRef = useRef(0)

  const loadSettings = useCallback(async () => {
    if (!base) return
    try {
      const s = await board.settings(base)
      if (s['LED/Effect']) {
        setEffect(s['LED/Effect'])
        setActive(s['LED/Effect'])  // corrected by the first status poll
      }
      if (s['LED/Palette']) setPalette(s['LED/Palette'])
      if (s['LED/Color']) setColor(`#${s['LED/Color'].replace(/^#/, '')}`)
      if (s['LED/Color2']) setColor2(`#${s['LED/Color2'].replace(/^#/, '')}`)
      if (s['LED/Brightness']) setBrightness(Number(s['LED/Brightness']))
      if (s['LED/Speed']) setSpeed(Number(s['LED/Speed']))
      if (s['LED/Intensity'] != null) setIntensity(Number(s['LED/Intensity']) || 0)
      setHasIntensity('LED/Intensity' in s)
      setLedCount(s['LED/Count'] != null ? Number(s['LED/Count']) || null : null)
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

  // Re-read on focus (the strip's count may have changed in Settings › LED
  // strip) and on a firmware change (an OTA can add settings, like
  // LED/Intensity, that gate whole controls) — this tab stays mounted.
  const fw = status?.fw
  useFocusEffect(
    useCallback(() => {
      loadSettings()
    }, [loadSettings, fw])
  )

  useEffect(() => {
    if (status?.led) {
      setEffect(status.led.effect)
      setActive(status.led.active)
      setOverride(status.led.override)
      if (Date.now() - brightnessTouchedRef.current > 1500) setBrightness(status.led.brightness)
      if (status.led.effect !== 'off') lastOnRef.current = status.led.effect
    }
  }, [status?.led?.effect, status?.led?.active, status?.led?.override, status?.led?.brightness])

  const send = (fn: () => Promise<void>) => {
    if (!base) return
    fn().catch((e) => toast.error(userMessage(e, 'update the LEDs')))
  }

  // `resetSliders` only from the effect gallery (WLED's "use effect defaults"): the
  // power button and the mode switch restore an effect and must keep the user's tuning.
  const applyEffect = (e: string, resetSliders = false) => {
    setEffect(e)
    // An explicit choice outranks a state hook on the board too, so show it
    // immediately instead of waiting a poll. Still Sands is the exception: it
    // holds the strip off whatever the effect is, so don't promise light.
    if (override !== 'quiet') {
      setActive(e)
      setOverride(null)
    }
    if (e !== 'off') lastOnRef.current = e
    const reset = resetSliders ? { speed: LED_DEFAULT_SPEED, intensity: hasIntensity ? LED_DEFAULT_INTENSITY : undefined } : undefined
    if (reset) {
      setSpeed(reset.speed)
      if (reset.intensity != null) setIntensity(reset.intensity)
    }
    send(() => board.setLedEffect(base!, e, reset))
  }

  // Playing / idle hooks. Like the web app, you SAVE THE CURRENT effect as the
  // hook instead of picking a different one from a list — the board only stores
  // an effect per hook (palette/colours/speed/brightness are global), so this
  // captures exactly what's showing, already previewed on the table.
  const saveHook = (which: 'run' | 'idle') => {
    if (which === 'run') { setRunEffect(effect); send(() => board.setLedRunEffect(base!, effect)) }
    else { setIdleEffect(effect); send(() => board.setLedIdleEffect(base!, effect)) }
    // Name the saved effect: "Off" is a legitimate choice but a silent one, and
    // saving it by accident is what makes the LEDs look broken later.
    const label = which === 'run' ? 'Playing' : 'Idle'
    toast.success(effect === 'off' ? `${label} effect saved: LEDs off` : `${label} effect saved: ${effectLabel(effect)}`)
  }
  const clearHook = (which: 'run' | 'idle') => {
    if (which === 'run') { setRunEffect('none'); send(() => board.setLedRunEffect(base!, 'none')) }
    else { setIdleEffect('none'); send(() => board.setLedIdleEffect(base!, 'none')) }
  }

  // Judge on/off by what the strip is SHOWING, not by the stored effect: with
  // $LED/IdleEffect=off the board keeps the strip dark while $LED/Effect still
  // reads "rainbow", and a power button reading "on" against dark LEDs is how
  // this looked like "only brightness 0 works".
  const isOn = active !== 'off'
  const togglePower = () => applyEffect(isOn ? 'off' : lastOnRef.current || 'rainbow')
  // Still Sands overrides in memory and outranks an effect change, so the power
  // button genuinely cannot help until quiet hours end -- say so instead.
  const powerBlocked = override === 'quiet'
  // Only worth explaining when the hook is showing something OTHER than what
  // the user picked — a hook that happens to match is not a surprise.
  const overrideNote =
    override === 'quiet'
      ? 'Still Sands is holding the LEDs off during quiet hours. They come back when quiet hours end.'
      : (override === 'run' || override === 'idle') && active !== effect
        ? `Showing “${effectLabel(active)}” instead of “${effectLabel(effect)}”: the “${
            override === 'run' ? 'While playing' : 'While idle'
          }” effect below is set to it. Clear that, or pick an effect to override it until the table next starts or stops.`
        : null

  const isBall = effect === 'ball'
  // Remember the last non-ball effect so switching back to Effects can restore it.
  useEffect(() => {
    if (effect !== 'ball' && effect !== 'off') lastNonBallRef.current = effect
  }, [effect])
  const switchMode = (m: 'effects' | 'ball') => {
    if (m === 'ball' && !isBall) applyEffect('ball')
    else if (m === 'effects' && isBall) applyEffect(lastNonBallRef.current || 'static')
  }

  const inputs = ledEffectInputs(effect)
  // What the ball's background sub-effect reads, so we can expose its controls.
  const bgInputs = ledEffectInputs(ballBg)

  // The ring preview: the user's ring size (clamped so it still reads as a ring),
  // and for the ball tracker, the blob where the sand ball is right now.
  const dotCount = Math.max(12, Math.min(72, ledCount ?? 48))
  const turn = ((((status?.theta ?? 0) / (2 * Math.PI)) % 1) + 1) % 1
  const ballAt = ((direction === 'ccw' ? 1 - turn : turn) + align / 360) % 1
  const look: RingLook = { color, color2, palette, ball: { at: ballAt, size: ballSize, bg: ballBg } }
  // The same settings, for the firmware-effect simulation that animates the rings.
  const sim: SimParams = {
    effect: isOn ? active : 'off',
    speed,
    intensity: hasIntensity ? intensity : 128,
    palette,
    color,
    color2,
    ball: { bg: ballBg, bgBright: ballBgBright, bright: ballBright, size: ballSize, dir: direction, align, angle: turn },
  }
  // Animate only while someone can see it: tab in front, gallery closed, and
  // never under Reduce Motion (the rings then show a still sketch).
  const animate = focused && !reduceMotion
  const ringSize = Math.min(240, width - spacing.lg * 4)

  if (!base) {
    return (
      <Screen title="LEDs">
        <EmptyState icon="lightbulb-outline" text="No table connected. Add one in Settings." />
      </Screen>
    )
  }
  if (hasLed === false) {
    return (
      <Screen title="LEDs">
        <EmptyState icon="lightbulb-outline" text="This table has no LED ring set up." />
      </Screen>
    )
  }

  return (
    <Screen title="LEDs">
      <ScrollView scrollEnabled={!scrollLocked} contentContainerStyle={{ padding: spacing.lg, paddingBottom: SCROLL_BOTTOM_PAD, gap: spacing.lg }}>
        {/* The ring itself, as the table shows it: tap its center to switch the LEDs on or off. */}
        <Card style={styles.hero}>
          <AnimatedLedRing
            params={sim}
            count={dotCount}
            leds={ledCount ?? 48}
            animate={animate && isOn && !galleryOpen}
            still={ringDots(isOn ? active : 'off', dotCount, look)}
            size={ringSize}
            brightness={brightness}
          >
            <Pressable
              onPress={togglePower}
              disabled={powerBlocked}
              accessibilityRole="switch"
              accessibilityState={{ checked: isOn, disabled: powerBlocked }}
              accessibilityLabel="LEDs"
              hitSlop={8}
              style={({ pressed }) => [
                styles.power,
                isOn
                  ? { backgroundColor: colors.primary }
                  : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
                { opacity: powerBlocked ? 0.45 : pressed ? 0.85 : 1 },
              ]}
            >
              <MaterialIcons name="power-settings-new" size={30} color={isOn ? colors.primaryForeground : colors.foreground} />
            </Pressable>
          </AnimatedLedRing>
          <View style={styles.heroCaption}>
            <Text numberOfLines={1} style={[styles.heroTitle, { color: colors.foreground }]}>
              {isOn ? effectLabel(active) : 'Off'}
            </Text>
            <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>
              {powerBlocked ? 'Still Sands quiet hours' : isOn ? `${override === 'run' ? 'While playing · ' : override === 'idle' ? 'While idle · ' : ''}${asPercent255(brightness)}` : 'Tap the button to turn on'}
            </Text>
          </View>
          {overrideNote ? <Text style={[styles.hint, { color: colors.mutedForeground, textAlign: 'center' }]}>{overrideNote}</Text> : null}
          <View style={{ alignSelf: 'stretch' }}>
            <SliderRow
              label="Brightness"
              value={brightness}
              min={0}
              max={255}
              format={asPercent255}
              onChange={(v) => { brightnessTouchedRef.current = Date.now(); setBrightness(v) }}
              onComplete={(v) => { brightnessTouchedRef.current = Date.now(); send(() => board.setLedBrightness(base, v)) }}
            />
          </View>
        </Card>

        <Segmented
          fill
          value={isBall ? 'ball' : 'effects'}
          options={[{ value: 'effects', label: 'Effects' }, { value: 'ball', label: 'Ball tracker' }]}
          onChange={switchMode}
        />

        {isBall ? (
          <>
            <Card style={{ gap: spacing.lg }}>
              <Text style={[styles.hint, { color: colors.mutedForeground }]}>A glowing dot follows the sand ball around the ring.</Text>
              <ColorField
                label="Dot color"
                value={color}
                onChange={(hex) => { setColor(hex); colorThrottle.run(() => board.setLedColor(base, hex).catch(() => {})) }}
                onCommit={(hex) => { setColor(hex); colorThrottle.flush(() => send(() => board.setLedColor(base, hex))) }}
              />
              <SliderRow label="Dot brightness" value={ballBright} min={0} max={255} format={asPercent255} onChange={setBallBright} onComplete={(v) => send(() => board.setLedBallBright(base, v))} />
              <SliderRow label="Glow size (LEDs)" value={ballSize} min={1} max={30} onChange={setBallSize} onComplete={(v) => send(() => board.setLedBallSize(base, v))} />
              <View>
                <Text style={[styles.label, { color: colors.foreground }]}>Direction</Text>
                <Segmented
                  fill
                  value={direction}
                  options={[{ value: 'cw', label: 'Clockwise' }, { value: 'ccw', label: 'Counter-clockwise' }]}
                  onChange={(d) => { setDirection(d); send(() => board.setLedDirection(base, d)) }}
                />
              </View>
              <SliderRow
                label="Alignment"
                value={align}
                min={0}
                max={359}
                format={(v) => `${Math.round(v)}°`}
                onChange={(v) => { setAlign(v); alignThrottle.run(() => board.setLedAlign(base, v).catch(() => {})) }}
                onComplete={(v) => { setAlign(v); alignThrottle.flush(() => send(() => board.setLedAlign(base, v))) }}
              />
            </Card>

            <Card style={{ gap: spacing.lg }}>
              <View>
                <CardTitle>Behind the dot</CardTitle>
                <Select value={ballBg} options={BG_OPTIONS} onChange={(bg) => { setBallBg(bg); send(() => board.setLedBallBg(base, bg)) }} />
              </View>
              {bgInputs.palette ? (
                <View>
                  <Text style={[styles.label, { color: colors.foreground }]}>Palette</Text>
                  <PaletteGrid value={palette} speed={speed} animate={animate} onChange={(p) => { setPalette(p); send(() => board.setLedPalette(base, p)) }} />
                </View>
              ) : null}
              {ballBg === 'static' || bgInputs.color2 ? (
                <ColorField
                  label={ballBg === 'static' ? 'Background color' : 'Second color'}
                  value={color2}
                  onChange={(hex) => { setColor2(hex); color2Throttle.run(() => board.setLedColor2(base, hex).catch(() => {})) }}
                  onCommit={(hex) => { setColor2(hex); color2Throttle.flush(() => send(() => board.setLedColor2(base, hex))) }}
                />
              ) : null}
              {ballBg !== 'static' && ballBg !== 'off' && bgInputs.color && !bgInputs.color2 && !bgInputs.palette ? (
                <Text style={[styles.hint, { color: colors.mutedForeground }]}>This background reuses the dot color above (the firmware shares one color for both).</Text>
              ) : null}
              {ballBg !== 'off' ? (
                <SliderRow label="Background brightness" value={ballBgBright} min={0} max={255} format={asPercent255} onChange={setBallBgBright} onComplete={(v) => send(() => board.setLedBallBgBright(base, v))} />
              ) : null}
              {/* An animated background reads the one shared $LED/Intensity, with its own WLED meaning. */}
              {hasIntensity && ballBg !== 'static' && ballBg !== 'off' && bgInputs.intensity ? (
                <SliderRow label={`Background ${bgInputs.intensity.toLowerCase()}`} value={intensity} min={0} max={255} {...ixSlider(ballBg)} onChange={setIntensity} onComplete={(v) => send(() => board.setLedIntensity(base, v))} />
              ) : null}
            </Card>
          </>
        ) : (
          <Card style={{ gap: spacing.lg }}>
            {/* The effect is the big choice: a row that opens the gallery, previewed in your colors. */}
            <Pressable
              onPress={() => setGalleryOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Effect, ${effectLabel(effect)}. Browse effects`}
              style={({ pressed }) => [styles.effectRow, { opacity: pressed ? 0.7 : 1 }]}
            >
              <LedRing dots={ringDots(effect, 16, look)} size={44} glow={false} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>Effect</Text>
                <Text numberOfLines={1} style={[styles.effectName, { color: colors.foreground }]}>{effectLabel(effect)}</Text>
              </View>
              <Text style={{ color: colors.primary, fontSize: font.size.md, fontWeight: font.weight.medium }}>Browse</Text>
              <MaterialIcons name="chevron-right" size={22} color={colors.primary} />
            </Pressable>

            {inputs.palette ? (
              <View>
                <Text style={[styles.label, { color: colors.foreground }]}>Palette</Text>
                <PaletteGrid value={palette} speed={speed} animate={animate} onChange={(p) => { setPalette(p); send(() => board.setLedPalette(base, p)) }} />
              </View>
            ) : null}
            {inputs.color ? (
              <ColorField
                label={inputs.color2 ? 'First color' : 'Color'}
                value={color}
                onChange={(hex) => { setColor(hex); colorThrottle.run(() => board.setLedColor(base, hex).catch(() => {})) }}
                onCommit={(hex) => { setColor(hex); colorThrottle.flush(() => send(() => board.setLedColor(base, hex))) }}
              />
            ) : null}
            {inputs.color2 ? (
              <ColorField
                label="Second color"
                value={color2}
                onChange={(hex) => { setColor2(hex); color2Throttle.run(() => board.setLedColor2(base, hex).catch(() => {})) }}
                onCommit={(hex) => { setColor2(hex); color2Throttle.flush(() => send(() => board.setLedColor2(base, hex))) }}
              />
            ) : null}
            {inputs.speed !== false ? (
              <SliderRow label={inputs.speed ?? 'Speed'} value={speed} min={1} max={255} onChange={setSpeed} onComplete={(v) => send(() => board.setLedSpeed(base, v))} />
            ) : null}
            {hasIntensity && inputs.intensity ? (
              <SliderRow label={inputs.intensity} value={intensity} min={0} max={255} {...ixSlider(effect)} onChange={setIntensity} onComplete={(v) => send(() => board.setLedIntensity(base, v))} />
            ) : null}
          </Card>
        )}

        <Card>
          <CardTitle>While playing or idle</CardTitle>
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            Switch effects automatically when the table starts or stops. “Save current” stores the effect showing now; palette, colors, speed and brightness are shared.
          </Text>
          {([
            { which: 'run' as const, label: 'While playing', saved: runEffect },
            { which: 'idle' as const, label: 'While idle', saved: idleEffect },
          ]).map(({ which, label, saved }) => {
            const set = saved !== 'none' && saved !== ''
            // A saved "Off" holds the strip dark for good in that state — the
            // row has to say so rather than read like a harmless value.
            return (
              <View key={which} style={[styles.hookRow, { borderTopColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>{label}</Text>
                  <Text style={{ color: set && saved === 'off' ? colors.destructive : colors.mutedForeground, fontSize: font.size.sm }}>
                    {!set ? 'Not set' : saved === 'off' ? 'Off — the LEDs stay dark' : effectLabel(saved)}
                  </Text>
                </View>
                <Button title="Save current" variant="secondary" onPress={() => saveHook(which)} />
                {set ? <IconButton icon="close" size={20} color={colors.mutedForeground} label={`Clear the ${label.toLowerCase()} effect`} onPress={() => clearHook(which)} /> : null}
              </View>
            )
          })}
        </Card>

        {/* Strip setup lives in Settings (it's what the strip IS, set once, not what
            it shows); a pointer stays here, where people look for it. */}
        {ledCount != null ? (
          <Pressable
            onPress={() => navigation.navigate('Settings', { screen: 'LedStrip', initial: false })}
            accessibilityRole="button"
            style={({ pressed }) => [styles.stripLink, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>LED strip</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>{ledCount} LEDs · count and color order, in Settings</Text>
            </View>
            <MaterialIcons name="chevron-right" size={22} color={colors.mutedForeground} />
          </Pressable>
        ) : null}
      </ScrollView>

      <Sheet
        variant="page"
        visible={galleryOpen}
        onClose={() => setGalleryOpen(false)}
        title="Effects"
        trailing={<SheetButton title="Done" prominent onPress={() => setGalleryOpen(false)} />}
      >
        <EffectGallery value={effect} look={look} sim={sim} leds={ledCount ?? 48} animate={animate} onPick={(e) => applyEffect(e, true)} />
      </Sheet>
    </Screen>
  )
}

/** Every effect as a ring in the user's colors, ANIMATED (lib/ledSim.ts) while
 * its row is on screen, grouped by character. Tapping one plays it on the table
 * right away and the sheet stays open to try another. Rows scrolled out of view
 * stop animating, and on-screen tiles draw every other firmware frame (~15 fps;
 * the simulation itself keeps full speed), so a screenful of rings stays smooth.
 * Rendered INSIDE the sheet so it sizes from the sheet's width. */
function EffectGallery({ value, look, sim, leds, animate, onPick }: { value: string; look: RingLook; sim: SimParams; leds: number; animate: boolean; onPick: (name: string) => void }) {
  const colors = useTheme((s) => s.colors)
  const { cols, thumb } = thumbGrid(useSheetWidth())
  const ring = thumb - 10 // tile border (2) + padding (3), both sides
  const sections = useMemo(
    () =>
      GALLERY_GROUPS.map((g) => ({
        title: g.title,
        data: Array.from({ length: Math.ceil(g.effects.length / cols) }, (_, r) => ({
          key: `${g.title}-${r}`,
          effects: g.effects.slice(r * cols, r * cols + cols),
        })),
      })),
    [cols]
  )
  // Which rows are on screen — only those animate.
  const [visible, setVisible] = useState<Set<string>>(() => new Set())
  const onViewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    setVisible(new Set(viewableItems.map((v) => String(v.key))))
  }).current
  const viewability = useRef({ itemVisiblePercentThreshold: 10 }).current

  return (
    <SectionList
      sections={sections}
      keyExtractor={(row) => row.key}
      stickySectionHeadersEnabled={false}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={viewability}
      contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: spacing.xl }}
      renderSectionHeader={({ section }) => (
        <Text style={[styles.groupTitle, { color: colors.mutedForeground }]}>{section.title}</Text>
      )}
      renderItem={({ item: row }) => (
        <View style={styles.galleryRow}>
          {row.effects.map((e) => {
            const on = e.name === value
            return (
              <Pressable
                key={e.name}
                onPress={() => onPick(e.name)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={e.label}
                style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.7 : 1 }]}
              >
                <View style={[styles.tileRing, { borderColor: on ? colors.primary : 'transparent' }]}>
                  <AnimatedLedRing
                    // Preview what a tap gives: picking an effect resets speed and
                    // intensity to its defaults. The playing one keeps your tuning.
                    params={on ? { ...sim, effect: e.name } : { ...sim, effect: e.name, speed: LED_DEFAULT_SPEED, intensity: LED_DEFAULT_INTENSITY }}
                    count={24}
                    leds={leds}
                    animate={animate && visible.has(row.key)}
                    every={2}
                    still={ringDots(e.name, 24, look)}
                    size={ring}
                    glow={false}
                  />
                  {on ? (
                    <View style={[styles.tileCheck, { backgroundColor: colors.primary, borderColor: colors.card }]}>
                      <MaterialIcons name="check" size={14} color={colors.primaryForeground} />
                    </View>
                  ) : null}
                </View>
                <Text numberOfLines={1} style={{ color: on ? colors.primary : colors.foreground, fontSize: font.size.sm, fontWeight: on ? font.weight.semibold : font.weight.medium }}>
                  {e.label}
                </Text>
              </Pressable>
            )
          })}
          {/* Keep a short last row's tiles the same width as the rest. */}
          {Array.from({ length: cols - row.effects.length }, (_, k) => <View key={`pad-${k}`} style={styles.tile} />)}
        </View>
      )}
    />
  )
}

/** The firmware's palettes as gradient swatches (same tables as the strip),
 * flowing the way a palette moves on the strip: one palette length per 65536 /
 * (speed × 8) frames, the firmware's phase rate. */
function PaletteGrid({ value, speed, animate, onChange }: { value: string; speed: number; animate: boolean; onChange: (p: string) => void }) {
  const colors = useTheme((s) => s.colors)
  const shift = (useLedClock(animate, 2) * speed) / 8192
  return (
    <View style={styles.paletteGrid}>
      {LED_PALETTES.map((p) => {
        const on = p === value
        return (
          <Pressable
            key={p}
            onPress={() => onChange(p)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${cap(p)} palette`}
            style={({ pressed }) => [styles.paletteCell, { opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={[styles.paletteSwatch, { borderColor: on ? colors.foreground : colors.border, borderWidth: on ? 2 : 1 }]}>
              {Array.from({ length: 16 }, (_, k) => (
                <View key={k} style={{ flex: 1, backgroundColor: paletteColor(p, (k + 0.5) / 16 + shift) }} />
              ))}
            </View>
            <Text numberOfLines={1} style={{ color: on ? colors.foreground : colors.mutedForeground, fontSize: font.size.sm, fontWeight: on ? font.weight.semibold : font.weight.regular }}>
              {cap(p)}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

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
function ColorWheel({ size, value, onChange, onComplete }: { size: number; value: string; onChange: (hex: string) => void; onComplete: (hex: string) => void }) {
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
  const cb = useRef({ onChange, onComplete })
  cb.current = { onChange, onComplete }
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
      onPanResponderGrant: (e) => { useScrollLock.getState().lock(); pick.current(e.nativeEvent.locationX, e.nativeEvent.locationY, false) },
      onPanResponderMove: (e) => pick.current(e.nativeEvent.locationX, e.nativeEvent.locationY, false),
      onPanResponderRelease: (e) => { useScrollLock.getState().unlock(); pick.current(e.nativeEvent.locationX, e.nativeEvent.locationY, true) },
      onPanResponderTerminate: () => useScrollLock.getState().unlock(),
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
function ColorField({ label, value, onChange, onCommit }: { label: string; value: string; onChange: (hex: string) => void; onCommit: (hex: string) => void }) {
  const colors = useTheme((s) => s.colors)
  const scrollLocked = useScrollLock((s) => s.locked)
  const scrollRef = useRef<ScrollView>(null)
  const hexFocused = useRef(false)
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
        <Text style={{ flexShrink: 1, color: colors.foreground, fontWeight: font.weight.medium }}>{label}</Text>
        <View style={styles.colorValue}>
          <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, fontVariant: ['tabular-nums'] }}>{value.toUpperCase()}</Text>
          <View style={[styles.colorPreview, { backgroundColor: value, borderColor: colors.border }]} />
          <MaterialIcons name="chevron-right" size={20} color={colors.mutedForeground} />
        </View>
      </Pressable>

      {/* 'fit', not 'page': the wheel's capture-phase pan would fight UIKit's sheet swipe. */}
      <Sheet visible={open} onClose={() => setOpen(false)} title={label}>
        <ScrollView
          ref={scrollRef}
          scrollEnabled={!scrollLocked}
          keyboardShouldPersistTaps="handled"
          // The keyboard shrinks the sheet; keep the focused hex field (last row) in view.
          onLayout={() => { if (hexFocused.current) scrollRef.current?.scrollToEnd() }}
          contentContainerStyle={styles.colorSheetBody}
        >
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
              onFocus={() => { hexFocused.current = true }}
              onBlur={() => { hexFocused.current = false; commitHex() }}
              onSubmitEditing={commitHex}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="RRGGBB"
              placeholderTextColor={colors.mutedForeground}
              style={{ flex: 1, color: colors.foreground, fontSize: font.size.md, letterSpacing: 1 }}
            />
          </View>
        </ScrollView>
      </Sheet>
    </>
  )
}

/** Show a 0..255 brightness as a friendly 0..100%. The slider still works in
 * raw 0..255 (what the firmware stores); only the readout is a percentage. */
const asPercent255 = (v: number) => `${Math.round((v / 255) * 100)}%`

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  onComplete,
  format,
}: {
  label: string
  value: number
  min: number
  max: number
  /** Snap to multiples of this (default 1). */
  step?: number
  onChange: (v: number) => void
  onComplete: (v: number) => void
  /** Format the numeric readout (e.g. brightness as %). Default: rounded value. */
  format?: (v: number) => string
}) {
  const colors = useTheme((s) => s.colors)
  return (
    <View>
      <View style={styles.sliderLabelRow}>
        <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>{label}</Text>
        <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, fontFamily: font.family.mono }}>
          {format ? format(value) : Math.round(value)}
        </Text>
      </View>
      <Slider value={value} min={min} max={max} step={step} onChange={onChange} onComplete={onComplete} />
    </View>
  )
}


const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.md },
  heroCaption: { alignItems: 'center', gap: 2 },
  heroTitle: { fontSize: font.size.xl, fontFamily: font.family.display },
  power: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: font.size.sm, fontWeight: font.weight.medium, marginBottom: spacing.sm },
  hint: { fontSize: font.size.sm },
  effectRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52 },
  effectName: { fontSize: font.size.lg, fontFamily: font.family.displaySemi },
  tile: { flex: 1, alignItems: 'center', gap: spacing.xs },
  tileRing: { borderWidth: 2, borderRadius: 999, padding: 3 },
  tileCheck: { position: 'absolute', top: 2, right: 2, width: 22, height: 22, borderRadius: 11, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  galleryRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  groupTitle: { fontSize: font.size.sm, fontWeight: font.weight.semibold, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: spacing.sm, marginBottom: spacing.md, marginLeft: spacing.xs },
  paletteGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  paletteCell: { flexBasis: '22%', flexGrow: 1, gap: 4, alignItems: 'center', minHeight: 44 },
  paletteSwatch: { alignSelf: 'stretch', height: 28, borderRadius: radius.pill, overflow: 'hidden', flexDirection: 'row' },
  hookRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth },
  colorValue: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  colorPreview: { width: 24, height: 24, borderRadius: 12, borderWidth: 1 },
  colorTrigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: radius.md, borderWidth: 1, paddingLeft: spacing.md, paddingRight: spacing.sm, paddingVertical: spacing.sm, minHeight: 50 },
  colorSheetBody: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  wheelWrap: { alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.lg },
  presetLabel: { fontSize: font.size.xs, fontWeight: font.weight.medium, marginBottom: spacing.sm, textTransform: 'uppercase', letterSpacing: 0.5 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch: { width: 44, height: 44, borderRadius: 22 },
  hexRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.md, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, minHeight: 44 },
  sliderLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
  stripLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.lg, borderWidth: 1 },
})
