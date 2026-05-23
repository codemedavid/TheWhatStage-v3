import { decryptToken } from '@/lib/facebook/crypto'
import type { ActionPageKind } from '@/lib/action-pages/kinds'
import { resolveEventName } from './capi-mapping'
import {
  buildCustomData,
  buildEventEnvelope,
  buildUserData,
  type CapiEvent,
  type CatalogOrderForCapi,
} from './capi-payload'

const GRAPH_API_VERSION = 'v24.0'
const NETWORK_TIMEOUT_MS = 10_000

type Admin = {
  from: (table: string) => any
}

export interface DispatchInput {
  admin: Admin
  userId: string
  submissionId: string
  actionPageId: string
  actionPageKind: ActionPageKind
  outcome: string
  psid: string | null
  pageRowId: string | null
  parsedData: Record<string, unknown>
  pageConfig: Record<string, unknown>
  leadId: string | null
  submissionCreatedAt: Date
  businessOrderId: string | null
  catalogOrder: CatalogOrderForCapi | null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(s: string): boolean {
  return UUID_RE.test(s)
}

type LogRow = {
  user_id: string
  page_id: string | null
  submission_id: string | null
  action_page_id: string | null
  event_name: string | null
  event_id: string
  status: 'sent' | 'skipped' | 'error'
  skip_reason: 'no_messenger_context' | 'disabled' | 'not_configured' | 'outcome_skip' | null
  http_status: number | null
  fb_trace_id: string | null
  request_payload: unknown | null
  response_body: unknown | null
  error_message: string | null
}

async function writeLog(admin: Admin, row: LogRow): Promise<void> {
  try {
    const { error } = await admin.from('capi_event_logs').insert(row)
    if (error) console.warn('[capi] log insert failed', error.message ?? error)
  } catch (e) {
    console.warn('[capi] log insert threw', e instanceof Error ? e.message : e)
  }
}

function baseLog(input: DispatchInput): LogRow {
  return {
    user_id: input.userId,
    page_id: input.pageRowId,
    submission_id: isUuid(input.submissionId) ? input.submissionId : null,
    action_page_id: isUuid(input.actionPageId) ? input.actionPageId : null,
    event_name: null,
    event_id: input.submissionId,
    status: 'skipped',
    skip_reason: null,
    http_status: null,
    fb_trace_id: null,
    request_payload: null,
    response_body: null,
    error_message: null,
  }
}

export type DispatchResult = { status: 'sent' | 'skipped' | 'error'; error_message: string | null }

export async function dispatchCapiEvent(input: DispatchInput): Promise<DispatchResult> {
  // 1) Skip if no messenger context.
  if (!input.psid || !input.pageRowId) {
    await writeLog(input.admin, { ...baseLog(input), status: 'skipped', skip_reason: 'no_messenger_context' })
    return { status: 'skipped', error_message: null }
  }

  // 2) Load page CAPI config.
  const { data: page } = await input.admin
    .from('facebook_pages')
    .select('fb_page_id, capi_enabled, capi_dataset_id, capi_access_token, capi_test_event_code')
    .eq('id', input.pageRowId)
    .maybeSingle()
  if (!page || page.capi_enabled !== true) {
    await writeLog(input.admin, { ...baseLog(input), status: 'skipped', skip_reason: 'disabled' })
    return { status: 'skipped', error_message: null }
  }
  if (!page.capi_dataset_id || !page.capi_access_token) {
    await writeLog(input.admin, { ...baseLog(input), status: 'skipped', skip_reason: 'not_configured' })
    return { status: 'skipped', error_message: null }
  }

  // 3) Load per-action-page override (skip for non-UUID IDs such as test invocations).
  let override: string | null = null
  if (isUuid(input.actionPageId)) {
    const { data: ap } = await input.admin
      .from('action_pages')
      .select('capi_event_name_override')
      .eq('id', input.actionPageId)
      .maybeSingle()
    override = (ap?.capi_event_name_override as string | null) ?? null
  }

  // 4) Compute hasPayment.
  const hasPayment = computeHasPayment(input)

  // 5) Resolve event_name.
  const mapping = resolveEventName({
    kind: input.actionPageKind,
    outcome: input.outcome,
    hasPayment,
    override,
  })
  if (!mapping.send) {
    await writeLog(input.admin, { ...baseLog(input), status: 'skipped', skip_reason: 'outcome_skip' })
    return { status: 'skipped', error_message: null }
  }

  // 6) Lead contacts.
  let leadName: string | null = null
  let leadPhones: string[] = []
  let leadEmails: string[] = []
  if (input.leadId) {
    const { data: lead } = await input.admin
      .from('leads')
      .select('phones, emails, name')
      .eq('id', input.leadId)
      .maybeSingle()
    if (lead) {
      leadName = typeof lead.name === 'string' ? lead.name : null
      leadPhones = Array.isArray(lead.phones) ? lead.phones.filter((v: unknown): v is string => typeof v === 'string') : []
      leadEmails = Array.isArray(lead.emails) ? lead.emails.filter((v: unknown): v is string => typeof v === 'string') : []
    }
  }

  // 7) Build envelope.
  const userData = buildUserData({
    fbPageId: page.fb_page_id,
    psid: input.psid,
    leadId: input.leadId,
    leadName,
    leadPhones,
    leadEmails,
  })
  const customData = buildCustomData({
    kind: input.actionPageKind,
    actionPageId: input.actionPageId,
    parsedData: input.parsedData,
    pageConfig: input.pageConfig,
    businessOrderId: input.businessOrderId,
    catalogOrder: input.catalogOrder,
    submissionId: input.submissionId,
    hasPayment,
  })

  const event: CapiEvent = buildEventEnvelope({
    eventName: mapping.eventName,
    eventId: input.submissionId,
    eventTimeMs: input.submissionCreatedAt.getTime(),
    userData,
    customData,
  })
  const body: Record<string, unknown> = { data: [event] }
  if (page.capi_test_event_code) body.test_event_code = page.capi_test_event_code

  // 8) POST.
  const token = decryptToken(page.capi_access_token)
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${encodeURIComponent(
    page.capi_dataset_id,
  )}/events?access_token=${encodeURIComponent(token)}`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), NETWORK_TIMEOUT_MS)

  const log: LogRow = {
    ...baseLog(input),
    event_name: mapping.eventName,
    request_payload: body,
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const traceHeader = res.headers.get('x-fb-trace-id')
    let parsed: unknown = null
    try {
      parsed = await res.json()
    } catch {
      parsed = null
    }
    const traceFromBody =
      parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>).fbtrace_id ??
          ((parsed as Record<string, unknown>).error as Record<string, unknown> | undefined)?.fbtrace_id
        : null
    log.http_status = res.status
    log.fb_trace_id = traceHeader ?? (typeof traceFromBody === 'string' ? traceFromBody : null)
    log.response_body = parsed
    log.status = res.ok ? 'sent' : 'error'
    if (!res.ok) {
      const errMsg =
        parsed && typeof parsed === 'object' && (parsed as Record<string, unknown>).error
          ? ((parsed as Record<string, unknown>).error as Record<string, unknown>).message
          : `HTTP ${res.status}`
      log.error_message = typeof errMsg === 'string' ? errMsg : `HTTP ${res.status}`
    }
  } catch (e) {
    log.status = 'error'
    log.error_message = e instanceof Error ? e.message : String(e)
  } finally {
    clearTimeout(timeout)
  }

  await writeLog(input.admin, log)
  return { status: log.status, error_message: log.error_message }
}

function computeHasPayment(input: DispatchInput): boolean {
  if (input.actionPageKind === 'sales') {
    const pm = input.parsedData.payment_method_id
    const proof = input.parsedData.payment_proof_url
    return (typeof pm === 'string' && pm.length > 0) || (typeof proof === 'string' && proof.length > 0)
  }
  if (input.actionPageKind === 'catalog') {
    return input.catalogOrder !== null && input.catalogOrder.paymentStatus !== 'unpaid'
  }
  return false
}
