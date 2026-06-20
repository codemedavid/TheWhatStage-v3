'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { SequenceInput, SequencePreviewInput } from '../_lib/schemas'
import {
  fetchStageSequence,
  fetchStageProjectsForPreview,
  type StageSequence,
  type StagePreviewProject,
} from '../_lib/queries'
import { seedStageProjectsImmediate, cancelStageSequenceRuns } from '@/lib/projects/sequences/seed'
import { draftSequenceBatch, loadSequenceSendContext, retrieveKnowledge } from '@/lib/sequences/shared'
import { describeActionError, isRedirectError, type ActionResult } from '../_lib/action-result'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

// Reject stage ids the caller does not own before any admin-client (RLS-bypassing)
// writes touch that stage.
async function assertStageOwned(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  stageId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from('project_stages').select('id')
    .eq('id', stageId).eq('user_id', userId).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Stage not found')
}

// Client-callable loader for the per-stage sequence editor.
export async function loadStageSequence(stageId: string): Promise<StageSequence> {
  const { supabase, userId } = await requireUser()
  return fetchStageSequence(supabase, userId, stageId)
}

// Upsert the per-stage sequence config and fully replace its steps. Applies to
// every project that enters this stage. When the sequence is enabled, projects
// ALREADY in the stage are enrolled immediately (first touch on the next tick);
// when disabled, their in-flight runs are cancelled. Returns how many existing
// projects were newly enrolled so the UI can confirm something happened.
export async function saveStageSequence(raw: unknown): Promise<ActionResult<{ seeded: number }>> {
  // Validate without throwing — a thrown error here would be masked by Next.js
  // in production into an opaque "Server Components render" message.
  const parsed = SequenceInput.safeParse(raw)
  if (!parsed.success) return { ok: false, error: describeActionError(parsed.error) }
  const input = parsed.data

  // requireUser() may redirect (which throws a sentinel); keep it outside the
  // try so the navigation isn't swallowed.
  const { supabase, userId } = await requireUser()

  let seqId: string
  try {
    await assertStageOwned(supabase, userId, input.stage_id)

    const { data: seq, error: seqErr } = await supabase
      .from('project_stage_sequences')
      .upsert(
        {
          user_id: userId,
          stage_id: input.stage_id,
          enabled: input.enabled,
          stage_instructions: input.stage_instructions?.trim() || null,
          do_rules: input.do_rules,
          dont_rules: input.dont_rules,
        },
        { onConflict: 'stage_id' },
      )
      .select('id').single()
    if (seqErr) throw seqErr
    seqId = seq.id

    // Replace steps: clear then re-insert with fresh positions.
    const { error: delErr } = await supabase
      .from('project_stage_sequence_steps').delete().eq('sequence_id', seqId)
    if (delErr) throw delErr

    if (input.steps.length > 0) {
      const rows = input.steps.map((s, position) => ({
        user_id: userId,
        sequence_id: seqId,
        position,
        delay_minutes: s.delay_minutes,
        instruction: s.instruction,
        fallback_message: s.fallback_message?.trim() || null,
        channel: s.channel,
      }))
      const { error: insErr } = await supabase
        .from('project_stage_sequence_steps').insert(rows)
      if (insErr) throw insErr
    }
  } catch (e) {
    if (isRedirectError(e)) throw e
    return { ok: false, error: describeActionError(e) }
  }

  // Enroll / unenroll projects already sitting in this stage. This is a
  // side-effect: the config is already saved, so a failure here must NOT fail
  // the whole save (it only means existing cards aren't auto-enrolled yet).
  // Uses the admin client to match the cron/worker path (reads messenger_threads).
  let seeded = 0
  try {
    const admin = createAdminClient()
    if (input.enabled && input.steps.length > 0) {
      seeded = await seedStageProjectsImmediate(admin, { userId, stageId: input.stage_id })
    } else {
      await cancelStageSequenceRuns(admin, userId, input.stage_id, 'stage sequence disabled')
    }
  } catch (e) {
    console.error('[stage-sequence] enrollment side-effect failed (config still saved)', e)
  }

  revalidatePath('/dashboard/projects', 'layout')
  return { ok: true, seeded }
}

// Load the project (lead) picker options for the per-stage preview UI.
export async function loadStagePreviewProjects(stageId: string): Promise<StagePreviewProject[]> {
  const { supabase, userId } = await requireUser()
  await assertStageOwned(supabase, userId, stageId)
  return fetchStageProjectsForPreview(supabase, userId, stageId)
}

export type SequencePreviewTouch = {
  position: number
  delay_minutes: number
  // The drafted message, or null when the model produced nothing for this step
  // (the live engine would fall back to the step's fallback_message).
  text: string | null
}

// Draft the whole stage sequence for ONE project in a single LLM call and
// return the messages WITHOUT sending or persisting anything — the test
// preview. Uses the in-editor config so an operator can see exactly what would
// go out before saving.
export async function previewStageSequence(
  raw: unknown,
): Promise<ActionResult<{ touches: SequencePreviewTouch[] }>> {
  const parsed = SequencePreviewInput.safeParse(raw)
  if (!parsed.success) return { ok: false, error: describeActionError(parsed.error) }
  const input = parsed.data

  const { supabase, userId } = await requireUser()

  try {
  await assertStageOwned(supabase, userId, input.stage_id)

  // Owner-scoped project lookup (RLS) — authoritative customer facts + lead.
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('id, lead_id, title, ai_instructions')
    .eq('id', input.project_id).eq('user_id', userId).maybeSingle<{
      id: string; lead_id: string; title: string; ai_instructions: string | null
    }>()
  if (projErr) throw projErr
  if (!project) throw new Error('Project not found')

  const admin = createAdminClient()

  // Resolve the lead's latest Messenger thread (if any) to ground the draft in
  // the real conversation, mirroring the firing worker's context.
  const { data: thread } = await admin
    .from('messenger_threads')
    .select('id')
    .eq('lead_id', project.lead_id)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<{ id: string }>()

  const loaded = thread
    ? await loadSequenceSendContext(admin, { threadId: thread.id, userId, leadId: project.lead_id })
    : null
  if (thread && (!loaded || !loaded.ok)) {
    throw new Error(loaded && !loaded.ok ? `Cannot preview: ${loaded.reason}` : 'Cannot preview this lead')
  }
  const ctx = loaded && loaded.ok ? loaded.ctx : null

  const knowledge = await retrieveKnowledge(
    admin,
    userId,
    [...input.steps.map((s) => s.instruction), project.title, project.ai_instructions]
      .filter(Boolean).join(' — '),
  ).catch(() => '')

  const drafts = await draftSequenceBatch({
    leadName: ctx?.leadName ?? null,
    persona: ctx?.persona ?? null,
    instructions: ctx?.instructions ?? null,
    doRules: ctx?.doRules ?? [],
    dontRules: ctx?.dontRules ?? [],
    knowledge,
    contextTitle: project.title,
    aiInstructions: project.ai_instructions,
    stageInstructions: input.stage_instructions?.trim() || null,
    stageDoRules: input.do_rules,
    stageDontRules: input.dont_rules,
    steps: input.steps.map((s, position) => ({
      position,
      delayMinutes: s.delay_minutes,
      instruction: s.instruction,
    })),
    recentMessages: ctx?.recentMessages ?? [],
  })

  const byPosition = new Map(drafts.map((d) => [d.position, d.text]))
  const touches = input.steps.map((s, position) => ({
    position,
    delay_minutes: s.delay_minutes,
    text: byPosition.get(position) ?? null,
  }))
  return { ok: true, touches }
  } catch (e) {
    if (isRedirectError(e)) throw e
    return { ok: false, error: describeActionError(e) }
  }
}

export async function setStageSequenceEnabled(stageId: string, enabled: boolean): Promise<{ seeded: number }> {
  const { supabase, userId } = await requireUser()
  await assertStageOwned(supabase, userId, stageId)
  const { error } = await supabase
    .from('project_stage_sequences')
    .upsert(
      { user_id: userId, stage_id: stageId, enabled },
      { onConflict: 'stage_id' },
    )
  if (error) throw error

  const admin = createAdminClient()
  let seeded = 0
  if (enabled) {
    seeded = await seedStageProjectsImmediate(admin, { userId, stageId })
  } else {
    await cancelStageSequenceRuns(admin, userId, stageId, 'stage sequence disabled')
  }

  revalidatePath('/dashboard/projects', 'layout')
  return { seeded }
}
