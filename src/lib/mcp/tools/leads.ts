import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { buildLeadSearchOr } from '@/app/(app)/dashboard/leads/_lib/queries'
import { defineTool } from '../define-tool'
import { jsonResult, McpToolError, type McpContext } from '../context'

const SEARCH_LIMIT_MAX = 50
const TIMELINE_LIMIT = 500

const LEAD_SELECT =
  'id, name, email, phone, company, job_title, source, estimated_value, notes, custom_fields, phones, emails, score, stage_id, last_activity_at, created_at, updated_at, ' +
  'pipeline_stages!leads_stage_id_fkey(name, kind), ' +
  'messenger_threads(id, full_name, picture_url, conversation_summary, unread_count, missed_count, last_inbound_at, last_outbound_at, last_message_at, auto_reply_enabled, bot_paused_until, is_important)'

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null)
}

export async function loadLeadOrThrow(ctx: McpContext, leadId: string): Promise<Record<string, unknown>> {
  const { data, error } = await ctx.admin
    .from('leads').select(LEAD_SELECT)
    .eq('user_id', ctx.userId).eq('id', leadId).maybeSingle()
  if (error) throw error
  if (!data) throw new McpToolError('Lead not found.')
  return data as unknown as Record<string, unknown>
}

export function registerLeadTools(server: McpServer, ctx: McpContext): void {
  defineTool(server, ctx, {
    name: 'search_leads',
    title: 'Search leads',
    description:
      'Find leads (customers/contacts) by name, email, phone, or company. Returns the most recently active matches with their pipeline stage. Use the returned lead id with get_lead, get_conversation, list_lead_projects, and send_message.',
    input: {
      query: z.string().trim().max(120).default('').describe('Free text matched against name, email, phone, company. Empty returns the most recently active leads.'),
      limit: z.number().int().min(1).max(SEARCH_LIMIT_MAX).default(20),
    },
    annotations: { readOnlyHint: true },
  }, async ({ query, limit }) => {
    let q = ctx.admin
      .from('leads')
      .select('id, name, email, phone, company, last_activity_at, created_at, pipeline_stages!leads_stage_id_fkey(name, kind)')
      .eq('user_id', ctx.userId)
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .limit(limit)
    if (query) q = q.or(buildLeadSearchOr(query))
    const { data, error } = await q
    if (error) throw error
    const rows = (data ?? []).map((row) => {
      const stage = one(row.pipeline_stages as { name: string; kind: string | null } | { name: string; kind: string | null }[] | null)
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        company: row.company,
        stage: stage?.name ?? null,
        stage_kind: stage?.kind ?? null,
        last_activity_at: row.last_activity_at,
        created_at: row.created_at,
      }
    })
    return jsonResult({ leads: rows })
  })

  defineTool(server, ctx, {
    name: 'get_lead',
    title: 'Get lead',
    description:
      'Full profile of one lead: contact details (including every phone/email ever collected), pipeline stage, score, notes, custom fields, and a summary of the Messenger thread (AI conversation summary, unread/missed counts, bot status). Read-only.',
    input: { lead_id: z.string().uuid() },
    annotations: { readOnlyHint: true },
  }, async ({ lead_id }) => {
    const lead = await loadLeadOrThrow(ctx, lead_id)
    const { data: contacts } = await ctx.admin
      .from('lead_contact_values')
      .select('kind, value, source, collected_at')
      .eq('user_id', ctx.userId).eq('lead_id', lead_id)
      .order('collected_at', { ascending: false })
    const stage = one(lead.pipeline_stages as { name: string; kind: string | null } | null)
    const thread = one(lead.messenger_threads as Record<string, unknown> | Record<string, unknown>[] | null)
    const { pipeline_stages: _s, messenger_threads: _t, ...rest } = lead
    void _s; void _t
    return jsonResult({
      lead: { ...rest, stage: stage?.name ?? null, stage_kind: stage?.kind ?? null },
      contact_values: contacts ?? [],
      messenger_thread: thread,
    })
  })

  defineTool(server, ctx, {
    name: 'get_lead_timeline',
    title: 'Get lead timeline',
    description:
      'Chronological history of pipeline stage changes for a lead, plus stage changes of every project belonging to that lead. Each entry says who moved it (user, ai, workflow, action page) and why. Read-only.',
    input: { lead_id: z.string().uuid() },
    annotations: { readOnlyHint: true },
  }, async ({ lead_id }) => {
    await loadLeadOrThrow(ctx, lead_id)
    const [leadEvents, leadStages, projects] = await Promise.all([
      ctx.admin.from('lead_stage_events')
        .select('id, from_stage_id, to_stage_id, source, reason, confidence, created_at')
        .eq('user_id', ctx.userId).eq('lead_id', lead_id)
        .order('created_at', { ascending: true }).limit(TIMELINE_LIMIT),
      ctx.admin.from('pipeline_stages').select('id, name').eq('user_id', ctx.userId),
      ctx.admin.from('projects').select('id, title').eq('user_id', ctx.userId).eq('lead_id', lead_id),
    ])
    if (leadEvents.error) throw leadEvents.error
    const projectIds = (projects.data ?? []).map((p) => p.id as string)
    const projectTitle = new Map((projects.data ?? []).map((p) => [p.id as string, p.title as string]))

    const [projectEvents, projectStages] = projectIds.length
      ? await Promise.all([
          ctx.admin.from('project_stage_events')
            .select('id, project_id, from_stage_id, to_stage_id, source, reason, created_at')
            .eq('user_id', ctx.userId).in('project_id', projectIds)
            .order('created_at', { ascending: true }).limit(TIMELINE_LIMIT),
          ctx.admin.from('project_stages').select('id, name').eq('user_id', ctx.userId),
        ])
      : [{ data: [], error: null }, { data: [], error: null }]
    if (projectEvents.error) throw projectEvents.error

    const leadStageName = new Map((leadStages.data ?? []).map((s) => [s.id as string, s.name as string]))
    const projectStageName = new Map((projectStages.data ?? []).map((s) => [s.id as string, s.name as string]))

    const events = [
      ...(leadEvents.data ?? []).map((e) => ({
        kind: 'lead_stage' as const,
        at: e.created_at as string,
        from: e.from_stage_id ? leadStageName.get(e.from_stage_id as string) ?? null : null,
        to: e.to_stage_id ? leadStageName.get(e.to_stage_id as string) ?? null : null,
        source: e.source,
        reason: e.reason,
        confidence: e.confidence,
      })),
      ...(projectEvents.data ?? []).map((e) => ({
        kind: 'project_stage' as const,
        at: e.created_at as string,
        project_id: e.project_id,
        project_title: projectTitle.get(e.project_id as string) ?? null,
        from: e.from_stage_id ? projectStageName.get(e.from_stage_id as string) ?? null : null,
        to: e.to_stage_id ? projectStageName.get(e.to_stage_id as string) ?? null : null,
        source: e.source,
        reason: e.reason,
      })),
    ].sort((a, b) => a.at.localeCompare(b.at))
    return jsonResult({ events })
  })

  defineTool(server, ctx, {
    name: 'list_lead_submissions',
    title: 'List lead form submissions',
    description:
      'Every action-page submission (form fill, booking, quiz, order, catalog request) this lead has made, newest first, with the submitted data. Read-only.',
    input: { lead_id: z.string().uuid(), limit: z.number().int().min(1).max(100).default(25) },
    annotations: { readOnlyHint: true },
  }, async ({ lead_id, limit }) => {
    await loadLeadOrThrow(ctx, lead_id)
    const { data, error } = await ctx.admin
      .from('action_page_submissions')
      .select('id, outcome, data, created_at, action_page_id, action_pages(title, kind)')
      .eq('user_id', ctx.userId).eq('lead_id', lead_id)
      .order('created_at', { ascending: false }).limit(limit)
    if (error) throw error
    const submissions = (data ?? []).map((row) => {
      const page = one(row.action_pages as { title: string; kind: string } | { title: string; kind: string }[] | null)
      return {
        id: row.id,
        action_page_id: row.action_page_id,
        action_page_title: page?.title ?? null,
        action_page_kind: page?.kind ?? null,
        outcome: row.outcome,
        data: row.data,
        created_at: row.created_at,
      }
    })
    return jsonResult({ submissions })
  })
}
