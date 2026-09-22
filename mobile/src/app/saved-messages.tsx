import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { LayoutChip } from '@/components/saved/layout-chip'
import { Button } from '@/components/ui/button'
import { EmptyState, Skeleton } from '@/components/ui/primitives'
import { IconButton, ScreenHeader } from '@/components/ui/screen-header'
import { savedMessagePreview, useDeleteSavedMessage, useSavedMessages } from '@/data/saved-messages'
import type { SavedMessage } from '@/data/types'
import { truncate } from '@/lib/format'
import { colors, radius, shadow, spacing, type } from '@/theme/tokens'

/** The library. Creating and editing happen in the full-screen editor. */
export default function SavedMessagesScreen() {
  const router = useRouter()
  const list = useSavedMessages()
  const remove = useDeleteSavedMessage()

  const close = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))
  const openNew = () => router.push('/saved-message/new')
  const openEdit = (m: SavedMessage) => router.push(`/saved-message/${m.id}`)

  const confirmDelete = (m: SavedMessage) => {
    Alert.alert('Delete saved message?', `"${m.title}" will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => remove.mutate(m.id) },
    ])
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Saved messages"
        right={
          <>
            <IconButton name="add" label="New saved message" onPress={openNew} />
            <IconButton name="close" label="Close" onPress={close} />
          </>
        }
      />

      <FlatList
        data={list.data ?? []}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: spacing.lg, gap: 10, paddingBottom: 100 }}
        refreshing={list.isRefetching}
        onRefresh={() => list.refetch()}
        ListEmptyComponent={
          list.isLoading ? (
            <View style={{ gap: 10 }}>
              <Skeleton height={72} />
              <Skeleton height={72} />
            </View>
          ) : (
            <EmptyState
              icon="bookmark-outline"
              title="No saved messages"
              body="Write once, send in one tap — as plain text, or with buttons and cards attached."
              action={<Button label="Create one" onPress={openNew} />}
            />
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit ${item.title}`}
            onPress={() => openEdit(item)}
            onLongPress={() => confirmDelete(item)}
            style={({ pressed }) => [styles.item, pressed && { backgroundColor: colors.accentSubtle }]}
          >
            <View style={{ flex: 1, gap: 3 }}>
              <View style={styles.itemHead}>
                <Text style={[type.bodyStrong, { flexShrink: 1 }]} numberOfLines={1}>
                  {item.title}
                </Text>
                {item.shortcut ? <Text style={styles.shortcut}>/{item.shortcut}</Text> : null}
                <LayoutChip layout={item.layout} buttons={item.buttons} cards={item.cards} />
              </View>
              <Text style={type.small} numberOfLines={2}>
                {truncate(savedMessagePreview(item), 140)}
              </Text>
            </View>
            <Pressable onPress={() => confirmDelete(item)} hitSlop={8} accessibilityLabel={`Delete ${item.title}`}>
              <Ionicons name="trash-outline" size={18} color={colors.muted} />
            </Pressable>
          </Pressable>
        )}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="New saved message"
        onPress={openNew}
        style={[styles.fab, shadow.fab]}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
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
  fab: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xxl,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
