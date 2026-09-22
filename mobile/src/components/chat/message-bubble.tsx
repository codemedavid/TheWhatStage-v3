import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { memo } from 'react'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import type { MessageAttachment, MessageAttachmentButton, MessageAttachmentCard, MessageRow } from '@/data/types'
import { describeSendError } from '@/lib/send-error'
import { messageStamp } from '@/lib/format'
import { colors, radius, spacing } from '@/theme/tokens'

export const GROUP_GAP_MS = 20 * 60_000

export interface BubbleMeta {
  /** First message of a same-sender run (looser spacing above). */
  isFirstOfGroup: boolean
  /** Last message of a run: shows the time stamp. */
  isLastOfGroup: boolean
  /** Render a day/time separator above this bubble. */
  separator: string | null
  pending?: boolean
}

interface Props {
  message: MessageRow
  meta: BubbleMeta
}

function attachmentList(att: MessageRow['attachments']): MessageAttachment[] {
  return Array.isArray(att) ? att : []
}

// TODO: sign storage_path / media_asset_id attachments at read time (see
// src/data/messages.ts attachmentUrl). Direct urls only for now.
function displayUrl(att: MessageAttachment): string | null {
  return att.url ?? att.payload?.url ?? null
}

function Attachment({ att, onDark }: { att: MessageAttachment; onDark: boolean }) {
  const url = displayUrl(att)
  if (att.type === 'image' && url) {
    return (
      <Image
        source={{ uri: url }}
        style={styles.image}
        contentFit="cover"
        transition={150}
        cachePolicy="memory-disk"
        accessibilityLabel={att.name ?? 'Image attachment'}
      />
    )
  }
  if (att.type === 'action_page') {
    return (
      <View style={[styles.pageCard, onDark && styles.pageCardDark]}>
        <Ionicons name="link-outline" size={16} color={onDark ? '#fff' : colors.accent} />
        <Text style={[styles.pageCardText, onDark && { color: '#fff' }]} numberOfLines={2}>
          {att.name || 'Action page'}
        </Text>
      </View>
    )
  }
  return (
    <View style={[styles.fileChip, onDark && styles.fileChipDark]}>
      <Ionicons name="document-outline" size={13} color={onDark ? '#fff' : colors.tertiary} />
      <Text style={[styles.fileChipText, onDark && { color: '#fff' }]} numberOfLines={1}>
        {att.name ? `[${att.type ?? 'file'}] ${att.name}` : `[${att.type ?? 'file'}]`}
      </Text>
    </View>
  )
}

/** The buttons Messenger drew under the text, rendered where they appeared. */
function ButtonRow({ buttons, onDark }: { buttons: MessageAttachmentButton[]; onDark: boolean }) {
  return (
    <View style={{ gap: 5 }}>
      {buttons.map((button, index) => (
        <View key={index} style={[styles.sentButton, onDark && styles.sentButtonDark]}>
          <Text style={[styles.sentButtonText, onDark && { color: '#fff' }]} numberOfLines={1}>
            {button.label}
          </Text>
        </View>
      ))}
    </View>
  )
}

/** A card or carousel message, laid out the way the recipient swiped it. */
function CardStrip({ cards }: { cards: MessageAttachmentCard[] }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8 }}
      scrollEnabled={cards.length > 1}
    >
      {cards.map((card, index) => (
        <View key={index} style={styles.sentCard}>
          {card.image_url ? (
            <Image source={{ uri: card.image_url }} style={styles.sentCardImage} contentFit="cover" />
          ) : null}
          <View style={styles.sentCardBody}>
            <Text style={styles.sentCardTitle} numberOfLines={2}>
              {card.title}
            </Text>
            {card.subtitle ? (
              <Text style={styles.sentCardSubtitle} numberOfLines={2}>
                {card.subtitle}
              </Text>
            ) : null}
          </View>
          {(card.buttons ?? []).map((button, at) => (
            <View key={at} style={styles.sentCardButton}>
              <Text style={styles.sentCardButtonText} numberOfLines={1}>
                {button.label}
              </Text>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  )
}

function MessageBubbleInner({ message, meta }: Props) {
  const isInbound = message.sender === 'user'
  const isBot = message.sender === 'bot'
  const atts = attachmentList(message.attachments)
  // Buttons sit under the text and cards replace it, so both are pulled out of
  // the attachment run that renders above the body.
  const buttonsAtt = atts.find((att) => att.type === 'buttons')
  const cardsAtt = atts.find((att) => att.type === 'card')
  const leading = atts.filter((att) => att !== buttonsAtt && att !== cardsAtt)
  const hasBody = message.body.trim().length > 0 && !cardsAtt

  const bubbleStyle = isInbound ? styles.bubbleIn : isBot ? styles.bubbleBot : styles.bubbleOut
  const textColor = isInbound ? colors.bubbleInText : isBot ? colors.bubbleBotText : colors.bubbleOutText

  return (
    <View style={[styles.wrap, { marginTop: meta.isFirstOfGroup ? 10 : 2 }]}>
      {meta.separator && (
        <Text style={styles.separator} accessibilityRole="header">
          {meta.separator}
        </Text>
      )}
      {isBot && meta.isFirstOfGroup && (
        <View style={[styles.aiTag, styles.alignRight]}>
          <Ionicons name="sparkles" size={10} color={colors.bubbleBotAccent} />
          <Text style={styles.aiTagText}>AI</Text>
        </View>
      )}
      <View style={[styles.line, isInbound ? styles.alignLeft : styles.alignRight]}>
        <View
          style={[
            styles.bubble,
            bubbleStyle,
            isInbound ? styles.tailLeft : styles.tailRight,
            meta.pending && { opacity: 0.6 },
          ]}
        >
          {leading.map((att, i) => (
            <Attachment key={`${message.id}-${i}`} att={att} onDark={!isInbound && !isBot} />
          ))}
          {hasBody && <Text style={[styles.text, { color: textColor }]}>{message.body}</Text>}
          {buttonsAtt?.buttons?.length ? (
            <ButtonRow buttons={buttonsAtt.buttons} onDark={!isInbound && !isBot} />
          ) : null}
          {cardsAtt?.cards?.length ? <CardStrip cards={cardsAtt.cards} /> : null}
        </View>
      </View>
      {message.error && (
        <Text style={[styles.error, styles.alignRight]}>{describeSendError(message.error)}</Text>
      )}
      {meta.isLastOfGroup && !message.error && (
        <Text style={[styles.time, isInbound ? styles.alignLeft : styles.alignRight]}>
          {meta.pending ? 'Sending…' : messageStamp(message.created_at)}
        </Text>
      )}
    </View>
  )
}

/** Metas are rebuilt wholesale on every change, so compare them by value. */
function sameMeta(a: BubbleMeta, b: BubbleMeta): boolean {
  return (
    a.isFirstOfGroup === b.isFirstOfGroup &&
    a.isLastOfGroup === b.isLastOfGroup &&
    a.separator === b.separator &&
    !!a.pending === !!b.pending
  )
}

// buildMeta allocates a fresh object per row whenever the thread changes, so the
// default reference check made every bubble in a 200-message thread re-render
// each time one message landed. Value-comparing the meta keeps the work to the
// two or three bubbles whose grouping actually moved.
export const MessageBubble = memo(
  MessageBubbleInner,
  (prev, next) => prev.message === next.message && sameMeta(prev.meta, next.meta),
)

const styles = StyleSheet.create({
  sentButton: {
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    alignItems: 'center',
    backgroundColor: colors.borderSubtle,
  },
  sentButtonDark: { backgroundColor: 'rgba(255,255,255,0.18)' },
  sentButtonText: { fontSize: 13, fontWeight: '700', color: colors.accent },
  sentCard: {
    width: 190,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sentCardImage: { width: '100%', height: 96, backgroundColor: colors.borderSubtle },
  sentCardBody: { padding: 9, gap: 2 },
  sentCardTitle: { fontSize: 13, fontWeight: '700', color: colors.ink },
  sentCardSubtitle: { fontSize: 11, color: colors.tertiary, lineHeight: 16 },
  sentCardButton: {
    paddingVertical: 8,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sentCardButtonText: { fontSize: 12, fontWeight: '600', color: colors.accent },
  wrap: { paddingHorizontal: spacing.md },
  separator: {
    alignSelf: 'center',
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    marginVertical: spacing.md,
    letterSpacing: 0.3,
  },
  line: { flexDirection: 'row', width: '100%' },
  alignLeft: { justifyContent: 'flex-start', alignSelf: 'flex-start' },
  alignRight: { justifyContent: 'flex-end', alignSelf: 'flex-end' },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: radius.xl,
    gap: 6,
  },
  bubbleIn: { backgroundColor: colors.bubbleIn },
  bubbleOut: { backgroundColor: colors.bubbleOut },
  bubbleBot: { backgroundColor: colors.bubbleBot },
  tailLeft: { borderBottomLeftRadius: 6 },
  tailRight: { borderBottomRightRadius: 6 },
  text: { fontSize: 15.5, lineHeight: 21 },
  time: { fontSize: 10.5, color: colors.muted, marginTop: 3, marginHorizontal: 4 },
  error: { fontSize: 11, color: colors.danger, marginTop: 3, maxWidth: '80%' },
  aiTag: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 3, marginRight: 4 },
  aiTagText: { fontSize: 10, fontWeight: '700', color: colors.bubbleBotAccent, letterSpacing: 0.4 },
  image: { width: 220, height: 165, borderRadius: radius.md, backgroundColor: colors.borderSubtle },
  pageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    maxWidth: 240,
  },
  pageCardDark: { backgroundColor: 'rgba(255,255,255,0.14)', borderColor: 'rgba(255,255,255,0.25)' },
  pageCardText: { fontSize: 13, fontWeight: '600', color: colors.ink, flexShrink: 1 },
  fileChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    alignSelf: 'flex-start',
  },
  fileChipDark: { backgroundColor: 'rgba(255,255,255,0.16)' },
  fileChipText: { fontSize: 12, color: colors.body },
})
