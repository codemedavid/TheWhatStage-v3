import { Ionicons } from '@expo/vector-icons'
import { useQueryClient } from '@tanstack/react-query'
import * as Haptics from 'expo-haptics'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ActionPagesSheet } from '@/components/chat/action-pages-sheet'
import { BotSheet } from '@/components/chat/bot-sheet'
import { MediaSheet } from '@/components/chat/media-sheet'
import { Composer, type ComposerHandle, type ComposerSubmit } from '@/components/chat/composer'
import { GROUP_GAP_MS, MessageBubble, type BubbleMeta } from '@/components/chat/message-bubble'
import { SavedMessagesSheet } from '@/components/chat/saved-messages-sheet'
import { isTakenOver, threadDisplayName } from '@/components/chat/thread-row'
import { Avatar } from '@/components/ui/avatar'
import { KeyboardView, useKeyboardVisible } from '@/components/ui/keyboard-view'
import { EmptyState, Skeleton, StageChip } from '@/components/ui/primitives'
import { IconButton, ScreenHeader } from '@/components/ui/screen-header'
import { StagePickerSheet } from '@/components/ui/stage-picker-sheet'
import { useMoveLead, useStages } from '@/data/leads'
import { messageKeys, useMessages, useMessagesRealtime } from '@/data/messages'
import { savedMessageSendBody, useSavedMessages } from '@/data/saved-messages'
import { useMarkThreadSeen, useThread } from '@/data/threads'
import { one, type MessageAttachment, type MessageRow, type SavedMessage } from '@/data/types'
import { usesCards, type SavedButton } from '@/lib/saved-message-template'
import { api } from '@/lib/api'
import { messageStamp } from '@/lib/format'
import { describeSendError } from '@/lib/send-error'
import { colors, spacing, type } from '@/theme/tokens'

// Two id prefixes mark a locally-created bubble: SENDING while the request is
// in flight, SENT once the server has acknowledged it. Both are optimistic —
// they live only in the cache until the realtime INSERT delivers the real row —
// but only SENDING shows the "Sending…" stamp.
const SENDING_PREFIX = 'sending-'
const SENT_PREFIX = 'sent-'
const DEDUPE_WINDOW_MS = 10_000

const isOptimistic = (id: string) => id.startsWith(SENDING_PREFIX) || id.startsWith(SENT_PREFIX)

// A thread loads up to 200 messages. The default render window keeps roughly ten
// screens of cells mounted either side of the viewport, which on a long thread
// is every bubble in the thread — so each new message re-laid out the whole
// list. One screen up front plus a ~5-screen window keeps scrolling smooth
// while leaving updates cheap.
const INITIAL_RENDER = 15
const BATCH_SIZE = 10
const WINDOW_SIZE = 11

const keyExtractor = (m: MessageRow) => m.id
const LIST_CONTENT = { paddingVertical: spacing.md }

// Sends are no longer serialised, so two can start inside the same millisecond.
// A counter keeps optimistic ids unique where Date.now() alone would collide.
let tempSeq = 0
const nextSendingId = () => `${SENDING_PREFIX}${Date.now()}-${tempSeq++}`

/**
 * What the optimistic bubble shows for a saved message with a layout: the same
 * button labels and cards the send path will persist on the real row.
 */
function optimisticAttachments(message: SavedMessage): MessageAttachment[] | null {
  const labels = (buttons: SavedButton[]) => buttons.map((button) => ({ label: button.label }))
  if (usesCards(message.layout)) {
    return [
      {
        type: 'card',
        cards: message.cards.map((card) => ({
          title: card.title,
          subtitle: card.subtitle,
          buttons: labels(card.buttons),
        })),
      },
    ]
  }
  if (message.layout === 'buttons') return [{ type: 'buttons', buttons: labels(message.buttons) }]
  return null
}

/** Compute grouping/separator metadata for a newest-first list. */
function buildMeta(rows: MessageRow[]): BubbleMeta[] {
  return rows.map((m, i) => {
    const newer = rows[i - 1] // rendered below (later in time)
    const older = rows[i + 1] // rendered above (earlier in time)
    const t = new Date(m.created_at).getTime()
    const olderT = older ? new Date(older.created_at).getTime() : null
    const newerT = newer ? new Date(newer.created_at).getTime() : null
    const breaksAbove = !older || older.sender !== m.sender || olderT == null || t - olderT > GROUP_GAP_MS
    const breaksBelow = !newer || newer.sender !== m.sender || newerT == null || newerT - t > GROUP_GAP_MS
    const separator = !older || (olderT != null && t - olderT > GROUP_GAP_MS) ? messageStamp(m.created_at) : null
    return {
      isFirstOfGroup: breaksAbove,
      isLastOfGroup: breaksBelow,
      separator,
      pending: m.id.startsWith(SENDING_PREFIX),
    }
  })
}

export default function ChatScreen() {
  const { threadId } = useLocalSearchParams<{ threadId: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const keyboardVisible = useKeyboardVisible()
  const qc = useQueryClient()

  const thread = useThread(threadId)
  const messages = useMessages(threadId)
  useMessagesRealtime(threadId)
  const stages = useStages()
  const saved = useSavedMessages()
  const markSeen = useMarkThreadSeen()
  const moveLead = useMoveLead()

  const [savedOpen, setSavedOpen] = useState(false)
  const composer = useRef<ComposerHandle>(null)
  const [pagesOpen, setPagesOpen] = useState(false)
  const [mediaOpen, setMediaOpen] = useState(false)
  const [botOpen, setBotOpen] = useState(false)
  const [stageOpen, setStageOpen] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const seenOnce = useRef(false)

  useEffect(() => {
    if (!thread.data || seenOnce.current) return
    seenOnce.current = true
    markSeen.mutate(thread.data.id)
  }, [thread.data, markSeen])

  const leadId = thread.data?.lead_id ?? null
  const lead = one(thread.data?.leads)
  const name = thread.data ? threadDisplayName(thread.data) : ''
  const stage = stages.data?.find((s) => s.id === lead?.stage_id) ?? null

  const rows = useMemo(() => messages.data ?? [], [messages.data])
  const metas = useMemo(() => buildMeta(rows), [rows])

  // Depends on `metas` alone: typing in the composer, opening a sheet or a
  // thread refetch no longer invalidates every cell in the list.
  const renderItem = useCallback(
    ({ item, index }: ListRenderItemInfo<MessageRow>) => <MessageBubble message={item} meta={metas[index]} />,
    [metas],
  )

  // Drop an optimistic bubble once the real row for it arrives via realtime.
  useEffect(() => {
    if (!threadId) return
    const temps = rows.filter((m) => isOptimistic(m.id))
    if (temps.length === 0) return
    // Pair each temp with a DISTINCT real row: sending the same text twice
    // must retire two bubbles only once both echoes have landed.
    const claimed = new Set<string>()
    const stale = temps.filter((t) => {
      const tAt = new Date(t.created_at).getTime()
      const match = rows.find(
        (m) =>
          !isOptimistic(m.id) &&
          !claimed.has(m.id) &&
          m.sender === 'operator' &&
          m.body === t.body &&
          Math.abs(new Date(m.created_at).getTime() - tAt) < DEDUPE_WINDOW_MS,
      )
      if (!match) return false
      claimed.add(match.id)
      return true
    })
    if (stale.length === 0) return
    const ids = new Set(stale.map((s) => s.id))
    qc.setQueryData<MessageRow[]>(messageKeys.thread(threadId), (prev) => prev?.filter((m) => !ids.has(m.id)))
  }, [rows, threadId, qc])

  const statusLine = useMemo(() => {
    if (!thread.data) return ''
    if (isTakenOver(thread.data)) return "Bot paused · you're replying"
    return thread.data.auto_reply_enabled ? 'AI replying' : 'Auto-reply off'
  }, [thread.data])

  const send = useCallback(
    async ({ text, saved: savedMessage }: ComposerSubmit) => {
      if (!threadId || !leadId) return
      // The bubble mirrors what will actually be sent — buttons, cards and all —
      // and its body matches the row the server will write, so it retires the
      // moment that row arrives.
      const temp: MessageRow = {
        id: nextSendingId(),
        thread_id: threadId,
        direction: 'outbound',
        sender: 'operator',
        body: savedMessage ? savedMessageSendBody(savedMessage, text) : text,
        attachments: savedMessage ? optimisticAttachments(savedMessage) : null,
        error: null,
        fb_message_id: null,
        created_at: new Date().toISOString(),
      }
      qc.setQueryData<MessageRow[]>(messageKeys.thread(threadId), (prev) => [temp, ...(prev ?? [])])
      setSendError(null)
      const res = savedMessage
        ? await api.sendSavedMessage(
            leadId,
            savedMessage.id,
            usesCards(savedMessage.layout) ? undefined : text,
          )
        : await api.sendMessage(leadId, text)
      if (res.ok) {
        // Delivered. Retire "Sending…" now — the realtime INSERT that swaps in
        // the real row lands a beat later, and waiting for it is what made a
        // sent message look stuck.
        qc.setQueryData<MessageRow[]>(messageKeys.thread(threadId), (prev) =>
          prev?.map((m) => (m.id === temp.id ? { ...m, id: `${SENT_PREFIX}${m.id}` } : m)),
        )
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
        return
      }
      qc.setQueryData<MessageRow[]>(messageKeys.thread(threadId), (prev) => prev?.filter((m) => m.id !== temp.id))
      setSendError(describeSendError(res.error))
    },
    [threadId, leadId, qc],
  )

  return (
    <View style={styles.screen}>
      <ScreenHeader
        back
        center={
          thread.data ? (
            <Pressable
              style={styles.headerCenter}
              disabled={!leadId}
              onPress={() => leadId && router.push(`/lead/${leadId}`)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${name}`}
            >
              <Avatar name={name} uri={thread.data.picture_url} size={36} ring={isTakenOver(thread.data)} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={type.heading} numberOfLines={1}>
                  {name}
                </Text>
                <View style={styles.statusRow}>
                  <Text style={styles.status} numberOfLines={1}>
                    {statusLine}
                  </Text>
                  {stage && leadId && (
                    <StageChip name={stage.name} kind={stage.kind} onPress={() => setStageOpen(true)} style={styles.chip} />
                  )}
                </View>
              </View>
            </Pressable>
          ) : (
            <View style={[styles.headerCenter, { gap: 10 }]}>
              <Skeleton width={36} height={36} round />
              <Skeleton width="50%" height={16} />
            </View>
          )
        }
        right={
          thread.data ? (
            <>
              <IconButton
                name={thread.data.auto_reply_enabled && !isTakenOver(thread.data) ? 'sparkles' : 'sparkles-outline'}
                label="Bot settings"
                tint={thread.data.auto_reply_enabled && !isTakenOver(thread.data) ? colors.bubbleBotAccent : colors.tertiary}
                onPress={() => setBotOpen(true)}
              />
              {leadId && <IconButton name="information-circle-outline" label="Lead details" onPress={() => router.push(`/lead/${leadId}`)} />}
            </>
          ) : undefined
        }
      />

      <KeyboardView style={{ flex: 1 }}>
        <FlatList
          data={rows}
          inverted
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          contentContainerStyle={LIST_CONTENT}
          keyboardDismissMode="interactive"
          keyboardShouldPersistTaps="handled"
          initialNumToRender={INITIAL_RENDER}
          maxToRenderPerBatch={BATCH_SIZE}
          windowSize={WINDOW_SIZE}
          updateCellsBatchingPeriod={50}
          removeClippedSubviews={Platform.OS === 'android'}
          ListEmptyComponent={
            messages.isLoading ? (
              <View style={{ padding: spacing.lg, gap: 12 }}>
                <Skeleton width="55%" height={40} />
                <Skeleton width="60%" height={40} style={{ alignSelf: 'flex-end' }} />
              </View>
            ) : (
              <View style={{ transform: [{ scaleY: -1 }] }}>
                <EmptyState title="No messages yet" body="Say hello — your reply lands in their Messenger." />
              </View>
            )
          }
        />

        {sendError && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={16} color={colors.danger} />
            <Text style={styles.errorText}>{sendError}</Text>
            <Pressable onPress={() => setSendError(null)} hitSlop={8} accessibilityLabel="Dismiss">
              <Ionicons name="close" size={16} color={colors.danger} />
            </Pressable>
          </View>
        )}

        {/* The keyboard covers the gesture bar, so the inset only applies while
            it is down — keeping it would float the composer above the keys. */}
        <View style={{ paddingBottom: keyboardVisible ? 0 : insets.bottom }}>
          <Composer
            disabled={!!thread.data && !leadId}
            disabledNote="This chat isn't linked to a lead yet."
            saved={saved.data ?? []}
            leadName={name}
            ref={composer}
            onSend={send}
            onOpenSaved={() => setSavedOpen(true)}
            onOpenActionPages={() => setPagesOpen(true)}
            onOpenMedia={() => setMediaOpen(true)}
          />
        </View>
      </KeyboardView>

      <SavedMessagesSheet
        visible={savedOpen}
        onClose={() => setSavedOpen(false)}
        leadName={name}
        onPick={(m) => composer.current?.load(m)}
      />
      {leadId && <ActionPagesSheet visible={pagesOpen} onClose={() => setPagesOpen(false)} leadId={leadId} />}
      {leadId && <MediaSheet visible={mediaOpen} onClose={() => setMediaOpen(false)} leadId={leadId} />}
      {thread.data && <BotSheet visible={botOpen} onClose={() => setBotOpen(false)} thread={thread.data} />}
      {leadId && (
        <StagePickerSheet
          visible={stageOpen}
          onClose={() => setStageOpen(false)}
          stages={(stages.data ?? []).map((s) => ({ id: s.id, name: s.name, kind: s.kind }))}
          currentId={lead?.stage_id}
          onPick={(toStageId) => moveLead.mutate({ leadId, toStageId })}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  status: { fontSize: 12, color: colors.tertiary, flexShrink: 1 },
  chip: { paddingVertical: 2, paddingHorizontal: 8 },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.md,
    marginBottom: 6,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.dangerLight,
  },
  errorText: { flex: 1, fontSize: 13, color: colors.danger },
})
