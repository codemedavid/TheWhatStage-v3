import type { createAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_STAGES, type DefaultStage } from '@/app/(app)/dashboard/leads/_lib/defaults'

type Admin = ReturnType<typeof createAdminClient>

export type ExistingStage = {
  id: string
  name: string
  kind: string
  position: number
  entry_signals: string[] | null
}

export type UpgradeOp =
  | {
      kind: 'enrich'
      stageId: string
      newName: string
      newDescription: string
      newKind: string
      newEntrySignals: string[]
      newExitSignals: string[]
      newRequiredFields: string[]
    }
  | {
      kind: 'add'
      defaultStageName: string
      position: number
      payload: DefaultStage
    }

export type UpgradePlan = {
  needsUpgrade: boolean
  operations: UpgradeOp[]
  preservedCustomStageIds: string[]
  leadsMoved: number
}

/**
 * Match an existing stage to a default. We only auto-match when the user's
 * stage shares a structural identity with the default — same kind AND either
 * same canonical name (case-insensitive) OR same legacy alias.
 */
const KIND_ALIASES: Record<string, string[]> = {
  Engaged: ['contacted', 'first contact', 'outreach'],
  Interested: ['warm', 'engaged lead'],
  'Proposal / Booked': ['proposal', 'booking', 'booked'],
  Dormant: ['cold', 'inactive'],
}

export function matchStage(existing: ExistingStage, defaults: readonly DefaultStage[]): DefaultStage | null {
  for (const d of defaults) {
    const sameKind = d.kind === existing.kind
    const nameLower = existing.name.toLowerCase().trim()
    const directName = nameLower === d.name.toLowerCase().trim()
    const aliasMatch = (KIND_ALIASES[d.name] ?? []).some((a) => nameLower === a)
    if (sameKind && (directName || aliasMatch)) return d
  }
  return null
}

export function planUpgrade(existing: ExistingStage[], defaults: readonly DefaultStage[]): UpgradePlan {
  const needsUpgrade = existing.every((s) => !s.entry_signals || s.entry_signals.length === 0)

  const operations: UpgradeOp[] = []
  const preservedCustomStageIds: string[] = []
  const matched = new Set<string>()

  for (const ex of existing) {
    const d = matchStage(ex, defaults)
    if (!d) {
      preservedCustomStageIds.push(ex.id)
      continue
    }
    matched.add(d.name)
    operations.push({
      kind: 'enrich',
      stageId: ex.id,
      newName: d.name,
      newDescription: d.description,
      newKind: d.kind,
      newEntrySignals: d.entry_signals,
      newExitSignals: d.exit_signals,
      newRequiredFields: d.required_fields,
    })
  }

  defaults.forEach((d, i) => {
    if (!matched.has(d.name)) {
      operations.push({ kind: 'add', defaultStageName: d.name, position: i + existing.length, payload: d })
    }
  })

  return { needsUpgrade, operations, preservedCustomStageIds, leadsMoved: 0 }
}

export async function needsStageUpgrade(admin: Admin, userId: string): Promise<boolean> {
  const { data: profile } = await admin
    .from('profiles')
    .select('dismissed_stage_upgrade_at')
    .eq('id', userId)
    .maybeSingle()
  const dismissed = profile?.dismissed_stage_upgrade_at
    ? Date.now() - new Date(profile.dismissed_stage_upgrade_at).getTime() < 7 * 24 * 60 * 60 * 1000
    : false
  if (dismissed) return false

  const { data: stages } = await admin
    .from('pipeline_stages')
    .select('id, entry_signals')
    .eq('user_id', userId)
  if (!stages || stages.length === 0) return false
  const allEmpty = stages.every((s) => !s.entry_signals || (Array.isArray(s.entry_signals) && s.entry_signals.length === 0))
  return allEmpty
}

export async function previewUpgrade(admin: Admin, userId: string): Promise<UpgradePlan> {
  const { data: stages } = await admin
    .from('pipeline_stages')
    .select('id, name, kind, position, entry_signals')
    .eq('user_id', userId)
    .order('position')
  return planUpgrade((stages ?? []) as ExistingStage[], DEFAULT_STAGES)
}

export async function applyUpgrade(admin: Admin, userId: string): Promise<{ enriched: number; added: number }> {
  const { data: snapshot } = await admin
    .from('pipeline_stages')
    .select('*')
    .eq('user_id', userId)
  await admin.from('pipeline_stage_upgrade_snapshots').upsert({ user_id: userId, snapshot })

  const plan = await previewUpgrade(admin, userId)
  let enriched = 0
  let added = 0

  for (const op of plan.operations) {
    if (op.kind === 'enrich') {
      const { error } = await admin
        .from('pipeline_stages')
        .update({
          name: op.newName,
          description: op.newDescription,
          kind: op.newKind,
          entry_signals: op.newEntrySignals,
          exit_signals: op.newExitSignals,
          required_fields: op.newRequiredFields,
        })
        .eq('id', op.stageId)
      if (!error) enriched++
    } else {
      // append at the next free position
      const { data: maxRow } = await admin
        .from('pipeline_stages')
        .select('position')
        .eq('user_id', userId)
        .order('position', { ascending: false })
        .limit(1)
        .maybeSingle()
      const nextPos = (maxRow?.position ?? -1) + 1
      const { error } = await admin.from('pipeline_stages').insert({
        user_id: userId,
        name: op.payload.name,
        description: op.payload.description,
        position: nextPos,
        is_default: op.payload.isDefault,
        kind: op.payload.kind,
        is_won: op.payload.kind === 'won',
        is_lost: op.payload.kind === 'lost',
        is_terminal: op.payload.kind === 'won' || op.payload.kind === 'lost',
        entry_signals: op.payload.entry_signals,
        exit_signals: op.payload.exit_signals,
        required_fields: op.payload.required_fields,
      })
      if (!error) added++
    }
  }

  // Trigger an immediate suggestion run.
  await admin
    .from('stage_suggestion_jobs')
    .upsert({ user_id: userId, run_at: new Date().toISOString(), status: 'queued' })

  return { enriched, added }
}

export async function undoUpgrade(admin: Admin, userId: string): Promise<boolean> {
  const { data: snap } = await admin
    .from('pipeline_stage_upgrade_snapshots')
    .select('snapshot')
    .eq('user_id', userId)
    .maybeSingle()
  if (!snap?.snapshot || !Array.isArray(snap.snapshot)) return false

  // Drop current stages (cascades to leads via NULL not applied — DO NOT actually delete because of FK).
  // Instead: update every stage in the snapshot back to its original values; remove stages that were inserted (kind+name not in snapshot).
  const snapshot = snap.snapshot as Array<Record<string, unknown>>
  const snapshotIds = new Set(snapshot.map((s) => s.id as string))

  const { data: current } = await admin
    .from('pipeline_stages')
    .select('id')
    .eq('user_id', userId)
  const currentIds = new Set((current ?? []).map((s) => s.id as string))

  // Delete inserted ones (in current but not in snapshot). Leads referencing them are impossible: we just added them, so no leads can be there yet — but guard anyway by checking lead counts.
  for (const id of currentIds) {
    if (snapshotIds.has(id)) continue
    const { count } = await admin
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('stage_id', id)
    if ((count ?? 0) === 0) {
      await admin.from('pipeline_stages').delete().eq('id', id)
    }
  }

  // Restore enriched stages.
  for (const row of snapshot) {
    if (!currentIds.has(row.id as string)) continue
    await admin
      .from('pipeline_stages')
      .update({
        name: row.name,
        description: row.description,
        kind: row.kind,
        entry_signals: row.entry_signals,
        exit_signals: row.exit_signals,
        required_fields: row.required_fields,
      })
      .eq('id', row.id as string)
  }

  await admin.from('pipeline_stage_upgrade_snapshots').delete().eq('user_id', userId)
  return true
}
