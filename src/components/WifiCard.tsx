// Settings card: the table's Wi-Fi (firmware >= v0.1.8, which registers the
// captive-portal routes in every mode). Shows how the table is connected,
// moves it to another home network (scan -> pick -> password -> reboot-wait),
// or flips it to standalone hotspot mode. Also works while the phone is
// joined to the table's own hotspot (fallback setup / standalone), where the
// table answers on 192.168.0.1.

import React, { useCallback, useRef, useState } from 'react'
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MaterialIcons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { board, type WifiNetwork, type WifiStatus } from '../api/board'
import { isDemoBase } from '../api/demoBoard'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { toast } from '../stores/useToast'
import { connectTableToWifi, switchTableToStandalone, WIFI_AP_BASE, type WifiSetupStage } from '../lib/wifiSetup'
import { Button, Card, CardTitle, IconButton } from './ui'
import { radius, spacing, font } from '../theme'

type CardState = 'loading' | 'ok' | 'unsupported' | 'offline'

/** Wi-Fi routes answer JSON; an HTTP error or an HTML body (parse failure)
 * means the firmware predates them, anything else means we can't reach the
 * table at all. */
function probeFailureState(e: unknown): CardState {
  const msg = (e as Error)?.message ?? ''
  return /^HTTP \d/.test(msg) || /JSON/i.test(msg) ? 'unsupported' : 'offline'
}

function signalIcon(rssi: number): keyof typeof MaterialIcons.glyphMap {
  return rssi > -55 ? 'wifi' : rssi > -70 ? 'wifi-2-bar' : 'wifi-1-bar'
}

export function WifiCard({ base }: { base: string | null }) {
  const colors = useTheme((s) => s.colors)
  const activeId = useBoards((s) => s.activeId)
  const updateBase = useBoards((s) => s.updateBase)

  const [state, setState] = useState<CardState>('loading')
  const [info, setInfo] = useState<WifiStatus | null>(null)

  // Network picker sheet.
  const [pickerOpen, setPickerOpen] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [networks, setNetworks] = useState<WifiNetwork[]>([])
  const [ssid, setSsid] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [stage, setStage] = useState<WifiSetupStage | null>(null)
  const [standaloneBusy, setStandaloneBusy] = useState(false)
  // Bumps to orphan in-flight scan polls when the sheet closes or re-scans.
  const scanGen = useRef(0)

  const load = useCallback(async () => {
    if (!base) return
    try {
      setInfo(await board.wifiStatus(base))
      setState('ok')
    } catch (e) {
      setState(probeFailureState(e))
    }
  }, [base])

  useFocusEffect(
    useCallback(() => {
      setState('loading')
      void load()
    }, [load])
  )

  // Poll /wifi_scan until the async scan finishes ({status:"scanning"} -> ok).
  const startScan = useCallback(
    (fresh: boolean) => {
      if (!base) return
      const gen = ++scanGen.current
      setScanning(true)
      const poll = async (rescan: boolean) => {
        try {
          const r = await board.wifiScan(base, rescan)
          if (gen !== scanGen.current) return
          if (r.status === 'ok') {
            setNetworks([...r.aps].sort((a, b) => b.rssi - a.rssi))
            setScanning(false)
            return
          }
        } catch {
          // transient (the board is mid-scan or briefly busy) — keep polling
        }
        if (gen === scanGen.current) setTimeout(() => void poll(false), 2000)
      }
      void poll(fresh)
    },
    [base]
  )

  const openPicker = () => {
    setSsid('')
    setPassword('')
    setShowPw(false)
    setNetworks([])
    setPickerOpen(true)
    // The board's web server is single-threaded and the radio goes AP_STA
    // mid-scan — the 1s status poller queuing against the scan polls wedges
    // it (requests start timing out). Pause it while the sheet is open, like
    // pattern pushes do; the last status stays on screen.
    useStatus.getState().suspend()
    startScan(true)
  }

  /** Close the sheet and restart the status poller. */
  const finishPicker = () => {
    scanGen.current++
    setPickerOpen(false)
    useStatus.getState().resume()
  }

  const closePicker = () => {
    if (stage) return // mid-save: the table is committing/rebooting
    finishPicker()
  }

  const ssidOk = ssid.trim().length >= 1 && ssid.trim().length <= 32
  const passwordOk = password.length >= 8 && password.length <= 64

  const connect = () => {
    if (!base || !info) return
    const target = ssid.trim()
    Alert.alert(
      'Connect table to Wi-Fi',
      `Connect the table to “${target}”? It restarts and joins that network (~1 minute). If that isn’t the Wi-Fi this phone is on, join it afterwards to keep controlling the table.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Connect',
          onPress: async () => {
            setStage('saving')
            try {
              const outcome = await connectTableToWifi(base, target, password, setStage)
              finishPicker()
              if (outcome === 'connected') {
                toast.success(`Table is on “${target}”`)
              } else {
                Alert.alert(
                  'Table not back yet',
                  `The table restarted but hasn’t reappeared on this network.\n\n• If “${target}” is a different Wi-Fi, join it with this phone — the app re-finds the table automatically.\n• If the password was wrong, the table’s own “${info.ap_ssid}” hotspot comes back — join it to try again.`
                )
              }
              void load()
            } catch (e) {
              toast.error((e as Error).message || 'Could not save Wi-Fi settings')
            } finally {
              setStage(null)
            }
          },
        },
      ]
    )
  }

  const goStandalone = () => {
    if (!base || !info) return
    Alert.alert(
      'Use standalone hotspot',
      `The table stops using home Wi-Fi and broadcasts its own network “${info.ap_ssid}” instead. To control it, join that network with this phone.${info.mode === 'sta' ? ' The table restarts now.' : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Switch',
          onPress: async () => {
            setStandaloneBusy(true)
            try {
              const { reboot } = await switchTableToStandalone(base)
              if (reboot) {
                // The table is leaving this network — repoint its saved
                // address at the hotspot's fixed IP so the app works the
                // moment the phone joins it.
                if (activeId && !isDemoBase(base)) updateBase(activeId, WIFI_AP_BASE)
                Alert.alert(
                  'Switching to hotspot',
                  `The table is restarting into its own Wi-Fi network. Join “${info.ap_ssid}” in this phone’s Wi-Fi settings — the app is already pointed at the hotspot address (${WIFI_AP_BASE.replace(/^https?:\/\//, '')}).`
                )
              } else {
                toast.success('Standalone mode is on')
              }
              void load()
            } catch (e) {
              toast.error((e as Error).message || 'Could not switch to standalone mode')
            } finally {
              setStandaloneBusy(false)
            }
          },
        },
      ]
    )
  }

  if (!base) return null

  const modeTitle =
    info?.mode === 'sta' ? 'Home Wi-Fi'
    : info?.mode === 'standalone' ? 'Standalone hotspot'
    : 'Setup hotspot'
  const modeDetail =
    info?.mode === 'sta' ? `Connected to “${info.sta_ssid}”`
    : info?.mode === 'standalone' ? `The table broadcasts “${info?.ap_ssid}” and stays off home Wi-Fi.`
    : `Home Wi-Fi isn’t connected — the table broadcasts “${info?.ap_ssid}” for setup.`
  const modeIcon: keyof typeof MaterialIcons.glyphMap =
    info?.mode === 'sta' ? 'wifi' : info?.mode === 'standalone' ? 'wifi-tethering' : 'wifi-tethering-error'

  return (
    <Card>
      <CardTitle>Wi-Fi</CardTitle>

      {state === 'loading' ? (
        <View style={styles.row}>
          <ActivityIndicator size="small" color={colors.mutedForeground} />
          <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>Checking the table’s Wi-Fi…</Text>
        </View>
      ) : state === 'unsupported' ? (
        <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>
          Wi-Fi controls need firmware v0.1.8 or newer — update the table in the About section below.
        </Text>
      ) : state === 'offline' ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>
            Couldn’t reach the table to read its Wi-Fi state.
          </Text>
          <Button title="Retry" icon="refresh" variant="secondary" onPress={() => { setState('loading'); void load() }} />
        </View>
      ) : info ? (
        <View style={{ gap: spacing.md }}>
          <View style={styles.row}>
            <MaterialIcons name={modeIcon} size={22} color={info.mode === 'fallback' ? colors.destructive : colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>{modeTitle}</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>{modeDetail}</Text>
            </View>
          </View>

          {info.fail ? (
            <Text style={{ color: colors.destructive, fontSize: font.size.xs }}>
              Couldn’t join “{info.sta_ssid}”: {info.fail}
            </Text>
          ) : null}

          <Button
            title={info.mode === 'sta' ? 'Change Wi-Fi network' : 'Connect to home Wi-Fi'}
            icon="wifi-password"
            variant="secondary"
            onPress={openPicker}
          />
          {info.mode !== 'standalone' ? (
            <Button
              title="Use standalone hotspot"
              icon="wifi-tethering"
              variant="ghost"
              loading={standaloneBusy}
              onPress={goStandalone}
            />
          ) : null}
          <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>
            Standalone mode lets the table run without a router — it makes its own Wi-Fi network you join directly.
          </Text>
        </View>
      ) : null}

      {/* Network picker sheet */}
      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={closePicker}>
        {/* Lift the sheet above the keyboard so the password field and Connect
            button stay visible while typing (bottom-anchored sheet otherwise
            sits behind the keyboard). Tap-outside-to-close is the flex spacer. */}
        <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={{ flex: 1 }} onPress={closePicker} />
          <Pressable style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              <Text style={{ color: colors.foreground, fontSize: font.size.lg, fontWeight: font.weight.semibold, flex: 1 }}>
                Connect to Wi-Fi
              </Text>
              <IconButton
                icon="refresh"
                size={22}
                color={scanning ? colors.mutedForeground : colors.primary}
                onPress={() => { if (!scanning && !stage) { setNetworks([]); startScan(true) } }}
              />
            </View>

            {scanning ? (
              <View style={[styles.row, { paddingVertical: spacing.md }]}>
                <ActivityIndicator size="small" color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>Scanning for networks…</Text>
              </View>
            ) : networks.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, paddingVertical: spacing.md }}>
                No networks found — move the table closer to the router and rescan.
              </Text>
            ) : (
              <FlatList
                data={networks}
                keyExtractor={(n) => n.ssid}
                style={{ flexGrow: 0, maxHeight: 260 }}
                renderItem={({ item }) => {
                  const selected = item.ssid === ssid
                  return (
                    <Pressable
                      onPress={() => { if (item.secure) setSsid(item.ssid) }}
                      style={[styles.netRow, { borderBottomColor: colors.border, opacity: item.secure ? 1 : 0.45 }]}
                    >
                      <MaterialIcons name={signalIcon(item.rssi)} size={20} color={selected ? colors.primary : colors.mutedForeground} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: selected ? colors.primary : colors.foreground, fontWeight: selected ? font.weight.semibold : font.weight.regular }}>
                          {item.ssid}
                        </Text>
                        {!item.secure ? (
                          <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>Open network — not supported</Text>
                        ) : null}
                      </View>
                      {item.secure ? <MaterialIcons name="lock" size={16} color={colors.mutedForeground} /> : null}
                      {selected ? <MaterialIcons name="check" size={20} color={colors.primary} /> : null}
                    </Pressable>
                  )
                }}
              />
            )}

            <TextInput
              value={ssid}
              onChangeText={setSsid}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="Network name (or pick one above)"
              placeholderTextColor={colors.mutedForeground}
              editable={!stage}
              style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground }]}
            />
            <View style={styles.pwRow}>
              <TextInput
                value={password}
                onChangeText={setPassword}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry={!showPw}
                textContentType="none"
                autoComplete="off"
                placeholder="Password (8–64 characters)"
                placeholderTextColor={colors.mutedForeground}
                editable={!stage}
                style={[styles.input, { flex: 1, backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground }]}
              />
              <IconButton
                icon={showPw ? 'visibility-off' : 'visibility'}
                size={22}
                color={colors.mutedForeground}
                onPress={() => setShowPw((v) => !v)}
              />
            </View>

            <Button
              title={stage === 'saving' ? 'Sending…' : stage === 'rebooting' ? 'Restarting table…' : 'Connect table'}
              icon={stage ? undefined : 'wifi'}
              loading={stage != null}
              disabled={!ssidOk || !passwordOk}
              onPress={connect}
            />
            {stage === 'rebooting' ? (
              <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, textAlign: 'center' }}>
                Keep the app open — waiting for the table to come back (~1 minute).
              </Text>
            ) : null}
            <SafeAreaView edges={['bottom']} />
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </Card>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 28 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '85%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, paddingTop: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, gap: spacing.sm },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#888', alignSelf: 'center', marginBottom: spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  netRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, borderBottomWidth: 1 },
  input: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 46, fontSize: font.size.md },
  pwRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
})
