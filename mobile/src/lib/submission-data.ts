// Turning an action-page submission payload into something readable on a
// phone. Every page kind writes a different `data` shape — form fills land
// under `fields`, quizzes under `answers`, catalog orders under `items` —
// so this flattens all of them into one ordered label/value list.
//
// Mirrors the label vocabulary of the web view
// (src/app/(app)/dashboard/action-pages/[id]/submissions/form-submissions.helpers.ts).

/** Outcome the bot writes when it infers intent from chat instead of a fill. */
export const IMPLIED_PROCEED = 'implied_proceed'

const OUTCOME_LABELS: Record<string, string> = {
  submitted: 'Submitted',
  booked: 'Booked',
  checked_out: 'Checked out',
  payment_submitted: 'Payment sent',
  qualified: 'Qualified',
  disqualified: 'Disqualified',
  pending_review: 'Pending review',
  invalid: 'Invalid',
  [IMPLIED_PROCEED]: 'Chat-implied',
}

// Plumbing the operator never needs to read.
const HIDDEN_KEYS = new Set([
  'fields',
  'answers',
  'virtual',
  'thread_id',
  'psid',
  'page_id',
  'outcome_action',
  'outcome_action_id',
  'payment_proof_file_id',
  'payment_method_id',
])

export interface SubmissionField {
  label: string
  value: string
}

export function humanize(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.map(formatValue).filter(Boolean).join(', ')
  if (typeof v === 'object') {
    return Object.entries(v as Record<string, unknown>)
      .map(([k, val]) => `${humanize(k)}: ${formatValue(val)}`)
      .filter((s) => !s.endsWith(': '))
      .join(' · ')
  }
  return String(v)
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function push(out: SubmissionField[], label: string, raw: unknown): void {
  const value = formatValue(raw)
  if (value) out.push({ label, value })
}

/** A catalog/sales line item rendered as "2 × Widget". */
function formatItem(item: unknown): string {
  const row = asRecord(item)
  if (!row) return formatValue(item)
  const name = formatValue(row.name ?? row.title ?? row.product ?? '')
  const qty = typeof row.qty === 'number' ? row.qty : typeof row.quantity === 'number' ? row.quantity : null
  if (!name) return formatValue(item)
  return qty && qty > 1 ? `${qty} × ${name}` : name
}

/**
 * Every answer the person gave, in display order: quiz answers first (they
 * carry their own prompts), then form fields, then whatever else the payload
 * holds — booking slot, order lines, payment details.
 */
export function submissionFields(data: Record<string, unknown> | null | undefined): SubmissionField[] {
  const payload = data ?? {}
  const out: SubmissionField[] = []

  const answers = Array.isArray(payload.answers) ? payload.answers : []
  answers.forEach((entry, i) => {
    const row = asRecord(entry) ?? {}
    const prompt = typeof row.prompt === 'string' && row.prompt.trim() ? row.prompt : `Question ${i + 1}`
    push(out, prompt, row.display ?? row.value)
  })

  const fields = asRecord(payload.fields)
  if (fields) {
    for (const [key, value] of Object.entries(fields)) push(out, humanize(key), value)
  }

  for (const [key, value] of Object.entries(payload)) {
    if (HIDDEN_KEYS.has(key)) continue
    if (key === 'items' && Array.isArray(value)) {
      push(out, 'Items', value.map(formatItem).filter(Boolean).join(', '))
      continue
    }
    push(out, humanize(key), value)
  }

  return out
}

/** True for a row the bot inferred from chat rather than an actual page fill. */
export function isImplied(outcome: string | null | undefined): boolean {
  return outcome === IMPLIED_PROCEED
}

export function outcomeLabel(outcome: string | null | undefined): string {
  if (!outcome) return 'Submitted'
  return OUTCOME_LABELS[outcome] ?? humanize(outcome)
}

/** Where the submission came from — a Messenger deeplink or the open web. */
export function submissionSource(psid: string | null | undefined): 'Messenger' | 'Web' {
  return psid ? 'Messenger' : 'Web'
}

/** The customer's own words captured on a chat-implied row, if any. */
export function impliedQuote(data: Record<string, unknown> | null | undefined): string | null {
  const quote = data?.message_quote
  return typeof quote === 'string' && quote.trim() ? quote.trim() : null
}
