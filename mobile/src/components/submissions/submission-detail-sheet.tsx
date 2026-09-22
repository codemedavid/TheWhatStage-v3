import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useMemo } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { submissionName, submissionPageTitle, OutcomeTag } from './submission-row'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { useThreadByLead } from '@/data/threads'
import type { SubmissionRow } from '@/data/types'
import { messageStamp } from '@/lib/format'
import { impliedQuote, submissionFields, submissionSource } from '@/lib/submission-data'
import { colors, radius, spacing, type } from '@/theme/tokens'

interface Props {
  row: SubmissionRow | null
  onClose: () => void
}

/** Everything one person answered, plus the two things you'd do next. */
export function SubmissionDetailSheet({ row, onClose }: Props) {
  const router = useRouter()
  const thread = useThreadByLead(row?.lead_id ?? undefined)
  const fields = useMemo(() => submissionFields(row?.data), [row?.data])
  const quote = impliedQuote(row?.data)

  const openChat = (threadId: string) => {
    onClose()
    router.push(`/chat/${threadId}`)
  }

  const openLead = (leadId: string) => {
    onClose()
    router.push(`/lead/${leadId}`)
  }

  return (
    <Sheet
      visible={!!row}
      onClose={onClose}
      title={row ? submissionName(row) : ''}
      subtitle={row ? `${submissionPageTitle(row)} · ${submissionSource(row.psid)}` : undefined}
      height={0.72}
    >
      {row && (
        <ScrollView contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.lg }}>
          <View style={styles.metaRow}>
            <OutcomeTag outcome={row.outcome} />
            <Text style={type.small}>{messageStamp(row.created_at)}</Text>
          </View>

          {quote ? (
            <View style={styles.quote}>
              <Ionicons name="chatbubble-ellipses-outline" size={15} color={colors.warning} />
              <Text style={[type.body, { flex: 1, fontStyle: 'italic' }]}>“{quote}”</Text>
            </View>
          ) : null}

          {fields.length === 0 ? (
            <Text style={type.small}>No answers were captured on this submission.</Text>
          ) : (
            <View style={styles.card}>
              {fields.map((f, i) => (
                <View key={`${f.label}-${i}`} style={[styles.field, i > 0 && styles.fieldDivided]}>
                  <Text style={type.caption}>{f.label}</Text>
                  <Text style={[type.body, { color: colors.ink }]}>{f.value}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.actions}>
            {thread.data ? (
              <Button
                label="Open chat"
                style={{ flex: 1 }}
                icon={<Ionicons name="chatbubbles-outline" size={16} color="#fff" />}
                onPress={() => openChat(thread.data!.id)}
              />
            ) : null}
            {row.lead_id ? (
              <Button
                label="Lead"
                variant="secondary"
                style={{ flex: thread.data ? 0.7 : 1 }}
                icon={<Ionicons name="person-outline" size={16} color={colors.ink} />}
                onPress={() => openLead(row.lead_id!)}
              />
            ) : null}
          </View>
        </ScrollView>
      )}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  field: { paddingVertical: 10, gap: 2 },
  fieldDivided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderSubtle },
  quote: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.warningLight,
  },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
})
