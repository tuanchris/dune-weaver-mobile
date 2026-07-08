import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Modal, PanResponder, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MaterialIcons } from '@expo/vector-icons'
import { useTheme } from '../stores/useTheme'
import { radius, spacing, font } from '../theme'

type Variant = 'primary' | 'secondary' | 'destructive' | 'ghost'

export function Button({
  title,
  onPress,
  variant = 'primary',
  icon,
  disabled,
  loading,
  style,
  flex,
}: {
  title?: string
  onPress?: () => void
  variant?: Variant
  icon?: keyof typeof MaterialIcons.glyphMap
  disabled?: boolean
  loading?: boolean
  style?: ViewStyle
  flex?: boolean
}) {
  const colors = useTheme((s) => s.colors)
  const bg =
    variant === 'primary' ? colors.primary
    : variant === 'destructive' ? colors.destructive
    : variant === 'secondary' ? colors.cardElevated
    : 'transparent'
  const fg =
    variant === 'primary' || variant === 'destructive' ? '#fff'
    : colors.foreground
  const isDisabled = disabled || loading

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: bg, opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1 },
        variant === 'ghost' && { borderWidth: 1, borderColor: colors.border },
        flex ? { flex: 1 } : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <View style={styles.btnInner}>
          {icon && <MaterialIcons name={icon} size={18} color={fg} />}
          {title ? <Text style={[styles.btnText, { color: fg }]}>{title}</Text> : null}
        </View>
      )}
    </Pressable>
  )
}

export function IconButton({
  icon,
  onPress,
  color,
  size = 24,
  disabled,
}: {
  icon: keyof typeof MaterialIcons.glyphMap
  onPress?: () => void
  color?: string
  size?: number
  disabled?: boolean
}) {
  const colors = useTheme((s) => s.colors)
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={10} style={({ pressed }) => ({ opacity: disabled ? 0.4 : pressed ? 0.6 : 1, padding: 4 })}>
      <MaterialIcons name={icon} size={size} color={color ?? colors.foreground} />
    </Pressable>
  )
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const colors = useTheme((s) => s.colors)
  return <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }, style]}>{children}</View>
}

/** dw-style card section title: bold label with a thin rule beneath it. */
export function CardTitle({ children }: { children: React.ReactNode }) {
  const colors = useTheme((s) => s.colors)
  return (
    <View style={styles.cardTitleWrap}>
      <Text style={[styles.cardTitleText, { color: colors.foreground }]}>{children}</Text>
      <View style={[styles.cardTitleRule, { backgroundColor: colors.border }]} />
    </View>
  )
}

/** A dropdown select styled like an input; opens a sheet of options. */
export function Select<T extends string>({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  placeholder?: string
}) {
  const colors = useTheme((s) => s.colors)
  const [open, setOpen] = useState(false)
  const current = options.find((o) => o.value === value)
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[styles.select, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}
      >
        <Text style={{ color: current ? colors.foreground : colors.mutedForeground, fontSize: font.size.md, flex: 1 }} numberOfLines={1}>
          {current?.label ?? placeholder ?? 'Select'}
        </Text>
        <MaterialIcons name="expand-more" size={22} color={colors.mutedForeground} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.selectBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={[styles.selectSheet, { backgroundColor: colors.background, borderColor: colors.border }]} onPress={() => {}}>
            <View style={styles.selectHandle} />
            <FlatList
              data={options}
              keyExtractor={(o) => o.value}
              style={{ flexShrink: 1 }}
              contentContainerStyle={{ paddingBottom: 24 }}
              renderItem={({ item }) => {
                const active = item.value === value
                return (
                  <Pressable
                    onPress={() => {
                      onChange(item.value)
                      setOpen(false)
                    }}
                    style={[styles.selectOption, { borderBottomColor: colors.border }]}
                  >
                    <Text style={{ color: active ? colors.primary : colors.foreground, fontSize: font.size.md, fontWeight: active ? font.weight.semibold : font.weight.regular }}>
                      {item.label}
                    </Text>
                    {active ? <MaterialIcons name="check" size={20} color={colors.primary} /> : null}
                  </Pressable>
                )
              }}
            />
            {/* Spacer sized to the modal window's bottom inset (Android nav bar / iOS home indicator) */}
            <SafeAreaView edges={['bottom']} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

/**
 * Touch-draggable slider. Reports continuous changes via `onChange` (for live
 * visuals) and the released value via `onComplete` (use that to fire the board
 * command, so we don't spam the firmware mid-drag). No native deps — the track's
 * screen-left is derived from the grant event's pageX/locationX.
 */
export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  onComplete,
  disabled,
  trackColor,
}: {
  value: number
  min?: number
  max?: number
  step?: number
  onChange?: (v: number) => void
  onComplete?: (v: number) => void
  disabled?: boolean
  trackColor?: string
}) {
  const colors = useTheme((s) => s.colors)
  const widthRef = useRef(0)
  const leftRef = useRef(0)
  const [drag, setDrag] = useState<number | null>(null)
  // After release, keep showing the chosen value for a beat so the thumb doesn't
  // snap back to a stale `value` prop before the board's status poll catches up.
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (holdRef.current) clearTimeout(holdRef.current) }, [])
  const display = drag ?? value
  const frac = max > min ? (Math.max(min, Math.min(max, display)) - min) / (max - min) : 0

  const quantize = (v: number) => {
    const stepped = Math.round((v - min) / step) * step + min
    return Math.max(min, Math.min(max, stepped))
  }
  const fromX = (x: number) => {
    const w = widthRef.current || 1
    return quantize(min + Math.max(0, Math.min(1, x / w)) * (max - min))
  }

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      onPanResponderGrant: (e) => {
        if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null }
        leftRef.current = e.nativeEvent.pageX - e.nativeEvent.locationX
        const v = fromX(e.nativeEvent.locationX)
        setDrag(v)
        onChange?.(v)
      },
      onPanResponderMove: (e) => {
        const v = fromX(e.nativeEvent.pageX - leftRef.current)
        setDrag(v)
        onChange?.(v)
      },
      onPanResponderRelease: (e) => {
        const v = fromX(e.nativeEvent.pageX - leftRef.current)
        onComplete?.(v)
        // Hold the released value briefly, then fall back to the live `value` prop
        // (which the board's poll should have caught up to by then).
        if (holdRef.current) clearTimeout(holdRef.current)
        holdRef.current = setTimeout(() => setDrag(null), 1200)
      },
      onPanResponderTerminate: () => {
        if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null }
        setDrag(null)
      },
    })
  ).current

  const fill = trackColor ?? colors.primary

  return (
    <View
      {...pan.panHandlers}
      onLayout={(e) => (widthRef.current = e.nativeEvent.layout.width)}
      style={[styles.sliderHit, { opacity: disabled ? 0.5 : 1 }]}
    >
      {/* pointerEvents="none" so the track/thumb never become the touch target —
          otherwise the grant event's locationX is measured relative to the tapped
          child (e.g. the thumb), snapping the value to the wrong spot. */}
      <View pointerEvents="none" style={[styles.sliderTrack, { backgroundColor: colors.cardElevated }]}>
        <View style={[styles.sliderFill, { width: `${frac * 100}%`, backgroundColor: fill }]} />
      </View>
      <View pointerEvents="none" style={[styles.sliderThumb, { left: `${frac * 100}%`, backgroundColor: fill, borderColor: colors.background }]} />
    </View>
  )
}

const styles = StyleSheet.create({
  btn: {
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  btnText: { fontSize: font.size.md, fontWeight: font.weight.semibold },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
  },
  cardTitleWrap: { marginBottom: spacing.md },
  cardTitleText: { fontSize: font.size.md, fontWeight: font.weight.semibold, marginBottom: spacing.sm },
  cardTitleRule: { height: 1, borderRadius: 1 },
  select: { flexDirection: 'row', alignItems: 'center', borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 48 },
  selectBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  selectSheet: { maxHeight: '70%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, paddingTop: spacing.sm, paddingHorizontal: spacing.lg },
  selectHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#888', alignSelf: 'center', marginBottom: spacing.sm },
  selectOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md, borderBottomWidth: 1 },
  sliderHit: { height: 36, justifyContent: 'center' },
  sliderTrack: { height: 6, borderRadius: radius.pill, overflow: 'hidden' },
  sliderFill: { height: '100%', borderRadius: radius.pill },
  sliderThumb: { position: 'absolute', width: 22, height: 22, borderRadius: 11, borderWidth: 2, marginLeft: -11 },
})
