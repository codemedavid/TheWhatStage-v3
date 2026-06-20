import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActiveProjectContext, ProjectStageKind } from './types'

// A project + its stage as fetched for active-project resolution.
export type ProjectForResolution = {
  id: string
  title: string
  value: number | null
  currency: string
  ai_instructions: string | null
  updated_at: string
  // The project's current board stage id — used to look up per-stage AI rules.
  stage_id: string | null
  stage: { name: string | null; kind: ProjectStageKind | null } | null
}

// Per-stage AI rules row (project_stage_sequences) for the active project's
// current stage. All optional — most stages have no sequence configured.
type StageRulesRow = {
  stage_instructions: string | null
  do_rules: string[] | null
  dont_rules: string[] | null
}

// Pure, DB-free selector: the active project for a customer is the most-
// recently-updated NON-terminal one (stage kind null or 'open'; never
// 'won'/'lost'). `rows` is expected pre-sorted by updated_at desc, but we do
// not rely on that — we pick the newest open project defensively.
export function pickActiveProject(rows: ProjectForResolution[]): ProjectForResolution | null {
  let chosen: ProjectForResolution | null = null
  for (const r of rows) {
    const terminal = r.stage?.kind === 'won' || r.stage?.kind === 'lost'
    if (terminal) continue
    if (!chosen || r.updated_at > chosen.updated_at) chosen = r
  }
  return chosen
}

function toContext(p: ProjectForResolution, rules: StageRulesRow | null): ActiveProjectContext {
  return {
    id: p.id,
    title: p.title,
    stage_name: p.stage?.name ?? null,
    stage_kind: p.stage?.kind ?? null,
    value: p.value,
    currency: p.currency,
    ai_instructions: p.ai_instructions,
    stage_instructions: rules?.stage_instructions ?? null,
    stage_do_rules: rules?.do_rules ?? [],
    stage_dont_rules: rules?.dont_rules ?? [],
  }
}

// Resolve the active project context for a lead. Accepts any SupabaseClient
// (request-scoped or admin) — the caller is responsible for user scoping; the
// messenger worker uses the admin client and constrains by user_id upstream.
export async function resolveActiveProjectContext(
  client: SupabaseClient,
  leadId: string,
): Promise<ActiveProjectContext | null> {
  const { data, error } = await client
    .from('projects')
    .select('id, title, value, currency, ai_instructions, updated_at, stage_id, project_stages(name, kind)')
    .eq('lead_id', leadId)
    .order('updated_at', { ascending: false })
    .limit(20)
  if (error) throw error

  type Raw = Omit<ProjectForResolution, 'stage'> & {
    project_stages: { name: string | null; kind: ProjectStageKind | null } | { name: string | null; kind: ProjectStageKind | null }[] | null
  }
  const rows: ProjectForResolution[] = ((data ?? []) as Raw[]).map((r) => {
    const stage = Array.isArray(r.project_stages) ? (r.project_stages[0] ?? null) : (r.project_stages ?? null)
    return { id: r.id, title: r.title, value: r.value, currency: r.currency, ai_instructions: r.ai_instructions, updated_at: r.updated_at, stage_id: r.stage_id ?? null, stage }
  })

  const chosen = pickActiveProject(rows)
  if (!chosen) return null

  // Load the per-stage AI rules for the chosen project's current stage so the
  // live reply can switch from cold-lead mode to in-progress-deal mode.
  // Best-effort: a stage with no configured sequence simply has no rules.
  let rules: StageRulesRow | null = null
  if (chosen.stage_id) {
    const { data: rulesRow } = await client
      .from('project_stage_sequences')
      .select('stage_instructions, do_rules, dont_rules')
      .eq('stage_id', chosen.stage_id)
      .maybeSingle<StageRulesRow>()
    rules = rulesRow ?? null
  }

  return toContext(chosen, rules)
}

// Render the project context as a compact prompt block for LLM alignment.
// Returns '' when there is nothing useful to inject. When a project is active,
// it switches the bot OUT of cold-lead mode: per-stage instructions + do/dont
// rules become priority guidance, plus an explicit "not a new inquiry" guard.
export function renderProjectContextBlock(ctx: ActiveProjectContext | null): string {
  if (!ctx) return ''
  const lines: string[] = [
    '# Active project — talk to this customer as an in-progress deal (TOP PRIORITY)',
    `This customer is an existing client with an open project: "${ctx.title}". They are not a new inquiry.`,
  ]
  if (ctx.stage_name) lines.push(`Current stage: ${ctx.stage_name}`)
  if (ctx.value != null) lines.push(`Deal value: ${ctx.currency} ${ctx.value}`)

  const instr = ctx.ai_instructions?.trim()
  if (instr) lines.push(`Instructions about this customer (follow strictly):\n${instr}`)

  const stageInstr = ctx.stage_instructions?.trim()
  if (stageInstr) lines.push(`How to talk to them at this stage (follow strictly):\n${stageInstr}`)

  const dos = ctx.stage_do_rules.map((r) => r.trim()).filter(Boolean)
  if (dos.length) lines.push(`At this stage, DO:\n${dos.map((r) => `- ${r}`).join('\n')}`)

  const donts = ctx.stage_dont_rules.map((r) => r.trim()).filter(Boolean)
  if (donts.length) lines.push(`At this stage, DON'T:\n${donts.map((r) => `- ${r}`).join('\n')}`)

  lines.push(
    'Because this deal is already in progress, do NOT treat them like a cold lead: do NOT re-introduce ' +
      'yourself or the business from scratch, do NOT re-ask for information they already gave, and do NOT ' +
      're-send or re-request an action page / form they already completed for this project. Continue the deal ' +
      'from where it stands, following the stage guidance above. These project and stage instructions take ' +
      'priority over the general rules whenever they conflict.',
  )
  return lines.join('\n')
}
