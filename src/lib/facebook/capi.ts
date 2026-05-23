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

const GRAPH_API_VERSION = 'v19.0'
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
  actionPageSlug: string
  outcome: string
  psid: string | null
  pageRowId: string | null
  parsedData: Record<string, unknown>
  pageConfig: Record<string, unknown>
  leadId: string | null
  clientIp: string | null
  clientUserAgent: string | null
  submissionCreatedAt: Date
  businessOrderId: string | null
  catalogOrder: CatalogOrderForCapi | null
}

type LogRow = {
  user_id: string
  page_id: string | null
  submission_id: string
  action_page_id: string
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
    submission_id: input.submissionId,
    action_page_id: input.actionPageId,
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

export async function dispatchCapiEvent(input: DispatchInput): Promise<void> {
  // 1) Skip if no messenger context.
  if (!input.psid || !input.pageRowId) {
    await writeLog(input.admin, { ...baseLog(input), status: 'skipped', skip_reason: 'no_messenger_context' })
    return
  }

  // 2) Load page CAPI config.
  const { data: page } = await input.admin
    .from('facebook_pages')
    .select('fb_page_id, capi_enabled, capi_dataset_id, capi_access_token, capi_test_event_code')
    .eq('id', input.pageRowId)
    .maybeSingle()
  if (!page || page.capi_enabled !== true) {
    await writeLog(input.admin, { ...baseLog(input), status: 'skipped', skip_reason: 'disabled' })
    return
  }
  if (!page.capi_dataset_id || !page.capi_access_token) {
    await writeLog(input.admin, { ...baseLog(input), status: 'skipped', skip_reason: 'not_configured' })
    return
  }

  // 3) Load per-action-page override.
  const { data: ap } = await input.admin
    .from('action_pages')
    .select('capi_event_name_override')
    .eq('id', input.actionPageId)
    .maybeSingle()
  const override = (ap?.capi_event_name_override as string | null) ?? null

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
    return
  }

  // Step 6+ filled in by a later task; throw for now so it's obvious if reached.
  throw new Error('dispatchCapiEvent: network path not implemented yet')
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
