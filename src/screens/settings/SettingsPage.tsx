import React from 'react'
import { ScrollView } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { Screen } from '../../components/Screen'
import { IdleGate, IdleGateBanner } from '../../components/IdleGate'
import { useBoards } from '../../stores/useBoards'
import { SCROLL_BOTTOM_PAD } from '../../lib/layout'
import type { SettingsNav } from '../../navigation'
import { spacing } from '../../theme'

/** The active table's base URL (null when none is selected). */
export function useActiveBase(): string | null {
  return useBoards((s) => s.boards.find((b) => b.id === s.activeId)?.base ?? null)
}

/**
 * One page of the Settings stack: a back row to the list, the title, and a
 * scrolling column of cards.
 *  - `table`: the settings live ON the active table, so its name sits above the title.
 *  - `gated`: board-config writes, behind the pause/stop gate (IdleGate.tsx). Firmware
 *    is a table page that is NOT gated — an update stops the table itself.
 */
export function SettingsPage({
  title,
  table,
  gated,
  children,
}: {
  title: string
  table?: boolean
  gated?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const navigation = useNavigation<SettingsNav>()
  const base = useActiveBase()
  const tableName = useBoards((s) => s.boards.find((b) => b.id === s.activeId)?.name)
  const goBack = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('SettingsHome'))
  return (
    <Screen title={title} eyebrow={table ? tableName : undefined} back={{ label: 'Settings', onPress: goBack }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: SCROLL_BOTTOM_PAD, gap: spacing.lg }}>
        {gated ? (
          <>
            <IdleGateBanner base={base} />
            <IdleGate>{children}</IdleGate>
          </>
        ) : (
          children
        )}
      </ScrollView>
    </Screen>
  )
}
