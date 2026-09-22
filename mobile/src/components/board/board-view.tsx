import { memo, useCallback, useRef, useState, type ReactNode } from 'react'
import {
  Dimensions,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { colors, radius, spacing, STAGE_KIND_COLORS, type } from '@/theme/tokens'

export interface BoardColumn<T> {
  id: string
  name: string
  kind?: string | null
  color?: string | null
  items: T[]
  /** Optional subtitle under the column name (e.g. total value). */
  meta?: string
}

interface Props<T> {
  columns: BoardColumn<T>[]
  keyExtractor: (item: T) => string
  renderCard: (item: T, column: BoardColumn<T>) => ReactNode
  emptyLabel?: string
  refreshing?: boolean
  onRefresh?: () => void
  header?: ReactNode
}

const SCREEN_W = Dimensions.get('window').width
const COL_GUTTER = 12
const COL_W = Math.min(320, SCREEN_W - 48)

// Columns within this many pages of the viewport keep a live list; the rest keep
// their header and an empty body. Every column used to mount its own FlatList at
// once, so a 10-stage board built ten lists on first paint and re-rendered all
// ten on every refetch.
const LIVE_RADIUS = 1

const CARDS_INITIAL = 8
const CARDS_BATCH = 8
const CARDS_WINDOW = 7

function dotColor(column: Pick<BoardColumn<unknown>, 'color' | 'kind'>): string {
  return column.color ?? STAGE_KIND_COLORS[column.kind ?? ''] ?? colors.muted
}

interface PaneProps<T> {
  column: BoardColumn<T>
  /** False for off-screen columns: header only, no list. */
  live: boolean
  keyExtractor: (item: T) => string
  renderCard: (item: T, column: BoardColumn<T>) => ReactNode
  emptyLabel: string
  refreshing?: boolean
  onRefresh?: () => void
}

function ColumnPaneInner<T>({
  column,
  live,
  keyExtractor,
  renderCard,
  emptyLabel,
  refreshing,
  onRefresh,
}: PaneProps<T>) {
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<T>) => <View style={styles.cardWrap}>{renderCard(item, column)}</View>,
    [renderCard, column],
  )

  return (
    <View style={[styles.column, { width: COL_W }]}>
      <View style={styles.columnHead}>
        <View style={[styles.stripDot, styles.headDot, { backgroundColor: dotColor(column) }]} />
        <Text style={[type.heading, { flex: 1 }]} numberOfLines={1}>
          {column.name}
        </Text>
        <Text style={type.small}>{column.items.length}</Text>
      </View>
      {column.meta ? <Text style={styles.columnMeta}>{column.meta}</Text> : null}
      {live && (
        <FlatList
          data={column.items}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          showsVerticalScrollIndicator={false}
          refreshing={refreshing}
          onRefresh={onRefresh}
          nestedScrollEnabled
          initialNumToRender={CARDS_INITIAL}
          maxToRenderPerBatch={CARDS_BATCH}
          windowSize={CARDS_WINDOW}
          removeClippedSubviews={Platform.OS === 'android'}
          ListEmptyComponent={
            <View style={styles.emptyCol}>
              <Text style={type.small}>{emptyLabel}</Text>
            </View>
          }
          contentContainerStyle={styles.cardsContent}
        />
      )}
    </View>
  )
}

// memo() erases the generic, so the cast restores the call signature.
const ColumnPane = memo(ColumnPaneInner) as typeof ColumnPaneInner

/**
 * Horizontal, snap-paged kanban. One column ≈ one screen so cards stay
 * readable on a phone; a dot strip shows where you are. Cards decide their
 * own "move" affordance (tap / long-press), so no gesture library is needed.
 */
export function BoardView<T>({
  columns,
  keyExtractor,
  renderCard,
  emptyLabel = 'Nothing here',
  refreshing,
  onRefresh,
  header,
}: Props<T>) {
  const [page, setPage] = useState(0)
  const scrollRef = useRef<ScrollView>(null)
  const stride = COL_W + COL_GUTTER

  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / stride)
      setPage((cur) => (next === cur ? cur : next))
    },
    [stride],
  )

  const jump = useCallback((i: number) => scrollRef.current?.scrollTo({ x: i * stride, animated: true }), [stride])

  return (
    <View style={{ flex: 1 }}>
      {header}
      {/* Column strip: tap to jump. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        style={{ flexGrow: 0 }}
      >
        {columns.map((c, i) => {
          const active = i === page
          return (
            <Pressable key={c.id} onPress={() => jump(i)} style={[styles.stripItem, active && styles.stripItemActive]}>
              <View style={[styles.stripDot, { backgroundColor: dotColor(c) }]} />
              <Text style={[styles.stripText, active && styles.stripTextActive]} numberOfLines={1}>
                {c.name}
              </Text>
              <Text style={[styles.stripCount, active && { color: colors.ink }]}>{c.items.length}</Text>
            </Pressable>
          )
        })}
      </ScrollView>

      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled={false}
        snapToInterval={stride}
        snapToAlignment="start"
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={32}
        contentContainerStyle={styles.pages}
      >
        {columns.map((c, i) => (
          <ColumnPane
            key={c.id}
            column={c}
            live={Math.abs(i - page) <= LIVE_RADIUS}
            keyExtractor={keyExtractor}
            renderCard={renderCard}
            emptyLabel={emptyLabel}
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        ))}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  strip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: 6,
  },
  stripItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stripItemActive: { borderColor: colors.ink, backgroundColor: colors.card },
  stripDot: { width: 7, height: 7, borderRadius: 4 },
  headDot: { width: 8, height: 8 },
  stripText: { fontSize: 12, fontWeight: '600', color: colors.tertiary, maxWidth: 120 },
  stripTextActive: { color: colors.ink },
  stripCount: { fontSize: 11, fontWeight: '600', color: colors.muted },
  pages: { paddingHorizontal: spacing.lg, gap: COL_GUTTER, paddingBottom: spacing.xl },
  column: {
    backgroundColor: colors.borderSubtle,
    borderRadius: radius.xl,
    padding: 10,
    paddingTop: 12,
  },
  columnHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, paddingHorizontal: 4 },
  columnMeta: { ...type.caption, marginBottom: spacing.sm, marginLeft: 16 },
  cardWrap: { marginBottom: 8 },
  cardsContent: { paddingBottom: 80 },
  emptyCol: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.faint,
    borderRadius: radius.md,
    padding: spacing.xl,
    alignItems: 'center',
  },
})
