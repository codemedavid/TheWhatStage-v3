import { Ionicons } from '@expo/vector-icons'
import { StyleSheet, Text, View } from 'react-native'
import { describeLayout, type SavedButton, type SavedCard, type SavedLayout } from '@/lib/saved-message-template'
import { colors, radius } from '@/theme/tokens'

const ICONS: Record<SavedLayout, keyof typeof Ionicons.glyphMap> = {
  text: 'chatbubble',
  buttons: 'radio-button-on',
  card: 'image',
  carousel: 'albums',
}

interface Props {
  layout: SavedLayout
  buttons: SavedButton[]
  cards: SavedCard[]
}

/**
 * Marks what a saved message sends as. Plain text is the default and needs no
 * badge — the chip only appears when there is something extra to know.
 */
export function LayoutChip({ layout, buttons, cards }: Props) {
  if (layout === 'text') return null
  return (
    <View style={styles.chip}>
      <Ionicons name={ICONS[layout]} size={10} color={colors.accentDeep} />
      <Text style={styles.text} numberOfLines={1}>
        {describeLayout({ layout, buttons, cards })}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.accentLight,
    maxWidth: 110,
  },
  text: { fontSize: 10, fontWeight: '700', color: colors.accentDeep },
})
