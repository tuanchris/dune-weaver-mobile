import React, { useCallback, useEffect, useRef, useState } from 'react'
import { StyleSheet, Text, TextInput, View } from 'react-native'
import { board } from '../../api/board'
import { useTheme } from '../../stores/useTheme'
import { toast } from '../../stores/useToast'
import { userMessage } from '../../lib/errors'
import { Card, Select } from '../../components/ui'
import { SettingsPage, useActiveBase } from './SettingsPage'
import { radius, spacing, font } from '../../theme'

// The wire orders worth offering: all 6 RGB ones, and the RGBW ones with W last
// (where every common RGBW strip puts it). The firmware accepts all 30 —
// W in any slot — so a value set elsewhere is still listed as-is below.
const ORDERS = ['GRB', 'RGB', 'BRG', 'RBG', 'GBR', 'BGR', 'GRBW', 'RGBW', 'BRGW', 'RBGW', 'GBRW', 'BGRW']
const ORDER_NOTE: Record<string, string> = {
  GRB: 'GRB · most strips (WS2812B)',
  GRBW: 'GRBW · SK6812 RGBW',
}
const orderLabel = (o: string) => ORDER_NOTE[o] ?? (o.length === 4 ? `${o} · RGBW strip` : o)

/** The physical strip, set once per table: how many LEDs, and the order its
 * chips expect red, green and blue (+ white) on the wire. Moved here from the
 * LEDs tab, which is about what the strip shows, not what it is. */
export function LedStripSettings(): React.JSX.Element {
  const base = useActiveBase()
  return (
    <SettingsPage title="LED strip" table gated>
      {base ? <StripCard base={base} /> : null}
    </SettingsPage>
  )
}

function StripCard({ base }: { base: string }): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  // Text while editing; the ref is the board's value, so blurring an untouched
  // field writes nothing.
  const [count, setCount] = useState('')
  const savedCountRef = useRef(0)
  // $LED/Order is newer than $LED/Count: firmware without it gets no picker.
  const [order, setOrder] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const s = await board.settings(base)
      if (s['LED/Count'] != null) {
        savedCountRef.current = Number(s['LED/Count'])
        setCount(s['LED/Count'])
      }
      setOrder(s['LED/Order'] ? s['LED/Order'].toUpperCase() : null)
    } catch {
      // keep whatever we had
    }
  }, [base])
  useEffect(() => {
    load()
  }, [load])

  // Settings, not live keys: the board refuses them while drawing, so on any
  // failure reload to show what it really has.
  const commitCount = () => {
    const n = Math.max(1, Math.min(300, Math.round(Number(count) || 1)))
    setCount(String(n))
    if (n === savedCountRef.current) return
    board.setLedCount(base, n)
      .then(() => { savedCountRef.current = n })
      .catch((e) => {
        toast.error(userMessage(e, 'change the LED count'))
        load()
      })
  }
  const changeOrder = (next: string) => {
    setOrder(next)
    board.setLedOrder(base, next).catch((e) => {
      toast.error(userMessage(e, 'change the color order'))
      load()
    })
  }

  const options = (order && !ORDERS.includes(order) ? [...ORDERS, order] : ORDERS).map((o) => ({ value: o, label: orderLabel(o) }))

  return (
    <Card>
      <Text style={[styles.label, { color: colors.foreground }]}>Number of LEDs</Text>
      {/* onBlur, not onEndEditing: react-native-web (desktop) never fires onEndEditing. */}
      <TextInput
        value={count}
        onChangeText={(t) => setCount(t.replace(/[^0-9]/g, ''))}
        onBlur={commitCount}
        keyboardType="number-pad"
        accessibilityLabel="Number of LEDs"
        style={[styles.numInput, { color: colors.foreground, backgroundColor: colors.inputBackground, borderColor: colors.border }]}
      />
      <Text style={[styles.hint, { color: colors.mutedForeground }]}>How many LEDs your strip has (1–300).</Text>

      {order ? (
        <>
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <Text style={[styles.label, { color: colors.foreground }]}>Color order</Text>
          <Select value={order} options={options} onChange={changeOrder} />
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>
            If colors look wrong (red shows as green, say), try another order. Pick an RGBW order only for a strip with a white LED in each chip.
          </Text>
        </>
      ) : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  label: { fontSize: font.size.sm, fontWeight: font.weight.medium, marginBottom: spacing.sm },
  hint: { fontSize: font.size.sm, marginTop: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.lg },
  numInput: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, minHeight: 40, width: 90, textAlign: 'center', fontSize: font.size.md },
})
