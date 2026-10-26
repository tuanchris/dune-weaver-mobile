// The app's ONLY bottom-sheet Modal wrapper.
//  - 'page': iOS = native pageSheet (system swipe-to-dismiss, no fake grabber);
//    Android/web = a tall JS sheet. For task sheets: editors, pickers, logs.
//  - 'fit':  content-height JS sheet on every platform, with a REAL draggable
//    grabber. For short choosers and anything whose content fights UIKit's
//    sheet pan (ColorWheel).
// Rules: ONE sheet presented at a time (iOS silently refuses to present a
// second Modal, even while the first animates out) — nested flows are in-sheet
// sub-pages via `onBack`. A parent that may refuse `onClose` MUST pass
// dismissible={false}: a completed iOS swipe has already dismissed the sheet.

import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Animated, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { create } from 'zustand'
import { useTheme } from '../stores/useTheme'
import { MaterialIcons } from '@expo/vector-icons'
import { font, radius, spacing } from '../theme'

const SCRIM = 'rgba(0,0,0,0.5)'
const NATIVE_DRIVER = Platform.OS !== 'web' // RNW has no native Animated module (warns)

export interface SheetProps {
  visible: boolean
  /** User asked to close: ✕, backdrop, grabber drag, iOS swipe (attempt OR completed), Android back (no onBack). */
  onClose: () => void
  /** false = no gesture may finish a close by itself (dirty/busy); onClose still fires so the parent can ask. Default true. */
  dismissible?: boolean
  variant?: 'page' | 'fit'
  title?: string
  leading?: React.ReactNode
  /** Defaults to a ✕ close button when `title` is set. */
  trailing?: React.ReactNode
  /** Sub-page: a back chevron replaces `leading`; Android back calls it. */
  onBack?: () => void
  children: React.ReactNode
}

// Open-sheet registry: lets callers wait until no sheet is up (or animating out)
// before presenting one of their own.
const useOpenSheets = create<{ count: number }>(() => ({ count: 0 }))
export function useAnySheetOpen(): boolean {
  return useOpenSheets((s) => s.count > 0)
}

const SheetWidth = createContext<number | null>(null)
/** The presenting sheet's width (an iPad pageSheet is narrower than the window). */
export function useSheetWidth(): number {
  const w = useContext(SheetWidth)
  const { width } = useWindowDimensions()
  return w ?? width
}

export function Sheet({ visible, onClose, dismissible = true, variant = 'fit', title, leading, trailing, onBack, children }: SheetProps) {
  const colors = useTheme((s) => s.colors)
  const { height: winH } = useWindowDimensions()
  const nativePage = variant === 'page' && Platform.OS === 'ios'
  const [width, setWidth] = useState<number | null>(null)

  const registered = useRef(false)
  const setRegistered = (on: boolean) => {
    if (registered.current === on) return
    registered.current = on
    if (__DEV__ && on && useOpenSheets.getState().count > 0) console.warn('Sheet: another sheet is already open — use an in-sheet sub-page (onBack)')
    useOpenSheets.setState((s) => ({ count: s.count + (on ? 1 : -1) }))
  }
  useEffect(() => () => setRegistered(false), [])
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  useEffect(() => {
    if (visible) { setRegistered(true); return }
    if (!nativePage) return // the JS sheet unregisters when its close animation ends
    const t = setTimeout(() => setRegistered(false), 700) // in case onDismiss never fires
    return () => clearTimeout(t)
  }, [visible])

  // ---- JS sheet: mount → spring in; close → slide out → unmount ----
  const [mounted, setMounted] = useState(visible)
  const y = useRef(new Animated.Value(winH)).current
  const sheetH = useRef(0)
  const springBack = () => Animated.spring(y, { toValue: 0, bounciness: 0, speed: 16, useNativeDriver: NATIVE_DRIVER }).start()

  useEffect(() => {
    if (nativePage) return
    if (visible) { setMounted(true); return }
    if (!mounted) return
    // Unmount whenever the slide-out ENDS while still closed (finished or not): a
    // stopped close that only acted on `finished` left an invisible Modal eating
    // every touch. A re-open stops it with visibleRef already true.
    Animated.timing(y, { toValue: winH, duration: 220, useNativeDriver: NATIVE_DRIVER }).start(() => {
      if (!visibleRef.current) { setMounted(false); setRegistered(false) }
    })
  }, [visible])
  useEffect(() => { if (mounted && visible) springBack() }, [mounted, visible])

  // Created once, so it reads the live props through this ref.
  const live = useRef({ onClose, dismissible })
  live.current = { onClose, dismissible }
  const pan = useRef(
    PanResponder.create({
      // Claim on START: inside a native Modal a touch that begins on the grabber or
      // title bubbles to the Modal host, and move negotiation then never reaches this
      // View. Header Pressables are deeper, so they still win their taps. No gesture
      // while closing — it would stop the slide-out.
      onStartShouldSetPanResponder: () => visibleRef.current,
      // 10 (not 4): a tap that drifts a few points must not steal Save/Add/✕.
      onMoveShouldSetPanResponder: (_, g) => visibleRef.current && Math.abs(g.dy) > 10 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderGrant: () => y.stopAnimation(),
      // Follow the finger when it may close; rubber-band when it can't.
      onPanResponderMove: (_, g) => {
        if (visibleRef.current) y.setValue(Math.max(0, live.current.dismissible ? g.dy : g.dy * 0.3))
      },
      onPanResponderRelease: (_, g) => {
        if (!visibleRef.current) return // closed mid-drag: let the slide-out finish
        const out = g.dy > Math.min(120, 0.3 * sheetH.current) || (g.vy > 1.2 && g.dy > 0)
        if (out) live.current.onClose()
        // Dismissible + out: the parent flips `visible` and the slide-out continues from the finger.
        if (!out || !live.current.dismissible) springBack()
      },
      onPanResponderTerminate: () => { if (visibleRef.current) springBack() },
    })
  ).current
  const scrim = useMemo(() => y.interpolate({ inputRange: [0, winH], outputRange: [1, 0], extrapolate: 'clamp' }), [winH])

  const header = title || leading || trailing || onBack ? (
    <View style={styles.header}>
      <View style={styles.side}>
        {onBack ? <HeaderIcon icon="chevron-left" size={28} label="Back" onPress={onBack} /> : leading}
      </View>
      {title ? (
        <Text numberOfLines={2} style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      ) : null}
      <View style={[styles.side, styles.sideEnd, !title && { flex: 0 }]}>
        {trailing ?? (title ? <HeaderIcon icon="close" label="Close" onPress={onClose} /> : null)}
      </View>
    </View>
  ) : null

  if (nativePage) {
    return (
      <Modal
        visible={visible}
        presentationStyle="pageSheet"
        animationType="slide"
        allowSwipeDismissal={dismissible}
        // ALWAYS onClose (never onBack): a completed swipe also lands here, after
        // the sheet is already gone, and the parent must then set visible=false.
        onRequestClose={onClose}
        onDismiss={() => { if (!visibleRef.current) setRegistered(false) }}
        backdropColor={colors.background}
      >
        {/* Native SafeAreaView: measures the sheet's own window, not the root's. */}
        <SafeAreaView
          edges={['bottom']}
          onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
          style={[styles.page, { backgroundColor: colors.background }]}
        >
          <SheetWidth.Provider value={width}>
            {header}
            <View style={{ flex: 1 }}>{children}</View>
          </SheetWidth.Provider>
        </SafeAreaView>
      </Modal>
    )
  }

  return (
    <Modal visible={mounted} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={onBack ?? onClose}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: SCRIM, opacity: scrim }]}>
        {/* Sibling BEHIND the sheet — wrapping the content in it would steal its scroll. */}
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.anchor} pointerEvents="box-none">
        <Animated.View
          onLayout={(e) => {
            sheetH.current = e.nativeEvent.layout.height
            setWidth(e.nativeEvent.layout.width)
          }}
          style={[
            styles.sheet,
            variant === 'page' ? { height: '92%' } : { maxHeight: '90%' },
            { backgroundColor: colors.background, borderColor: colors.border, transform: [{ translateY: y }] },
          ]}
        >
          <SheetWidth.Provider value={width}>
            {/* The ONLY drag zone: content scroll, Sliders and the ColorWheel never fight it. */}
            <View {...pan.panHandlers}>
              <View style={[styles.grabber, { backgroundColor: colors.border }]} />
              {header}
            </View>
            <View style={variant === 'page' ? { flex: 1 } : { flexShrink: 1 }}>{children}</View>
            <SafeAreaView edges={['bottom']} />
          </SheetWidth.Provider>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

// ui.tsx's IconButton, inlined: ui.tsx imports Sheet (Select), so importing it back is a require cycle.
function HeaderIcon({ icon, label, size = 24, onPress }: { icon: 'close' | 'chevron-left'; label: string; size?: number; onPress: () => void }) {
  const colors = useTheme((s) => s.colors)
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 4 })}>
      <MaterialIcons name={icon} size={size} color={colors.foreground} />
    </Pressable>
  )
}

/** Text button for a sheet header (Cancel / Save / Add). `prominent` = the sand primary pill. */
export function SheetButton({ title, onPress, prominent, disabled, loading }: { title: string; onPress: () => void; prominent?: boolean; disabled?: boolean; loading?: boolean }) {
  const colors = useTheme((s) => s.colors)
  const fg = prominent ? colors.primaryForeground : colors.foreground
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.btn,
        prominent ? { backgroundColor: colors.primary, paddingHorizontal: spacing.md } : null,
        { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <Text style={{ color: fg, fontSize: font.size.md, fontWeight: prominent ? font.weight.semibold : font.weight.medium }}>{title}</Text>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, paddingTop: spacing.sm },
  anchor: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderBottomWidth: 0,
    overflow: 'hidden',
  },
  grabber: { width: 36, height: 5, borderRadius: 2.5, alignSelf: 'center', marginTop: spacing.sm, marginBottom: spacing.xs },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, minHeight: 52 },
  side: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md }, // gap: keeps a neighbour's hitSlop off the icon beside it
  sideEnd: { justifyContent: 'flex-end' },
  title: { flex: 2, textAlign: 'center', fontSize: font.size.lg, fontWeight: font.weight.semibold },
  btn: { minHeight: 34, paddingHorizontal: spacing.xs, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
})
