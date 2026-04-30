import { NextResponse, type NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyDeeplink } from '@/lib/action-pages/signing'
import { parseSubmission } from '@/lib/action-pages/dispatch'
import '@/lib/action-pages/handlers' // side-effect: register per-kind handlers
import { isActionPageKind, type ActionPageKind } from '@/lib/action-pages/kinds'
import { decryptToken } from '@/lib/facebook/crypto'
import { sendMessengerText } from '@/lib/facebook/messenger'
import type { PipelineRule } from '@/app/(app)/dashboard/action-pages/_lib/schemas'

export const dynamic = 'force-dynamic'

interface ActionPageRecord {
  id: string
  user_id: string
  kind: string
  slug: string
  config: Record<string, unknown>
  pipeline_rules: PipelineRule[]
  notification_template: { text?: string } | null
  signing_secret: string
}

function hashIp(ip: string | null): string | null {
  if (!ip) return null
  return createHash('sha256').update(ip).digest('hex').slice(0, 32)
}

function nestedFromForm(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of fd.entries()) {
    if (key === 'slug' || key === 'p' || key === 'g' || key === 'e' || key === 't') continue
    if (typeof value !== 'string') continue
    if (key.startsWith('data.')) {
      out[key.slice(5)] = value
    } else {
      out[key] = value
    }
  }
  return out
}

export async function POST(req: NextRequest) {
  const ct = req.headers.get('content-type') ?? ''
  let slug = ''
  let payload: Record<string, unknown> = {}
  let signed: { p?: string; g?: string; e?: string; t?: string } = {}

  if (ct.includes('application/json')) {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    slug = String(body.slug ?? '')
    payload = (body.data as Record<string, unknown>) ?? {}
    signed = {
      p: body.p as string | undefined,
      g: body.g as string | undefined,
      e: body.e as string | undefined,
      t: body.t as string | undefined,
    }
  } else {
    const fd = await req.formData()
    slug = String(fd.get('slug') ?? '')
    signed = {
      p: (fd.get('p') as string) || undefined,
      g: (fd.get('g') as string) || undefined,
      e: (fd.get('e') as string) || undefined,
      t: (fd.get('t') as string) || undefined,
    }
    payload = nestedFromForm(fd)
  }

  if (!slug) return NextResponse.json({ error: 'missing_slug' }, { status: 400 })

  const admin = createAdminClient()

  const { data: pageRow, error: pageErr } = await admin
    .from('action_pages')
    .select(
      'id, user_id, kind, slug, status, config, pipeline_rules, notification_template, signing_secret',
    )
    .eq('slug', slug)
    .maybeSingle()
  if (pageErr) {
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  }
  if (!pageRow || pageRow.status !== 'published') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!isActionPageKind(pageRow.kind)) {
    return NextResponse.json({ error: 'bad_kind' }, { status: 500 })
  }
  const page = pageRow as unknown as ActionPageRecord

  // Verify deeplink (PSID + page id) when present.
  let psid: string | null = null
  let fbPageId: string | null = null
  if (signed.p || signed.g || signed.e || signed.t) {
    const v = verifyDeeplink(page.signing_secret, slug, signed)
    if (!v.ok) {
      return NextResponse.json(
        { error: 'bad_deeplink', reason: v.reason },
        { status: 400 },
      )
    }
    psid = v.claims!.psid
    fbPageId = v.claims!.pageId
  }

  // Resolve lead from messenger thread when we have an attributed PSID + page.
  let leadId: string | null = null
  if (psid && fbPageId) {
    const { data: thread } = await admin
      .from('messenger_threads')
      .select('lead_id')
      .eq('page_id', fbPageId)
      .eq('psid', psid)
      .maybeSingle<{ lead_id: string | null }>()
    leadId = thread?.lead_id ?? null
  }

  const parsed = parseSubmission(page.kind as ActionPageKind, payload, page.config)

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    null
  const ua = req.headers.get('user-agent')

  const { data: subInsert, error: subErr } = await admin
    .from('action_page_submissions')
    .insert({
      action_page_id: page.id,
      user_id: page.user_id,
      lead_id: leadId,
      psid,
      page_id: fbPageId,
      outcome: parsed.outcome,
      data: parsed.data,
      ip_hash: hashIp(ip),
      user_agent: ua,
    })
    .select('id')
    .single<{ id: string }>()
  if (subErr || !subInsert) {
    return NextResponse.json(
      { error: 'insert_failed', detail: subErr?.message },
      { status: 500 },
    )
  }

  // Apply pipeline rule (best-effort — submission already saved).
  if (leadId) {
    const rule = page.pipeline_rules.find((r) => r.outcome === parsed.outcome)
    if (rule?.to_stage_id) {
      try {
        await applyStageMove({
          adminClient: admin,
          leadId,
          userId: page.user_id,
          toStageId: rule.to_stage_id,
          reason: rule.reason ?? `Action page: ${parsed.outcome}`,
        })
      } catch (e) {
        console.warn('[action-pages.submit] stage move failed', {
          leadId,
          err: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }

  // Echo back to Messenger.
  const echo = page.notification_template?.text
  if (echo && psid && fbPageId) {
    try {
      const { data: pageData } = await admin
        .from('facebook_pages')
        .select('page_access_token')
        .eq('id', fbPageId)
        .maybeSingle<{ page_access_token: string }>()
      if (pageData?.page_access_token) {
        const token = decryptToken(pageData.page_access_token)
        await sendMessengerText({
          pageAccessToken: token,
          recipientPsid: psid,
          text: echo,
        })
      }
    } catch (e) {
      console.warn('[action-pages.submit] messenger echo failed', {
        psid,
        err: e instanceof Error ? e.message : String(e),
      })
    }
  }

  // Form posts redirect to a thank-you screen; JSON callers get JSON.
  if (ct.includes('application/json')) {
    return NextResponse.json({ ok: true, submission_id: subInsert.id })
  }
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  return NextResponse.redirect(`${base}/a/${slug}?submitted=1`, { status: 303 })
}

async function applyStageMove(args: {
  adminClient: ReturnType<typeof createAdminClient>
  leadId: string
  userId: string
  toStageId: string
  reason: string
}): Promise<void> {
  const { adminClient, leadId, userId, toStageId, reason } = args

  const { data: lead } = await adminClient
    .from('leads')
    .select('stage_id')
    .eq('id', leadId)
    .eq('user_id', userId)
    .maybeSingle<{ stage_id: string | null }>()
  const fromStageId = lead?.stage_id ?? null
  if (fromStageId === toStageId) return

  const { data: maxRow } = await adminClient
    .from('leads')
    .select('position')
    .eq('user_id', userId)
    .eq('stage_id', toStageId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle<{ position: number }>()
  const nextPosition = (maxRow?.position ?? -1) + 1

  await adminClient
    .from('leads')
    .update({ stage_id: toStageId, position: nextPosition })
    .eq('id', leadId)
    .eq('user_id', userId)

  await adminClient.from('lead_stage_events').insert({
    lead_id: leadId,
    user_id: userId,
    from_stage_id: fromStageId,
    to_stage_id: toStageId,
    source: 'action_page',
    reason,
  })
}
