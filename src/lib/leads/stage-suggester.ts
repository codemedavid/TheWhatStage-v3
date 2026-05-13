import type { createAdminClient } from '@/lib/supabase/admin'
import { HfRouterLlm, ragConfig } from '@/lib/rag'

type Admin = ReturnType<typeof createAdminClient>

export type SuggesterStage = {
  id: string
  name: string
  kind: string
  description: string | null
  entry_signals: string[]
  exit_signals: string[]
  required_fields: string[]
}

export type KnowledgeSummary = {
  offers: string[]
  faqs: string[]
  qualification_criteria: string[]
  tags: string[]
}

export type Suggestion = {
  stage_id: string
  field: 'description' | 'entry_signals' | 'exit_signals' | 'required_fields'
  proposed_value: unknown
  reason: string
  source_refs?: string[]
}

const VALID_FIELDS = new Set<Suggestion['field']>([
  'description',
  'entry_signals',
  'exit_signals',
  'required_fields',
])

export function buildSuggesterPrompt(input: { stages: SuggesterStage[]; knowledge: KnowledgeSummary }): string {
  const stageBlock = input.stages
    .map((s) =>
      [
        `stage_id=${s.id} name="${s.name}" kind=${s.kind}`,
        `  description: ${s.description ?? ''}`,
        `  entry_signals: ${JSON.stringify(s.entry_signals)}`,
        `  exit_signals: ${JSON.stringify(s.exit_signals)}`,
        `  required_fields: ${JSON.stringify(s.required_fields)}`,
      ].join('\n'),
    )
    .join('\n\n')

  const knowBlock =
    `offers:\n${input.knowledge.offers.map((o) => '  - ' + o).join('\n') || '  (none)'}\n` +
    `faqs:\n${input.knowledge.faqs.map((f) => '  - ' + f).join('\n') || '  (none)'}\n` +
    `qualification_criteria:\n${input.knowledge.qualification_criteria.map((q) => '  - ' + q).join('\n') || '  (none)'}\n` +
    `tags: ${input.knowledge.tags.join(', ')}`

  return (
    'You are a sales pipeline tuner. Given the user\'s current pipeline stages and a summary of ' +
    'their business knowledge (offers, FAQs, qualification criteria), propose targeted edits to ' +
    'stage descriptions and signal lists so they match what this business actually sells and asks.\n\n' +
    'Only propose changes where there is a concrete mismatch — e.g. the knowledge mentions a specific ' +
    'product or qualification question that the stage signals do not reflect. Do NOT propose stylistic ' +
    'rewrites.\n\n' +
    'Output JSON only:\n' +
    '{"suggestions": [{"stage_id": string, "field": "description"|"entry_signals"|"exit_signals"|"required_fields", "proposed_value": any, "reason": string}]}\n\n' +
    'For array fields (entry_signals, exit_signals, required_fields), proposed_value is the FULL replacement array, not a delta.\n\n' +
    `# Current stages\n${stageBlock}\n\n# Knowledge\n${knowBlock}`
  )
}

export function parseSuggesterOutput(raw: string): Suggestion[] {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return []
    const arr = (parsed as { suggestions?: unknown }).suggestions
    if (!Array.isArray(arr)) return []
    const out: Suggestion[] = []
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue
      const it = item as Record<string, unknown>
      if (typeof it.stage_id !== 'string') continue
      if (typeof it.field !== 'string' || !VALID_FIELDS.has(it.field as Suggestion['field'])) continue
      if (typeof it.reason !== 'string') continue
      out.push({
        stage_id: it.stage_id,
        field: it.field as Suggestion['field'],
        proposed_value: it.proposed_value,
        reason: it.reason,
      })
    }
    return out
  } catch {
    return []
  }
}

export async function loadKnowledgeSummary(admin: Admin, userId: string): Promise<KnowledgeSummary> {
  const offers: string[] = []
  const faqs: string[] = []
  const qualification_criteria: string[] = []
  const tagsSet = new Set<string>()

  // business_items: status values are 'draft' | 'published' | 'archived'
  const { data: items } = await admin
    .from('business_items')
    .select('title, rag_text')
    .eq('user_id', userId)
    .eq('status', 'published')
    .limit(50)
  for (const it of (items ?? []) as { title: string; rag_text: string | null }[]) {
    offers.push(`${it.title}: ${(it.rag_text ?? '').slice(0, 240)}`)
  }

  const { data: faqRows } = await admin
    .from('knowledge_faqs')
    .select('question, answer')
    .eq('user_id', userId)
    .limit(50)
  for (const f of (faqRows ?? []) as { question: string; answer: string }[]) {
    faqs.push(`${f.question} → ${(f.answer ?? '').slice(0, 200)}`)
  }

  // Qualification criteria from any qualification action page
  const { data: pages } = await admin
    .from('action_pages')
    .select('id, kind, config')
    .eq('user_id', userId)
    .eq('kind', 'qualification')
  for (const p of (pages ?? []) as { config: unknown }[]) {
    const cfg = p.config as { questions?: { prompt?: string }[] } | null
    for (const q of cfg?.questions ?? []) {
      if (q.prompt) qualification_criteria.push(q.prompt)
    }
  }

  const { data: tagRows } = await admin
    .from('knowledge_tags')
    .select('name')
    .eq('user_id', userId)
    .limit(30)
  for (const t of (tagRows ?? []) as { name: string }[]) tagsSet.add(t.name)

  return { offers, faqs, qualification_criteria, tags: [...tagsSet] }
}

export async function runSuggesterForUser(admin: Admin, userId: string): Promise<number> {
  const { data: stages } = await admin
    .from('pipeline_stages')
    .select('id, name, kind, description, entry_signals, exit_signals, required_fields')
    .eq('user_id', userId)
    .order('position')

  if (!stages || stages.length === 0) return 0

  const knowledge = await loadKnowledgeSummary(admin, userId)
  const prompt = buildSuggesterPrompt({ stages: stages as SuggesterStage[], knowledge })

  const llm = new HfRouterLlm({ model: ragConfig.classifierModel })
  const raw = await llm.complete(
    [
      { role: 'system', content: prompt },
      { role: 'user', content: 'Return the suggestions JSON now.' },
    ],
    { responseFormat: 'json_object', temperature: 0.2 },
  )

  const suggestions = parseSuggesterOutput(raw)

  let written = 0
  for (const s of suggestions) {
    const stage = (stages as SuggesterStage[]).find((x) => x.id === s.stage_id)
    if (!stage) continue
    const currentValue =
      s.field === 'description'
        ? stage.description
        : s.field === 'entry_signals'
          ? stage.entry_signals
          : s.field === 'exit_signals'
            ? stage.exit_signals
            : stage.required_fields

    // Supersede earlier pending suggestions for the same (stage_id, field).
    await admin
      .from('pipeline_stage_suggestions')
      .update({ status: 'superseded' })
      .eq('user_id', userId)
      .eq('stage_id', s.stage_id)
      .eq('field', s.field)
      .eq('status', 'pending')

    const { error } = await admin.from('pipeline_stage_suggestions').insert({
      user_id: userId,
      stage_id: s.stage_id,
      field: s.field,
      current_value: currentValue,
      proposed_value: s.proposed_value,
      reason: s.reason,
      source_refs: s.source_refs ?? [],
    })
    if (!error) written++
  }

  await admin
    .from('stage_suggestion_jobs')
    .update({ status: 'idle', last_completed_at: new Date().toISOString() })
    .eq('user_id', userId)

  return written
}
