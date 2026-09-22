import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'expo-router'
import { useCallback, useMemo } from 'react'
import { FlatList, RefreshControl, StyleSheet, Text, View, type ListRenderItemInfo } from 'react-native'
import { WorkspaceCard, type WorkspaceStats } from '@/components/projects/workspace-card'
import { EmptyState, Skeleton } from '@/components/ui/primitives'
import { ScreenHeader } from '@/components/ui/screen-header'
import { useWorkspaces } from '@/data/projects'
import type { Workspace } from '@/data/types'
import { supabase } from '@/lib/supabase'
import { colors, spacing, type } from '@/theme/tokens'

interface CountRow {
  id: string
  workspace_id: string
  value: number | string | null
  archived_at: string | null
}

function useProjectCounts() {
  return useQuery({
    queryKey: ['projects', 'counts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, workspace_id, value, archived_at, stage_id')
      if (error) throw new Error(error.message)
      return (data ?? []) as CountRow[]
    },
  })
}

const EMPTY_STATS: WorkspaceStats = { active: 0, totalValue: 0 }

const workspaceKey = (w: Workspace) => w.id

function aggregate(rows: CountRow[]): Record<string, WorkspaceStats> {
  return rows.reduce<Record<string, WorkspaceStats>>((acc, row) => {
    if (row.archived_at) return acc
    const prev = acc[row.workspace_id] ?? EMPTY_STATS
    const n = Number(row.value ?? 0)
    return {
      ...acc,
      [row.workspace_id]: {
        active: prev.active + 1,
        totalValue: prev.totalValue + (Number.isNaN(n) ? 0 : n),
      },
    }
  }, {})
}

export default function ProjectsTab() {
  const router = useRouter()
  const workspaces = useWorkspaces()
  const counts = useProjectCounts()
  const stats = useMemo(() => aggregate(counts.data ?? []), [counts.data])
  const refreshing = workspaces.isRefetching || counts.isRefetching

  const refresh = () => {
    workspaces.refetch()
    counts.refetch()
  }

  const openWorkspace = useCallback((w: Workspace) => router.push(`/projects/${w.id}`), [router])
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Workspace>) => (
      <WorkspaceCard workspace={item} stats={stats[item.id] ?? EMPTY_STATS} onPress={openWorkspace} />
    ),
    [stats, openWorkspace],
  )

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Projects" large bordered={false} />
      {workspaces.isLoading ? (
        <View style={styles.list}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={92} style={{ borderRadius: 16 }} />
          ))}
        </View>
      ) : (
        <FlatList
          data={workspaces.data ?? []}
          keyExtractor={workspaceKey}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} />
          }
          ListHeaderComponent={
            workspaces.data?.length ? (
              <Text style={[type.small, { marginBottom: 4 }]}>
                {workspaces.data.length} {workspaces.data.length === 1 ? 'workspace' : 'workspaces'}
              </Text>
            ) : null
          }
          renderItem={renderItem}
          ListEmptyComponent={
            <EmptyState
              icon="grid-outline"
              title={workspaces.isError ? "Couldn't load workspaces" : 'No workspaces yet'}
              body={
                workspaces.isError
                  ? workspaces.error.message
                  : 'Create a workspace from the web dashboard to start tracking projects here.'
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
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: 40 },
})
