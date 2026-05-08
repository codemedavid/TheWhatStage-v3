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

const GRAPH = 'https://graph.facebook.com/v19.0'

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
    let metaMsg = text
    try {
      const parsed = JSON.parse(text) as MetaError
      metaMsg = parsed.error?.message ?? text
    } catch {
      // keep raw text
    }
    throw new Error(`Meta template create ${res.status}: ${metaMsg}`)
  }
  return JSON.parse(text) as CreateTemplateResult
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
