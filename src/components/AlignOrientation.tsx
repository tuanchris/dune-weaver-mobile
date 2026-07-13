import React, { useRef, useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MaterialIcons } from '@expo/vector-icons'
import Svg, { Circle } from 'react-native-svg'
import { board } from '../api/board'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { toast } from '../stores/useToast'
import { userMessage } from '../lib/errors'
import { Button, IconButton } from './ui'
import { radius, spacing, font } from '../theme'

const DEG = Math.PI / 180
const DIAGRAM = 190

/**
 * Crash-homing orientation alignment (mirrors dw's "Pattern Orientation
 * Alignment" dialog). Crash homing never moves theta — whatever direction the
 * arm points when the table homes BECOMES theta=0, so pattern orientation is
 * set physically: nudge the ball to the table's "East" (a quarter turn left of
 * where you stand), then home. Nudges are absolute /sand_goto?theta= jogs
 * seeded from the live status theta, same as dw's rotate buttons.
 */
export function AlignOrientation({ base }: { base: string }) {
  const colors = useTheme((s) => s.colors)
  const status = useStatus((s) => s.status)
  const refresh = useStatus((s) => s.refresh)
  const [open, setOpen] = useState(false)
  const [homing, setHoming] = useState(false)

  const isAlarm = status?.state === 'Alarm'
  // Nudges need Idle (goto is idle-gated); Jog counts too so taps can queue up
  // while the previous nudge is still finishing.
  const canNudge = !isAlarm && (status?.state === 'Idle' || status?.state === 'Jog') && !status?.playlist
  const canHome = !!status && !status.isRunning && !status.isPaused && !status.isHoming

  // Taps accumulate into a target angle; one pump loop pushes the latest value,
  // retrying while the previous jog is still running (the firmware answers 409
  // until it's Idle again). Keeps rapid taps responsive instead of erroring.
  const targetRef = useRef<number | null>(null)
  const pumping = useRef(false)

  const nudge = (deg: number) => {
    const cur = targetRef.current ?? useStatus.getState().status?.theta ?? 0
    targetRef.current = cur + deg * DEG
    void pump()
  }

  const pump = async () => {
    if (pumping.current) return
    pumping.current = true
    try {
      let sent: number | null = null
      let waitedMs = 0
      while (targetRef.current != null && targetRef.current !== sent) {
        sent = targetRef.current
        try {
          await board.rotateTo(base, sent)
          waitedMs = 0
        } catch (e) {
          if (!/http 409/i.test((e as Error)?.message ?? '') || waitedMs > 15000) throw e
          await new Promise((r) => setTimeout(r, 400))
          waitedMs += 400
          sent = null // resend (possibly updated) target
        }
      }
    } catch (e) {
      toast.error(userMessage(e, 'rotate the arm'))
      targetRef.current = null
    } finally {
      pumping.current = false
    }
  }

  // Homing re-declares the current arm angle as theta=0 (crash mode), so the
  // accumulated nudge frame is stale afterwards — drop it.
  const home = async (finish: boolean) => {
    setHoming(true)
    try {
      await board.home(base)
      targetRef.current = null
      setTimeout(refresh, 400)
      if (finish) {
        setOpen(false)
        toast.success('Orientation set — homing now')
      } else {
        toast.success('Homing')
      }
    } catch (e) {
      toast.error(userMessage(e, 'home the table'))
    } finally {
      setHoming(false)
    }
  }

  const toEdge = async () => {
    try {
      await board.moveToPerimeter(base)
      toast.success('Moving to the edge')
    } catch (e) {
      toast.error(userMessage(e, 'move the ball'))
    }
  }

  const close = () => {
    targetRef.current = null
    setOpen(false)
  }

  const c = DIAGRAM / 2
  const ringR = c - 12

  return (
    <View>
      <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginBottom: spacing.sm }}>
        With crash homing, patterns are oriented by where the arm points when the table homes. Align it once so patterns come out matching their previews.
      </Text>
      <Button title="Align pattern orientation" icon="screen-rotation" variant="secondary" onPress={() => setOpen(true)} />

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]} onPress={() => {}}>
            <View style={styles.header}>
              <View style={{ width: 32 }} />
              <Text style={{ color: colors.foreground, fontSize: font.size.lg, fontWeight: font.weight.semibold }}>Align orientation</Text>
              <IconButton icon="close" size={26} color={colors.foreground} onPress={close} />
            </View>

            <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.lg }}>
              {/* Table seen from above, viewer at the bottom. Target = 3 o'clock,
                  i.e. theta=0 in the preview frame (dw's "arm points East"). */}
              <View style={{ alignItems: 'center', marginVertical: spacing.sm }}>
                <View style={{ width: DIAGRAM, height: DIAGRAM }}>
                  <Svg width={DIAGRAM} height={DIAGRAM}>
                    <Circle cx={c} cy={c} r={ringR} stroke={colors.border} strokeWidth={2} fill={colors.cardElevated} />
                    <Circle cx={c + ringR - 9} cy={c} r={9} fill={colors.primary} />
                  </Svg>
                  <View style={[styles.youMarker, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <MaterialIcons name="person" size={16} color={colors.mutedForeground} />
                    <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>You</Text>
                  </View>
                </View>
              </View>

              {[
                'Stand where you normally look at the table from.',
                'Use the arrows to walk the ball around the edge until it sits directly to your RIGHT (the highlighted spot). You can also nudge the arm by hand.',
                'Tap “Set orientation” — the table homes and locks that in as the pattern reference.',
              ].map((step, i) => (
                <View key={i} style={styles.stepRow}>
                  <View style={[styles.stepBadge, { backgroundColor: colors.cardElevated, borderColor: colors.border }]}>
                    <Text style={{ color: colors.foreground, fontSize: font.size.xs, fontWeight: font.weight.semibold }}>{i + 1}</Text>
                  </View>
                  <Text style={{ flex: 1, color: colors.mutedForeground, fontSize: font.size.sm }}>{step}</Text>
                </View>
              ))}

              {isAlarm ? (
                <View style={{ marginTop: spacing.md }}>
                  <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginBottom: spacing.sm }}>
                    The table hasn’t homed since power-on — home it once first so the ball can be moved.
                  </Text>
                  <Button title="Home first" icon="home" loading={homing} onPress={() => home(false)} />
                </View>
              ) : (
                <>
                  <View style={styles.nudgeRow}>
                    {([
                      ['rotate-left', -45, '45°'],
                      ['rotate-left', -10, '10°'],
                      ['rotate-right', 10, '10°'],
                      ['rotate-right', 45, '45°'],
                    ] as const).map(([icon, deg, label], i) => (
                      <Pressable
                        key={i}
                        onPress={() => nudge(deg)}
                        disabled={!canNudge}
                        style={({ pressed }) => [
                          styles.nudgeBtn,
                          { backgroundColor: colors.cardElevated, borderColor: colors.border, opacity: !canNudge ? 0.45 : pressed ? 0.7 : 1 },
                        ]}
                      >
                        <MaterialIcons name={icon} size={22} color={colors.foreground} />
                        <Text style={{ color: colors.foreground, fontSize: font.size.xs, fontWeight: font.weight.medium }}>{label}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Button title="Move ball to the edge" icon="trip-origin" variant="secondary" disabled={!canNudge} onPress={toEdge} style={{ marginTop: spacing.sm }} />
                  <Button title="Set orientation (homes the table)" icon="check" loading={homing} disabled={!canHome} onPress={() => home(true)} style={{ marginTop: spacing.sm }} />

                  {!canNudge ? (
                    <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginTop: spacing.sm, textAlign: 'center' }}>
                      The table is busy — stop the current pattern to align.
                    </Text>
                  ) : null}
                </>
              )}
            </ScrollView>
            <SafeAreaView edges={['bottom']} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  youMarker: {
    position: 'absolute', bottom: -2, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 2,
    paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1,
  },
  stepRow: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md, alignItems: 'flex-start' },
  stepBadge: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  nudgeRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  nudgeBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, height: 60, borderRadius: radius.md, borderWidth: 1 },
})
