import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Image,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native'
import { MaterialIcons } from '@expo/vector-icons'
import { Sheet, useSheetWidth } from './Sheet'
import { Button, IconButton, Segmented } from './ui'
import { EmptyState } from './EmptyState'
import { SandImage } from './PatternThumb'
import { useTheme } from '../stores/useTheme'
import { useBoards } from '../stores/useBoards'
import { useStatus } from '../stores/useStatus'
import { usePreviews } from '../stores/usePreviews'
import { useLibrary, bareName, bundledNames } from '../stores/useLibrary'
import { toast } from '../stores/useToast'
import { isJobLocked } from '../api/status'
import { userMessage } from '../lib/errors'
import { SCROLL_BOTTOM_PAD, thumbGrid, useScreenWidth } from '../lib/layout'
import { STARTER_LICENSE, fetchHubCatalog, forTable, staleHubFiles, syncHub, type HubPattern, type HubProgress } from '../lib/patternHub'
import { HUB_TABLES, hubTable, hubTableLabel, type HubTable } from '../lib/tableSize'
import { NotMemberError, SignedOutError, refreshAccount, signIn, signOut, useHubAccount } from '../lib/hubAuth'
import { radius, spacing, font } from '../theme'

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const mb = (bytes: number) => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`
// Coarse on purpose: the rate swings file to file, so finer steps would jitter.
const timeLeft = (ms: number) => {
  const min = Math.round(ms / 60_000)
  if (min < 1) return 'under a minute left'
  return min < 60 ? `about ${min} min left` : `about ${Math.floor(min / 60)} h ${min % 60} min left`
}
// Uploading needs a duneweaver.com account and the site's form (license,
// credit, photos), so the app links to it rather than copying it.
const HUB_UPLOAD = 'https://duneweaver.com/patterns/upload'
// App Store 1.2 (user-generated content): every hub pattern can be reported.
// Uploads are approved before they're published; this reaches the same inbox.
const reportUrl = (p: HubPattern) =>
  `mailto:hello@duneweaver.com?subject=${encodeURIComponent(`Report a Pattern Hub pattern: ${p.title}`)}` +
  `&body=${encodeURIComponent(`Pattern: ${p.title} (${p.id})\nWhat's wrong with it:\n`)}`

/**
 * Browse's Pattern Hub tab: the hub's catalog as a grid, each tile marked by
 * where the pattern is (hub only / this phone / the table). Tap tiles to pick
 * some, or pick none for all of them. "Sync to phone" downloads into the
 * library; "Sync to table" downloads what's missing and then sends it, one file
 * at a time (lib/patternHub.ts). Search and Tags narrow the grid; with nothing
 * picked, the buttons act on what's shown. Touch and hold a tile for its
 * details (credit, tags, license). The panel holds the account (sign in
 * right here) and the sync buttons. It scrolls away with the grid, so browsing
 * gets the whole screen, and pins above the grid only while something is picked
 * or a sync runs. Round tables only: the hub is .thr. Everyone sees the catalog; the
 * sync buttons are for a signed-in plan owner (lib/hubAuth.ts). No purchase
 * wording, no shop links (App Store 3.1.1 / 3.1.3).
 *
 * Stays mounted once opened (BrowseScreen hides it), so a sync keeps its
 * progress and Stop across a switch to Library.
 */
export function HubPane({ active }: { active: boolean }) {
  const colors = useTheme((s) => s.colors)
  const { height } = useWindowDimensions()
  const board = useBoards((s) => s.getActive())
  const setHubTable = useBoards((s) => s.setHubTable)
  const base = board?.base ?? null
  // Which version of each pattern this table takes (lib/tableSize.ts): a table
  // between the hub's sizes (a DW Gold) chooses, for every pattern or one by one.
  const sizing = hubTable(board)
  const status = useStatus((s) => s.status)
  const previewSyncing = usePreviews((s) => s.syncing)
  const library = useLibrary((s) => s.patterns)
  const tablePatterns = useLibrary((s) => s.tablePatterns)
  const tableBase = useLibrary((s) => s.tableBase)
  const account = useHubAccount((s) => s.state)
  const email = useHubAccount((s) => s.email)
  const [signingIn, setSigningIn] = useState(false)
  const [checking, setChecking] = useState(false)
  // Re-read the account: a plan added on the site since shows without a restart.
  const recheck = () => {
    setChecking(true)
    void refreshAccount().finally(() => setChecking(false))
  }

  const [raw, setRaw] = useState<HubPattern[] | null>(null)
  const catalog = useMemo(() => raw && forTable(raw, board), [raw, board])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<(HubProgress & { eta: number | null }) | null>(null)
  const [running, setRunning] = useState(false)
  const [stopping, setStopping] = useState(false)
  const stop = useRef(false)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState<string | null>(null)
  const [tagsOpen, setTagsOpen] = useState(false)
  // The pattern shown up close (touch and hold its tile), by id: picking its
  // version there swaps it for that version.
  const [detailId, setDetailId] = useState<string | null>(null)
  const detail = catalog?.find((p) => p.id === detailId) ?? null
  const setDetail = (p: HubPattern | null) => setDetailId(p?.id ?? null)
  const twoSizes = sizing.choose && !!catalog?.some((p) => p.versions.length > 1)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setRaw((await fetchHubCatalog()).patterns)
    } catch (e) {
      setError(userMessage(e, 'reach the Pattern Hub'))
    } finally {
      setLoading(false)
    }
  }
  // Each switch to the tab re-reads the account; the catalog loads once (pull to refresh).
  useEffect(() => {
    if (!active) return
    recheck()
    if (!raw && !loading) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  // Use another account = sign out first, so the sign-in window starts fresh.
  const startSignIn = async (another: boolean) => {
    setSigningIn(true)
    try {
      if (another) await signOut()
      await signIn()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSigningIn(false)
    }
  }

  // Copies older than the hub's (the pattern was updated) count as missing, so a sync replaces them.
  const stale = useMemo(() => staleHubFiles(catalog ?? [], library, board), [catalog, library, board])
  const onPhone = useMemo(
    () => new Set([...bundledNames(false), ...library.map((p) => p.name)].filter((n) => !stale.phone.has(n))),
    [library, stale],
  )
  // A copy in a subfolder counts too: the table has it, so it isn't sent twice.
  const onTable = useMemo(
    () => new Set(tableBase === base ? tablePatterns.map((p) => bareName(p)).filter((n) => !stale.table.has(n)) : []),
    [tablePatterns, tableBase, base, stale],
  )
  const updated = useMemo(() => new Set([...stale.phone, ...stale.table]), [stale])

  const q = query.trim().toLowerCase()
  const filtered = !!q || !!tag
  const shown = useMemo(
    () =>
      (catalog ?? []).filter(
        (p) => (!tag || p.tags.includes(tag)) && (!q || `${p.title} ${p.author} ${p.description}`.toLowerCase().includes(q)),
      ),
    [catalog, tag, q],
  )
  // Tags by how many patterns carry them.
  const tags = useMemo(() => {
    const n = new Map<string, number>()
    for (const p of catalog ?? []) for (const t of p.tags) n.set(t, (n.get(t) ?? 0) + 1)
    return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [catalog])
  // The picked ones, else everything shown.
  const scope = useMemo(
    () => (selected.size ? (catalog ?? []).filter((p) => selected.has(p.id)) : shown),
    [catalog, selected, shown],
  )
  const needPhone = scope.filter((p) => !onPhone.has(p.name))
  const needTable = scope.filter((p) => !onTable.has(p.name))
  const tableReason =
    !base ? 'No table connected.'
    : !status?.connected ? 'The table is offline.'
    : isJobLocked(status) ? 'The table is busy. Sync when it’s idle.'
    : previewSyncing ? 'Previews are syncing from the table.'
    : null

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const run = async (toTable: boolean) => {
    const list = toTable ? needTable : needPhone
    stop.current = false
    setStopping(false)
    setRunning(true)
    // Time left per stage (downloads, then sends): elapsed over the size-weighted
    // fraction done. Held back for the first 3 s, while one file is all it knows.
    // Time away from the app doesn't count: the sync pauses there (patternHub.ts).
    let stage = ''
    let startedAt = 0
    let awayAt = 0
    const away = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        if (!awayAt) awayAt = Date.now()
      } else if (awayAt) {
        startedAt += Date.now() - awayAt
        awayAt = 0
      }
    })
    const onProgress = (p: HubProgress) => {
      if (p.stage !== stage) {
        stage = p.stage
        startedAt = Date.now()
      }
      const elapsed = Date.now() - startedAt
      const eta = elapsed > 3000 && p.fraction > 0.01 ? (elapsed * (1 - p.fraction)) / p.fraction : null
      setProgress({ ...p, eta })
    }
    try {
      const r = await syncHub(list, {
        base: toTable && base ? base : undefined,
        onTable,
        onProgress,
        shouldStop: () => stop.current,
      })
      const failed = r.failed.length ? `, ${r.failed.length} didn’t download` : ''
      if (r.error instanceof SignedOutError || r.error instanceof NotMemberError) {
        // No toast: the account store has changed, so the panel now shows
        // Sign in / the non-member note. What downloaded before it stays.
      } else if (r.error) {
        toast.error(`${userMessage(r.error, 'send the patterns')}${r.toTable ? ` (${r.toTable} sent)` : ''}`)
      } else if (toTable) {
        toast.success(`${r.stopped ? 'Stopped: sent' : 'Sent'} ${plural(r.toTable, 'pattern')} to the table${failed}`)
      } else if (r.toPhone || !r.failed.length) {
        toast.success(`${r.stopped ? 'Stopped: synced' : 'Synced'} ${plural(r.toPhone, 'pattern')} to this phone${failed}`)
      } else {
        // An HTTP status means the site answered: say what it said, not "check the internet".
        const why = r.failedError instanceof Error ? r.failedError.message : ''
        toast.error(/HTTP \d/.test(why) ? `Couldn’t download from the Pattern Hub: ${why}` : 'Couldn’t download from the Pattern Hub. Check the internet connection.')
      }
      if (!r.error && !r.stopped && !r.failed.length) setSelected(new Set())
    } finally {
      away.remove()
      setRunning(false)
      setProgress(null)
    }
  }

  const confirmTable = () => {
    const bytes = needTable.reduce((n, p) => n + p.bytes, 0)
    Alert.alert(
      `Sync ${plural(needTable.length, 'pattern')} to the table?`,
      `About ${mb(bytes)}, sent one file at a time, so it can take a while. It runs while the app is open: leave it and the sync pauses, then carries on when you come back.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sync', onPress: () => void run(true) },
      ],
    )
  }

  const all = selected.size === 0
  const scopeLabel = !all ? `${selected.size} selected` : filtered ? `${shown.length} shown` : `All ${catalog?.length ?? 0}`
  const summary =
    needPhone.length + needTable.length === 0
      ? `${scopeLabel} · on this phone and the table`
      : [
          scopeLabel,
          needPhone.length ? `${needPhone.length} to download (${mb(needPhone.reduce((n, p) => n + p.bytes, 0))})` : 'on this phone',
          needTable.length ? `${needTable.length} to send to the table` : 'on the table',
        ].join(' · ')

  const small = [styles.small, { color: colors.mutedForeground }]
  const panelColors = { backgroundColor: colors.card, borderColor: colors.border }

  // The account, or the sync buttons once signed in as a plan owner. At the top
  // of the grid, scrolling with it; pinned above it (never at the bottom: on
  // iOS 26 a tab screen's bottom is under the glass tab bar and the mini player)
  // while picks or a sync need the buttons in reach. At the top of the list the
  // two spots coincide, and further down the header shrinks as much as the
  // pinned copy grows, so the tiles don't jump when it moves.
  const pinned = running || selected.size > 0
  const panel = progress ? (
    <View>
      <Text numberOfLines={2} style={{ color: colors.foreground, fontSize: font.size.sm }}>
        {progress.stage === 'phone' ? 'Downloading' : 'Sending to the table'} {progress.index} of {progress.total} · {progress.title}
      </Text>
      <View style={styles.progressRow}>
        <View style={[styles.track, { backgroundColor: colors.border }]}>
          <View style={[styles.fill, { width: `${Math.round(progress.fraction * 100)}%`, backgroundColor: colors.primary }]} />
        </View>
        <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, fontFamily: font.family.mono }}>
          {Math.round(progress.fraction * 100)}%
        </Text>
      </View>
      {progress.eta !== null ? (
        <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, fontFamily: font.family.mono }}>
          {timeLeft(progress.eta)}
        </Text>
      ) : null}
      {/* iOS suspends the app seconds after it leaves the screen, which pauses the sync. */}
      <Text style={[styles.small, { color: colors.foreground, marginTop: spacing.xs, marginBottom: spacing.sm }]}>
        Stay on this page until it’s done. Leaving the app pauses the sync.
      </Text>
      <Button
        title={stopping ? 'Stopping after this one…' : 'Stop'}
        variant="secondary"
        disabled={stopping}
        onPress={() => {
          stop.current = true
          setStopping(true)
        }}
      />
    </View>
  ) : account === 'notMember' ? (
    <View style={styles.panelBody}>
      <Text style={[styles.small, { color: colors.foreground }]}>Pattern Hub downloads are for Dune Weaver plan owners.</Text>
      <Text style={small}>Use the duneweaver.com account your plan is under.</Text>
      {email ? (
        <Text numberOfLines={2} style={small}>
          Signed in as {email}
        </Text>
      ) : null}
      <Button title="Use another account" icon="switch-account" variant="secondary" loading={signingIn} onPress={() => void startSignIn(true)} />
    </View>
  ) : account === 'unknown' ? (
    // A stored sign-in /me hasn't confirmed (slow, offline, a site error).
    // Never Sign in here: that would start a second grant.
    <View style={styles.panelBody}>
      <Text style={small}>{checking ? 'Checking your duneweaver.com account…' : 'Signed in. Can’t reach duneweaver.com right now.'}</Text>
      {checking ? null : <Button title="Try again" icon="refresh" variant="secondary" onPress={recheck} />}
    </View>
  ) : account === 'signedOut' ? (
    <View style={styles.panelBody}>
      <Text style={small}>Sign in with your duneweaver.com account to sync Pattern Hub patterns.</Text>
      <Button title="Sign in" icon="login" loading={signingIn} onPress={() => void startSignIn(false)} />
    </View>
  ) : catalog ? (
    <View style={styles.panelBody}>
      <View style={styles.summaryRow}>
        <Text style={[small, { flex: 1 }]}>{summary}</Text>
        {!all ? <Button title="Deselect" variant="ghost" disabled={running} onPress={() => setSelected(new Set())} /> : null}
      </View>
      <View style={styles.buttons}>
        <Button
          flex
          title="Sync to phone"
          icon="download"
          // Prominent when it's the one that can run: no table to sync to, or it's busy.
          variant={tableReason ? 'primary' : 'secondary'}
          disabled={running || needPhone.length === 0}
          onPress={() => void run(false)}
        />
        <Button
          flex
          title="Sync to table"
          icon="cloud-upload"
          variant={tableReason ? 'secondary' : 'primary'}
          loading={running}
          disabled={running || needTable.length === 0 || !!tableReason}
          onPress={confirmTable}
        />
      </View>
      {tableReason && needTable.length ? <Text style={small}>{tableReason}</Text> : null}
    </View>
  ) : null

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.searchRow}>
        <View style={[styles.control, styles.search, { backgroundColor: colors.inputBackground, borderColor: colors.border }]}>
          <MaterialIcons name="search" size={18} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={tag ? `Search in ${tag}` : `Search ${catalog?.length ?? ''} hub patterns`}
            placeholderTextColor={colors.mutedForeground}
            autoCorrect={false}
            autoCapitalize="none"
            spellCheck={false}
            style={[styles.searchInput, { color: colors.foreground }]}
          />
          {query ? <IconButton icon="close" size={18} color={colors.mutedForeground} label="Clear search" onPress={() => setQuery('')} /> : null}
        </View>
        <Pressable
          onPress={() => setTagsOpen(true)}
          disabled={!catalog}
          accessibilityRole="button"
          accessibilityLabel={`Tags${tag ? ` (${tag})` : ''}`}
          style={[
            styles.control,
            styles.iconBtn,
            tag ? { backgroundColor: colors.primary, borderColor: colors.primary } : { backgroundColor: colors.card, borderColor: colors.border },
          ]}
        >
          <MaterialIcons name="filter-list" size={22} color={tag ? colors.primaryForeground : colors.foreground} />
        </Pressable>
      </View>

      {pinned && panel ? <View style={[styles.panel, styles.pinned, panelColors]}>{panel}</View> : null}

      {catalog ? (
        <HubGrid
          catalog={shown}
          selected={selected}
          onPhone={onPhone}
          onTable={onTable}
          updated={updated}
          disabled={running}
          onToggle={toggle}
          onDetail={setDetail}
          refreshing={loading}
          onRefresh={load}
          header={
            <View>
              {!pinned && panel ? <View style={[styles.panel, styles.inList, panelColors]}>{panel}</View> : null}
              {twoSizes && board ? (
                <View style={[styles.panel, styles.inList, styles.panelBody, panelColors]}>
                  <Text style={[styles.optionTitle, { color: colors.foreground }]}>Versions for this table</Text>
                  <Segmented
                    fill
                    value={sizing.table}
                    options={HUB_TABLES.map((h) => ({ value: h.id, label: h.label }))}
                    onChange={(t) => setHubTable(board.id, t)}
                  />
                  <Text style={small}>
                    Patterns made in both sizes show their {hubTableLabel(sizing.table)} version. Touch and hold one to pick its version on its own.
                  </Text>
                </View>
              ) : null}
              {all && shown.length ? (
                <Text style={[small, styles.hint]}>
                  {filtered ? plural(shown.length, 'pattern') : `${catalog.length} patterns from duneweaver.com`}. Tap to pick some, or sync them
                  all. Touch and hold for details.
                </Text>
              ) : null}
            </View>
          }
          empty={
            <View style={styles.center}>
              <EmptyState icon="search-off" text={tag && q ? `No ${tag} patterns match “${query.trim()}”.` : 'No hub patterns match.'} />
              <Button
                title="Show all patterns"
                variant="secondary"
                onPress={() => {
                  setQuery('')
                  setTag(null)
                }}
              />
            </View>
          }
          footer={
            // Contributing comes after browsing: the end of the grid, not ahead of it.
            <Pressable
              onPress={() => void Linking.openURL(HUB_UPLOAD).catch(() => toast.error('Couldn’t open duneweaver.com'))}
              accessibilityRole="link"
              style={({ pressed }) => [styles.panel, styles.shareRow, panelColors, { opacity: pressed ? 0.7 : 1 }]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.optionTitle, { color: colors.foreground }]}>Share your own pattern</Text>
                <Text style={small}>Upload a .thr on duneweaver.com</Text>
              </View>
              <MaterialIcons name="open-in-new" size={20} color={colors.mutedForeground} />
            </Pressable>
          }
        />
      ) : error ? (
        <View style={styles.center}>
          <EmptyState icon="cloud-off" text={error} />
          <Button title="Try again" icon="refresh" variant="secondary" loading={loading} onPress={load} />
        </View>
      ) : (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      )}

      <Sheet visible={tagsOpen} onClose={() => setTagsOpen(false)} title="Tags">
        <ScrollView style={{ maxHeight: height * 0.55 }} contentContainerStyle={styles.tagList} showsVerticalScrollIndicator>
          {[[null, catalog?.length ?? 0] as const, ...tags].map(([t, n]) => {
            const on = tag === t
            return (
              <Pressable
                key={t ?? ''}
                onPress={() => {
                  setTag(t)
                  setTagsOpen(false)
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.tagRow, { backgroundColor: on ? colors.cardElevated : 'transparent' }]}
              >
                <Text style={[styles.tagLabel, { color: colors.foreground }]}>{t ?? 'All patterns'}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, fontFamily: font.family.mono }}>{n}</Text>
                {on ? <MaterialIcons name="check" size={20} color={colors.primary} /> : null}
              </Pressable>
            )
          })}
        </ScrollView>
      </Sheet>

      <Sheet
        visible={!!detail}
        onClose={() => setDetail(null)}
        title={detail?.title}
        trailing={<IconButton icon="close" label="Close" onPress={() => setDetail(null)} />}
      >
        {detail ? (
          <HubDetail
            p={detail}
            where={whereIs(detail, onPhone, onTable, updated)}
            choose={sizing.choose}
            onVersion={(t) => board && setHubTable(board.id, t, detail.id)}
            selected={selected.has(detail.id)}
            disabled={running}
            onToggle={() => {
              toggle(detail.id)
              setDetail(null)
            }}
            onTag={(t) => {
              setTag(t)
              setDetail(null)
            }}
          />
        ) : null}
      </Sheet>
    </View>
  )
}

type Where = 'on the table' | 'on this phone' | 'on the hub' | 'updated on the hub'
const whereIs = (p: HubPattern, onPhone: Set<string>, onTable: Set<string>, updated: Set<string>): Where =>
  updated.has(p.name) ? 'updated on the hub' : onTable.has(p.name) ? 'on the table' : onPhone.has(p.name) ? 'on this phone' : 'on the hub'
const WHERE_LINE: Record<Where, string> = {
  'on the table': 'On the table',
  'on this phone': 'On this phone, not on the table',
  'on the hub': 'On the Pattern Hub',
  'updated on the hub': 'Updated on the Pattern Hub — sync to replace the old copy',
}
const WHERE_GLYPH: Record<Where, React.ComponentProps<typeof MaterialIcons>['name'] | null> = {
  'on the table': null,
  'on this phone': 'smartphone',
  'on the hub': 'cloud-queue',
  'updated on the hub': 'update',
}
// "CC-BY-NC-4.0" reads as Creative Commons writes it: "CC BY-NC 4.0".
const licenseName = (id: string | undefined): string | null =>
  !id ? null : id === STARTER_LICENSE ? 'Dune Weaver starter set' : id.replace(/^CC-/, 'CC ').replace(/-(\d)/, ' $1')

/**
 * A hub pattern up close, like a Library pattern's sheet: its disc, credit, the
 * table size it's made for (and, on a table between the sizes, which version
 * to take), tags (tap one to browse it), license, and Select.
 */
function HubDetail({ p, where, choose, onVersion, selected, disabled, onToggle, onTag }: {
  p: HubPattern
  where: Where
  choose: boolean
  onVersion: (table: HubTable) => void
  selected: boolean
  disabled: boolean
  onToggle: () => void
  onTag: (tag: string) => void
}) {
  const colors = useTheme((s) => s.colors)
  const size = Math.min(useSheetWidth() - spacing.lg * 2, 260)
  const license = licenseName(p.license)
  const muted = { color: colors.mutedForeground, fontSize: font.size.sm }
  return (
    <View style={styles.detail}>
      <View style={[styles.thumb, styles.detailDisc, { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.card, borderColor: colors.border }]}>
        <SandImage
          inkUrl={p.previewUrl}
          size={size - 12}
          fallback={<Image source={{ uri: p.previewUrl }} style={{ width: size - 12, height: size - 12, tintColor: colors.foreground }} resizeMode="contain" />}
        />
      </View>
      <Text style={[muted, styles.centered]}>
        by {p.author}
        {p.table ? ` · made for a ${hubTableLabel(p.table)}` : ''}
      </Text>
      {choose && p.versions.length > 1 ? (
        <Segmented
          fill
          value={p.table ?? ''}
          options={HUB_TABLES.filter((h) => p.versions.some((v) => v.table === h.id)).map((h) => ({ value: h.id, label: h.label }))}
          onChange={(t) => onVersion(t as HubTable)}
        />
      ) : null}
      {p.description ? <Text style={{ color: colors.foreground, fontSize: font.size.md }}>{p.description}</Text> : null}
      {p.tags.length ? (
        <View style={styles.detailTags}>
          {p.tags.map((t) => (
            <Pressable
              key={t}
              onPress={() => onTag(t)}
              accessibilityRole="button"
              accessibilityHint={`Shows the ${t} patterns`}
              style={({ pressed }) => [styles.tagChip, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.7 : 1 }]}
            >
              <MaterialIcons name="sell" size={14} color={colors.mutedForeground} />
              <Text style={{ color: colors.foreground, fontSize: font.size.sm, fontWeight: font.weight.medium }}>{t}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Text style={[muted, styles.centered]}>
        {WHERE_LINE[where]}
        <Text style={{ fontFamily: font.family.mono }}> · {mb(p.bytes)}</Text>
        {license ? ` · ${license}` : ''}
      </Text>
      <Button title={selected ? 'Deselect' : 'Select'} icon={selected ? 'remove-done' : 'done'} variant={selected ? 'secondary' : 'primary'} disabled={disabled} onPress={onToggle} />
      <Button
        title="Report this pattern"
        icon="flag"
        variant="ghost"
        onPress={() => void Linking.openURL(reportUrl(p)).catch(() => toast.error('No mail app. Write to hello@duneweaver.com'))}
      />
    </View>
  )
}

interface HubGridProps {
  catalog: HubPattern[]
  selected: Set<string>
  onPhone: Set<string>
  onTable: Set<string>
  /** Files whose copy on the phone or the table is older than the hub's. */
  updated: Set<string>
  disabled: boolean
  onToggle: (id: string) => void
  onDetail: (p: HubPattern) => void
  refreshing: boolean
  onRefresh: () => void
  header: React.ReactElement
  empty: React.ReactElement
  footer: React.ReactElement
}

function HubGrid({ catalog, selected, onPhone, onTable, updated, disabled, onToggle, onDetail, refreshing, onRefresh, header, empty, footer }: HubGridProps) {
  const colors = useTheme((s) => s.colors)
  const { cols, thumb } = thumbGrid(useScreenWidth(), spacing.md)
  return (
    <FlatList
      data={catalog}
      key={cols}
      numColumns={cols}
      keyExtractor={(p) => p.id}
      contentContainerStyle={{ padding: spacing.md, paddingBottom: SCROLL_BOTTOM_PAD }}
      columnWrapperStyle={{ gap: spacing.md }}
      keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      ListFooterComponent={footer}
      renderItem={({ item: p }) => {
        const on = selected.has(p.id)
        const where = whereIs(p, onPhone, onTable, updated)
        return (
          <Pressable
            onPress={() => onToggle(p.id)}
            onLongPress={() => onDetail(p)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${p.title} by ${p.author}, ${where}`}
            style={[styles.tile, { flex: 1 / cols }]}
          >
            <View
              style={[
                styles.thumb,
                { width: thumb, height: thumb, borderRadius: thumb / 2, backgroundColor: colors.card, borderColor: on ? colors.primary : colors.border },
              ]}
            >
              <SandImage
                inkUrl={p.previewUrl}
                size={thumb - 8}
                fallback={<Image source={{ uri: p.previewUrl }} style={{ width: thumb - 8, height: thumb - 8, tintColor: colors.foreground }} resizeMode="contain" />}
              />
              {on ? (
                <View style={[styles.check, { backgroundColor: colors.primary }]}>
                  <MaterialIcons name="check" size={16} color={colors.primaryForeground} />
                </View>
              ) : null}
            </View>
            <View style={styles.caption}>
              {/* Marks what's still missing, like the Library's phone glyph: none once it's on the
                  table (a check here would read as the pick badge); an older copy, the update glyph. */}
              {WHERE_GLYPH[where] ? <MaterialIcons name={WHERE_GLYPH[where]} size={13} color={colors.mutedForeground} /> : null}
              <Text numberOfLines={1} style={[styles.name, { color: colors.foreground }]}>
                {p.title}
              </Text>
            </View>
            <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontSize: font.size.xs, maxWidth: '100%' }}>
              {p.author}
            </Text>
          </Pressable>
        )
      }}
    />
  )
}

const styles = StyleSheet.create({
  searchRow: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm, marginBottom: spacing.sm },
  control: { shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: spacing.md, minHeight: 44 },
  searchInput: { flex: 1, fontSize: font.size.md, paddingVertical: 0 },
  iconBtn: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, borderWidth: 1, width: 44, height: 44 },
  panel: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md },
  // The list's content padding (spacing.md) puts the in-list copy where the pinned one sits.
  pinned: { marginHorizontal: spacing.md, marginTop: spacing.sm },
  inList: { marginBottom: spacing.md },
  panelBody: { gap: spacing.sm },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 32 },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  small: { fontSize: font.size.sm },
  hint: { marginBottom: spacing.md },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, marginTop: spacing.sm },
  optionTitle: { fontSize: font.size.md, fontWeight: font.weight.medium },
  detail: { gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  detailDisc: { alignSelf: 'center' },
  centered: { textAlign: 'center' },
  detailTags: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: spacing.sm },
  tagChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: 6, minHeight: 34 },
  tagList: { gap: 2, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 52, borderRadius: radius.md, paddingHorizontal: spacing.md },
  tagLabel: { flex: 1, fontSize: font.size.md, fontWeight: font.weight.medium },
  center: { alignItems: 'center', gap: spacing.md, padding: spacing.lg },
  tile: { alignItems: 'center', gap: 2, marginBottom: spacing.md },
  thumb: { borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  check: { position: 'absolute', top: -2, right: -2, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  caption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, maxWidth: '100%', marginTop: spacing.xs },
  name: { flexShrink: 1, fontSize: font.size.sm, fontWeight: font.weight.medium },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.sm },
  track: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
})
