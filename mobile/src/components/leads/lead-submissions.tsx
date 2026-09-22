import { Ionicons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SubmissionDetailSheet } from '@/components/submissions/submission-detail-sheet'
import { OutcomeTag, submissionPageTitle } from '@/components/submissions/submission-row'
import { Card, SectionLabel } from '@/components/ui/primitives'
import { useLeadSubmissions } from '@/data/submissions'
import type { SubmissionRow } from '@/data/types'
import { relativeTime } from '@/lib/format'
import { colors, spacing, type } from '@/theme/tokens'

/** Which action pages this one lead has filled in, newest first. */
export function LeadSubmissions({ leadId }: { leadId: string }) {
  const submissions = useLeadSubmissions(leadId)
  const [open, setOpen] = useState<SubmissionRow | null>(null)
  const rows = submissions.data ?? []

  return (
    <>
      <SectionLabel>Action pages</SectionLabel>
      <Card style={{ paddingVertical: 4 }}>
        {rows.length === 0 ? (
          <Text style={[type.small, { paddingVertical: spacing.sm }]}>
            {submissions.isLoading ? 'Loading…' : 'Hasn’t filled in an action page yet'}
          </Text>
        ) : (
          rows.map((row, i) => (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              onPress={() => setOpen(row)}
              style={[styles.row, i === rows.length - 1 && { borderBottomWidth: 0 }]}
            >
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={type.bodyStrong} numberOfLines={1}>
                  {submissionPageTitle(row)}
                </Text>
                <View style={styles.meta}>
                  <OutcomeTag outcome={row.outcome} />
                  <Text style={type.caption}>{relativeTime(row.created_at)}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.muted} />
            </Pressable>
          ))
        )}
      </Card>
      <SubmissionDetailSheet row={open} onClose={() => setOpen(null)} />
    </>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
})
