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
  return { outcome: 'submitted', data }
}

registerHandler('sales', parseSalesSubmission)
