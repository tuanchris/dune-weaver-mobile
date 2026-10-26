import React, { useState } from 'react'
import { Alert, StyleSheet, Text, View } from 'react-native'
import { isDemoBase } from '../../api/demoBoard'
import { isJobLocked } from '../../api/status'
import { useStatus } from '../../stores/useStatus'
import { useTheme } from '../../stores/useTheme'
import { usePreviews } from '../../stores/usePreviews'
import { toast } from '../../stores/useToast'
import { importPreviews } from '../../lib/importPreviews'
import { syncPreviewBundle } from '../../lib/previewSync'
import { userMessage } from '../../lib/errors'
import { Button, Card, CardTitle, IconButton } from '../../components/ui'
import { CatalogCard } from '../../components/CatalogCard'
import { SettingsPage, useActiveBase } from './SettingsPage'
import { spacing, font } from '../../theme'

/** The pattern list as this phone sees it: thumbnails for card-only patterns,
 * and the imported-catalog escape hatch for weak Wi-Fi. Browse's "N patterns
 * without a thumbnail" banner deep-links here. */
export function PatternsSettings(): React.JSX.Element {
  const base = useActiveBase()
  return (
    <SettingsPage title="Patterns">
      <PreviewsCard base={base} />
      {base && !isDemoBase(base) ? <CatalogCard base={base} /> : null}
    </SettingsPage>
  )
}

function PreviewsCard({ base }: { base: string | null }): React.JSX.Element {
  const colors = useTheme((s) => s.colors)
  const previewCount = usePreviews((s) => Object.keys(s.map).length)
  const addPreviews = usePreviews((s) => s.addMany)
  const clearPreviews = usePreviews((s) => s.clear)
  const [importing, setImporting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  // The one control here a PAUSE doesn't free: syncing streams shards off the
  // same single-threaded SD the paused job still holds its .thr open on.
  // Disabling the button (not the card) keeps the local import beside it live.
  const syncBlocked = useStatus((s) => isJobLocked(s.status))

  // Pull the preview bundle the SD Card Pattern Manager writes to the card.
  // Manual only (see lib/previewSync.ts) — this button is the single trigger,
  // for "I just updated the card" moments, with the outcome made visible.
  const doSync = async () => {
    if (!base) return
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await syncPreviewBundle(base, (p) => {
        if (p.stage === 'checking') {
          setSyncMsg('Checking the card for a preview bundle…')
        } else if (p.stage === 'downloading') {
          setSyncMsg(`Downloading bundle ${p.shard} of ${p.totalShards} (${Math.max(1, Math.round(p.bytes / 1024))} KB)…`)
        } else {
          setSyncMsg(`Saved ${p.images} preview${p.images === 1 ? '' : 's'} (bundle ${p.shard} of ${p.totalShards})…`)
        }
      })
      if (res.status === 'busy') {
        toast.error('The table is running — try again when it’s idle')
      } else if (res.status === 'no-bundle') {
        toast.error('No preview bundle on the card — build one with the SD Card Pattern Manager (duneweaver.com/install)')
      } else if (res.imagesIngested === 0) {
        toast.success('Previews already up to date')
      } else {
        toast.success(`Synced ${res.imagesIngested} preview${res.imagesIngested > 1 ? 's' : ''} from the table`)
      }
    } finally {
      setSyncing(false)
      setSyncMsg(null)
    }
  }

  const doImport = async () => {
    setImporting(true)
    try {
      const res = await importPreviews()
      if (!res) return // cancelled
      const { entries, failed } = res
      addPreviews(entries)
      if (entries.length === 0) {
        toast.error(failed.length ? `No usable images (skipped ${failed.length})` : 'No images selected')
        return
      }
      const added = `Imported ${entries.length} preview${entries.length > 1 ? 's' : ''}`
      toast.success(failed.length ? `${added}, skipped ${failed.length}` : added)
    } catch (e) {
      toast.error(userMessage(e, 'import the previews'))
    } finally {
      setImporting(false)
    }
  }

  const confirmClear = () => {
    if (previewCount === 0) return
    Alert.alert('Clear previews', `Remove all ${previewCount} imported preview image${previewCount > 1 ? 's' : ''}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => { clearPreviews(); toast.success('Previews cleared') } },
    ])
  }

  return (
    <Card>
      <CardTitle>Pattern previews</CardTitle>
      <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, marginBottom: spacing.md }}>
        Thumbnails for patterns copied straight onto the SD card. Sync reads the preview bundle the SD Card Pattern Manager saves there; Import adds images, or the bundle’s .zip files, from this phone. Images match patterns by file name (star.thr.webp → star.thr), work for every table, and look best black-on-transparent.
      </Text>
      {base ? (
        <View style={{ marginBottom: spacing.sm }}>
          <Button title="Sync previews from table" icon="sync" variant="secondary" loading={syncing} disabled={syncBlocked} onPress={doSync} />
          {syncBlocked && !syncing ? (
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              Syncing reads the SD card the pattern is playing from — stop the table first.
            </Text>
          ) : null}
          {syncing ? (
            <Text style={[styles.note, { color: colors.mutedForeground }]}>
              {syncMsg ?? 'Checking the card for a preview bundle…'}
              {'\n'}This can take a while — keep the app open.
            </Text>
          ) : null}
        </View>
      ) : null}
      <Button title="Import previews" icon="add-photo-alternate" variant="secondary" loading={importing} onPress={doImport} />
      {previewCount > 0 ? (
        <View style={styles.meta}>
          <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>{previewCount} imported</Text>
          <IconButton icon="delete-outline" size={22} color={colors.mutedForeground} label="Clear imported previews" onPress={confirmClear} />
        </View>
      ) : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  note: { fontSize: font.size.sm, marginTop: spacing.xs, textAlign: 'center' },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
})
