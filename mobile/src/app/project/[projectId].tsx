import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMemo, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { KeyboardView } from '@/components/ui/keyboard-view'
import { Card, EmptyState, Row, SectionLabel, Skeleton, StageChip } from '@/components/ui/primitives'
import { IconButton, ScreenHeader } from '@/components/ui/screen-header'
import { StagePickerSheet } from '@/components/ui/stage-picker-sheet'
import {
  useArchiveProject,
  useMoveProject,
  useProject,
  useProjectEvents,
  useProjectStages,
  useUpdateProject,
  type ProjectPatch,
} from '@/data/projects'
import { useThreadByLead } from '@/data/threads'
import { one, type ProjectRow } from '@/data/types'
import { money, relativeTime } from '@/lib/format'
import { colors, radius, spacing, type } from '@/theme/tokens'

type EmbeddedStage = { name: string; kind: string | null }

interface Draft {
  title: string
  value: string
  description: string
  notes: string
}

function draftFrom(p: ProjectRow): Draft {
  return {
    title: p.title,
    value: p.value == null ? '' : String(p.value),
    description: p.description ?? '',
    notes: p.notes ?? '',
  }
}

function diff(p: ProjectRow, d: Draft): ProjectPatch {
  const patch: ProjectPatch = {}
  const title = d.title.trim()
  if (title && title !== p.title) patch.title = title
  const value = d.value.trim() === '' ? null : Number(d.value)
  if (value !== null && Number.isNaN(value)) return patch
  if (value !== (p.value == null ? null : Number(p.value))) patch.value = value
  const description = d.description.trim() || null
  if (description !== (p.description ?? null)) patch.description = description
  const notes = d.notes.trim() || null
  if (notes !== (p.notes ?? null)) patch.notes = notes
  return patch
}

export default function ProjectDetailScreen() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const project = useProject(projectId)
  const p = project.data ?? null
  const stages = useProjectStages(p?.workspace_id)
  const events = useProjectEvents(projectId)
  const thread = useThreadByLead(p?.lead_id)
  const update = useUpdateProject()
  const archive = useArchiveProject()
  const move = useMoveProject(p?.workspace_id ?? '')

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  const stageById = useMemo(() => new Map((stages.data ?? []).map((s) => [s.id, s])), [stages.data])
  const lead = one(p?.leads)
  const leadThread = one(lead?.messenger_threads)
  const stage = p ? stageById.get(p.stage_id) : undefined
  // The PROJECT_SELECT embed carries the stage row, but ProjectRow does not type it.
  const embeddedStage = one(
    (p as (ProjectRow & { project_stages?: EmbeddedStage | EmbeddedStage[] | null }) | null)?.project_stages,
  )

  const startEdit = () => {
    if (!p) return
    setDraft(draftFrom(p))
    setEditing(true)
  }

  const save = () => {
    if (!p || !draft) return
    const patch = diff(p, draft)
    if (Object.keys(patch).length === 0) return setEditing(false)
    update.mutate(
      { projectId: p.id, patch },
      {
        onSuccess: () => setEditing(false),
        onError: (e) => Alert.alert("Couldn't save", e.message),
      },
    )
  }

  const toggleArchive = () => {
    if (!p) return
    const archiving = !p.archived_at
    Alert.alert(
      archiving ? 'Archive project?' : 'Restore project?',
      archiving ? 'It will be hidden from the board but kept in totals.' : 'It will show on the board again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: archiving ? 'Archive' : 'Restore',
          style: archiving ? 'destructive' : 'default',
          onPress: () =>
            archive.mutate(
              { projectId: p.id, archive: archiving },
              { onError: (e) => Alert.alert("Couldn't update", e.message) },
            ),
        },
      ],
    )
  }

  if (project.isLoading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader back title="Project" />
        <View style={{ padding: spacing.lg, gap: spacing.md }}>
          <Skeleton height={28} width="70%" />
          <Skeleton height={100} style={{ borderRadius: 16 }} />
          <Skeleton height={160} style={{ borderRadius: 16 }} />
        </View>
      </View>
    )
  }

  if (!p) {
    return (
      <View style={styles.screen}>
        <ScreenHeader back title="Project" />
        <EmptyState icon="alert-circle-outline" title="Project not found" body={project.error?.message} />
      </View>
    )
  }

  return (
    <KeyboardView style={styles.screen}>
      <ScreenHeader
        back
        title={editing ? 'Edit project' : 'Project'}
        right={
          editing ? (
            <Button label="Save" size="sm" onPress={save} loading={update.isPending} />
          ) : (
            <>
              <IconButton name="create-outline" label="Edit project" onPress={startEdit} />
              <IconButton
                name={p.archived_at ? 'refresh-outline' : 'archive-outline'}
                label={p.archived_at ? 'Restore project' : 'Archive project'}
                onPress={toggleArchive}
              />
            </>
          )
        }
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxxl }]}
        keyboardShouldPersistTaps="handled"
      >
        {p.archived_at && (
          <View style={styles.banner}>
            <Ionicons name="archive-outline" size={16} color={colors.warning} />
            <Text style={{ color: colors.warning, fontSize: 13, fontWeight: '600' }}>
              Archived {relativeTime(p.archived_at)} ago
            </Text>
          </View>
        )}

        {editing && draft ? (
          <TextInput
            style={[styles.input, type.title]}
            value={draft.title}
            onChangeText={(title) => setDraft({ ...draft, title })}
            placeholder="Project title"
            placeholderTextColor={colors.muted}
            maxLength={160}
          />
        ) : (
          <Text style={type.display}>{p.title}</Text>
        )}

        <View style={{ marginTop: spacing.sm, flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <StageChip
            name={stage?.name ?? embeddedStage?.name ?? 'Stage'}
            kind={stage?.kind ?? embeddedStage?.kind}
            color={stage?.color}
            onPress={() => setPickerOpen(true)}
          />
          <Text style={type.caption}>Updated {relativeTime(p.updated_at)}</Text>
        </View>

        {lead && (
          <>
            <SectionLabel>Lead</SectionLabel>
            <Card>
              <View style={styles.leadRow}>
                <Avatar name={lead.name} uri={leadThread?.picture_url} size={44} />
                <View style={{ flex: 1 }}>
                  <Text style={type.heading} numberOfLines={1}>
                    {lead.name}
                  </Text>
                  <Text style={type.small} numberOfLines={1}>
                    {[lead.email, lead.phone].filter(Boolean).join(' · ') || 'No contact details'}
                  </Text>
                </View>
              </View>
              <View style={styles.leadActions}>
                <Button
                  label="Message"
                  size="sm"
                  disabled={!thread.data}
                  icon={<Ionicons name="chatbubble-outline" size={15} color="#fff" />}
                  onPress={() => thread.data && router.push(`/chat/${thread.data.id}`)}
                  style={{ flex: 1 }}
                />
                <Button
                  label="Lead details"
                  size="sm"
                  variant="secondary"
                  onPress={() => router.push(`/lead/${p.lead_id}`)}
                  style={{ flex: 1 }}
                />
              </View>
            </Card>
          </>
        )}

        <SectionLabel>Details</SectionLabel>
        <Card style={{ paddingVertical: 4 }}>
          {editing && draft ? (
            <>
              <Field label="Value">
                <TextInput
                  style={styles.fieldInput}
                  value={draft.value}
                  onChangeText={(value) => setDraft({ ...draft, value })}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  placeholderTextColor={colors.muted}
                />
              </Field>
              <Row icon="cash-outline" label="Currency" value={p.currency} />
              <Field label="Description">
                <TextInput
                  style={[styles.fieldInput, styles.multiline]}
                  value={draft.description}
                  onChangeText={(description) => setDraft({ ...draft, description })}
                  multiline
                  maxLength={4000}
                  placeholder="What is this project about?"
                  placeholderTextColor={colors.muted}
                />
              </Field>
              <Field label="Notes">
                <TextInput
                  style={[styles.fieldInput, styles.multiline]}
                  value={draft.notes}
                  onChangeText={(notes) => setDraft({ ...draft, notes })}
                  multiline
                  maxLength={4000}
                  placeholder="Internal notes"
                  placeholderTextColor={colors.muted}
                />
              </Field>
              <Button label="Cancel" variant="ghost" size="sm" onPress={() => setEditing(false)} />
            </>
          ) : (
            <>
              <Row icon="pricetag-outline" label="Value" value={money(p.value, p.currency)} />
              <Row icon="cash-outline" label="Currency" value={p.currency} />
              <Row icon="document-text-outline" label="Description" value={p.description} />
              <Row icon="create-outline" label="Notes" value={p.notes} />
            </>
          )}
        </Card>

        <SectionLabel>Timeline</SectionLabel>
        <Card style={{ paddingVertical: 4 }}>
          {(events.data ?? []).length === 0 ? (
            <Text style={[type.small, { paddingVertical: 10 }]}>No stage changes yet.</Text>
          ) : (
            events.data!.map((e) => (
              <View key={e.id} style={styles.event}>
                <View style={styles.eventDot} />
                <View style={{ flex: 1 }}>
                  <Text style={type.body}>
                    {e.from_stage_id ? `${stageById.get(e.from_stage_id)?.name ?? 'Stage'} → ` : 'Started in '}
                    <Text style={{ fontWeight: '600', color: colors.ink }}>
                      {stageById.get(e.to_stage_id)?.name ?? 'Stage'}
                    </Text>
                  </Text>
                  <Text style={type.caption}>
                    {e.source}
                    {e.reason ? ` · ${e.reason}` : ''} · {relativeTime(e.created_at)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </Card>
      </ScrollView>

      <StagePickerSheet
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        stages={(stages.data ?? []).map((s) => ({ id: s.id, name: s.name, kind: s.kind, color: s.color }))}
        currentId={p.stage_id}
        onPick={(toStageId) =>
          move.mutate(
            { projectId: p.id, toStageId },
            { onError: (e) => Alert.alert("Couldn't move project", e.message) },
          )
        }
      />
    </KeyboardView>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ paddingVertical: 8 }}>
      <Text style={[type.caption, { marginBottom: 4 }]}>{label}</Text>
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  content: { padding: spacing.lg },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.warningLight,
    padding: 10,
    borderRadius: radius.sm,
    marginBottom: spacing.md,
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fieldInput: {
    backgroundColor: colors.page,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.ink,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  leadRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  leadActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  event: { flexDirection: 'row', gap: spacing.md, paddingVertical: 10, alignItems: 'flex-start' },
  eventDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent, marginTop: 6 },
})
