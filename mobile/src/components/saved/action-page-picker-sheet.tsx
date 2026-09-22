import { Ionicons } from '@expo/vector-icons'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { KIND_ICON } from '@/components/submissions/page-stat-card'
import { EmptyState, Skeleton } from '@/components/ui/primitives'
import { Sheet } from '@/components/ui/sheet'
import { useSendableActionPages, type SendableActionPage } from '@/data/action-pages'
import { colors, radius, spacing, type } from '@/theme/tokens'

interface Props {
  visible: boolean
  onClose: () => void
  onPick: (page: SendableActionPage) => void
  selectedId?: string | null
}

/** Pick one published action page to hang a button on. */
export function ActionPagePickerSheet({ visible, onClose, onPick, selectedId }: Props) {
  const pages = useSendableActionPages(visible)

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Choose a page"
      subtitle="Only published pages can be sent"
      height={0.7}
    >
      {pages.isLoading ? (
        <View style={{ gap: 10 }}>
          <Skeleton height={60} />
          <Skeleton height={60} />
        </View>
      ) : pages.isError ? (
        <EmptyState icon="cloud-offline-outline" title="Couldn't load pages" body={pages.error.message} />
      ) : (
        <FlatList
          data={pages.data ?? []}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ gap: 8, paddingBottom: spacing.lg }}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <EmptyState
              icon="link-outline"
              title="No published pages"
              body="Publish a form, booking, or order page in the dashboard and it will show up here."
            />
          }
          renderItem={({ item }) => {
            const selected = item.id === selectedId
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  onPick(item)
                  onClose()
                }}
                style={({ pressed }) => [styles.item, selected && styles.itemSelected, pressed && { opacity: 0.85 }]}
              >
                <View style={styles.icon}>
                  <Ionicons name={KIND_ICON[item.kind] ?? 'link-outline'} size={18} color={colors.accent} />
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={type.bodyStrong} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={type.small} numberOfLines={2}>
                    {item.description || item.kind}
                  </Text>
                </View>
                <Ionicons
                  name={selected ? 'checkmark-circle' : 'chevron-forward'}
                  size={selected ? 20 : 16}
                  color={selected ? colors.accent : colors.muted}
                />
              </Pressable>
            )
          }}
        />
      )}
    </Sheet>
  )
}

const styles = StyleSheet.create({
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
  itemSelected: { borderColor: colors.accent, backgroundColor: colors.accentSubtle },
  icon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
