import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from 'react-native'
import { LeadBoard } from '@/components/board/lead-board'
import { ThreadRow, threadDisplayName } from '@/components/chat/thread-row'
import { EmptyState, Pill, Skeleton } from '@/components/ui/primitives'
import { IconButton, ScreenHeader } from '@/components/ui/screen-header'
import { Segmented } from '@/components/ui/segmented'
import { Sheet } from '@/components/ui/sheet'
import { useMarkThreadRead, useThreads, useToggleImportant, type InboxFilter } from '@/data/threads'
import type { ThreadRow as ThreadRowData } from '@/data/types'
import { colors, radius, spacing, type } from '@/theme/tokens'

type View_ = 'list' | 'board'
const VIEW_KEY = 'chats.view'

const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'important', label: 'Important' },
  { value: 'takeover', label: 'Taken over' },
]

const threadKey = (t: ThreadRowData) => t.id
const LIST_CONTENT = { paddingBottom: spacing.xxxl }

function Separator() {
  return <View style={styles.sep} />
}

function matches(thread: ThreadRowData, q: string): boolean {
  if (!q) return true
  const hay = `${threadDisplayName(thread)} ${thread.full_name ?? ''} ${thread.last_message_preview ?? ''}`.toLowerCase()
  return hay.includes(q)
}

export default function ChatsScreen() {
  const router = useRouter()
  const [view, setView] = useState<View_>('list')
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [search, setSearch] = useState('')
  const [menuThread, setMenuThread] = useState<ThreadRowData | null>(null)

  const threads = useThreads(filter)
  const markRead = useMarkThreadRead()
  const toggleImportant = useToggleImportant()

  useEffect(() => {
    AsyncStorage.getItem(VIEW_KEY)
      .then((v) => {
        if (v === 'list' || v === 'board') setView(v)
      })
      .catch(() => {})
  }, [])

  const changeView = (v: View_) => {
    setView(v)
    AsyncStorage.setItem(VIEW_KEY, v).catch(() => {})
  }

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return threads.rows.filter((t) => matches(t, q))
  }, [threads.rows, search])

  const openThread = useCallback((thread: ThreadRowData) => router.push(`/chat/${thread.id}`), [router])
  const openMenu = useCallback((thread: ThreadRowData) => setMenuThread(thread), [])
  // Stable, so typing in the search box or opening the row menu no longer
  // re-renders every mounted row.
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ThreadRowData>) => (
      <ThreadRow thread={item} onPress={openThread} onLongPress={openMenu} />
    ),
    [openThread, openMenu],
  )

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Chats"
        large
        bordered={view === 'board'}
        right={<IconButton name="bookmark-outline" label="Saved messages" onPress={() => router.push('/saved-messages')} />}
      >
        <View style={{ marginTop: spacing.sm, marginBottom: 4 }}>
          <Segmented<View_>
            value={view}
            onChange={changeView}
            segments={[
              { value: 'list', label: 'List', icon: <Ionicons name="list" size={14} color={view === 'list' ? colors.ink : colors.muted} /> },
              { value: 'board', label: 'Board', icon: <Ionicons name="grid-outline" size={14} color={view === 'board' ? colors.ink : colors.muted} /> },
            ]}
          />
        </View>
      </ScreenHeader>

      {view === 'board' ? (
        <LeadBoard />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={threadKey}
          keyboardShouldPersistTaps="handled"
          refreshing={threads.isRefetching}
          onRefresh={() => threads.refetch()}
          onEndReached={() => threads.loadMore()}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            threads.isFetchingNextPage ? (
              <View style={styles.footer}>
                <Skeleton width="100%" height={52} />
              </View>
            ) : null
          }
          ListHeaderComponent={
            <View>
              <View style={styles.search}>
                <Ionicons name="search" size={17} color={colors.muted} />
                <TextInput
                  style={styles.searchInput}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search chats"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                  accessibilityLabel="Search chats"
                />
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
                {FILTERS.map((f) => (
                  <Pill key={f.value} label={f.label} active={filter === f.value} onPress={() => setFilter(f.value)} />
                ))}
              </ScrollView>
            </View>
          }
          ListEmptyComponent={
            threads.isLoading ? (
              <ListSkeleton />
            ) : threads.isError ? (
              <EmptyState icon="cloud-offline-outline" title="Couldn't load chats" body="Pull to refresh or check your connection." />
            ) : (
              <EmptyState
                title={search ? 'No matches' : filter === 'all' ? 'No conversations yet' : 'Nothing here'}
                body={
                  search
                    ? 'Try a different name or keyword.'
                    : filter === 'all'
                      ? 'New Messenger conversations will appear here in real time.'
                      : 'Switch filters to see other chats.'
                }
              />
            )
          }
          renderItem={renderItem}
          ItemSeparatorComponent={Separator}
          contentContainerStyle={LIST_CONTENT}
        />
      )}

      <Sheet visible={!!menuThread} onClose={() => setMenuThread(null)} title={menuThread ? threadDisplayName(menuThread) : ''}>
        {menuThread && (
          <View style={{ gap: 6, paddingBottom: spacing.sm }}>
            <MenuItem
              icon="checkmark-done-outline"
              label="Mark as read"
              onPress={() => {
                markRead.mutate(menuThread.id)
                setMenuThread(null)
              }}
            />
            <MenuItem
              icon={menuThread.is_important ? 'star' : 'star-outline'}
              label={menuThread.is_important ? 'Unpin from important' : 'Pin as important'}
              onPress={() => {
                toggleImportant.mutate({ threadId: menuThread.id, value: !menuThread.is_important })
                setMenuThread(null)
              }}
            />
            {menuThread.lead_id && (
              <MenuItem
                icon="person-outline"
                label="Open lead"
                onPress={() => {
                  const id = menuThread.lead_id
                  setMenuThread(null)
                  router.push(`/lead/${id}`)
                }}
              />
            )}
          </View>
        )}
      </Sheet>
    </View>
  )
}

function MenuItem({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: colors.accentSubtle }]}
    >
      <Ionicons name={icon} size={20} color={colors.ink} />
      <Text style={type.bodyStrong}>{label}</Text>
    </Pressable>
  )
}

function ListSkeleton() {
  return (
    <View style={{ paddingHorizontal: spacing.lg, gap: 18, paddingTop: 8 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <Skeleton width={52} height={52} round />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width="50%" />
            <Skeleton width="85%" />
          </View>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.borderSubtle,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.ink, paddingVertical: 0 },
  pills: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 8 },
  footer: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderSubtle, marginLeft: 80 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
  },
})
