import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { board, LED_EFFECTS, LED_PALETTES, ledEffectInputs } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { toast } from '../stores/useToast'
import { Card, CardTitle, Select, Slider } from '../components/ui'
import { Screen } from '../components/Screen'
import { radius, spacing, font } from '../theme'

// A curated swatch grid (no native color-picker dep). Bare RRGGBB.
const SWATCHES = [
  '#FF0000', '#FF6000', '#FFB000', '#FFE000', '#A0FF00', '#22FF55',
  '#00FFA0', '#00FFFF', '#0090FF', '#0030FF', '#7000FF', '#B000FF',
  '#FF00E0', '#FF0080', '#FFFFFF', '#FFB060', '#60C0FF', '#FF4040',
]

const EFFECT_OPTIONS = LED_EFFECTS.map((e) => ({ value: e.name, label: e.label }))
const PALETTE_OPTIONS = LED_PALETTES.map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))
const HOOK_OPTIONS = [{ value: 'none', label: "Don't override" }, ...LED_EFFECTS.map((e) => ({ value: e.name, label: e.label }))]

const HEX_RE = /^#?[0-9a-fA-F]{6}$/

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
  const [runEffect, setRunEffect] = useState('none')
  const [idleEffect, setIdleEffect] = useState('none')
  const [hasLed, setHasLed] = useState<boolean | null>(null)

  // Remember the last "on" effect so the power button can restore it.
  const lastOnRef = useRef('rainbow')

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
      setBrightness(status.led.brightness)
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

  const inputs = ledEffectInputs(effect)

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
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 160, gap: spacing.lg }}>
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
            <ColorField
              label={inputs.color2 ? 'Primary color' : 'Color'}
              value={color}
              onChange={(hex) => {
                setColor(hex)
                send(() => board.setLedColor(base, hex))
              }}
            />
          ) : null}
          {inputs.color2 ? (
            <ColorField
              label="Secondary color"
              value={color2}
              onChange={(hex) => {
                setColor2(hex)
                send(() => board.setLedColor2(base, hex))
              }}
            />
          ) : null}
        </Card>

        <Card>
          <SliderRow label="Brightness" value={brightness} min={0} max={255} onChange={setBrightness} onComplete={(v) => send(() => board.setLedBrightness(base, v))} />
          <View style={{ height: spacing.lg }} />
          <SliderRow label="Speed" value={speed} min={1} max={255} onChange={setSpeed} onComplete={(v) => send(() => board.setLedSpeed(base, v))} />
        </Card>

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

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const colors = useTheme((s) => s.colors)
  const [hex, setHex] = useState(value.replace(/^#/, ''))
  useEffect(() => setHex(value.replace(/^#/, '')), [value])

  const commitHex = () => {
    if (HEX_RE.test(hex)) onChange(`#${hex.replace(/^#/, '')}`)
    else setHex(value.replace(/^#/, ''))
  }

  return (
    <View style={{ marginTop: spacing.md }}>
      <View style={styles.colorHeader}>
        <Text style={[styles.label, { color: colors.foreground }]}>{label}</Text>
        <View style={[styles.colorPreview, { backgroundColor: value, borderColor: colors.border }]} />
      </View>
      <View style={styles.swatches}>
        {SWATCHES.map((c) => {
          const active = c.toUpperCase() === value.toUpperCase()
          return <Pressable key={c} onPress={() => onChange(c)} style={[styles.swatch, { backgroundColor: c, borderColor: active ? colors.foreground : colors.border, borderWidth: active ? 3 : 1 }]} />
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
    </View>
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
  hint: { fontSize: font.size.xs },
  power: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, height: 48, borderRadius: radius.md },
  colorHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  colorPreview: { width: 28, height: 28, borderRadius: 14, borderWidth: 1 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch: { width: 38, height: 38, borderRadius: 19 },
  hexRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.md, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 44 },
  sliderLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs },
})
