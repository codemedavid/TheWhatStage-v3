import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { parseIntent } from '@/lib/agent/parseIntent'
import { resolveAudience } from '@/lib/agent/resolveAudience'
import { loadContext, DAILY_CAP } from '@/lib/agent/loadContext'
import { classifyPolicy, policyLabel } from '@/lib/agent/classifyPolicy'
import { generateDraft } from '@/lib/agent/generateDraft'

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
  try {
    const body = await req.json() as { command?: unknown; imageMediaAssetId?: unknown; imageUrl?: unknown }
    command = typeof body.command === 'string' ? body.command.trim() : ''
    imageMediaAssetId = typeof body.imageMediaAssetId === 'string' ? body.imageMediaAssetId : null
    imageUrl = typeof body.imageUrl === 'string' ? body.imageUrl : null
  } catch { /* empty body is fine */ }

  if (!command) {
    return new Response(JSON.stringify({ error: 'command is required' }), {
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
        const intent = await parseIntent(command, stages)
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
        const limit = createLimiter(DRAFT_CONCURRENCY)
        let capRemaining = DAILY_CAP - ctx.dailyCapUsed

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
