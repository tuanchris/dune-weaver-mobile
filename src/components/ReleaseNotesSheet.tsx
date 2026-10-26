// "What's new" sheet, shared by the app and the table's firmware.
//
// The two sources are written differently — app notes are owner-facing bullets
// ("• Favorites …"), firmware notes are the GitHub release body in markdown —
// so the renderer below handles a small, deliberate subset of markdown rather
// than pulling in a markdown library for one sheet: headings, bullets, and the
// inline emphasis/code/link syntax that would otherwise show as raw punctuation.

import React from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '../stores/useTheme'
import { Sheet } from './Sheet'
import { radius, spacing, font } from '../theme'

export interface NotesEntry {
  /** Version label, shown in mono like every other version in the app. */
  version: string
  notes: string
  /** Optional chip, e.g. "Installed" / "Available" / "Pre-release". */
  badge?: string
  /** Optional secondary line, e.g. a publish date. */
  meta?: string
}

/** Strip the inline markdown that would otherwise render as literal punctuation:
 * **bold**, _em_, `code`, [text](url) — keeping the text itself. */
function inline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, '$1$2')
    .replace(/ -- /g, ' — ')
}

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'gap' }

function toBlocks(notes: string): Block[] {
  const out: Block[] = []
  // The firmware's release bodies are hard-wrapped at ~80 columns, so a single
  // bullet spans several source lines. Treat a plain line after a bullet or
  // paragraph as a CONTINUATION of it — rendering each source line as its own
  // block would break every long bullet into ragged fragments.
  const append = (text: string): boolean => {
    const last = out[out.length - 1]
    if (!last || (last.kind !== 'bullet' && last.kind !== 'para')) return false
    last.text = `${last.text} ${text}`
    return true
  }

  for (const raw of notes.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) {
      // A blank line ends the current block and collapses runs into one gap.
      if (out.length && out[out.length - 1].kind !== 'gap') out.push({ kind: 'gap' })
      continue
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      out.push({ kind: 'heading', text: heading[1] })
      continue
    }
    const bullet = /^(?:[-*+]|•|\d+\.)\s+(.*)$/.exec(line)
    if (bullet) {
      // The firmware notes title each section with a plain line ("WiFi
      // recovery") straight above its bullets: a short one-liner there, with
      // no closing punctuation, is a heading.
      const last = out[out.length - 1]
      if (last?.kind === 'para' && last.text.length <= 60 && !/[.!?:]$/.test(last.text) && (out.length === 1 || out[out.length - 2].kind === 'gap')) {
        out[out.length - 1] = { kind: 'heading', text: last.text }
      }
      out.push({ kind: 'bullet', text: bullet[1] })
      continue
    }
    if (!append(line)) out.push({ kind: 'para', text: line })
  }
  while (out.length && out[out.length - 1].kind === 'gap') out.pop()
  // Inline markdown last: a hard-wrapped bullet's **bold** often spans two source lines.
  return out.map((b) => (b.kind === 'gap' ? b : { ...b, text: inline(b.text) }))
}

/** One line for a list row: the release's headings ("WiFi recovery · LED fixes"),
 * else its first bullet — not the intro sentence every release repeats. */
export function notesSummary(notes: string): string {
  const blocks = toBlocks(notes)
  const heads = blocks.flatMap((b) => (b.kind === 'heading' ? [b.text] : []))
  if (heads.length) return heads.join(' · ')
  const first = blocks.find((b) => b.kind === 'bullet') ?? blocks.find((b) => b.kind === 'para')
  return first ? first.text : ''
}

/** Release notes, rendered (headings, bullets, paragraphs). */
export function Notes({ notes }: { notes: string }) {
  const colors = useTheme((s) => s.colors)
  return (
    <View style={{ gap: spacing.xs }}>
      {toBlocks(notes).map((b, i) => {
        if (b.kind === 'gap') return <View key={i} style={{ height: spacing.xs }} />
        if (b.kind === 'heading') {
          return (
            <Text
              key={i}
              style={{
                color: colors.foreground,
                fontFamily: font.family.displaySemi,
                fontSize: font.size.md,
                marginTop: i === 0 ? 0 : spacing.xs,
              }}
            >
              {b.text}
            </Text>
          )
        }
        if (b.kind === 'bullet') {
          return (
            <View key={i} style={styles.bullet}>
              <Text style={{ color: colors.primary, fontSize: font.size.sm, lineHeight: 21 }}>•</Text>
              <Text style={{ color: colors.mutedForeground, fontSize: font.size.sm, lineHeight: 21, flex: 1 }}>{b.text}</Text>
            </View>
          )
        }
        return (
          <Text key={i} style={{ color: colors.mutedForeground, fontSize: font.size.sm, lineHeight: 21 }}>
            {b.text}
          </Text>
        )
      })}
    </View>
  )
}

export function ReleaseNotesSheet({
  visible,
  title,
  entries,
  loading = false,
  emptyText = 'No release notes to show.',
  onClose,
}: {
  visible: boolean
  title: string
  entries: NotesEntry[]
  loading?: boolean
  emptyText?: string
  onClose: () => void
}) {
  const colors = useTheme((s) => s.colors)
  return (
    <Sheet variant="page" visible={visible} onClose={onClose} title={title}>
      <View style={styles.body}>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing.xl }} />
        ) : entries.length === 0 ? (
          <Text style={{ color: colors.mutedForeground, paddingVertical: spacing.lg }}>{emptyText}</Text>
        ) : (
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ paddingBottom: spacing.md, gap: spacing.lg }}>
            {entries.map((e) => (
              <View key={e.version} style={{ gap: spacing.sm }}>
                <View style={styles.entryHead}>
                  <Text style={{ color: colors.foreground, fontFamily: font.family.monoMedium, fontSize: font.size.md }}>
                    {e.version}
                  </Text>
                  {e.badge ? (
                    <Text style={[styles.tag, { color: colors.primary, borderColor: colors.primary }]}>{e.badge}</Text>
                  ) : null}
                  {e.meta ? (
                    <Text style={{ color: colors.mutedForeground, fontSize: font.size.xs }}>{e.meta}</Text>
                  ) : null}
                </View>
                <Notes notes={e.notes} />
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({
  body: { flex: 1, paddingHorizontal: spacing.lg },
  entryHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  bullet: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  tag: {
    fontSize: font.size.xs,
    fontWeight: font.weight.medium,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 1,
    overflow: 'hidden',
  },
})
