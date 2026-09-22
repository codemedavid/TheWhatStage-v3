import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { useMemo, useState } from 'react'
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { KIND_ICON } from '@/components/submissions/page-stat-card'
import { Button } from '@/components/ui/button'
import { EmptyState, Skeleton } from '@/components/ui/primitives'
import { Sheet } from '@/components/ui/sheet'
import { useSendableActionPages, type SendableActionPage } from '@/data/action-pages'
import { useLeadSubmissions } from '@/data/submissions'
import { api } from '@/lib/api'
import { describeSendError } from '@/lib/send-error'
import { isImplied } from '@/lib/submission-data'
import { relativeTime } from '@/lib/format'
import { colors, radius, spacing, type } from '@/theme/tokens'

const TEXT_MAX = 640
const CTA_MAX = 20

interface Props {
  visible: boolean
  onClose: () => void
  leadId: string
  onSent?: () => void
}

function defaultText(page: SendableActionPage): string {
  return `${page.title}\n\n${page.description ?? ''}`.trim().slice(0, TEXT_MAX)
}

export function ActionPagesSheet({ visible, onClose, leadId, onSent }: Props) {
  const [selected, setSelected] = useState<SendableActionPage | null>(null)
  const [messageText, setMessageText] = useState('')
  const [ctaLabel, setCtaLabel] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pages = useSendableActionPages(visible)
  const submissions = useLeadSubmissions(visible ? leadId : null)

  // "They already filled this in" is the single most useful thing to know
  // before sending a page again — keyed by page so the list can say so.
  const filledAt = useMemo(() => {
    const map = new Map<string, string>()
    for (const row of submissions.data ?? []) {
      if (isImplied(row.outcome) || map.has(row.action_page_id)) continue
      map.set(row.action_page_id, row.created_at)
    }
    return map
  }, [submissions.data])

  const reset = () => {
    setSelected(null)
    setError(null)
    setSending(false)
  }
  const close = () => {
    reset()
    onClose()
  }
  const pick = (page: SendableActionPage) => {
    setSelected(page)
    setMessageText(defaultText(page))
    setCtaLabel((page.cta_label || 'Open').slice(0, CTA_MAX))
    setError(null)
  }

  const send = async () => {
    if (!selected || sending) return
    setSending(true)
    setError(null)
    const res = await api.sendActionPage(leadId, selected.id, {
      messageText: messageText.trim() || undefined,
      ctaLabel: ctaLabel.trim() || undefined,
    })
    setSending(false)
    if (!res.ok) {
      setError(describeSendError(res.error))
      return
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
    onSent?.()
    close()
  }

  return (
    <Sheet
      visible={visible}
      onClose={close}
      title={selected ? 'Send action page' : 'Action pages'}
      subtitle={selected ? selected.title : 'Send the lead a button to a published page'}
      height={0.78}
      action={
        selected ? (
          <Pressable onPress={reset} hitSlop={8} accessibilityRole="button">
            <Text style={styles.link}>Back</Text>
          </Pressable>
        ) : undefined
      }
    >
      {selected ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.md, paddingBottom: spacing.lg }}>
          <Text style={type.label}>Message</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={messageText}
            onChangeText={(t) => setMessageText(t.slice(0, TEXT_MAX))}
            multiline
            placeholder="Say why they should open it"
            placeholderTextColor={colors.muted}
          />
          <Text style={styles.counter}>
            {messageText.length}/{TEXT_MAX}
          </Text>
          <Text style={type.label}>Button label</Text>
          <TextInput
            style={styles.input}
            value={ctaLabel}
            onChangeText={(t) => setCtaLabel(t.slice(0, CTA_MAX))}
            placeholder="Open"
            placeholderTextColor={colors.muted}
          />
          <Text style={styles.counter}>
            {ctaLabel.length}/{CTA_MAX}
          </Text>
          <View style={styles.preview}>
            <Text style={styles.previewText}>{messageText || defaultText(selected)}</Text>
            <View style={styles.previewBtn}>
              <Text style={styles.previewBtnText}>{ctaLabel || 'Open'}</Text>
            </View>
          </View>
          {error ? (
            <View style={styles.error}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={{ color: colors.danger, fontSize: 13, flex: 1 }}>{error}</Text>
            </View>
          ) : null}
          <Button label="Send" onPress={send} loading={sending} size="lg" icon={<Ionicons name="paper-plane" size={16} color="#fff" />} />
        </ScrollView>
      ) : pages.isLoading ? (
        <View style={{ gap: 10 }}>
          <Skeleton height={60} />
          <Skeleton height={60} />
        </View>
      ) : pages.isError ? (
        <EmptyState icon="cloud-offline-outline" title="Couldn't load pages" body={describeSendError(pages.error.message)} />
      ) : (
        <FlatList
          data={pages.data ?? []}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ gap: 8, paddingBottom: spacing.lg }}
          ListEmptyComponent={
            <EmptyState
              icon="link-outline"
              title="No published pages"
              body="Publish a form, booking, or order page in the dashboard and it will show up here."
            />
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => pick(item)}
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.accentSubtle }]}
            >
              <View style={styles.kindIcon}>
                <Ionicons name={KIND_ICON[item.kind] ?? 'link-outline'} size={18} color={colors.accent} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={styles.titleRow}>
                  <Text style={[type.bodyStrong, { flexShrink: 1 }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  {filledAt.has(item.id) ? (
                    <View style={styles.filled}>
                      <Ionicons name="checkmark-circle" size={11} color={colors.accentDeep} />
                      <Text style={styles.filledText}>Filled {relativeTime(filledAt.get(item.id))}</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={type.small} numberOfLines={2}>
                  {item.description || item.kind}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.muted} />
            </Pressable>
          )}
        />
      )}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  link: { color: colors.accent, fontWeight: '600', fontSize: 15 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  filled: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.accentLight,
  },
  filledText: { fontSize: 10, fontWeight: '700', color: colors.accentDeep },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  kindIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
  },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  counter: { ...type.caption, textAlign: 'right', marginTop: -6 },
  preview: {
    backgroundColor: colors.bubbleOut,
    borderRadius: radius.xl,
    borderBottomRightRadius: 6,
    padding: 12,
    alignSelf: 'flex-end',
    maxWidth: '85%',
    gap: 8,
  },
  previewText: { color: '#fff', fontSize: 14.5, lineHeight: 20 },
  previewBtn: {
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: radius.sm,
    paddingVertical: 8,
    alignItems: 'center',
  },
  previewBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.dangerLight,
    padding: 10,
    borderRadius: radius.sm,
  },
})
