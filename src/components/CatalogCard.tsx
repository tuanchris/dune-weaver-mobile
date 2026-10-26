// Settings card: the On-Table pattern catalog source. Normally the app fetches
// the pattern list from the table (/sand_patterns, cached + ETag). Over weak
// Wi-Fi even that is expensive, so this card lets the user IMPORT the catalog
// from a file (the card's /patterns/index.json) and freeze it — the app then
// never reads the catalog off the board. Flipping the toggle switches back and
// forth between the imported list and live board fetches without re-importing.

import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useLibrary } from '../stores/useLibrary'
import { useTheme } from '../stores/useTheme'
import { toast } from '../stores/useToast'
import { importCatalog } from '../lib/importCatalog'
import { Button, Card, CardTitle, Toggle } from './ui'
import { spacing, font } from '../theme'

export function CatalogCard({ base }: { base: string }) {
  const colors = useTheme((s) => s.colors)
  // Subscribe to the cache entry so the count/source update live after import.
  const entry = useLibrary((s) => s.tableCache[base])
  const importTableCatalog = useLibrary((s) => s.importTableCatalog)
  const setCatalogSource = useLibrary((s) => s.setCatalogSource)
  const [busy, setBusy] = useState(false)

  const source = entry?.catalogSource ?? 'board'
  const imported = source === 'imported'
  const importedCount = entry?.importedPatterns?.length ?? 0

  const doImport = async () => {
    setBusy(true)
    try {
      const res = await importCatalog()
      if (!res) return // cancelled
      importTableCatalog(base, res.keys)
      toast.success(`Imported ${res.keys.length} patterns — using the imported catalog`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not import that file')
    } finally {
      setBusy(false)
    }
  }

  const toggleSource = (useImported: boolean) => {
    if (useImported && importedCount === 0) {
      toast.error('Import a catalog file first')
      return
    }
    setCatalogSource(base, useImported ? 'imported' : 'board')
  }

  return (
    <Card>
      <CardTitle>Pattern catalog</CardTitle>
      <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, marginBottom: spacing.md }}>
        The On-Table pattern list normally comes from the table. Over weak Wi-Fi you can import it
        from a file — the card’s <Text style={{ fontFamily: font.family.mono }}>index.json</Text> — and
        freeze it, so the app stops re-reading the catalog from the board.
      </Text>

      <View style={styles.row}>
        <View style={{ flex: 1, paddingRight: spacing.md }}>
          <Text style={{ color: colors.foreground, fontWeight: font.weight.medium }}>Use imported catalog</Text>
          <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm }}>
            {imported
              ? `Showing ${importedCount} imported patterns — not fetching from the table.`
              : 'Off: the On-Table list is fetched from the table as usual.'}
          </Text>
        </View>
        <Toggle value={imported} onValueChange={toggleSource} disabled={!imported && importedCount === 0} />
      </View>

      <Button
        title={importedCount > 0 ? 'Replace catalog file…' : 'Import catalog file…'}
        icon="file-upload"
        variant="secondary"
        loading={busy}
        onPress={doImport}
        style={{ marginTop: spacing.md }}
      />
    </Card>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
})
