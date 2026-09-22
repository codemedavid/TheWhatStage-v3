import { useRouter } from 'expo-router'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { LayoutChip } from '@/components/saved/layout-chip'
import { Button } from '@/components/ui/button'
import { EmptyState, Skeleton } from '@/components/ui/primitives'
import { Sheet } from '@/components/ui/sheet'
import { savedMessagePreview, useSavedMessages } from '@/data/saved-messages'
import type { SavedMessage } from '@/data/types'
import { previewPersonalize, truncate } from '@/lib/format'
import { colors, radius, spacing, type } from '@/theme/tokens'

interface Props {
  visible: boolean
  onClose: () => void
  onPick: (message: SavedMessage) => void
  leadName?: string | null
}

export function SavedMessagesSheet({ visible, onClose, onPick, leadName }: Props) {
  const router = useRouter()
  const { data, isLoading } = useSavedMessages()
  const goManage = () => {
    onClose()
    router.push('/saved-messages')
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Saved messages"
      subtitle="Tap one to load it into the composer"
      height={0.7}
      action={
        <Pressable onPress={goManage} hitSlop={8} accessibilityRole="button">
          <Text style={styles.manage}>Manage</Text>
        </Pressable>
      }
    >
      {isLoading ? (
        <View style={{ gap: 10 }}>
          <Skeleton height={64} />
          <Skeleton height={64} />
          <Skeleton height={64} />
        </View>
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(m) => m.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 8, paddingBottom: spacing.lg }}
          ListEmptyComponent={
            <EmptyState
              icon="bookmark-outline"
              title="No saved messages yet"
              body="Save the replies you send every day — with buttons or cards when you need them — and drop them into any chat in one tap."
              action={<Button label="Create one" onPress={goManage} />}
            />
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                onPick(item)
                onClose()
              }}
              style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.accentSubtle }]}
            >
              <View style={styles.itemHead}>
                <Text style={[type.bodyStrong, { flexShrink: 1 }]} numberOfLines={1}>
                  {item.title}
                </Text>
                {item.shortcut ? <Text style={styles.shortcut}>/{item.shortcut}</Text> : null}
                <LayoutChip layout={item.layout} buttons={item.buttons} cards={item.cards} />
              </View>
              <Text style={type.small} numberOfLines={2}>
                {truncate(previewPersonalize(savedMessagePreview(item), leadName), 140)}
              </Text>
            </Pressable>
          )}
        />
      )}
    </Sheet>
  )
}

const styles = StyleSheet.create({
  manage: { color: colors.accent, fontWeight: '600', fontSize: 15 },
  item: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    gap: 4,
  },
  itemHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shortcut: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.accent,
    backgroundColor: colors.accentLight,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
  },
})
