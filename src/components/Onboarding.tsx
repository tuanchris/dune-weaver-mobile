import React, { useEffect, useState } from 'react'
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MaterialIcons } from '@expo/vector-icons'
import { normalizeBase, testBoard } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useBranding, brandName } from '../stores/useBranding'
import { useTheme } from '../stores/useTheme'
import { toast } from '../stores/useToast'
import { useDiscovery, type DiscoveredTable } from '../lib/discovery'
import { Button } from './ui'
import { radius, spacing, font } from '../theme'

export function Onboarding() {
  const colors = useTheme((s) => s.colors)
  const addBoard = useBoards((s) => s.addBoard)
  const addDemoBoard = useBoards((s) => s.addDemoBoard)
  const brand = useBranding((s) => s.name)
  const logoUri = useBranding((s) => s.logoUri)
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [busy, setBusy] = useState(false)

  // mDNS discovery — kick off a scan as soon as the welcome screen appears so
  // tables show up without the user having to know their IP.
  const { available: discoveryAvailable, scanning, tables: found, start, stop } = useDiscovery()
  useEffect(() => {
    if (discoveryAvailable) start()
  }, [discoveryAvailable, start])

  const addDiscovered = (t: DiscoveredTable) => {
    addBoard(t.name, t.base)
    toast.success(`Connected to ${t.name}`)
  }

  const connect = async () => {
    if (!host.trim()) {
      toast.error('Enter your table’s IP or hostname')
      return
    }
    setBusy(true)
    try {
      const ok = await testBoard(normalizeBase(host))
      if (!ok) {
        toast.error('Could not reach that table. Check the IP and that you’re on the same Wi-Fi.')
        return
      }
      addBoard(name, host)
      toast.success('Connected')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
          <Image source={logoUri ? { uri: logoUri } : require('../../assets/dw-logo.png')} style={styles.brandLogo} />
          <Text style={[styles.title, { color: colors.foreground }]}>{brandName(brand)}</Text>
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            Connect to your sand table on the local network.
          </Text>

          <View style={styles.form}>
            <Button
              title="Try demo mode — no table needed"
              icon="play-circle-outline"
              variant="secondary"
              onPress={() => {
                addDemoBoard()
                toast.success('Demo table ready — explore the app')
              }}
            />
          </View>

          {discoveryAvailable ? (
            <View style={styles.form}>
              <Button
                title={scanning ? 'Scanning…' : 'Search Wi-Fi for tables'}
                icon={scanning ? undefined : 'wifi-find'}
                loading={scanning && found.length === 0}
                onPress={scanning ? stop : start}
              />
              {found.map((t) => (
                <Pressable
                  key={t.key}
                  onPress={() => addDiscovered(t)}
                  style={[styles.foundRow, { borderColor: colors.border, backgroundColor: colors.cardElevated }]}
                >
                  <MaterialIcons name="cast-connected" size={22} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>{t.name}</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>{t.base}</Text>
                  </View>
                  <MaterialIcons name="add" size={22} color={colors.primary} />
                </Pressable>
              ))}
              {found.length === 0 ? (
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, textAlign: 'center' }}>
                  {scanning
                    ? 'Looking for tables on your Wi-Fi…'
                    : 'No tables found yet — make sure the phone and table share the same Wi-Fi, or add one below.'}
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.divider}>
            <View style={[styles.line, { backgroundColor: colors.border }]} />
            <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>or enter manually</Text>
            <View style={[styles.line, { backgroundColor: colors.border }]} />
          </View>

          <View style={styles.form}>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Name (optional)"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground }]}
            />
            <TextInput
              value={host}
              onChangeText={setHost}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="IP or host (e.g. 192.168.68.160)"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground }]}
            />
            <Button title="Connect" icon="wifi-tethering" variant={discoveryAvailable ? 'secondary' : undefined} loading={busy} onPress={connect} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  wrap: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  brandLogo: { width: 72, height: 72, borderRadius: 16 },
  title: { fontSize: font.size.xxl, fontWeight: font.weight.bold },
  sub: { fontSize: font.size.md, textAlign: 'center', marginBottom: spacing.lg },
  form: { alignSelf: 'stretch', gap: spacing.md },
  foundRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, borderRadius: radius.md, borderWidth: 1, padding: spacing.md },
  divider: { flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', gap: spacing.md, marginVertical: spacing.lg },
  line: { flex: 1, height: 1 },
  input: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 48, fontSize: font.size.md },
})
