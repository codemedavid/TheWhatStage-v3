import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, ScrollView, StyleSheet, TextInput, View, type ListRenderItemInfo } from 'react-native'
import { LeadRow } from '@/components/leads/lead-row'
import { EmptyState, Pill, Skeleton } from '@/components/ui/primitives'
import { ScreenHeader } from '@/components/ui/screen-header'
import { Segmented } from '@/components/ui/segmented'
import { useLeadContactIndex, useLeads, useStages } from '@/data/leads'
import type { LeadRow as LeadRowData } from '@/data/types'
import { hasContact, indexLatestContacts, sortByLatestContact } from '@/lib/lead-contacts'
import { colors, radius, spacing } from '@/theme/tokens'

const SEARCH_DEBOUNCE_MS = 250

type Scope = 'reachable' | 'all'

const SCOPES = [
  { value: 'reachable' as const, label: 'Can contact' },
  { value: 'all' as const, label: 'All leads' },
]

const leadKey = (l: LeadRowData) => l.id
const LIST_CONTENT = { paddingBottom: spacing.xxxl }

function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

function LoadingRows() {
  return (
    <View style={{ padding: spacing.lg, gap: spacing.lg }}>
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <View key={i} style={{ flexDirection: 'row', gap: spacing.md, alignItems: 'center' }}>
          <Skeleton width={46} height={46} round />
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton width="55%" />
            <Skeleton width="80%" height={12} />
          </View>
        </View>
      ))}
    </View>
  )
}

export default function LeadsScreen() {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<string | null>(null)
  // Defaults to the call list: leads we hold a number or address for. The
  // segmented control widens it back to everyone when you need the full board.
  const [scope, setScope] = useState<Scope>('reachable')
  const debounced = useDebounced(search, SEARCH_DEBOUNCE_MS)
  const reachableOnly = scope === 'reachable'
  const leads = useLeads(debounced, reachableOnly)
  const stages = useStages()
  const contactIndex = useLeadContactIndex()

  const stageById = useMemo(
    () => new Map((stages.data ?? []).map((s) => [s.id, s])),
    [stages.data],
  )
  const latestContacts = useMemo(
    () => indexLatestContacts(contactIndex.data ?? []),
    [contactIndex.data],
  )

  // The query already narrows to reachable leads; `hasContact` is the exact
  // gate on top of it, so an empty-string phone column can't sneak a lead with
  // nothing to dial into the call list.
  const scoped = useMemo(() => {
    const rows = leads.data ?? []
    return reachableOnly ? rows.filter(hasContact) : rows
  }, [leads.data, reachableOnly])

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of scoped) m.set(l.stage_id, (m.get(l.stage_id) ?? 0) + 1)
    return m
  }, [scoped])

  // Newest contact first — whoever handed over a number most recently is the
  // one worth calling now. Falls back to lead activity for leads whose values
  // predate the contact log.
  const visible = useMemo(() => {
    const filtered = scoped.filter((l) => !stageFilter || l.stage_id === stageFilter)
    return reachableOnly ? sortByLatestContact(filtered, latestContacts) : filtered
  }, [scoped, stageFilter, reachableOnly, latestContacts])

  const openLead = useCallback((lead: LeadRowData) => router.push(`/lead/${lead.id}`), [router])
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<LeadRowData>) => (
      <LeadRow
        lead={item}
        stage={stageById.get(item.stage_id)}
        latest={latestContacts.get(item.id)}
        onPress={openLead}
      />
    ),
    [stageById, latestContacts, openLead],
  )

  const isFiltered = !!debounced || !!stageFilter

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Leads" large bordered={false}>
        <View style={styles.search}>
          <Ionicons name="search" size={17} color={colors.muted} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search name, email, phone, company"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            clearButtonMode="while-editing"
            returnKeyType="search"
          />
        </View>
        <View style={{ marginTop: spacing.sm }}>
          <Segmented value={scope} onChange={setScope} segments={SCOPES} compact />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pills}
          style={{ marginHorizontal: -spacing.lg }}
        >
          <Pill label={`All · ${scoped.length}`} active={!stageFilter} onPress={() => setStageFilter(null)} />
          {(stages.data ?? []).map((s) => (
            <Pill
              key={s.id}
              label={`${s.name} · ${counts.get(s.id) ?? 0}`}
              active={stageFilter === s.id}
              onPress={() => setStageFilter((cur) => (cur === s.id ? null : s.id))}
            />
          ))}
        </ScrollView>
      </ScreenHeader>

      {leads.isLoading ? (
        <LoadingRows />
      ) : (
        <FlatList
          data={visible}
          keyExtractor={leadKey}
          renderItem={renderItem}
          refreshing={leads.isRefetching}
          onRefresh={() => {
            leads.refetch()
            contactIndex.refetch()
          }}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={LIST_CONTENT}
          ListEmptyComponent={
            <EmptyState
              icon={reachableOnly ? 'call-outline' : 'people-outline'}
              title={isFiltered ? 'No leads match' : reachableOnly ? 'Nobody to call yet' : 'No leads yet'}
              body={
                leads.error
                  ? leads.error.message
                  : isFiltered
                    ? 'Try a different search or stage.'
                    : reachableOnly
                      ? 'Leads show up here once they share a phone number or email — anything they type in chat is captured automatically.'
                      : 'Leads appear here as conversations come in.'
              }
            />
          }
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    height: 42,
    marginTop: spacing.sm,
  },
  searchInput: { flex: 1, fontSize: 15, color: colors.ink, paddingVertical: 0 },
  pills: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: 8 },
})
