// Meta Message Templates API client (Messenger Utility Messages).
//
// Templates are submitted at the Page level: POST /{PAGE_ID}/message_templates.
// Once Meta reviews them, status updates are pushed to the page webhook as a
// `message_template_status_update` change. See:
// https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/utility-messages
//
// Notes on shape:
//   - `language` is a Meta language code with underscore (en_US, fil_PH, ...).
//   - `components` mirrors the WhatsApp template shape: an array of objects
//     keyed by `type` (HEADER, BODY, FOOTER, BUTTONS). BODY is required.
//   - Variable placeholders use {{1}}, {{2}}, ... in the body text. Meta also
//     wants `example.body_text` as a 2D array of sample values.

import type { TemplateButton } from '@/lib/messenger-templates/types'

const GRAPH = 'https://graph.facebook.com/v24.0'

export interface CreateTemplateArgs {
  fbPageId: string // Meta's page id (not our internal uuid)
  pageAccessToken: string
  name: string
  language: string
  bodyText: string
  sampleValues: string[]
  buttons?: TemplateButton[]
  footer?: string | null
}

export interface CreateTemplateResult {
  id: string // Meta-assigned template id (used for webhook correlation)
  status?: string // 'PENDING' | 'APPROVED' | 'REJECTED'
  category?: string
}

interface MetaError {
  error?: {
    message?: string
    type?: string
    code?: number
    error_subcode?: number
    fbtrace_id?: string
  }
}

/**
 * Error thrown by the Meta template API calls, carrying the structured Graph
 * error envelope. Callers can detect the missing-permission case by
 * `code === 200` (Meta's "Permissions error" code, surfaced as HTTP 403 #200
 * when the app lacks `pages_utility_messaging`) instead of regex-matching the
 * message text, which breaks whenever Meta rewords the string.
 */
export class MetaTemplateError extends Error {
  code?: number
  errorSubcode?: number
  httpStatus: number
  constructor(message: string, opts: { code?: number; errorSubcode?: number; httpStatus: number }) {
    super(message)
    this.name = 'MetaTemplateError'
    this.code = opts.code
    this.errorSubcode = opts.errorSubcode
    this.httpStatus = opts.httpStatus
  }

  /** True when Meta reported a permissions error (missing pages_utility_messaging). */
  get isPermissionError(): boolean {
    return this.code === 200 || this.httpStatus === 403
  }
}

function parseMetaError(status: number, text: string): MetaTemplateError {
  let message = text
  let code: number | undefined
  let errorSubcode: number | undefined
  try {
    const parsed = JSON.parse(text) as MetaError
    message = parsed.error?.message ?? text
    code = parsed.error?.code
    errorSubcode = parsed.error?.error_subcode
  } catch {
    // keep raw text
  }
  return new MetaTemplateError(message, { code, errorSubcode, httpStatus: status })
}

function toMetaButton(b: TemplateButton): Record<string, unknown> {
  if (b.type === 'url') {
    return { type: 'URL', text: b.text, url: b.url }
  }
  if (b.type === 'phone_number') {
    return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone_number }
  }
  // Meta calls postback buttons QUICK_REPLY in the template API.
  return { type: 'QUICK_REPLY', text: b.text }
}

export async function createMessengerTemplate(
  args: CreateTemplateArgs,
): Promise<CreateTemplateResult> {
  const components: Array<Record<string, unknown>> = []

  const bodyComponent: Record<string, unknown> = {
    type: 'BODY',
    text: args.bodyText,
  }
  if (args.sampleValues.length > 0) {
    // Meta wants example.body_text as a 2D array — outer array is the set of
    // examples (we send 1), inner is the values for each {{n}} placeholder
    // in order.
    bodyComponent.example = { body_text: [args.sampleValues] }
  }
  components.push(bodyComponent)

  if (args.footer?.trim()) {
    // NOTE (unverified): Meta's Messenger UTILITY-template component reference
    // enumerates HEADER / BODY / BUTTONS but NOT FOOTER (FOOTER is a WhatsApp
    // template concept). A FOOTER component may be rejected on Messenger. We
    // keep sending it to avoid regressing pages where it currently works;
    // confirm with one live create against a real page and, if rejected, drop
    // this branch + the footer field from the editor.
    components.push({ type: 'FOOTER', text: args.footer.trim() })
  }

  if (args.buttons && args.buttons.length > 0) {
    components.push({
      type: 'BUTTONS',
      buttons: args.buttons.map(toMetaButton),
    })
  }

  const url = new URL(`${GRAPH}/${args.fbPageId}/message_templates`)
  url.searchParams.set('access_token', args.pageAccessToken)

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: args.name,
      language: args.language,
      category: 'UTILITY',
      components,
    }),
  })
  const text = await res.text()
  if (!res.ok) {
    throw parseMetaError(res.status, text)
  }
  return JSON.parse(text) as CreateTemplateResult
}

/**
 * Fetch the current status of a template by name. Used as a fallback when the
 * `message_template_status_update` webhook isn't reliably delivered for
 * Messenger pages — we can poll this on demand to flip pending → approved.
 *
 * Returns null when no template with that name/language is found on the page.
 */
export async function fetchMessengerTemplateStatus(args: {
  fbPageId: string
  pageAccessToken: string
  name: string
  language: string
}): Promise<{ id: string; status: string; rejected_reason?: string | null } | null> {
  const url = new URL(`${GRAPH}/${args.fbPageId}/message_templates`)
  url.searchParams.set('access_token', args.pageAccessToken)
  url.searchParams.set('name', args.name)
  url.searchParams.set('fields', 'id,name,language,status,rejected_reason')
  const res = await fetch(url.toString(), { method: 'GET' })
  const text = await res.text()
  if (!res.ok) {
    throw parseMetaError(res.status, text)
  }
  const parsed = JSON.parse(text) as {
    data?: Array<{ id: string; name: string; language: string; status: string; rejected_reason?: string }>
  }
  const match = parsed.data?.find(
    (t) => t.name === args.name && t.language === args.language,
  )
  if (!match) return null
  return {
    id: match.id,
    status: match.status,
    rejected_reason: match.rejected_reason ?? null,
  }
}

export interface MetaTemplateRow {
  id: string
  name: string
  language: string
  status: string
  rejected_reason?: string | null
}

/**
 * List ALL message templates on a page, following pagination. This is the
 * primitive for the background status-poll cron: one (paginated) GET per page
 * returns every template, which the caller matches locally against its pending
 * rows — O(pages) Graph calls instead of O(pending-templates) per-name fetches.
 */
export async function fetchAllMessengerTemplates(args: {
  fbPageId: string
  pageAccessToken: string
  /** Safety cap on pages followed, to bound a runaway pagination loop. */
  maxPages?: number
}): Promise<MetaTemplateRow[]> {
  const out: MetaTemplateRow[] = []
  const first = new URL(`${GRAPH}/${args.fbPageId}/message_templates`)
  first.searchParams.set('access_token', args.pageAccessToken)
  first.searchParams.set('fields', 'id,name,language,status,rejected_reason')
  first.searchParams.set('limit', '100')

  let next: string | null = first.toString()
  const maxPages = args.maxPages ?? 20
  for (let page = 0; next && page < maxPages; page++) {
    const res: Response = await fetch(next, { method: 'GET' })
    const text = await res.text()
    if (!res.ok) {
      throw parseMetaError(res.status, text)
    }
    const parsed = JSON.parse(text) as {
      data?: MetaTemplateRow[]
      paging?: { next?: string; cursors?: { after?: string } }
    }
    for (const row of parsed.data ?? []) {
      out.push({
        id: row.id,
        name: row.name,
        language: row.language,
        status: row.status,
        rejected_reason: row.rejected_reason ?? null,
      })
    }
    // Meta returns an absolute `paging.next` URL (token already embedded).
    next = parsed.paging?.next ?? null
  }
  return out
}

/**
 * Delete a template by name. Idempotent — Meta returns 200 with `success:true`
 * even when no matching template exists.
 */
export async function deleteMessengerTemplate(args: {
  fbPageId: string
  pageAccessToken: string
  name: string
}): Promise<void> {
  const url = new URL(`${GRAPH}/${args.fbPageId}/message_templates`)
  url.searchParams.set('access_token', args.pageAccessToken)
  url.searchParams.set('name', args.name)
  const res = await fetch(url.toString(), { method: 'DELETE' })
  if (!res.ok && res.status !== 404) {
    throw new Error(`Meta template delete ${res.status}: ${await res.text()}`)
  }
}
