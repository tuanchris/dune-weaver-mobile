// Settings card: the table's API password ($Sand/Password, firmware ≥ v0.1.11).
// Setting a password locks the table's CONTROL routes (run/stop/upload/update
// — reads like status and patterns stay open), and every phone that should
// keep control needs the key saved. The key is stored on the board entry
// (useBoards) and attached to all requests automatically; older firmware
// simply ignores the header, and the $Sand/Password write 404s-into-an-error
// there, which userMessage surfaces.

import React, { useState } from 'react'
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native'
import { board } from '../api/board'
import { useBoards } from '../stores/useBoards'
import { useTheme } from '../stores/useTheme'
import { toast } from '../stores/useToast'
import { userMessage } from '../lib/errors'
import { Button, Card, CardTitle } from './ui'
import { radius, spacing, font } from '../theme'

export function SecurityCard({ base }: { base: string }) {
  const colors = useTheme((s) => s.colors)
  const entry = useBoards((s) => s.boards.find((b) => b.base === base))
  const setKey = useBoards((s) => s.setKey)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)

  if (!entry) return null
  const hasKey = !!entry.key

  const validate = (): string | null => {
    const v = pw.trim()
    if (!v) {
      toast.error('Enter a password first')
      return null
    }
    if (v.length > 32) {
      toast.error('Passwords are at most 32 characters')
      return null
    }
    return v
  }

  // Lock the table (or change its password). The request carries the OLD key
  // automatically when one is saved, which is what a locked table requires.
  const setOnTable = async () => {
    const v = validate()
    if (!v) return
    setBusy(true)
    try {
      await board.setSandPassword(base, v)
      setKey(entry.id, v)
      setPw('')
      toast.success(hasKey ? 'Password changed' : 'Table locked — controls now need this password')
    } catch (e) {
      toast.error(userMessage(e, hasKey ? 'change the password' : 'set the password'))
    } finally {
      setBusy(false)
    }
  }

  // The table was locked elsewhere (another phone / the web installer): verify
  // the entered password against it and keep it on this phone only.
  const saveExisting = async () => {
    const v = validate()
    if (!v) return
    setBusy(true)
    try {
      await board.testKey(base, v)
      setKey(entry.id, v)
      setPw('')
      toast.success('Password saved — this phone can control the table again')
    } catch (e) {
      const raw = (e as Error)?.message ?? ''
      toast.error(/http 401/i.test(raw) ? 'That password doesn’t match the table’s' : userMessage(e, 'check the password'))
    } finally {
      setBusy(false)
    }
  }

  const removeFromTable = () => {
    Alert.alert('Remove password', 'Unlock the table so anyone on this Wi-Fi can control it?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          setBusy(true)
          try {
            await board.setSandPassword(base, '')
            setKey(entry.id, undefined)
            toast.success('Password removed — the table is open again')
          } catch (e) {
            toast.error(userMessage(e, 'remove the password'))
          } finally {
            setBusy(false)
          }
        },
      },
    ])
  }

  return (
    <Card>
      <CardTitle>Security</CardTitle>
      <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginBottom: spacing.md }}>
        A password locks the table’s controls (run, stop, uploads, updates) to phones that know it. Watching — status and patterns — stays open. Needs firmware v0.1.11 or newer.
      </Text>

      {hasKey ? (
        <Text style={{ color: colors.foreground, fontSize: font.size.sm, marginBottom: spacing.sm }}>
          🔒 Locked · password saved on this phone
        </Text>
      ) : null}

      <TextInput
        value={pw}
        onChangeText={setPw}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={hasKey ? 'New password' : 'Password'}
        placeholderTextColor={colors.mutedForeground}
        style={[styles.input, { backgroundColor: colors.inputBackground, borderColor: colors.border, color: colors.foreground }]}
      />
      <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
        <Button
          title={hasKey ? 'Change table password' : 'Lock table with this password'}
          icon="lock"
          loading={busy}
          onPress={() => void setOnTable()}
        />
        {hasKey ? (
          <Button title="Remove password" icon="lock-open" variant="secondary" disabled={busy} onPress={removeFromTable} />
        ) : (
          <Button title="Table already locked? Save its password" icon="key" variant="secondary" disabled={busy} onPress={() => void saveExisting()} />
        )}
      </View>
      <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginTop: spacing.sm }}>
        Forgot it? Connect over USB and send $Sand/Password= to clear it — serial is never locked.
      </Text>
    </Card>
  )
}

const styles = StyleSheet.create({
  input: { borderRadius: radius.md, borderWidth: 1, paddingHorizontal: spacing.md, height: 46, fontSize: font.size.md },
})
