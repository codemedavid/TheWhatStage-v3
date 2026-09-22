import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { ScrollView, StyleSheet, Text, View } from 'react-native'
import { useMediaAssetThumb } from '@/data/media'
import { previewPersonalize } from '@/lib/format'
import { usesCards, type SavedButton, type SavedCard, type SavedLayout } from '@/lib/saved-message-template'
import { colors, radius, spacing, type } from '@/theme/tokens'

const BUTTON_ICONS: Record<SavedButton['type'], keyof typeof Ionicons.glyphMap> = {
  url: 'open-outline',
  action_page: 'document-text-outline',
  phone: 'call-outline',
  postback: 'chatbubble-ellipses-outline',
}

interface Props {
  layout: SavedLayout
  body: string
  buttons: SavedButton[]
  cards: SavedCard[]
  /** Name used to render merge tags — the real lead's when there is one. */
  leadName?: string | null
  placeholder?: string
}

/**
 * What the customer will actually see, layout and all. Merge tags are rendered
 * so an operator can tell at a glance that `[first_name]` becomes a name and
 * not a bracket.
 */
export function SavedMessagePreview({
  layout,
  body,
  buttons,
  cards,
  leadName,
  placeholder = 'Your message appears here',
}: Props) {
  const name = leadName ?? 'Juan Dela Cruz'
  return (
    <View style={styles.wrap}>
      {usesCards(layout) ? (
        <CardsPreview cards={cards} leadName={name} />
      ) : (
        <TextPreview
          body={body}
          buttons={layout === 'buttons' ? buttons : []}
          leadName={name}
          placeholder={placeholder}
        />
      )}
      <Text style={[type.caption, { textAlign: 'right' }]}>Preview</Text>
    </View>
  )
}

function TextPreview({
  body,
  buttons,
  leadName,
  placeholder,
}: {
  body: string
  buttons: SavedButton[]
  leadName: string
  placeholder: string
}) {
  const text = body.trim()
  return (
    <View style={styles.bubble}>
      <Text style={[styles.text, !text && { opacity: 0.6 }]}>
        {text ? previewPersonalize(text, leadName) : placeholder}
      </Text>
      {buttons.map((button, index) => (
        <View key={index} style={styles.button}>
          <Ionicons name={BUTTON_ICONS[button.type]} size={13} color="#fff" />
          <Text style={styles.buttonText} numberOfLines={1}>
            {button.label.trim() || 'Button'}
          </Text>
        </View>
      ))}
    </View>
  )
}

/** Cards preview horizontally, the way a carousel behaves in Messenger. */
function CardsPreview({ cards, leadName }: { cards: SavedCard[]; leadName: string }) {
  if (cards.length === 0) {
    return (
      <View style={styles.bubble}>
        <Text style={[styles.text, { opacity: 0.6 }]}>Your card appears here</Text>
      </View>
    )
  }
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.cardStrip}
      // A single card should not scroll away from the edge.
      scrollEnabled={cards.length > 1}
    >
      {cards.map((card, index) => (
        <CardPreview key={index} card={card} leadName={leadName} />
      ))}
    </ScrollView>
  )
}

function CardPreview({ card, leadName }: { card: SavedCard; leadName: string }) {
  const thumb = useMediaAssetThumb(card.image_asset_id)
  const image = card.image_url ?? thumb.data ?? null
  return (
    <View style={styles.card}>
      {image ? (
        <Image source={{ uri: image }} style={styles.cardImage} contentFit="cover" transition={120} />
      ) : (
        <View style={[styles.cardImage, styles.cardImageEmpty]}>
          <Ionicons name="image-outline" size={22} color={colors.muted} />
        </View>
      )}
      <View style={styles.cardBody}>
        <Text style={styles.cardTitle} numberOfLines={2}>
          {previewPersonalize(card.title.trim() || 'Card title', leadName)}
        </Text>
        {card.subtitle?.trim() ? (
          <Text style={styles.cardSubtitle} numberOfLines={2}>
            {previewPersonalize(card.subtitle.trim(), leadName)}
          </Text>
        ) : null}
      </View>
      {card.buttons.map((button, index) => (
        <View key={index} style={styles.cardButton}>
          <Text style={styles.cardButtonText} numberOfLines={1}>
            {button.label.trim() || 'Button'}
          </Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  bubble: {
    alignSelf: 'flex-end',
    maxWidth: '88%',
    minWidth: 140,
    gap: 8,
    padding: 12,
    borderRadius: radius.xl,
    borderBottomRightRadius: 6,
    backgroundColor: colors.bubbleOut,
  },
  text: { color: colors.bubbleOutText, fontSize: 15, lineHeight: 21 },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderRadius: radius.sm,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  cardStrip: { gap: 8, paddingRight: spacing.sm },
  card: {
    width: 210,
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardImage: { width: '100%', height: 110, backgroundColor: colors.borderSubtle },
  cardImageEmpty: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { padding: 10, gap: 2 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: colors.ink },
  cardSubtitle: { fontSize: 12, color: colors.tertiary, lineHeight: 17 },
  cardButton: {
    paddingVertical: 10,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  cardButtonText: { fontSize: 13, fontWeight: '600', color: colors.accent },
})
