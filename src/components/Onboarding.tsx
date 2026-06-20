import React, { useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { MaterialIcons } from '@expo/vector-icons'
import { normalizeBase, testBoard } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useTheme } from '../stores/useTheme'
import { toast } from '../stores/useToast'
import { Button } from './ui'
import { radius, spacing, font } from '../theme'

export function Onboarding() {
  const colors = useTheme((s) => s.colors)
  const addBoard = useBoards((s) => s.addBoard)
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [busy, setBusy] = useState(false)

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
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.wrap}>
        <MaterialIcons name="blur-circular" size={64} color={colors.primary} />
        <Text style={[styles.title, { color: colors.foreground }]}>Dune Weaver</Text>
        <Text style={[styles.sub, { color: colors.mutedForeground }]}>
          Connect to your sand table on the local network.
        </Text>
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
          <Button title="Connect" icon="wifi-tethering" loading={busy} onPress={connect} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  title: { fontSize: font.size.xxl, fontWeight: font.weight.bold },
  sub: { fontSize: font.size.md, textAlign: 'center', marginBottom: spacing.lg },
  form: { alignSelf: 'stretch', gap: spacing.md },
  input: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 48, fontSize: font.size.md },
})
