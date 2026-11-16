import React, { useCallback, useState } from 'react'
import { Alert, Linking, StyleSheet, Text, View } from 'react-native'
import { useFocusEffect, useNavigation, type NavigationProp } from '@react-navigation/native'
import type { TabParamList } from '../../navigation'
import { setHubAutoDownload, useHubVisible } from '../../lib/patternHub'
import { useIsRect } from '../../components/RectTable'
import { useTheme } from '../../stores/useTheme'
import { toast } from '../../stores/useToast'
import { usePrefs } from '../../stores/usePrefs'
import { userMessage } from '../../lib/errors'
import { SITE, refreshAccount, signIn, signOut, useHubAccount } from '../../lib/hubAuth'
import { Button, Card, CardTitle, Toggle } from '../../components/ui'
import { SettingsPage } from './SettingsPage'
import { spacing, font } from '../../theme'

/** The duneweaver.com account behind Pattern Hub downloads (lib/hubAuth.ts).
 * No purchase wording and no shop links here (App Store 3.1.1 / 3.1.3). The
 * Settings row that opens it is hidden on desktop. */
export function AccountSettings(): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const { state, email } = useHubAccount()
  const [signingIn, setSigningIn] = useState(false)
  const [checking, setChecking] = useState(false)
  const navigation = useNavigation<NavigationProp<TabParamList>>()
  // Where the patterns are: Browse's Pattern Hub tab (round tables, once launched).
  const hubVisible = useHubVisible()
  const rect = useIsRect()
  const showHub = hubVisible && !rect
  // Re-read on every visit: a plan bought on the site since, or a launch that
  // was offline (still 'unknown'), shows here without restarting the app.
  useFocusEffect(
    useCallback(() => {
      setChecking(true)
      void refreshAccount().finally(() => setChecking(false))
    }, []),
  )

  const doSignIn = async () => {
    setSigningIn(true)
    try {
      await signIn()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSigningIn(false)
    }
  }

  const muted = [styles.text, { color: colors.mutedForeground }]

  // The hub's auto-download: set once, so it lives here rather than over the hub's grid.
  const hubAuto = usePrefs((s) => s.hubAuto)
  const [switching, setSwitching] = useState(false)
  const switchAuto = (on: boolean) => {
    setSwitching(true)
    setHubAutoDownload(on)
      .catch((e: unknown) => toast.error(userMessage(e, 'reach the Pattern Hub')))
      .finally(() => setSwitching(false))
  }

  // Only 'signedOut' offers Sign in. 'unknown' past the launch read means a
  // refresh token is stored but /me hasn't answered (offline, table-only Wi-Fi,
  // a site error): the user is still signed in, so it shows as signed in.
  if (state === 'signedOut') {
    return (
      <SettingsPage title="duneweaver.com">
        <Card>
          <Text style={muted}>Pattern Hub is for every Dune Weaver plan owner. Sign in with your duneweaver.com account to sync its patterns to your phone and table.</Text>
          <Button title="Sign in" icon="login" loading={signingIn} onPress={doSignIn} />
        </Card>
      </SettingsPage>
    )
  }

  return (
    <SettingsPage title="duneweaver.com">
      <Card>
        {email ? <Text numberOfLines={2} style={[styles.email, { color: colors.foreground }]}>{email}</Text> : null}
        {state === 'member' ? (
          <Text style={muted}>Plan owner</Text>
        ) : state === 'notMember' ? (
          <>
            <Text style={muted}>Pattern Hub downloads are for Dune Weaver plan owners.</Text>
            <Text style={muted}>Use the duneweaver.com account your plan is under.</Text>
          </>
        ) : (
          <Text style={muted}>{checking ? 'Checking your duneweaver.com account…' : 'Signed in. Can’t reach duneweaver.com right now.'}</Text>
        )}
        <View style={styles.actions}>
          {showHub ? (
            <Button title="Open Pattern Hub" icon="public" onPress={() => navigation.navigate('Browse', { tab: 'hub' })} />
          ) : null}
          <Button title="Sign out" icon="logout" variant="secondary" onPress={() => void signOut().catch(() => toast.error('Couldn’t sign out. Try again.'))} />
        </View>
      </Card>
      {showHub && state === 'member' ? (
        <Card>
          <CardTitle>Pattern Hub</CardTitle>
          <View style={styles.row}>
            <View style={{ flex: 1, paddingRight: spacing.md }}>
              <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>Download new patterns</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>
                Patterns added to the hub come to this phone when the app opens. Not to the table.
              </Text>
            </View>
            <Toggle value={hubAuto} onValueChange={switchAuto} disabled={switching} />
          </View>
        </Card>
      ) : null}
      {/* Its own card at the foot of the page, away from Sign out, and confirmed first:
          a slip shouldn't start a deletion (App Review 5.1.1(v) still wants it findable). */}
      <Card>
        <Text style={[muted, styles.text]}>Deleting your duneweaver.com account is permanent. You confirm it on duneweaver.com.</Text>
        <Button title="Delete account…" icon="delete-outline" variant="destructive" onPress={confirmDelete} />
      </Card>
    </SettingsPage>
  )
}

function confirmDelete(): void {
  Alert.alert('Delete your duneweaver.com account?', 'This can’t be undone. duneweaver.com opens next, where you confirm the deletion.', [
    { text: 'Cancel', style: 'cancel' },
    {
      text: 'Continue',
      style: 'destructive',
      onPress: () => void Linking.openURL(`${SITE}/account/delete`).catch(() => toast.error('Couldn’t open duneweaver.com')),
    },
  ])
}

const styles = StyleSheet.create({
  text: { fontSize: font.size.sm, marginBottom: spacing.md },
  email: { fontSize: font.size.md, fontWeight: font.weight.medium, marginBottom: spacing.xs },
  actions: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
})
