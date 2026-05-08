import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseIntent } from '@/lib/agent/parseIntent'
import { resolveAudience } from '@/lib/agent/resolveAudience'
import { loadContext, DAILY_CAP } from '@/lib/agent/loadContext'
import {
  classifyPolicy,
  policyLabel,
  classifyTemplatePolicy,
  templatePolicyLabel,
} from '@/lib/agent/classifyPolicy'
import { generateDraft } from '@/lib/agent/generateDraft'
import {
  renderTemplateVariables,
  type VariableMap,
} from '@/lib/messenger-templates/render'
import { renderTemplate } from '@/lib/messenger-templates/types'
import type { ParsedIntent } from '@/lib/agent/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const DRAFT_CONCURRENCY = parseInt(process.env.AGENT_DRAFT_CONCURRENCY ?? '8', 10)

// Simple bounded concurrency limiter (avoids p-limit dependency).
function createLimiter(concurrency: number) {
  let running = 0
  const queue: Array<() => void> = []
  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = async () => {
        running++
        try { resolve(await fn()) } catch (err) { reject(err) }
        finally {
          running--
          if (queue.length > 0) queue.shift()!()
        }
      }
      if (running < concurrency) run()
      else queue.push(run)
    })
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const claims = await supabase.auth.getClaims()
  let userId: string | undefined = claims.data?.claims?.sub
  if (!userId) {
    const { data } = await supabase.auth.getUser()
    userId = data.user?.id
  }
  if (!userId) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  let command = ''
  let imageMediaAssetId: string | null = null
  let imageUrl: string | null = null
  let mode: 'per_lead_ai' | 'shared_template' = 'per_lead_ai'
  let templateId: string | null = null
  let templateVariables: VariableMap = {}
  let attachedActionPageId: string | null = null
  let attachedButtonIndex = 0
  let stageNameInput: string | null = null
  let lastActiveWithinDays: number | null = null
  try {
    const body = await req.json() as Record<string, unknown>
    command = typeof body.command === 'string' ? body.command.trim() : ''
    imageMediaAssetId = typeof body.imageMediaAssetId === 'string' ? body.imageMediaAssetId : null
    imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : null
    if (body.mode === 'shared_template') mode = 'shared_template'
    if (typeof body.templateId === 'string') templateId = body.templateId
    if (body.templateVariables && typeof body.templateVariables === 'object') {
      templateVariables = body.templateVariables as VariableMap
    }
    if (typeof body.attachedActionPageId === 'string') {
      attachedActionPageId = body.attachedActionPageId
    }
    if (typeof body.attachedButtonIndex === 'number') {
      attachedButtonIndex = body.attachedButtonIndex
    }
    if (typeof body.stageName === 'string') stageNameInput = body.stageName
    if (typeof body.lastActiveWithinDays === 'number') {
      lastActiveWithinDays = body.lastActiveWithinDays
    }
  } catch { /* empty body is fine */ }

  if (mode === 'per_lead_ai' && !command) {
    return new Response(JSON.stringify({ error: 'command is required' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }
  if (mode === 'shared_template' && !templateId) {
    return new Response(JSON.stringify({ error: 'templateId is required for shared_template mode' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  const admin = createAdminClient()
  const enc = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          )
        } catch { /* controller may be closed on client disconnect */ }
      }

      try {
        // Fetch user's pipeline stages for intent parsing context.
        const { data: stagesData } = await admin
          .from('pipeline_stages')
          .select('name')
          .eq('user_id', userId)
          .order('position', { ascending: true })
        const stages = (stagesData ?? []).map((s) => s.name as string)

        // 1. Parse intent
        // In shared_template mode the audience is supplied directly via
        // stageName / lastActiveWithinDays — we skip the LLM intent parse
        // entirely. We synthesize a ParsedIntent so the rest of the
        // pipeline (resolveAudience, campaign row) keeps the same shape.
        let intent: ParsedIntent
        if (mode === 'shared_template') {
          intent = {
            audience: {
              stage_name: stageNameInput,
              last_active_within_days: lastActiveWithinDays,
            },
            instruction: '',
            tone: 'professional',
            ambiguities: [],
          }
        } else {
          intent = await parseIntent(command, stages)
        }
        send('intent', intent)

        if (intent.ambiguities.length > 0) {
          // Surface ambiguities and let the UI ask the user before proceeding.
          // The client may choose to continue anyway.
        }

        // 2. Resolve audience
        const audience = await resolveAudience(admin, userId!, intent)
        send('audience', { count: audience.length })

        if (audience.length === 0) {
          send('done', {})
          controller.close()
          return
        }

        // 3. Bulk context load
        const threadIds = audience.map((l) => l.thread_id)
        const ctx = await loadContext(admin, userId!, threadIds)

        // 4. Create campaign record early so the client has a stable campaign_id.
        const { data: campaign, error: campaignErr } = await admin
          .from('agent_campaigns')
          .insert({
            user_id: userId,
            command_text: command,
            intent,
            image_media_asset_id: imageMediaAssetId,
            image_url: imageUrl,
            status: 'previewing',
            total: audience.length,
            send_mode: mode,
            template_id: mode === 'shared_template' ? templateId : null,
            template_variables: mode === 'shared_template' ? templateVariables : {},
            attached_action_page_id: mode === 'shared_template' ? attachedActionPageId : null,
            attached_button_index: attachedButtonIndex,
          })
          .select('id')
          .single()

        if (campaignErr || !campaign) {
          send('error', { message: 'Failed to create campaign record' })
          controller.close()
          return
        }

        send('campaign', { campaign_id: campaign.id })

        // 5. Fan-out draft generation with bounded concurrency.
        let capRemaining = DAILY_CAP - ctx.dailyCapUsed

        if (mode === 'shared_template') {
          // Load the template once. We render the same body for everyone
          // (modulo variable substitution for lead_field rules) — no LLM
          // call per lead, so we don't need bounded concurrency.
          const { data: tplRow } = await admin
            .from('messenger_message_templates')
            .select('id, name, language, body_text, variable_count, buttons, meta_status')
            .eq('id', templateId!)
            .eq('user_id', userId!)
            .maybeSingle<{
              id: string
              name: string
              language: string
              body_text: string
              variable_count: number
              buttons: unknown
              meta_status: string
            }>()
          if (!tplRow) {
            send('error', { message: 'Template not found' })
            controller.close()
            return
          }
          if (tplRow.meta_status !== 'approved') {
            send('error', {
              message: `Template is "${tplRow.meta_status}" — only approved templates can be sent.`,
            })
            controller.close()
            return
          }

          for (const lead of audience) {
            const policy = classifyTemplatePolicy(lead, ctx, capRemaining)
            const label = templatePolicyLabel(policy)
            const included = policy.policy !== 'paused'
            const params = renderTemplateVariables(
              templateVariables,
              tplRow.variable_count,
              { name: lead.name, custom_fields: lead.custom_fields ?? null },
            )
            const rendered = renderTemplate(tplRow.body_text, params)
            if (included) capRemaining = Math.max(0, capRemaining - 1)
            send('draft', {
              lead_id: lead.id,
              thread_id: lead.thread_id,
              name: lead.name,
              draft: rendered,
              policy: label,
              user_included: included,
            })
          }
        } else {
          const limit = createLimiter(DRAFT_CONCURRENCY)
          await Promise.all(
            audience.map((lead) =>
              limit(async () => {
                const policy = classifyPolicy(lead, ctx, capRemaining)
                const label = policyLabel(policy)

                let draft = ''
                if (policy.policy !== 'paused') {
                  draft = await generateDraft(lead, intent, ctx)
                  capRemaining = Math.max(0, capRemaining - 1)
                }

                send('draft', {
                  lead_id: lead.id,
                  thread_id: lead.thread_id,
                  name: lead.name,
                  draft,
                  policy: label,
                  user_included: policy.policy !== 'paused',
                })
              }),
            ),
          )
        }

        send('done', { campaign_id: campaign.id, daily_cap_used: ctx.dailyCapUsed })
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.error('[agent.preview] stream error', msg)
        send('error', { message: msg })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  })
}
