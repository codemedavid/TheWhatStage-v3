import { registerHandler, type ParsedSubmission } from '../dispatch'
import {
  parseSalesConfig,
  type SalesFallbackField,
} from '@/app/a/[slug]/_kinds/sales/schema'

function asTrimmedString(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value).trim()
}

export function parseSalesSubmission(
  payload: Record<string, unknown>,
  config: Record<string, unknown>,
): ParsedSubmission {
  const cfg = parseSalesConfig(config)
  const enabled: SalesFallbackField[] = cfg.fallback_form.fields.filter(
    (f) => f.enabled,
  )

  const customer: Record<string, string> = {}
  const validationErrors: string[] = []

  for (const field of enabled) {
    const raw = asTrimmedString(payload[field.key])
    if (!raw) {
      if (field.required) validationErrors.push(field.key)
      continue
    }
    if (raw.length > 4000) {
      throw new Error(`Field too long: ${field.label}`)
    }
    if (field.key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      throw new Error(`Invalid email`)
    }
    customer[field.key] = raw
  }

  if (validationErrors.length > 0) {
    throw new Error(
      `Missing required field(s): ${validationErrors.join(', ')}`,
    )
  }

  const data: Record<string, unknown> = { customer }

  const paymentMethodId = asTrimmedString(payload.payment_method_id)
  let outcome: ParsedSubmission['outcome'] = 'submitted'
  if (paymentMethodId) {
    data.payment_method_id = paymentMethodId
    const proofUrl = asTrimmedString(payload.payment_proof_url)
    if (proofUrl) data.payment_proof_url = proofUrl
    const proofFileId = asTrimmedString(payload.payment_proof_file_id)
    if (proofFileId) data.payment_proof_file_id = proofFileId
    const amountRaw = payload.payment_amount
    const amount =
      typeof amountRaw === 'number'
        ? amountRaw
        : asTrimmedString(amountRaw)
          ? Number(asTrimmedString(amountRaw))
          : NaN
    if (Number.isFinite(amount) && amount > 0) data.payment_amount = amount
    const currency = asTrimmedString(payload.payment_currency)
    if (currency) data.payment_currency = currency.toUpperCase().slice(0, 8)
    const note = asTrimmedString(payload.payment_note)
    if (note) data.payment_note = note.slice(0, 500)
    outcome = 'payment_submitted'
  }

  return { outcome, data }
}

registerHandler('sales', parseSalesSubmission)
