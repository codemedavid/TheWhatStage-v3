import { Ionicons } from '@expo/vector-icons'
import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { PageStatCard } from '@/components/submissions/page-stat-card'
import { SubmissionDetailSheet } from '@/components/submissions/submission-detail-sheet'
import { SubmissionListRow } from '@/components/submissions/submission-row'
import { KeyboardView } from '@/components/ui/keyboard-view'
import { EmptyState, Pill, Skeleton } from '@/components/ui/primitives'
import { ScreenHeader } from '@/components/ui/screen-header'
import { Segmented } from '@/components/ui/segmented'
import { useSubmissions, useSubmissionStats, type OutcomeFilter } from '@/data/submissions'
import type { SubmissionRow } from '@/data/types'
import { PRESET_LABELS, resolveRange, type DatePreset } from '@/lib/date-range'
import { colors, radius, spacing, type } from '@/theme/tokens'

type Mode = 'people' | 'pages'

const PRESETS: DatePreset[] = ['all', 'today', '7d', '30d']
const OUTCOMES: { value: OutcomeFilter; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'filled', label: 'Filled in' },
  { value: 'implied', label: 'Chat-implied' },
]
const SEARCH_DEBOUNCE_MS = 250

/**
 * Who has filled in the action pages. Two lenses on the same data: "People"
 * is the newest-first feed of individual submissions, "Pages" rolls the same
 * range up per page so an empty page is as visible as a busy one.
 */
export default function SubmissionsScreen() {
  const insets = useSafeAreaInsets()
  const [mode, setMode] = useState<Mode>('people')
  const [preset, setPreset] = useState<DatePreset>('all')
  const [pageId, setPageId] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<OutcomeFilter>('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<SubmissionRow | null>(null)

  // Typing shouldn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [searchInput])

  const range = useMemo(
    () => resolveRange({ preset, basis: 'created', customFrom: null, customTo: null }),
    [preset],
  )
  const filter = useMemo(() => ({ pageId, range, outcome, search }), [pageId, range, outcome, search])

  const feed = useSubmissions(filter)
  const stats = useSubmissionStats(range)

  const selectedPage = useMemo(
    () => stats.data?.find((s) => s.action_page_id === pageId) ?? null,
    [stats.data, pageId],
  )
  const totals = useMemo(() => {
    const rows = stats.data ?? []
    const scoped = pageId ? rows.filter((r) => r.action_page_id === pageId) : rows
    return scoped.reduce(
      (acc, r) => ({
        submissions: acc.submissions + Number(r.submissions),
        filled: acc.filled + Number(r.filled),
        people: acc.people + Number(r.people),
      }),
      { submissions: 0, filled: 0, people: 0 },
    )
  }, [stats.data, pageId])

  const showPage = (id: string) => {
    setPageId(id)
    setMode('people')
  }

  // The gesture bar sits over the last row otherwise — this screen is pushed,
  // so no tab bar reserves that space for it. Memoised so the lists are not
  // handed a fresh content style on every keystroke in the search box.
  const listPad = useMemo(() => ({ paddingBottom: insets.bottom + spacing.xxl }), [insets.bottom])

  return (
    <KeyboardView style={styles.screen}>
      <ScreenHeader back title="Submissions" bordered={false}>
        <View style={{ gap: spacing.sm, marginTop: spacing.sm }}>
          <Segmented
            value={mode}
            onChange={setMode}
            segments={[
              { value: 'people', label: 'People' },
              { value: 'pages', label: 'Pages' },
            ]}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
            {PRESETS.map((p) => (
              <Pill key={p} label={PRESET_LABELS[p]} active={preset === p} onPress={() => setPreset(p)} />
            ))}
          </ScrollView>
        </View>
      </ScreenHeader>

      <SummaryBar
        loading={stats.isLoading}
        submissions={totals.submissions}
        filled={totals.filled}
        people={totals.people}
        scope={selectedPage?.title ?? 'All pages'}
      />

      {mode === 'pages' ? (
        <FlatList
          data={stats.data ?? []}
          keyExtractor={(s) => s.action_page_id}
          contentContainerStyle={[styles.list, listPad]}
          refreshing={stats.isRefetching}
          onRefresh={() => stats.refetch()}
          ListEmptyComponent={
            stats.isLoading ? (
              <View style={{ gap: 10 }}>
                <Skeleton height={86} />
                <Skeleton height={86} />
              </View>
            ) : (
              <EmptyState
                icon="link-outline"
                title="No action pages yet"
                body="Publish a form, booking, or order page in the dashboard and its fills show up here."
              />
            )
          }
          renderItem={({ item }) => (
            <PageStatCard stat={item} selected={item.action_page_id === pageId} onPress={() => showPage(item.action_page_id)} />
          )}
        />
      ) : (
        <FlatList
          data={feed.rows}
          keyExtractor={(s) => s.id}
          contentContainerStyle={feed.rows.length === 0 ? [styles.list, listPad] : listPad}
          refreshing={feed.isRefetching && !feed.isFetchingNextPage}
          onRefresh={() => feed.refetch()}
          onEndReached={feed.loadMore}
          onEndReachedThreshold={0.4}
          keyboardShouldPersistTaps="handled"
          ItemSeparatorComponent={() => <View style={styles.sep} />}
          ListHeaderComponent={
            <View style={styles.filters}>
              <View style={styles.searchWrap}>
                <Ionicons name="search" size={16} color={colors.muted} />
                <TextInput
                  style={styles.search}
                  value={searchInput}
                  onChangeText={setSearchInput}
                  placeholder="Search by name"
                  placeholderTextColor={colors.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  accessibilityLabel="Search submissions by name"
                />
                {searchInput ? (
                  <Pressable onPress={() => setSearchInput('')} hitSlop={8} accessibilityLabel="Clear search">
                    <Ionicons name="close-circle" size={16} color={colors.muted} />
                  </Pressable>
                ) : null}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
                {OUTCOMES.map((o) => (
                  <Pill key={o.value} label={o.label} active={outcome === o.value} onPress={() => setOutcome(o.value)} />
                ))}
              </ScrollView>
              {selectedPage ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Clear the ${selectedPage.title} filter`}
                  onPress={() => setPageId(null)}
                  style={styles.scopeChip}
                >
                  <Ionicons name="funnel" size={12} color={colors.accentDeep} />
                  <Text style={styles.scopeText} numberOfLines={1}>
                    {selectedPage.title}
                  </Text>
                  <Ionicons name="close" size={13} color={colors.accentDeep} />
                </Pressable>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            feed.isLoading ? (
              <View style={{ gap: 10 }}>
                <Skeleton height={56} />
                <Skeleton height={56} />
                <Skeleton height={56} />
              </View>
            ) : feed.isError ? (
              <EmptyState icon="cloud-offline-outline" title="Couldn't load submissions" body={feed.error.message} />
            ) : (
              <EmptyState
                icon="clipboard-outline"
                title={search ? 'Nobody by that name' : 'No submissions in this range'}
                body={
                  search
                    ? 'Only submissions linked to a lead can be searched by name.'
                    : 'Send an action page from a chat — every fill lands here with the answers.'
                }
              />
            )
          }
          ListFooterComponent={
            feed.isFetchingNextPage ? (
              <ActivityIndicator style={{ paddingVertical: spacing.lg }} color={colors.accent} />
            ) : null
          }
          renderItem={({ item }) => <SubmissionListRow row={item} onPress={setOpen} hidePage={!!pageId} />}
        />
      )}

      <SubmissionDetailSheet row={open} onClose={() => setOpen(null)} />
    </KeyboardView>
  )
}

function SummaryBar({
  loading,
  submissions,
  filled,
  people,
  scope,
}: {
  loading: boolean
  submissions: number
  filled: number
  people: number
  scope: string
}) {
  return (
    <View style={styles.summary}>
      {loading ? (
        <Skeleton height={18} width="60%" />
      ) : (
        <>
          <Stat value={filled} label="filled in" />
          <View style={styles.summaryDivider} />
          <Stat value={people} label="people" />
          <View style={styles.summaryDivider} />
          <Stat value={submissions - filled} label="chat-implied" />
          <Text style={[type.caption, { marginLeft: 'auto', maxWidth: 110, textAlign: 'right' }]} numberOfLines={1}>
            {scope}
          </Text>
        </>
      )}
    </View>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <Text style={type.bodyStrong}>{value}</Text>
      <Text style={type.caption}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  strip: { gap: 8, paddingRight: spacing.lg },
  list: { padding: spacing.lg, gap: 10 },
  sep: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderSubtle, marginLeft: 68 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.page,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  summaryDivider: { width: StyleSheet.hairlineWidth, height: 24, backgroundColor: colors.border },
  filters: { gap: spacing.sm, padding: spacing.md, backgroundColor: colors.page },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  search: { flex: 1, fontSize: 15, color: colors.ink },
  scopeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.accentLight,
  },
  scopeText: { fontSize: 12, fontWeight: '700', color: colors.accentDeep, maxWidth: 180 },
})
