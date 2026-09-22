import { Ionicons } from '@expo/vector-icons'
import { Image } from 'expo-image'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useMediaAssetThumb } from '@/data/media'
import {
  CARD_SUBTITLE_MAX,
  CARD_TITLE_MAX,
  emptyCard,
  maxCardsFor,
  type SavedCard,
  type SavedLayout,
} from '@/lib/saved-message-template'
import { colors, radius, spacing, type } from '@/theme/tokens'
import { ButtonList } from './button-list'
import { CardImageSheet, type CardImage } from './card-image-sheet'
import { Field } from './field'

interface Props {
  layout: Extract<SavedLayout, 'card' | 'carousel'>
  cards: SavedCard[]
  onChange: (cards: SavedCard[]) => void
}

/**
 * The cards of a card or carousel message. A card layout holds exactly one, so
 * the add row and the per-card header only appear once a carousel can have
 * several — one card should not look like a list of one.
 */
export function CardList({ layout, cards, onChange }: Props) {
  const max = maxCardsFor(layout)
  const isCarousel = layout === 'carousel'

  const patchAt = (index: number, patch: Partial<SavedCard>) =>
    onChange(cards.map((card, at) => (at === index ? { ...card, ...patch } : card)))

  const removeAt = (index: number) => onChange(cards.filter((_, at) => at !== index))

  const move = (index: number, by: number) => {
    const to = index + by
    if (to < 0 || to >= cards.length) return
    const next = [...cards]
    const [card] = next.splice(index, 1)
    next.splice(to, 0, card)
    onChange(next)
  }

  return (
    <View style={{ gap: spacing.md }}>
      {/* The caps below are Messenger's, and a card silently truncates past
          them — worth saying once, because the way out is a different layout
          rather than shorter copy. */}
      <Text style={type.caption}>
        A card holds {CARD_TITLE_MAX} characters of title and {CARD_SUBTITLE_MAX} of subtitle. For longer
        copy, send as Message or Buttons instead.
      </Text>
      {cards.map((card, index) => (
        <CardEditor
          key={index}
          card={card}
          index={index}
          total={cards.length}
          showHeader={isCarousel}
          onPatch={(patch) => patchAt(index, patch)}
          onRemove={cards.length > 1 ? () => removeAt(index) : undefined}
          onMove={isCarousel && cards.length > 1 ? (by) => move(index, by) : undefined}
        />
      ))}

      {cards.length < max ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => onChange([...cards, emptyCard()])}
          style={({ pressed }) => [styles.add, pressed && { backgroundColor: colors.accentSubtle }]}
        >
          <Ionicons name="add-circle-outline" size={17} color={colors.accent} />
          <Text style={styles.addText}>Add a card</Text>
        </Pressable>
      ) : isCarousel ? (
        <Text style={type.caption}>A carousel holds {max} cards at most.</Text>
      ) : null}
    </View>
  )
}

interface CardEditorProps {
  card: SavedCard
  index: number
  total: number
  showHeader: boolean
  onPatch: (patch: Partial<SavedCard>) => void
  onRemove?: () => void
  onMove?: (by: number) => void
}

function CardEditor({ card, index, total, showHeader, onPatch, onRemove, onMove }: CardEditorProps) {
  const [imageOpen, setImageOpen] = useState(false)
  const subtitle = card.subtitle ?? ''
  const image: CardImage = {
    ...(card.image_asset_id ? { image_asset_id: card.image_asset_id } : {}),
    ...(card.image_url ? { image_url: card.image_url } : {}),
  }

  return (
    <View style={styles.card}>
      {showHeader ? (
        <View style={styles.cardHead}>
          <Text style={type.label}>
            CARD {index + 1} OF {total}
          </Text>
          <View style={styles.cardTools}>
            {onMove ? (
              <>
                <Tool icon="arrow-up" label={`Move card ${index + 1} up`} onPress={() => onMove(-1)} disabled={index === 0} />
                <Tool
                  icon="arrow-down"
                  label={`Move card ${index + 1} down`}
                  onPress={() => onMove(1)}
                  disabled={index === total - 1}
                />
              </>
            ) : null}
            {onRemove ? (
              <Tool icon="trash-outline" label={`Remove card ${index + 1}`} onPress={onRemove} danger />
            ) : null}
          </View>
        </View>
      ) : null}

      <CardImageRow image={image} onPress={() => setImageOpen(true)} />

      {/* Both fields wrap and grow: a card's copy is short, but reading it
          back sideways through a one-line box is not. The counters make the
          ceiling visible, since Messenger truncates rather than warning. */}
      <Field label="Title" hint={`${card.title.length}/${CARD_TITLE_MAX}`}>
        <TextInput
          style={[styles.input, styles.multiline]}
          value={card.title}
          onChangeText={(title) => onPatch({ title: title.slice(0, CARD_TITLE_MAX) })}
          placeholder="Watch this video"
          placeholderTextColor={colors.muted}
          multiline
          accessibilityLabel={`Card ${index + 1} title`}
        />
      </Field>
      <Field label="Subtitle" hint={`${subtitle.length}/${CARD_SUBTITLE_MAX}`}>
        <TextInput
          style={[styles.input, styles.multiline, styles.subtitle]}
          value={subtitle}
          onChangeText={(next) => onPatch({ subtitle: next.slice(0, CARD_SUBTITLE_MAX) })}
          placeholder="What it covers — including how much, and how it works"
          placeholderTextColor={colors.muted}
          multiline
          accessibilityLabel={`Card ${index + 1} subtitle`}
        />
      </Field>

      <ButtonList
        buttons={card.buttons}
        onChange={(buttons) => onPatch({ buttons })}
        addLabel="Add a button to this card"
      />

      <CardImageSheet
        visible={imageOpen}
        value={image}
        onClose={() => setImageOpen(false)}
        onPick={(picked) =>
          onPatch({ image_asset_id: picked.image_asset_id, image_url: picked.image_url })
        }
      />
    </View>
  )
}

/** The image slot: a thumbnail once set, a dashed prompt while empty. */
function CardImageRow({ image, onPress }: { image: CardImage; onPress: () => void }) {
  const thumb = useMediaAssetThumb(image.image_asset_id)
  const preview = image.image_url ?? thumb.data ?? null

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={preview ? 'Change card image' : 'Add a card image'}
      onPress={onPress}
      style={({ pressed }) => [styles.imageRow, pressed && { opacity: 0.85 }]}
    >
      {preview ? (
        <Image source={{ uri: preview }} style={styles.thumb} contentFit="cover" transition={120} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]}>
          <Ionicons name="image-outline" size={20} color={colors.accent} />
        </View>
      )}
      <View style={{ flex: 1 }}>
        <Text style={type.bodyStrong}>{preview ? 'Card image' : 'Add an image'}</Text>
        <Text style={type.caption}>
          {image.image_asset_id ? 'From your media library' : image.image_url ? 'From a link' : 'Optional'}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.muted} />
    </Pressable>
  )
}

function Tool({
  icon,
  label,
  onPress,
  disabled,
  danger,
}: {
  icon: keyof typeof Ionicons.glyphMap
  label: string
  onPress: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.tool, pressed && { opacity: 0.6 }]}
    >
      <Ionicons
        name={icon}
        size={16}
        color={disabled ? colors.faint : danger ? colors.danger : colors.tertiary}
      />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTools: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tool: { padding: 2 },
  imageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  thumb: { width: 52, height: 52, borderRadius: radius.sm, backgroundColor: colors.borderSubtle },
  thumbEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
  input: {
    backgroundColor: colors.page,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
  },
  multiline: { minHeight: 44, textAlignVertical: 'top', lineHeight: 21 },
  subtitle: { minHeight: 66 },
  add: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
  },
  addText: { fontSize: 14, fontWeight: '600', color: colors.accent },
})
