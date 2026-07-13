// Settings card: diagnostics. "View logs" opens a sheet showing the TABLE's
// runtime log first (/sand_log — the board's ~8 KB RAM ring, fetched on
// demand; it's lost when the table reboots) with the app's own event ring
// (useAppLog) on a second tab. Nothing is collected or uploaded
// automatically; data leaves the phone only through the user's explicit
// share of the visible log.

import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import Constants from 'expo-constants'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useAppLog, appLogText } from '../stores/useAppLog'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { useTableLog } from '../stores/useTableLog'
import { collectTableLog, RESTART_MARKER } from '../lib/tableLogSync'
import { useTheme } from '../stores/useTheme'
import { toast } from '../stores/useToast'
import { userMessage } from '../lib/errors'
import { Button, Card, CardTitle, IconButton } from './ui'
import { radius, spacing, font } from '../theme'

type LogTab = 'table' | 'app'

function reportHeader(base: string | null): string {
  const status = useStatus.getState().status
  return [
    '=== Dune Weaver diagnostics ===',
    `App: v${Constants.expoConfig?.version ?? '?'} on ${Platform.OS} ${Platform.Version}`,
    `Table: ${base ?? 'none'}  fw: ${status?.fw ?? '?'}  state: ${status?.state ?? '?'}  sd_ok: ${status?.sdOk ?? '?'}`,
    `Generated: ${new Date().toISOString()}`,
    '',
  ].join('\n')
}

export function DiagnosticsCard({ base }: { base: string | null }) {
  const colors = useTheme((s) => s.colors)
  const entries = useAppLog((s) => s.entries)
  const clear = useAppLog((s) => s.clear)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<LogTab>('table')
  const [tableErr, setTableErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<ScrollView>(null)

  // Collected table-log history (harvested continuously by useTableLogSync;
  // the refresh below just forces a collection now).
  const boardId = useBoards((s) => (base ? s.boards.find((b) => b.base === base)?.id : undefined))
  const stored = useTableLog((s) => (boardId ? s.logs[boardId] : undefined))
  const clearTableLog = useTableLog((s) => s.clear)
  const tableLines = stored?.lines ?? []

  const fetchTableLog = async () => {
    if (!base) return
    setLoading(true)
    try {
      await collectTableLog(base)
      setTableErr(null)
    } catch (e) {
      // With history on screen a fetch failure is incidental — toast it; only
      // block the view when there's nothing to show at all.
      const msg = userMessage(e, 'read the table log')
      if (tableLines.length > 0) toast.error(msg)
      else setTableErr(msg)
    } finally {
      setLoading(false)
    }
  }

  const openSheet = () => {
    setTab(base ? 'table' : 'app')
    setOpen(true)
    if (base) void fetchTableLog()
  }

  // The interesting lines are the most recent ones, at the END of both logs —
  // land there when the sheet opens, the tab changes, or a fetch completes.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 60)
    return () => clearTimeout(t)
  }, [open, tab, stored])

  const share = async () => {
    const body =
      tab === 'table'
        ? `--- Table log (collected from /sand_log) ---\n${tableLines.join('\n') || '(empty)'}`
        : `--- App log ---\n${appLogText() || '(empty)'}`
    const report = reportHeader(base) + body
    try {
      await Share.share(
        Platform.OS === 'ios' ? { message: report } : { message: report, title: 'Dune Weaver diagnostics' }
      )
    } catch (e) {
      // User cancelling the sheet also rejects on some platforms — stay quiet
      // unless assembling the report itself failed.
      if ((e as Error)?.message && !/cancel|dismiss/i.test((e as Error).message)) {
        toast.error(userMessage(e, 'share the log'))
      }
    }
  }

  const appLevelColor = (level: string) =>
    level === 'error' ? colors.destructive : level === 'warn' ? colors.primary : colors.mutedForeground
  const tableLevelColor = (line: string) =>
    /MSG:ERR|error|alarm/i.test(line) ? colors.destructive : /MSG:WARN/i.test(line) ? colors.primary : colors.mutedForeground

  return (
    <Card>
      <CardTitle>Diagnostics</CardTitle>
      <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginBottom: spacing.md }}>
        The table’s runtime log (read from the table when you open it) and this app’s own event log. Nothing leaves this phone unless you share it.
      </Text>
      <Button title="View logs" icon="receipt-long" variant="secondary" onPress={openSheet} />

      {/* Log viewer sheet. The sheet itself is a plain View (not a Pressable —
          a Pressable wrapper competed with the ScrollView for the drag gesture
          and scrolling never started); tap-outside-to-close is the flex spacer. */}
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setOpen(false)} />
          <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}>
              {base ? (
                <View style={styles.tabs}>
                  {(
                    [
                      { key: 'table', label: 'Table' },
                      { key: 'app', label: `App (${entries.length})` },
                    ] as const
                  ).map(({ key, label }) => (
                    <Pressable
                      key={key}
                      onPress={() => setTab(key)}
                      style={[
                        styles.tabBtn,
                        { borderColor: tab === key ? colors.primary : colors.border, backgroundColor: tab === key ? colors.cardElevated : 'transparent' },
                      ]}
                    >
                      <Text style={{ color: tab === key ? colors.foreground : colors.mutedForeground, fontSize: font.size.sm, fontWeight: font.weight.medium }}>
                        {label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : (
                <Text style={{ color: colors.foreground, fontSize: font.size.lg, fontWeight: font.weight.semibold, flex: 1 }}>App log</Text>
              )}
              {tab === 'table' ? (
                <>
                  <IconButton icon="refresh" size={22} color={colors.mutedForeground} disabled={loading} onPress={() => void fetchTableLog()} />
                  <IconButton
                    icon="delete-outline"
                    size={22}
                    color={colors.mutedForeground}
                    onPress={() => { if (boardId) { clearTableLog(boardId); toast.success('Collected log cleared') } }}
                  />
                </>
              ) : (
                <IconButton icon="delete-outline" size={22} color={colors.mutedForeground} onPress={() => { clear(); toast.success('Log cleared') }} />
              )}
              <IconButton icon="ios-share" size={22} color={colors.primary} onPress={() => void share()} />
            </View>

            {tab === 'table' ? (
              loading && tableLines.length === 0 ? (
                <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.xl }} />
              ) : tableErr && tableLines.length === 0 ? (
                <View style={{ paddingVertical: spacing.lg, gap: spacing.md }}>
                  <Text style={{ color: colors.mutedForeground }}>{tableErr}</Text>
                  <Button title="Try again" icon="refresh" variant="secondary" onPress={() => void fetchTableLog()} />
                </View>
              ) : (
                <ScrollView ref={scrollRef} style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: spacing.md }}>
                  {tableLines.length === 0 ? (
                    <Text style={{ color: colors.mutedForeground, paddingVertical: spacing.lg }}>Nothing collected yet.</Text>
                  ) : (
                    tableLines.map((line, i) =>
                      line === RESTART_MARKER ? (
                        <Text key={i} style={[styles.line, { color: colors.mutedForeground, textAlign: 'center', marginVertical: 4 }]}>
                          {line}
                        </Text>
                      ) : (
                        <Text key={i} selectable style={[styles.line, { color: tableLevelColor(line) }]}>
                          {line}
                        </Text>
                      )
                    )
                  )}
                  <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs, marginTop: spacing.md }}>
                    Collected from the table whenever the app can reach it, so the history survives table restarts.
                    {stored ? ` Last collected ${new Date(stored.updatedAt).toLocaleTimeString()}.` : ''}
                  </Text>
                </ScrollView>
              )
            ) : entries.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, paddingVertical: spacing.lg }}>Nothing logged yet.</Text>
            ) : (
              <ScrollView ref={scrollRef} style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: spacing.md }}>
                {entries.map((e, i) => (
                  <Text key={i} selectable style={[styles.line, { color: appLevelColor(e.level) }]}>
                    {new Date(e.ts).toLocaleTimeString()} [{e.tag}] {e.msg}
                  </Text>
                ))}
              </ScrollView>
            )}
            <SafeAreaView edges={['bottom']} />
          </View>
        </View>
      </Modal>
    </Card>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { maxHeight: '85%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, borderWidth: 1, paddingTop: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#888', alignSelf: 'center', marginBottom: spacing.sm },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  tabs: { flex: 1, flexDirection: 'row', gap: spacing.sm },
  tabBtn: { paddingHorizontal: spacing.md, height: 34, borderRadius: radius.pill, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  line: { fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', marginBottom: 3 },
})
