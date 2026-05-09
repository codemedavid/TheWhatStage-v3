import { NextRequest } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { HfRouterLlm } from '@/lib/rag'
import { ragConfig } from '@/lib/rag/config'
import { KIND_REGISTRY, isActionPageKind } from '@/lib/action-pages/kinds'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Body = { pageId?: unknown }

type PageRow = {
  id: string
  kind: string
  title: string
  description: string | null
  cta_label: string | null
  bot_send_instructions: string | null
}

function jsonError(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function clean(s: string, max: number): string {
  return s.replace(/^"+|"+$/g, '').trim().slice(0, max)
}

function tryParseJson(text: string): { ctaLabel?: string; trigger?: string } {
  const trimmed = text.trim()
  const match = trimmed.match(/\{[\s\S]*\}/)
  if (!match) return {}
  try {
    const obj = JSON.parse(match[0]) as Record<string, unknown>
    const ctaLabel =
      typeof obj.ctaLabel === 'string'
        ? obj.ctaLabel
        : typeof obj.cta_label === 'string'
          ? obj.cta_label
          : undefined
    const trigger =
      typeof obj.trigger === 'string'
        ? obj.trigger
        : typeof obj.botSendInstructions === 'string'
          ? obj.botSendInstructions
          : typeof obj.bot_send_instructions === 'string'
            ? obj.bot_send_instructions
            : undefined
    return { ctaLabel, trigger }
  } catch {
    return {}
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const claimsRes = await supabase.auth.getClaims()
  let userId: string | undefined = claimsRes.data?.claims?.sub
  if (!userId) {
    const { data } = await supabase.auth.getUser()
    userId = data.user?.id
  }
  if (!userId) return jsonError(401, 'unauthorized')

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return jsonError(400, 'invalid_body')
  }
  const pageId = typeof body.pageId === 'string' ? body.pageId : ''
  if (!pageId) return jsonError(400, 'missing_page_id')

  const { data: page, error: loadErr } = await supabase
    .from('action_pages')
    .select('id, kind, title, description, cta_label, bot_send_instructions')
    .eq('id', pageId)
    .eq('user_id', userId)
    .maybeSingle<PageRow>()
  if (loadErr || !page) return jsonError(404, 'not_found')

  if (!isActionPageKind(page.kind)) return jsonError(400, 'invalid_kind')

  if (!ragConfig.hfToken) return jsonError(503, 'llm_not_configured')

  const meta = KIND_REGISTRY[page.kind]
  const llm = new HfRouterLlm({ model: ragConfig.classifierModel })

  const userBrief = [
    `Page kind: ${page.kind} (${meta.label} — ${meta.blurb})`,
    `Title: ${page.title}`,
    page.description ? `Description: ${page.description}` : null,
    page.cta_label ? `Existing CTA label: ${page.cta_label}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const raw = await llm
    .complete(
      [
        {
          role: 'system',
          content:
            'You write Messenger-bot routing instructions for a SaaS that sends action pages (forms, bookings, storefronts, sales pages, property listings) to leads. Given a page, output STRICT JSON only — no markdown, no preamble — with shape {"ctaLabel": "string (max 30 chars, button label)", "trigger": "string (max 240 chars, plain English starting with \\"Send when...\\")"}. The trigger must be specific to the page topic, action-oriented, and describe lead intent that warrants sending this page. Use the existing CTA label if provided.',
        },
        { role: 'user', content: userBrief },
      ],
      { temperature: 0.4, maxTokens: 220, responseFormat: 'json_object' },
    )
    .catch((err: unknown) => {
      console.error('[generate-trigger] llm failed', err)
      return ''
    })

  if (!raw) return jsonError(502, 'llm_failed')

  const parsed = tryParseJson(raw)
  const trigger = parsed.trigger ? clean(parsed.trigger, 2000) : ''
  if (!trigger) return jsonError(502, 'llm_no_trigger')

  const ctaLabel = page.cta_label
    ? page.cta_label
    : parsed.ctaLabel
      ? clean(parsed.ctaLabel, 50)
      : meta.defaultCtaLabel

  const update: Record<string, unknown> = {
    bot_send_instructions: trigger,
  }
  if (!page.cta_label && ctaLabel) update.cta_label = ctaLabel

  const { error: updateErr } = await supabase
    .from('action_pages')
    .update(update)
    .eq('id', pageId)
    .eq('user_id', userId)
  if (updateErr) {
    console.error('[generate-trigger] update failed', updateErr)
    return jsonError(500, 'update_failed')
  }

  revalidatePath('/dashboard/action-pages')
  revalidatePath(`/dashboard/action-pages/${pageId}`)

  return new Response(
    JSON.stringify({ ctaLabel, botSendInstructions: trigger }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )
}
