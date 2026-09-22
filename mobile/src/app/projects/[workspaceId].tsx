import { Ionicons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native'
import { BoardView, type BoardColumn } from '@/components/board/board-view'
import { ProjectCard } from '@/components/projects/project-card'
import { ProjectListRow } from '@/components/projects/project-list-row'
import { EmptyState, SectionLabel, Skeleton } from '@/components/ui/primitives'
import { IconButton, ScreenHeader } from '@/components/ui/screen-header'
import { Segmented } from '@/components/ui/segmented'
import { Sheet } from '@/components/ui/sheet'
import { StagePickerSheet } from '@/components/ui/stage-picker-sheet'
import { useMoveProject, useProjectBoard, useProjectStages, useWorkspaces } from '@/data/projects'
import type { ProjectRow, ProjectStage } from '@/data/types'
import { money } from '@/lib/format'
import { colors, spacing, type } from '@/theme/tokens'

type ViewMode = 'board' | 'list'
const VIEW_KEY = 'projects.view'

const projectKey = (p: ProjectRow) => p.id

function useViewMode(): [ViewMode, (v: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>('board')
  useEffect(() => {
    AsyncStorage.getItem(VIEW_KEY)
      .then((v) => {
        if (v === 'board' || v === 'list') setMode(v)
      })
      .catch(() => {})
  }, [])
  const update = (v: ViewMode) => {
    setMode(v)
    AsyncStorage.setItem(VIEW_KEY, v).catch(() => {})
  }
  return [mode, update]
}

function columnMeta(items: ProjectRow[]): string | undefined {
  if (items.length === 0) return undefined
  const total = items.reduce((sum, p) => {
    const n = Number(p.value ?? 0)
    return sum + (Number.isNaN(n) ? 0 : n)
  }, 0)
  if (total <= 0) return undefined
  return money(total, items[0]?.currency || 'PHP')
}

function buildColumns(stages: ProjectStage[], projects: ProjectRow[], showArchived: boolean): BoardColumn<ProjectRow>[] {
  const visible = showArchived ? projects : projects.filter((p) => !p.archived_at)
  return stages.map((s) => {
    const items = visible.filter((p) => p.stage_id === s.id)
    return { id: s.id, name: s.name, kind: s.kind, color: s.color, items, meta: columnMeta(items) }
  })
}

export default function WorkspaceBoardScreen() {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>()
  const router = useRouter()
  const workspaces = useWorkspaces()
  const stages = useProjectStages(workspaceId)
  const board = useProjectBoard(workspaceId)
  const move = useMoveProject(workspaceId ?? '')

  const [mode, setMode] = useViewMode()
  const [showArchived, setShowArchived] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const [moving, setMoving] = useState<ProjectRow | null>(null)

  const workspace = workspaces.data?.find((w) => w.id === workspaceId)
  const columns = useMemo(
    () => buildColumns(stages.data ?? [], board.data ?? [], showArchived),
    [stages.data, board.data, showArchived],
  )
  const stageById = useMemo(
    () => new Map((stages.data ?? []).map((s) => [s.id, s])),
    [stages.data],
  )

  const onMove = (project: ProjectRow, toStageId: string) => {
    move.mutate(
      { projectId: project.id, toStageId },
      { onError: (e) => Alert.alert("Couldn't move project", e.message) },
    )
  }

  const openProject = useCallback((project: ProjectRow) => router.push(`/project/${project.id}`), [router])
  const startMove = useCallback((project: ProjectRow) => setMoving(project), [])
  const renderCard = useCallback(
    (project: ProjectRow) => <ProjectCard project={project} onPress={openProject} onLongPress={startMove} />,
    [openProject, startMove],
  )
  const refetchBoard = board.refetch
  const refreshBoard = useCallback(() => {
    refetchBoard()
  }, [refetchBoard])

  const isLoading = stages.isLoading || board.isLoading
  const error = stages.error ?? board.error

  return (
    <View style={styles.screen}>
      <ScreenHeader
        back
        title={workspace?.name ?? 'Workspace'}
        right={
          <>
            <View style={{ width: 150 }}>
              <Segmented
                compact
                value={mode}
                onChange={setMode}
                segments={[
                  { value: 'board', label: 'Board' },
                  { value: 'list', label: 'List' },
                ]}
              />
            </View>
            <IconButton name="options-outline" label="Board options" onPress={() => setOptionsOpen(true)} />
          </>
        }
      />

      {isLoading ? (
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton height={32} />
          <Skeleton height={120} style={{ borderRadius: 16 }} />
          <Skeleton height={120} style={{ borderRadius: 16 }} />
        </View>
      ) : error ? (
        <EmptyState icon="alert-circle-outline" title="Couldn't load board" body={error.message} />
      ) : (stages.data?.length ?? 0) === 0 ? (
        <EmptyState icon="grid-outline" title="No stages" body="Add stages to this workspace from the web dashboard." />
      ) : mode === 'board' ? (
        <BoardView
          columns={columns}
          keyExtractor={projectKey}
          emptyLabel="No projects"
          refreshing={board.isRefetching}
          onRefresh={refreshBoard}
          renderCard={renderCard}
        />
      ) : (
        <ListMode
          columns={columns}
          stageById={stageById}
          refreshing={board.isRefetching}
          onRefresh={refreshBoard}
          onOpen={openProject}
        />
      )}

      <Sheet visible={optionsOpen} onClose={() => setOptionsOpen(false)} title="Board options">
        <View style={styles.optionRow}>
          <View style={{ flex: 1 }}>
            <Text style={type.bodyStrong}>Show archived</Text>
            <Text style={type.small}>Archived projects stay in place but are hidden by default.</Text>
          </View>
          <Switch
            value={showArchived}
            onValueChange={setShowArchived}
            trackColor={{ true: colors.accent, false: colors.faint }}
          />
        </View>
        <Pressable onPress={() => board.refetch()} style={styles.optionRow}>
          <Ionicons name="refresh-outline" size={18} color={colors.tertiary} />
          <Text style={[type.bodyStrong, { flex: 1 }]}>Refresh board</Text>
        </Pressable>
      </Sheet>

      <StagePickerSheet
        visible={!!moving}
        onClose={() => setMoving(null)}
        stages={columns.map((c) => ({ id: c.id, name: c.name, kind: c.kind, color: c.color, count: c.items.length }))}
        currentId={moving?.stage_id}
        onPick={(stageId) => moving && onMove(moving, stageId)}
      />
    </View>
  )
}

interface ListModeProps {
  columns: BoardColumn<ProjectRow>[]
  stageById: Map<string, ProjectStage>
  refreshing: boolean
  onRefresh: () => void
  onOpen: (project: ProjectRow) => void
}

type ListItem = { kind: 'header'; id: string; name: string; count: number } | { kind: 'row'; project: ProjectRow }

const listItemKey = (it: ListItem) => (it.kind === 'header' ? `h:${it.id}` : it.project.id)
const LIST_CONTENT = { paddingBottom: 40 }

function flatten(columns: BoardColumn<ProjectRow>[]): ListItem[] {
  return columns.flatMap((c) => [
    { kind: 'header' as const, id: c.id, name: c.name, count: c.items.length },
    ...c.items.map((project) => ({ kind: 'row' as const, project })),
  ])
}

function ListMode({ columns, stageById, refreshing, onRefresh, onOpen }: ListModeProps) {
  // Rebuilding this inline on every render handed the list a brand-new `data`
  // array each time, which invalidated every mounted row.
  const items = useMemo(() => flatten(columns), [columns])
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<ListItem>) =>
      item.kind === 'header' ? (
        <View style={styles.headerRow}>
          <SectionLabel right={<Text style={type.caption}>{item.count}</Text>}>{item.name}</SectionLabel>
        </View>
      ) : (
        <ProjectListRow project={item.project} stage={stageById.get(item.project.stage_id)} onPress={onOpen} />
      ),
    [stageById, onOpen],
  )

  return (
    <FlatList
      data={items}
      keyExtractor={listItemKey}
      refreshing={refreshing}
      onRefresh={onRefresh}
      contentContainerStyle={LIST_CONTENT}
      renderItem={renderItem}
    />
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  headerRow: { paddingHorizontal: spacing.lg },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 12,
  },
})
