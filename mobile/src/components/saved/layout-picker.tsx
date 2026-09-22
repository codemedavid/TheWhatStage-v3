import { Ionicons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { SavedLayout } from '@/lib/saved-message-template'
import { colors, radius, spacing, type } from '@/theme/tokens'

interface Option {
  layout: SavedLayout
  icon: keyof typeof Ionicons.glyphMap
  label: string
  body: string
}

/** Order runs simplest to richest, which is also the order operators grow into. */
const OPTIONS: Option[] = [
  { layout: 'text', icon: 'chatbubble-outline', label: 'Message', body: 'Plain text only' },
  { layout: 'buttons', icon: 'radio-button-on-outline', label: 'Buttons', body: 'Text + up to 3 buttons' },
  { layout: 'card', icon: 'image-outline', label: 'Card', body: 'Image, title and buttons' },
  { layout: 'carousel', icon: 'albums-outline', label: 'Carousel', body: 'Up to 10 swipeable cards' },
]

interface Props {
  value: SavedLayout
  onChange: (layout: SavedLayout) => void
}

/** Picks which Messenger layout a saved message sends as. */
export function LayoutPicker({ value, onChange }: Props) {
  return (
    <View style={styles.grid}>
      {OPTIONS.map((option) => {
        const selected = option.layout === value
        return (
          <Pressable
            key={option.layout}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${option.label}. ${option.body}`}
            onPress={() => onChange(option.layout)}
            style={({ pressed }) => [styles.tile, selected && styles.tileOn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons
              name={option.icon}
              size={18}
              color={selected ? colors.accentDeep : colors.tertiary}
            />
            <Text style={[type.bodyStrong, selected && { color: colors.accentDeep }]}>{option.label}</Text>
            <Text style={type.caption} numberOfLines={2}>
              {option.body}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    // Two per row, with the gap taken out of each tile's share.
    flexBasis: '48%',
    flexGrow: 1,
    gap: 2,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  tileOn: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
})
