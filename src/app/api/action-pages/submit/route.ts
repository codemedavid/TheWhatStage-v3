import { NextResponse, type NextRequest } from 'next/server'
import { createHash } from 'node:crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyDeeplink } from '@/lib/action-pages/signing'
import { parseSubmission } from '@/lib/action-pages/dispatch'
import '@/lib/action-pages/handlers' // side-effect: register per-kind handlers
import { isActionPageKind, type ActionPageKind } from '@/lib/action-pages/kinds'
import { decryptToken } from '@/lib/facebook/crypto'
import { appendLeadContacts, extractContactsFromSubmission } from '@/lib/leads/contact-append'
import { sendOutbound } from '@/lib/messenger/outbound'
import {
  dispatchStageEntered,
  dispatchSubmissionReceived,
  dispatchBookingOffsets,
} from '@/lib/workflow/dispatcher'
import type { PipelineRule } from '@/app/(app)/dashboard/action-pages/_lib/schemas'
import { deeplinkActionPageUrl } from '@/lib/action-pages/urls'
import { getDefaultStageKind, resolveDefaultStageId } from '@/lib/action-pages/default-stage'
import { createFromSubmission, snapshotMethod } from '@/lib/order-payments/server'
import type { PaymentMethod } from '@/lib/payment-methods/types'
import { convertVisitorCart } from '@/lib/action-pages/visitor-cart'
import { dispatchCapiEvent } from '@/lib/facebook/capi'

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

interface ParsedOutcomeAction {
  to_stage_id?: string | null
  messenger_text?: string
  attach_action_page_id?: string | null
  attach_cta_label?: string
  public_message?: string
}

interface AttachedActionPageRecord {
  id: string
  user_id: string
  kind: string
  slug: string
  title: string
  status: string
  cta_label: string | null
  signing_secret: string
}

function parsedOutcomeAction(data: Record<string, unknown>): ParsedOutcomeAction | null {
  const raw = data.outcome_action
  return raw && typeof raw === 'object' ? (raw as ParsedOutcomeAction) : null
}

async function resolveAttachedActionPage(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  id: string,
): Promise<AttachedActionPageRecord | null> {
  const { data } = await admin
    .from('action_pages')
    .select('id, user_id, kind, slug, title, status, cta_label, signing_secret')
    .eq('id', id)
    .maybeSingle<AttachedActionPageRecord>()

  if (!data || data.user_id !== userId || data.status !== 'published') return null
  return data
}

function hashIp(ip: string | null): string | null {
  if (!ip) return null
  return createHash('sha256').update(ip).digest('hex').slice(0, 32)
}

function nestedFromForm(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of fd.entries()) {
    if (
      key === 'slug' ||
      key === 'p' ||
      key === 'g' ||
      key === 'e' ||
      key === 't' ||
      key === 'source_property_action_page_id' ||
      key === 'source_property_title' ||
      key === 'source_property_unit_id' ||
      key === 'source_property_unit_title' ||
      key === 'source_sales_page_id' ||
      key === 'source_sales_page_title'
    )
      continue
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
  let sourcePropertyActionPageId: string | null = null
  let sourcePropertyTitle: string | null = null
  let sourcePropertyUnitId: string | null = null
  let sourcePropertyUnitTitle: string | null = null
  let sourceSalesPageId: string | null = null
  let sourceSalesPageTitle: string | null = null

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
    sourcePropertyActionPageId =
      typeof body.source_property_action_page_id === 'string'
        ? body.source_property_action_page_id
        : null
    sourcePropertyTitle =
      typeof body.source_property_title === 'string'
        ? body.source_property_title
        : null
    sourcePropertyUnitId =
      typeof body.source_property_unit_id === 'string'
        ? body.source_property_unit_id
        : null
    sourcePropertyUnitTitle =
      typeof body.source_property_unit_title === 'string'
        ? body.source_property_unit_title
        : null
    sourceSalesPageId =
      typeof body.source_sales_page_id === 'string'
        ? body.source_sales_page_id
        : null
    sourceSalesPageTitle =
      typeof body.source_sales_page_title === 'string'
        ? body.source_sales_page_title
        : null
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
    const sp = fd.get('source_property_action_page_id')
    if (typeof sp === 'string' && sp) sourcePropertyActionPageId = sp
    const spt = fd.get('source_property_title')
    if (typeof spt === 'string' && spt) sourcePropertyTitle = spt
    const spuId = fd.get('source_property_unit_id')
    if (typeof spuId === 'string' && spuId) sourcePropertyUnitId = spuId
    const spuTitle = fd.get('source_property_unit_title')
    if (typeof spuTitle === 'string' && spuTitle) sourcePropertyUnitTitle = spuTitle
    const ss = fd.get('source_sales_page_id')
    if (typeof ss === 'string' && ss) sourceSalesPageId = ss
    const sst = fd.get('source_sales_page_title')
    if (typeof sst === 'string' && sst) sourceSalesPageTitle = sst
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

    // The deeplink HMAC verifies but the referenced facebook_pages row may
    // have been deleted (page disconnected, env switched). Soft-drop the
    // attribution so downstream inserts that FK to facebook_pages.id (e.g.
    // business_orders.page_id) don't 500 the checkout.
    if (fbPageId) {
      const { data: fbPage } = await admin
        .from('facebook_pages')
        .select('id')
        .eq('id', fbPageId)
        .maybeSingle<{ id: string }>()
      if (!fbPage) {
        psid = null
        fbPageId = null
      }
    }
  }

  // Resolve lead from messenger thread when we have an attributed PSID + page.
  let leadId: string | null = null
  let messengerThreadId: string | null = null
  if (psid && fbPageId) {
    const { data: thread } = await admin
      .from('messenger_threads')
      .select('id, lead_id')
      .eq('page_id', fbPageId)
      .eq('psid', psid)
      .maybeSingle<{ id: string; lead_id: string | null }>()
    leadId = thread?.lead_id ?? null
    messengerThreadId = thread?.id ?? null
  }

  let parsed
  try {
    parsed = parseSubmission(page.kind as ActionPageKind, payload, page.config)
  } catch (e) {
    return NextResponse.json(
      {
        error: 'invalid_submission',
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 400 },
    )
  }

  let businessOrderId: string | null = null
  let catalogOrderResult: CatalogOrderResult | null = null
  if (page.kind === 'catalog') {
    try {
      catalogOrderResult = await createBusinessOrderFromCatalog({
        admin,
        page,
        parsedData: parsed.data,
        leadId,
        psid,
        fbPageId,
      })
      businessOrderId = catalogOrderResult.orderId
    } catch (e) {
      return NextResponse.json(
        {
          error: 'invalid_catalog_order',
          detail: e instanceof Error ? e.message : String(e),
        },
        { status: 400 },
      )
    }

    if (psid && fbPageId) {
      try {
        await convertVisitorCart(admin, {
          actionPageId: page.id,
          psid,
          pageOwnerId: page.user_id,
          fbPageId,
        })
      } catch (e) {
        console.error(
          '[submit] convertVisitorCart failed',
          e instanceof Error ? e.message : e,
        )
      }
    }
  }

  // If no Messenger deeplink attributed a lead, try to find one by customer
  // phone/email so the pipeline rule still fires for direct-URL checkouts.
  if (!leadId && catalogOrderResult) {
    const { phone, email } = catalogOrderResult.customer
    const filters: string[] = []
    if (phone) filters.push(`phones.cs.{${phone}}`)
    if (email) filters.push(`emails.cs.{${email}}`)
    if (filters.length) {
      const { data: matchedLeads } = await admin
        .from('leads')
        .select('id')
        .eq('user_id', page.user_id)
        .or(filters.join(','))
        .limit(2)
      if (matchedLeads?.length === 1) {
        leadId = (matchedLeads[0] as { id: string }).id
      }
    }
  }

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    null
  const ua = req.headers.get('user-agent')

  // A3: capture consent fields from the form payload (boolean or "true"/"false")
  const marketingOptin = payload.marketing_optin === true || payload.marketing_optin === 'true'
  const reminderOptin  = payload.reminder_optin  === true || payload.reminder_optin  === 'true'

  // Validate the source property reference: must be a published realestate
  // page owned by the same user as the page being submitted. Silently drop on
  // mismatch — never 400 on a soft attribution field.
  let validatedSourceProperty: { id: string; title: string | null } | null = null
  if (sourcePropertyActionPageId) {
    const { data: prop } = await admin
      .from('action_pages')
      .select('id, title, kind, status, user_id')
      .eq('id', sourcePropertyActionPageId)
      .maybeSingle<{
        id: string
        title: string | null
        kind: string
        status: string
        user_id: string
      }>()
    if (
      prop &&
      prop.kind === 'realestate' &&
      prop.status === 'published' &&
      prop.user_id === page.user_id
    ) {
      validatedSourceProperty = {
        id: prop.id,
        title: sourcePropertyTitle || prop.title,
      }
    }
  }

  // Validate the source sales reference: must be a published sales page owned
  // by the same user. Silently drop on mismatch — never 400 on a soft
  // attribution field.
  let validatedSourceSales: { id: string; title: string | null } | null = null
  if (sourceSalesPageId) {
    const { data: sp } = await admin
      .from('action_pages')
      .select('id, title, kind, status, user_id')
      .eq('id', sourceSalesPageId)
      .maybeSingle<{
        id: string
        title: string | null
        kind: string
        status: string
        user_id: string
      }>()
    if (
      sp &&
      sp.kind === 'sales' &&
      sp.status === 'published' &&
      sp.user_id === page.user_id
    ) {
      validatedSourceSales = {
        id: sp.id,
        title: sourceSalesPageTitle || sp.title,
      }
    }
  }

  const submissionMeta: Record<string, unknown> = {}
  if (businessOrderId) submissionMeta.business_order_id = businessOrderId
  if (validatedSourceProperty) {
    submissionMeta.source_property_action_page_id = validatedSourceProperty.id
    if (validatedSourceProperty.title) {
      submissionMeta.source_property_title = validatedSourceProperty.title
    }
    if (sourcePropertyUnitId) {
      submissionMeta.source_property_unit_id = sourcePropertyUnitId
      if (sourcePropertyUnitTitle) {
        submissionMeta.source_property_unit_title = sourcePropertyUnitTitle
      }
    }
  }
  if (validatedSourceSales) {
    submissionMeta.source_sales_page_id = validatedSourceSales.id
    if (validatedSourceSales.title) {
      submissionMeta.source_sales_page_title = validatedSourceSales.title
    }
  }

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
      meta: Object.keys(submissionMeta).length > 0 ? submissionMeta : null,
      marketing_optin: marketingOptin,
      reminder_optin:  reminderOptin,
    })
    .select('id')
    .single<{ id: string }>()
  if (subErr || !subInsert) {
    if (businessOrderId) {
      console.warn('[action-pages.submit] submission insert failed after order capture', {
        businessOrderId,
        err: subErr?.message,
      })
    } else {
      return NextResponse.json(
        { error: 'insert_failed', detail: subErr?.message },
        { status: 500 },
      )
    }
  }

  // A3/M5: persist marketing opt-in into the consent registry so the channel
  // policy resolver can find it when sending outside the 24-hour window.
  if (marketingOptin && messengerThreadId) {
    void admin
      .from('messenger_marketing_optins')
      .upsert(
        { thread_id: messengerThreadId, user_id: page.user_id, source: 'action_page_submission' },
        { onConflict: 'thread_id' },
      )
      .then(({ error: e }) => {
        if (e) console.warn('[action-pages.submit] marketing_optins upsert failed', { threadId: messengerThreadId, err: e.message })
      })
  }

  // Append any phone/email values captured in the submission to the lead's
  // contact arrays. Best-effort — never blocks the response.
  if (leadId) {
    try {
      const contacts = extractContactsFromSubmission(page.kind, parsed.data, page.config)
      await appendLeadContacts(admin, leadId, contacts)
    } catch (e) {
      console.warn('[action-pages.submit] contact append failed', {
        leadId,
        err: e instanceof Error ? e.message : String(e),
      })
    }
  }

  // Payment proof handling — applies when the buyer selected a payment method.
  const paymentMethodId =
    typeof parsed.data.payment_method_id === 'string'
      ? parsed.data.payment_method_id
      : null
  if (subInsert?.id && paymentMethodId) {
    const proofUrl =
      typeof parsed.data.payment_proof_url === 'string'
        ? parsed.data.payment_proof_url
        : null
    if (!proofUrl) {
      return NextResponse.json(
        { error: 'payment_proof_required' },
        { status: 400 },
      )
    }

    const cfgPayment =
      (page.config as Record<string, unknown>).payment as
        | { enabled?: boolean; excluded_method_ids?: string[] }
        | undefined
    const excluded = new Set(cfgPayment?.excluded_method_ids ?? [])
    if (cfgPayment?.enabled === false || excluded.has(paymentMethodId)) {
      return NextResponse.json(
        { error: 'payment_method_not_allowed' },
        { status: 400 },
      )
    }

    const { data: pm } = await admin
      .from('payment_methods')
      .select('id, kind, name, enabled, user_id')
      .eq('id', paymentMethodId)
      .maybeSingle<Pick<PaymentMethod, 'id' | 'kind' | 'name' | 'enabled'> & { user_id: string }>()
    if (!pm || !pm.enabled || pm.user_id !== page.user_id) {
      return NextResponse.json(
        { error: 'payment_method_not_found' },
        { status: 400 },
      )
    }

    try {
      await createFromSubmission(admin, {
        user_id: page.user_id,
        submission_id: subInsert.id,
        business_order_id: businessOrderId,
        action_page_id: page.id,
        payment_method_id: pm.id,
        ...snapshotMethod(pm),
        proof_url: proofUrl,
        proof_file_id:
          typeof parsed.data.payment_proof_file_id === 'string'
            ? parsed.data.payment_proof_file_id
            : null,
        amount:
          typeof parsed.data.payment_amount === 'number'
            ? parsed.data.payment_amount
            : null,
        currency:
          typeof parsed.data.payment_currency === 'string'
            ? parsed.data.payment_currency
            : null,
        note:
          typeof parsed.data.payment_note === 'string'
            ? parsed.data.payment_note
            : null,
      })
    } catch (e) {
      console.error('[action-pages.submit] order_payments insert failed', e)
      return NextResponse.json(
        { error: 'payment_record_failed' },
        { status: 500 },
      )
    }
  }

  // Dispatch workflow triggers. Best-effort — never blocks the response.
  if (subInsert?.id) {
    dispatchSubmissionReceived(admin, {
      userId: page.user_id,
      submissionId: subInsert.id,
      actionPageId: page.id,
      outcome: parsed.outcome,
      leadId: leadId ?? null,
      threadId: messengerThreadId ?? null,
    }).catch((e) => console.error('[action-pages.submit] dispatchSubmissionReceived threw', e))
  }

  // Fire Conversions API event for Meta. Best-effort — never blocks the response.
  if (subInsert?.id) {
    dispatchCapiEvent({
      admin,
      userId: page.user_id,
      submissionId: subInsert.id,
      actionPageId: page.id,
      actionPageKind: page.kind as ActionPageKind,
      actionPageSlug: page.slug,
      outcome: parsed.outcome,
      psid,
      pageRowId: fbPageId,
      parsedData: parsed.data,
      pageConfig: page.config,
      leadId,
      clientIp: ip,
      clientUserAgent: ua,
      submissionCreatedAt: new Date(),
      businessOrderId,
      catalogOrder: catalogOrderResult
        ? {
            subtotal: catalogOrderResult.subtotal,
            currency: catalogOrderResult.currency,
            lines: catalogOrderResult.lines.map((l) => ({
              business_item_id: l.business_item_id,
              quantity: l.quantity,
            })),
            paymentStatus: catalogOrderResult.paymentStatus,
          }
        : null,
    }).catch((e) => console.error('[action-pages.submit] dispatchCapiEvent threw', e))
  }

  // For booking submissions: persist a structured booking_events row (A1/A2)
  // then dispatch time-offset workflow triggers (-3d, -2h, -10m).
  if (parsed.outcome === 'booked' && subInsert?.id) {
    const slotIso = typeof parsed.data.slot_iso === 'string' ? parsed.data.slot_iso : null
    const tz = typeof (page.config as Record<string, unknown>).timezone === 'string'
      ? (page.config as Record<string, unknown>).timezone as string
      : 'UTC'
    if (slotIso) {
      ;(async () => {
        const { data: bkRow, error: bkErr } = await admin
          .from('booking_events')
          .insert({
            user_id: page.user_id,
            submission_id: subInsert.id,
            lead_id: leadId ?? null,
            event_at: new Date(slotIso).toISOString(),
            timezone: tz,
            duration_minutes: typeof (page.config as Record<string, unknown>).duration_min === 'number'
              ? (page.config as Record<string, unknown>).duration_min as number
              : null,
            status: 'scheduled',
          })
          .select('id')
          .single<{ id: string }>()
        if (bkErr) {
          console.warn('[action-pages.submit] booking_events insert failed', bkErr.message)
          return
        }
        if (bkRow) {
          await dispatchBookingOffsets(admin, {
            userId: page.user_id,
            bookingEventId: bkRow.id,
            leadId: leadId ?? null,
            threadId: messengerThreadId ?? null,
            eventAt: new Date(slotIso).toISOString(),
            actionPageId: page.id,
          })
        }
      })().catch((e) => console.error('[action-pages.submit] booking_events chain threw', e))
    }
  }

  // Resolve outcome action once; used in both the stage-move block and the echo/attach blocks.
  const outcomeAction = parsedOutcomeAction(parsed.data)

  // Apply pipeline rule best-effort. For catalog, the order remains source of
  // truth even if action_page_submissions linkage failed.
  if (leadId) {
    const rule = page.pipeline_rules.find((r) => r.outcome === parsed.outcome)
    let toStageId = outcomeAction?.to_stage_id || rule?.to_stage_id || null
    if (!toStageId) {
      const defaultKind = getDefaultStageKind(page.kind as ActionPageKind, parsed.outcome)
      if (defaultKind) {
        toStageId = await resolveDefaultStageId(admin, page.user_id, defaultKind)
      }
    }
    if (toStageId) {
      try {
        await applyStageMove({
          adminClient: admin,
          userId: page.user_id,
          leadId,
          toStageId,
          outcome: parsed.outcome,
          submissionId: subInsert?.id ?? null,
          threadId: messengerThreadId,
        })
      } catch (e) {
        console.warn('[action-pages.submit] stage move failed', {
          leadId,
          err: e instanceof Error ? e.message : String(e),
        })
      }
    }
    try {
      await advanceLeadFunnelForActionPage({
        adminClient: admin,
        leadId,
        userId: page.user_id,
        actionPageId: page.id,
      })
    } catch (e) {
      console.warn('[action-pages.submit] funnel advance failed', {
        leadId,
        err: e instanceof Error ? e.message : String(e),
      })
    }
  }

  // Echo back to Messenger. For catalog orders, prepend an order summary.
  // Per-outcome notify_text wins over the global template for the closing line.
  const matchedRule = page.pipeline_rules.find((r) => r.outcome === parsed.outcome)
  const notifyText =
    (outcomeAction?.messenger_text && outcomeAction.messenger_text.trim()) ||
    (matchedRule?.notify_text && matchedRule.notify_text.trim()) ||
    page.notification_template?.text
  const echo = catalogOrderResult
    ? buildOrderEcho(catalogOrderResult, notifyText)
    : notifyText
  // Fetch page token and thread data once; reused by both the echo block and
  // the attached-action-page block below.
  let messengerPageData: { page_access_token: string } | null = null
  let messengerThreadData: { last_inbound_at: string | null } | null = null
  if (psid && fbPageId && messengerThreadId) {
    const [{ data: _pageData }, { data: _threadData }] = await Promise.all([
      admin
        .from('facebook_pages')
        .select('page_access_token')
        .eq('id', fbPageId)
        .maybeSingle<{ page_access_token: string }>(),
      admin
        .from('messenger_threads')
        .select('last_inbound_at')
        .eq('id', messengerThreadId)
        .maybeSingle<{ last_inbound_at: string | null }>(),
    ])
    messengerPageData = _pageData
    messengerThreadData = _threadData
  }

  if (echo && psid && fbPageId && messengerThreadId) {
    try {
      if (messengerPageData?.page_access_token) {
        const token = decryptToken(messengerPageData.page_access_token)
        const result = await sendOutbound({
          admin,
          thread: { id: messengerThreadId, psid, last_inbound_at: messengerThreadData?.last_inbound_at ?? null },
          pageToken: token,
          payload: { kind: 'text', text: echo },
          kind: 'submission_echo',
        })
        if (result.sent) {
          const { error: msgErr } = await admin.from('messenger_messages').insert({
            thread_id: messengerThreadId,
            user_id: page.user_id,
            direction: 'outbound',
            sender: 'bot',
            fb_message_id: result.messageId,
            body: echo,
          })
          if (msgErr && (msgErr as { code?: string }).code !== '23505') {
            console.warn('[action-pages.submit] messenger echo record failed', {
              threadId: messengerThreadId,
              err: msgErr.message,
            })
          } else {
            await admin
              .from('messenger_threads')
              .update({
                last_message_at: new Date().toISOString(),
                last_message_preview: echo.slice(0, 200),
              })
              .eq('id', messengerThreadId)
          }
        }
      }
    } catch (e) {
      console.warn('[action-pages.submit] messenger echo failed', {
        psid,
        err: e instanceof Error ? e.message : String(e),
      })
    }
  }

  if (
    outcomeAction?.attach_action_page_id &&
    psid &&
    fbPageId &&
    messengerThreadId
  ) {
    try {
      const attached = await resolveAttachedActionPage(
        admin,
        page.user_id,
        outcomeAction.attach_action_page_id,
      )
      if (attached) {
        if (messengerPageData?.page_access_token) {
          const token = decryptToken(messengerPageData.page_access_token)
          const exp = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60
          const url = deeplinkActionPageUrl(attached.signing_secret, {
            slug: attached.slug,
            psid,
            pageId: fbPageId,
            exp,
          })
          const result = await sendOutbound({
            admin,
            thread: {
              id: messengerThreadId,
              psid,
              last_inbound_at: messengerThreadData?.last_inbound_at ?? null,
            },
            pageToken: token,
            payload: {
              kind: 'button',
              text: attached.title,
              url,
              ctaLabel:
                outcomeAction.attach_cta_label ||
                attached.cta_label ||
                'Open',
            },
            kind: 'submission_echo',
          })
          if (result.sent) {
            await admin.from('messenger_messages').insert({
              thread_id: messengerThreadId,
              user_id: page.user_id,
              direction: 'outbound',
              sender: 'bot',
              fb_message_id: result.messageId,
              body: `${attached.title}\n${outcomeAction.attach_cta_label || attached.cta_label || 'Open'} → ${url}`,
            })
          }
        }
      }
    } catch (e) {
      console.warn('[action-pages.submit] attached action page send failed', {
        psid,
        err: e instanceof Error ? e.message : String(e),
      })
    }
  }

  // Form posts redirect to a thank-you screen; JSON callers get JSON.
  if (ct.includes('application/json')) {
    return NextResponse.json({
      ok: true,
      submission_id: subInsert?.id ?? null,
      business_order_id: businessOrderId,
    })
  }
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  const redirectUrl = new URL(`${base}/a/${slug}`)
  redirectUrl.searchParams.set('submitted', '1')
  if (subInsert?.id) redirectUrl.searchParams.set('submission', subInsert.id)
  return NextResponse.redirect(redirectUrl.toString(), { status: 303 })
}

interface CatalogOrderResult {
  orderId: string
  lines: Array<{
    business_item_id: string
    title_snapshot: string
    quantity: number
    unit_amount: number
    line_total_amount: number
    currency: string
  }>
  subtotal: number
  currency: string
  customer: { name: string | null; phone: string | null; email: string | null; notes: string | null }
  customFields: Record<string, string>
  paymentStatus: 'unpaid' | 'pending' | 'paid'
}

function buildOrderEcho(order: CatalogOrderResult, notifyText: string | undefined): string {
  const fmt = (amount: number, currency: string) => {
    try {
      return new Intl.NumberFormat('en-PH', { style: 'currency', currency }).format(amount)
    } catch {
      return `${amount.toFixed(2)} ${currency}`
    }
  }
  const lines = order.lines
    .map((l) => `• ${l.quantity}x ${l.title_snapshot} — ${fmt(l.line_total_amount, l.currency)}`)
    .join('\n')
  const parts = [`Order received!\n${lines}\n\nTotal: ${fmt(order.subtotal, order.currency)}`]
  const { name, phone, email, notes } = order.customer
  if (name) parts.push(`Name: ${name}`)
  if (phone) parts.push(`Phone: ${phone}`)
  if (email) parts.push(`Email: ${email}`)
  if (notes) parts.push(`Notes: ${notes}`)
  if (notifyText?.trim()) parts.push(`\n${notifyText.trim()}`)
  return parts.join('\n').slice(0, 1900)
}

async function createBusinessOrderFromCatalog(args: {
  admin: ReturnType<typeof createAdminClient>
  page: ActionPageRecord
  parsedData: Record<string, unknown>
  leadId: string | null
  psid: string | null
  fbPageId: string | null
}): Promise<CatalogOrderResult> {
  const items = (args.parsedData.items ?? []) as {
    id: string
    quantity: number
  }[]
  if (!items.length) throw new Error('cart is empty')

  const ids = [...new Set(items.map((item) => item.id))]
  const { data: products, error } = await args.admin
    .from('business_items')
    .select('id, title, sku, price_amount, currency, pricing_model')
    .eq('user_id', args.page.user_id)
    .eq('kind', 'product')
    .eq('status', 'published')
    .in('id', ids)

  if (error) throw new Error(`load catalog products failed: ${error.message}`)
  if ((products ?? []).length !== ids.length) {
    throw new Error('cart contains unavailable products')
  }

  const productById = new Map((products ?? []).map((product) => [
    product.id as string,
    product,
  ]))
  const currency = String((products ?? [])[0]?.currency ?? 'PHP')
  const lines = items.map((item) => {
    const product = productById.get(item.id)
    if (!product) throw new Error('cart contains unavailable products')

    const pricingModel = String(product.pricing_model ?? 'fixed')
    if (
      (pricingModel === 'fixed' || pricingModel === 'starts_at') &&
      (product.price_amount === null || product.price_amount === undefined || Number(product.price_amount) <= 0)
    ) {
      throw new Error('cart contains products without a valid price')
    }

    const unit = Number(product.price_amount ?? 0)
    const total = Math.round(unit * item.quantity * 100) / 100

    return {
      user_id: args.page.user_id,
      business_item_id: item.id,
      title_snapshot: String(product.title),
      sku_snapshot: product.sku ?? null,
      quantity: item.quantity,
      unit_amount: unit,
      currency: String(product.currency ?? currency),
      line_total_amount: total,
    }
  })
  const subtotal = lines.reduce(
    (sum, line) => sum + Number(line.line_total_amount),
    0,
  )
  const customer = (args.parsedData.customer ?? {}) as Record<string, unknown>
  const customFieldsRaw = (customer.custom ?? {}) as Record<string, unknown>
  const customFields: Record<string, string> = {}
  for (const [k, v] of Object.entries(customFieldsRaw)) {
    if (v != null && String(v).length > 0) customFields[k] = String(v)
  }
  const fieldDefs = Array.isArray(
    (args.page.config as Record<string, unknown>).checkout_fields,
  )
    ? ((args.page.config as Record<string, unknown>).checkout_fields as Array<
        Record<string, unknown>
      >)
    : []
  const labeledCustomFields = fieldDefs
    .map((f) => {
      const key = typeof f.key === 'string' ? f.key : ''
      const label = typeof f.label === 'string' ? f.label : key
      const type = typeof f.type === 'string' ? f.type : 'short_text'
      const value = key && customFields[key] ? customFields[key] : ''
      return { key, label, value, type }
    })
    .filter((f) => f.key && f.value)
  const hasImageUpload = labeledCustomFields.some((f) => f.type === 'image')
  const meta: Record<string, unknown> = {}
  if (labeledCustomFields.length > 0) meta.custom_fields = labeledCustomFields

  // Validate the chosen payment method: must belong to this user, be enabled,
  // and be one of the page's attached methods. Soft-drop on mismatch — never
  // 400 on a payment selection so the order still captures.
  let validatedPaymentMethodId: string | null = null
  let validatedPaymentMethodName: string | null = null
  const rawPaymentMethodId = args.parsedData.payment_method_id
  if (typeof rawPaymentMethodId === 'string' && rawPaymentMethodId) {
    const allowedIds = Array.isArray(
      (args.page.config as Record<string, unknown>).payment_method_ids,
    )
      ? ((args.page.config as Record<string, unknown>).payment_method_ids as unknown[]).filter(
          (x): x is string => typeof x === 'string',
        )
      : []
    if (allowedIds.includes(rawPaymentMethodId)) {
      const { data: pm } = await args.admin
        .from('payment_methods')
        .select('id, name, enabled, user_id')
        .eq('id', rawPaymentMethodId)
        .eq('user_id', args.page.user_id)
        .maybeSingle<{ id: string; name: string; enabled: boolean; user_id: string }>()
      if (pm && pm.enabled) {
        validatedPaymentMethodId = pm.id
        validatedPaymentMethodName = pm.name
      }
    }
  }

  if (validatedPaymentMethodId) {
    meta.payment_method_id = validatedPaymentMethodId
    if (validatedPaymentMethodName) meta.payment_method_name = validatedPaymentMethodName
  }
  if (hasImageUpload) meta.payment_proof_uploaded = true

  // If the buyer either picked a payment method or uploaded a proof image,
  // mark the order as awaiting verification so it surfaces in the dashboard
  // as something to confirm.
  const paymentStatus =
    validatedPaymentMethodId || hasImageUpload ? 'pending' : 'unpaid'

  const { data: orderId, error: orderErr } = await args.admin.rpc('create_catalog_order', {
    p_order: {
      user_id: args.page.user_id,
      action_page_id: args.page.id,
      lead_id: args.leadId,
      psid: args.psid,
      page_id: args.fbPageId,
      status: 'new',
      payment_status: paymentStatus,
      currency,
      subtotal_amount: subtotal,
      customer_name: customer.name ?? null,
      customer_email: customer.email ?? null,
      customer_phone: customer.phone ?? null,
      customer_notes: customer.notes ?? null,
      meta,
    },
    p_lines: lines,
  })

  if (orderErr || !orderId) {
    throw new Error(orderErr?.message ?? 'order insert failed')
  }
  return {
    orderId: String(orderId),
    lines: lines.map((l) => ({
      business_item_id: l.business_item_id,
      title_snapshot: l.title_snapshot,
      quantity: l.quantity,
      unit_amount: l.unit_amount,
      line_total_amount: l.line_total_amount,
      currency: l.currency,
    })),
    subtotal,
    currency,
    customer: {
      name: (customer.name as string | null) ?? null,
      phone: (customer.phone as string | null) ?? null,
      email: (customer.email as string | null) ?? null,
      notes: (customer.notes as string | null) ?? null,
    },
    customFields,
    paymentStatus: paymentStatus as 'unpaid' | 'pending' | 'paid',
  }
}

async function applyStageMove(args: {
  adminClient: ReturnType<typeof createAdminClient>
  userId: string
  leadId: string
  toStageId: string
  outcome: string
  submissionId: string | null
  threadId: string | null
}): Promise<void> {
  const { adminClient, userId, leadId, toStageId, outcome, submissionId, threadId } = args
  const idempotencyKey = `submission:${submissionId}`

  const { data, error } = await adminClient
    .rpc('set_lead_stage', {
      p_lead_id: leadId,
      p_to_stage_id: toStageId,
      p_source: 'action_page_submission',
      p_reason: `outcome: ${outcome}`,
      p_idempotency_key: idempotencyKey,
      p_expected_version: null,
      p_confidence: null,
      p_thread_id: threadId ?? null,
    })
  if (error) {
    throw new Error(error.message)
  }
  if (data) {
    dispatchStageEntered(adminClient, {
      userId,
      leadId,
      threadId,
      toStageId,
      fromStageId: null,
      idempotencyKey,
    }).catch((e) => console.error('[action-pages.submit] dispatchStageEntered threw', e))
  }
}

async function advanceLeadFunnelForActionPage(args: {
  adminClient: ReturnType<typeof createAdminClient>
  leadId: string
  userId: string
  actionPageId: string
}): Promise<void> {
  const { adminClient, leadId, userId, actionPageId } = args

  const { data: lead } = await adminClient
    .from('leads')
    .select('current_funnel_id')
    .eq('id', leadId)
    .eq('user_id', userId)
    .maybeSingle<{ current_funnel_id: string | null }>()
  if (!lead?.current_funnel_id) return

  const { data: funnel } = await adminClient
    .from('funnels')
    .select('id, action_page_id, next_funnel_id')
    .eq('id', lead.current_funnel_id)
    .eq('user_id', userId)
    .maybeSingle<{
      id: string
      action_page_id: string | null
      next_funnel_id: string | null
    }>()
  if (!funnel || funnel.action_page_id !== actionPageId || !funnel.next_funnel_id) return

  await adminClient
    .from('leads')
    .update({ current_funnel_id: funnel.next_funnel_id })
    .eq('id', leadId)
    .eq('user_id', userId)
}
