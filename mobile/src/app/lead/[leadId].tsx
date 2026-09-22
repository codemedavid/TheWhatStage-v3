import { Ionicons } from '@expo/vector-icons'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LeadContacts } from '@/components/leads/lead-contacts'
import { LeadFields, CONTACT_FIELDS, draftFromLead, type FieldDraft } from '@/components/leads/lead-fields'
import { LeadHeader } from '@/components/leads/lead-header'
import { LeadSubmissions } from '@/components/leads/lead-submissions'
import { LeadTimeline } from '@/components/leads/lead-timeline'
import { NewProjectSheet } from '@/components/leads/new-project-sheet'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, SectionLabel, Skeleton, StageChip } from '@/components/ui/primitives'
import { IconButton, ScreenHeader } from '@/components/ui/screen-header'
import { StagePickerSheet } from '@/components/ui/stage-picker-sheet'
import {
  useFieldDefs,
  useLead,
  useLeadStageEvents,
  useMoveLead,
  useStages,
  useUpdateLead,
  type LeadPatch,
} from '@/data/leads'
import { useCreateProject, useLeadProjects, useWorkspaces } from '@/data/projects'
import { useThreadByLead } from '@/data/threads'
import { one, type LeadRow } from '@/data/types'
import { money } from '@/lib/format'
import { colors, spacing, type } from '@/theme/tokens'

const SAVED_FLASH_MS = 2000

// PROJECT_SELECT embeds project_stages via the FK hint; ProjectRow doesn't type it yet.
type StageEmbed = { name: string; kind: string | null }

function buildPatch(lead: LeadRow, name: string, draft: FieldDraft): LeadPatch {
  const patch: LeadPatch = {}
  const trimmedName = name.trim()
  if (trimmedName && trimmedName !== lead.name) patch.name = trimmedName
  for (const f of CONTACT_FIELDS) {
    const next = draft.contact[f.key].trim() || null
    if (next !== (lead[f.key] ?? null)) patch[f.key] = next
  }
  const before = JSON.stringify(lead.custom_fields ?? {})
  if (JSON.stringify(draft.custom) !== before) patch.custom_fields = { ...draft.custom }
  return patch
}

export default function LeadDetailScreen() {
  const { leadId } = useLocalSearchParams<{ leadId: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()

  const lead = useLead(leadId)
  const stages = useStages()
  const defs = useFieldDefs()
  const events = useLeadStageEvents(leadId)
  const thread = useThreadByLead(leadId)
  const projects = useLeadProjects(leadId)
  const workspaces = useWorkspaces()
  const updateLead = useUpdateLead()
  const moveLead = useMoveLead()
  const createProject = useCreateProject()

  const [editing, setEditing] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [draft, setDraft] = useState<FieldDraft | null>(null)
  const [saved, setSaved] = useState(false)
  const [stagePicker, setStagePicker] = useState(false)
  const [projectSheet, setProjectSheet] = useState(false)

  const stageById = useMemo(() => new Map((stages.data ?? []).map((s) => [s.id, s])), [stages.data])

  useEffect(() => {
    if (!saved) return
    const t = setTimeout(() => setSaved(false), SAVED_FLASH_MS)
    return () => clearTimeout(t)
  }, [saved])

  const startEdit = () => {
    if (!lead.data) return
    setDraftName(lead.data.name)
    setDraft(draftFromLead(lead.data))
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setDraft(null)
  }

  const save = async () => {
    if (!lead.data || !draft) return
    const patch = buildPatch(lead.data, draftName, draft)
    if (Object.keys(patch).length === 0) return cancelEdit()
    try {
      await updateLead.mutateAsync({ leadId: lead.data.id, patch })
      setSaved(true)
      cancelEdit()
    } catch {
      // error surfaced via updateLead.error below
    }
  }

  if (lead.isLoading) {
    return (
      <View style={styles.screen}>
        <ScreenHeader back title="" />
        <View style={{ alignItems: 'center', padding: spacing.xl, gap: spacing.md }}>
          <Skeleton width={72} height={72} round />
          <Skeleton width="50%" height={20} />
          <Skeleton width="30%" />
        </View>
      </View>
    )
  }

  if (!lead.data) {
    return (
      <View style={styles.screen}>
        <ScreenHeader back title="Lead" />
        <EmptyState icon="person-outline" title="Lead not found" body={lead.error?.message ?? 'It may have been deleted.'} />
      </View>
    )
  }

  const row = lead.data
  const stage = stageById.get(row.stage_id)
  const hasThread = !!thread.data

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader
        back
        title={editing ? 'Edit lead' : row.name}
        right={
          editing ? (
            <Pressable onPress={cancelEdit} hitSlop={8}>
              <Text style={[type.bodyStrong, { color: colors.tertiary }]}>Cancel</Text>
            </Pressable>
          ) : (
            <IconButton name="create-outline" label="Edit lead" onPress={startEdit} />
          )
        }
      />
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: editing ? 120 : spacing.xxxl + insets.bottom }}
      >
        <LeadHeader
          lead={row}
          stage={stage}
          editing={editing}
          draftName={draftName}
          onChangeName={setDraftName}
          onPressStage={() => setStagePicker(true)}
          hasThread={hasThread}
          onMessage={() => thread.data && router.push(`/chat/${thread.data.id}`)}
          onNewProject={() => setProjectSheet(true)}
        />

        {moveLead.error ? <Notice tone="danger" text={`Move failed: ${moveLead.error.message}`} /> : null}
        {updateLead.error ? <Notice tone="danger" text={`Save failed: ${updateLead.error.message}`} /> : null}
        {saved ? <Notice tone="success" text="Changes saved" /> : null}

        <View style={{ paddingHorizontal: spacing.lg }}>
          {!editing && (
            <LeadContacts leadId={row.id} primaryPhone={row.phone} primaryEmail={row.email} />
          )}

          <LeadFields
            lead={row}
            defs={defs.data ?? []}
            editing={editing}
            draft={draft ?? draftFromLead(row)}
            onChange={setDraft}
          />

          <SectionLabel>Projects</SectionLabel>
          <Card style={{ paddingVertical: 4 }}>
            {(projects.data ?? []).length === 0 ? (
              <Text style={[type.small, { paddingVertical: spacing.sm }]}>No projects for this lead</Text>
            ) : (
              (projects.data ?? []).map((p, i, arr) => {
                const pStage = one(
                  (p as unknown as { project_stages?: StageEmbed | StageEmbed[] | null }).project_stages,
                )
                return (
                  <Pressable
                    key={p.id}
                    onPress={() => router.push(`/project/${p.id}`)}
                    style={[styles.projectRow, i === arr.length - 1 && { borderBottomWidth: 0 }]}
                  >
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={type.bodyStrong} numberOfLines={1}>
                        {p.title}
                      </Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                        {pStage ? <StageChip name={pStage.name} kind={pStage.kind} /> : null}
                        {p.archived_at ? <Text style={type.caption}>Archived</Text> : null}
                      </View>
                    </View>
                    <Text style={type.small}>{money(p.value, p.currency)}</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.muted} />
                  </Pressable>
                )
              })
            )}
          </Card>

          <LeadSubmissions leadId={row.id} />

          <LeadTimeline events={events.data ?? []} stages={stages.data ?? []} />
        </View>
      </ScrollView>

      {editing && (
        <View style={[styles.saveBar, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
          <Button label="Save changes" onPress={save} loading={updateLead.isPending} size="lg" />
        </View>
      )}

      <StagePickerSheet
        visible={stagePicker}
        onClose={() => setStagePicker(false)}
        stages={stages.data ?? []}
        currentId={row.stage_id}
        onPick={(toStageId) => moveLead.mutate({ leadId: row.id, toStageId })}
      />

      <NewProjectSheet
        visible={projectSheet}
        onClose={() => setProjectSheet(false)}
        leadName={row.name}
        workspaces={workspaces.data ?? []}
        busy={createProject.isPending}
        error={createProject.error?.message ?? null}
        onCreate={async ({ workspaceId, title, value }) => {
          try {
            const created = await createProject.mutateAsync({ leadId: row.id, workspaceId, title, value })
            setProjectSheet(false)
            router.push(`/project/${created.id}`)
          } catch {
            // error rendered inside the sheet
          }
        }}
      />
    </KeyboardAvoidingView>
  )
}

function Notice({ tone, text }: { tone: 'danger' | 'success'; text: string }) {
  const bg = tone === 'danger' ? colors.dangerLight : colors.successLight
  const fg = tone === 'danger' ? colors.danger : colors.accentDeep
  return (
    <View style={[styles.notice, { backgroundColor: bg }]}>
      <Ionicons name={tone === 'danger' ? 'alert-circle' : 'checkmark-circle'} size={16} color={fg} />
      <Text style={{ color: fg, fontSize: 13, flex: 1 }}>{text}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  projectRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  saveBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.lg,
    backgroundColor: colors.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: 10,
    borderRadius: 10,
  },
})
