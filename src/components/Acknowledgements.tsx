// Settings › About: credit for Create's fonts and layout, and their license
// notices (src/lib/sandText/notices.mjs).
import React, { useState } from 'react'
import { ScrollView, StyleSheet, Text } from 'react-native'
import { NOTICES } from '../lib/sandText/notices.mjs'
import { useTheme } from '../stores/useTheme'
import { Button, Card, CardTitle } from './ui'
import { Sheet } from './Sheet'
import { font, spacing } from '../theme'

export function Acknowledgements(): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const [open, setOpen] = useState(false)
  return (
    <Card>
      <CardTitle>Acknowledgements</CardTitle>
      <Text style={{ color: colors.foreground, fontSize: font.size.md, marginBottom: spacing.md }}>
        Create in Browse writes with SandSkrit by UnintelligibleMaker, the fonts of Sandify by Jeff Eberl and its contributors (sandify.org), and open-source fonts and emoji (Noto Emoji) listed in the licenses. Its inlays follow sand-weaver’s.
      </Text>
      <Button title="Open-source licenses" variant="secondary" onPress={() => setOpen(true)} />
      <Sheet visible={open} onClose={() => setOpen(false)} variant="page" title="Open-source licenses">
        <ScrollView contentContainerStyle={styles.body}>
          {NOTICES.map((n) => (
            <React.Fragment key={n.name}>
              <Text style={[styles.name, { color: colors.foreground }]}>{n.name}</Text>
              <Text style={[styles.text, { color: colors.mutedForeground }]}>{n.text}</Text>
            </React.Fragment>
          ))}
        </ScrollView>
      </Sheet>
    </Card>
  )
}

const styles = StyleSheet.create({
  body: { padding: spacing.lg, paddingBottom: spacing.xxl },
  name: { fontSize: font.size.md, fontWeight: font.weight.semibold, marginTop: spacing.lg, marginBottom: spacing.sm },
  text: { fontFamily: font.family.mono, fontSize: font.size.xs, lineHeight: 16 },
})
