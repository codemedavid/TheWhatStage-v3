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
  stage: { name: string | null; kind: ProjectStageKind | null } | null
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

function toContext(p: ProjectForResolution): ActiveProjectContext {
  return {
    id: p.id,
    title: p.title,
    stage_name: p.stage?.name ?? null,
    stage_kind: p.stage?.kind ?? null,
    value: p.value,
    currency: p.currency,
    ai_instructions: p.ai_instructions,
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
    .select('id, title, value, currency, ai_instructions, updated_at, project_stages(name, kind)')
    .eq('lead_id', leadId)
    .order('updated_at', { ascending: false })
    .limit(20)
  if (error) throw error

  type Raw = Omit<ProjectForResolution, 'stage'> & {
    project_stages: { name: string | null; kind: ProjectStageKind | null } | { name: string | null; kind: ProjectStageKind | null }[] | null
  }
  const rows: ProjectForResolution[] = ((data ?? []) as Raw[]).map((r) => {
    const stage = Array.isArray(r.project_stages) ? (r.project_stages[0] ?? null) : (r.project_stages ?? null)
    return { id: r.id, title: r.title, value: r.value, currency: r.currency, ai_instructions: r.ai_instructions, updated_at: r.updated_at, stage }
  })

  const chosen = pickActiveProject(rows)
  return chosen ? toContext(chosen) : null
}

// Render the project context as a compact prompt block for LLM alignment.
// Returns '' when there is nothing useful to inject.
export function renderProjectContextBlock(ctx: ActiveProjectContext | null): string {
  if (!ctx) return ''
  const lines: string[] = [`Current project for this customer: "${ctx.title}"`]
  if (ctx.stage_name) lines.push(`Stage: ${ctx.stage_name}`)
  if (ctx.value != null) lines.push(`Deal value: ${ctx.currency} ${ctx.value}`)
  const instr = ctx.ai_instructions?.trim()
  if (instr) lines.push(`Instructions about this customer (follow strictly):\n${instr}`)
  return lines.join('\n')
}
