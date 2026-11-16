import React, { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { useTheme } from '../stores/useTheme'
import { toast } from '../stores/useToast'
import { SignedOutError, useHubAccount } from '../lib/hubAuth'
import { castHubVote, loadHubVotes, useHubVotes } from '../lib/hubVotes'
import { spacing, font, radius } from '../theme'

const SIGN_IN = 'Sign in to vote: Settings › duneweaver.com'

/**
 * A Pattern Hub pattern's vote, as on the website: ↑ score ↓ in one pill. Your
 * vote is in sand (an action you took; never ember, which means destructive).
 */
export function HubVote({ id }: { id: string }): React.ReactElement {
  const colors = useTheme((s) => s.colors)
  // Only 'signedOut' is signed out: 'unknown' is a stored sign-in /me hasn't confirmed.
  const signedIn = useHubAccount((s) => s.state !== 'signedOut')
  const email = useHubAccount((s) => s.email)
  const count = useHubVotes((s) => s.counts?.[id])
  const mine = useHubVotes((s) => s.mine[id] ?? 0)
  const [busy, setBusy] = useState(false)
  useEffect(() => loadHubVotes(signedIn ? (email ?? 'signed-in') : null), [signedIn, email])

  const cast = async (vote: 1 | -1) => {
    if (!signedIn) return toast.info(SIGN_IN)
    setBusy(true)
    try {
      await castHubVote(id, vote)
    } catch (e) {
      toast.error(e instanceof SignedOutError ? SIGN_IN : e instanceof Error ? e.message : 'The vote didn’t go through')
    } finally {
      setBusy(false)
    }
  }
  const arrow = (vote: 1 | -1) => {
    const on = mine === vote
    return (
      <Pressable
        onPress={() => void cast(vote)}
        disabled={busy}
        hitSlop={4}
        accessibilityRole="button"
        accessibilityLabel={vote === 1 ? 'Vote up' : 'Vote down'}
        accessibilityState={{ selected: on, disabled: busy }}
        style={({ pressed }) => [styles.arrow, { opacity: busy ? 0.5 : pressed ? 0.6 : 1 }]}
      >
        <MaterialIcons name={vote === 1 ? 'arrow-upward' : 'arrow-downward'} size={20} color={on ? colors.primary : colors.mutedForeground} />
      </Pressable>
    )
  }
  return (
    <View style={[styles.pill, { borderColor: colors.border }]}>
      {arrow(1)}
      <Text accessibilityLabel={`Score ${count ?? 'not loaded'}`} style={[styles.score, { color: colors.foreground }]}>
        {count ?? '–'}
      </Text>
      {arrow(-1)}
    </View>
  )
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'center', borderWidth: 1, borderRadius: radius.pill },
  arrow: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  score: { minWidth: 24, textAlign: 'center', fontFamily: font.family.mono, fontSize: font.size.md, paddingHorizontal: spacing.xs },
})
