import React, { useCallback, useEffect, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, TextInput, View, Pressable } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import Constants from 'expo-constants'
import { board, normalizeBase, testBoard } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTheme } from '../stores/useTheme'
import { toast } from '../stores/useToast'
import { Button, Card, CardTitle, IconButton } from '../components/ui'
import { Screen } from '../components/Screen'
import { useDiscovery, type DiscoveredTable } from '../lib/discovery'
import { radius, spacing, font } from '../theme'

export function SettingsScreen() {
  const colors = useTheme((s) => s.colors)
  const { boards, activeId, addBoard, removeBoard, setActive, getActiveBase } = useBoards()
  const base = getActiveBase()

  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [testing, setTesting] = useState(false)
  const [settings, setSettings] = useState<Record<string, string> | null>(null)

  const { available: discoveryAvailable, scanning, tables: found, start, stop } = useDiscovery()
  const knownBases = new Set(boards.map((b) => b.base))

  const addDiscovered = (t: DiscoveredTable) => {
    if (knownBases.has(t.base)) {
      toast.error('Already added')
      return
    }
    addBoard(t.name, t.base)
    toast.success(`Added ${t.name}`)
  }

  const loadSettings = useCallback(async () => {
    if (!base) return setSettings(null)
    try {
      setSettings(await board.settings(base))
    } catch {
      setSettings(null)
    }
  }, [base])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  const add = async () => {
    if (!host.trim()) {
      toast.error('Enter an IP or hostname')
      return
    }
    setTesting(true)
    try {
      const ok = await testBoard(normalizeBase(host))
      if (!ok) {
        toast.error('Could not reach that table')
        return
      }
      addBoard(name, host)
      toast.success('Table added')
      setName('')
      setHost('')
    } finally {
      setTesting(false)
    }
  }

  const reboot = () => {
    if (!base) return
    Alert.alert('Restart table', 'Reboot the controller? It needs ~25–30s to rejoin Wi-Fi.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Restart',
        style: 'destructive',
        onPress: () =>
          board
            .reboot(base)
            .then(() => toast.success('Rebooting…'))
            .catch(() => toast.error('Could not reboot')),
      },
    ])
  }

  return (
    <Screen title="Settings">
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 160, gap: spacing.lg }}>
        <Card>
          <CardTitle>Tables</CardTitle>
          {boards.length === 0 ? (
            <Text style={{ color: colors.mutedForeground, marginBottom: spacing.md }}>No tables yet. Add one below.</Text>
          ) : (
            boards.map((b) => {
              const active = b.id === activeId
              return (
                <Pressable
                  key={b.id}
                  onPress={() => setActive(b.id)}
                  style={[styles.boardRow, { borderColor: active ? colors.primary : colors.border }]}
                >
                  <MaterialIcons name={active ? 'radio-button-checked' : 'radio-button-unchecked'} size={20} color={active ? colors.primary : colors.mutedForeground} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>{b.name}</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>{b.base}</Text>
                  </View>
                  <IconButton icon="delete-outline" size={20} color={colors.mutedForeground} onPress={() => removeBoard(b.id)} />
                </Pressable>
              )
            })
          )}

          {discoveryAvailable ? (
            <View style={styles.discover}>
              <Button
                title={scanning ? 'Scanning…' : 'Find tables on Wi-Fi'}
                icon={scanning ? undefined : 'wifi-find'}
                variant="secondary"
                loading={scanning && found.length === 0}
                onPress={scanning ? stop : start}
              />
              {found.map((t) => (
                <Pressable
                  key={t.key}
                  onPress={() => addDiscovered(t)}
                  style={[styles.foundRow, { borderColor: colors.border, backgroundColor: colors.cardElevated }]}
                >
                  <MaterialIcons name="cast-connected" size={20} color={colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>{t.name}</Text>
                    <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>{t.base}</Text>
                  </View>
                  <MaterialIcons name={knownBases.has(t.base) ? 'check' : 'add'} size={22} color={knownBases.has(t.base) ? colors.success : colors.primary} />
                </Pressable>
              ))}
              {scanning && found.length > 0 ? (
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, textAlign: 'center' }}>Still scanning…</Text>
              ) : null}
              {!scanning && found.length === 0 ? (
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, textAlign: 'center' }}>
                  Tip: the phone and table must be on the same Wi-Fi.
                </Text>
              ) : null}
            </View>
          ) : null}

          <View style={styles.addForm}>
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
              placeholder="IP or host (e.g. 192.168.68.160)"
              placeholderTextColor={colors.mutedForeground}
              style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground }]}
            />
            <Button title="Test & add table" icon="add" loading={testing} onPress={add} />
          </View>
        </Card>

        <Card>
          <CardTitle>Table settings</CardTitle>
          {settings ? (
            Object.entries(settings).map(([k, v]) => (
              <View key={k} style={styles.kv}>
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>{k}</Text>
                <Text style={{ color: colors.foreground, fontSize: font.size.sm, fontWeight: font.weight.medium }}>{v}</Text>
              </View>
            ))
          ) : (
            <Text style={{ color: colors.mutedForeground }}>—</Text>
          )}
          {base ? (
            <Button title="Restart table" icon="restart-alt" variant="secondary" style={{ marginTop: spacing.md }} onPress={reboot} />
          ) : null}
        </Card>

        <Text style={{ color: colors.mutedForeground, textAlign: 'center', fontSize: font.size.xs }}>
          Dune Weaver Mobile · v{Constants.expoConfig?.version ?? '1.0.0'}
        </Text>
      </ScrollView>
    </Screen>
  )
}

const styles = StyleSheet.create({
  cardTitle: { fontSize: font.size.md, fontWeight: font.weight.semibold, marginBottom: spacing.md },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, marginBottom: spacing.sm },
  discover: { gap: spacing.sm, marginTop: spacing.sm },
  foundRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1 },
  addForm: { gap: spacing.sm, marginTop: spacing.md },
  input: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 46, fontSize: font.size.md },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, gap: spacing.md },
})
