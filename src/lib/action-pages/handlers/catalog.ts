import { z } from 'zod'
import { registerHandler, type ParsedSubmission } from '../dispatch'

const CatalogItem = z.object({
  id: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(999),
})

const CHECKOUT_FIELD_TYPES = [
  'short_text',
  'long_text',
  'email',
  'phone',
  'number',
  'select',
  'image',
] as const

type CheckoutFieldType = (typeof CHECKOUT_FIELD_TYPES)[number]

interface CheckoutFieldDef {
  id: string
  key: string
  label: string
  type: CheckoutFieldType
  required: boolean
  placeholder?: string
  options?: string[]
}

function parseCheckoutFields(config: Record<string, unknown>): CheckoutFieldDef[] {
  const raw = config.checkout_fields
  if (!Array.isArray(raw)) return []
  const out: CheckoutFieldDef[] = []
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue
    const r = f as Record<string, unknown>
    const key = typeof r.key === 'string' ? r.key.trim() : ''
    const label = typeof r.label === 'string' ? r.label.trim() : ''
    const type = (CHECKOUT_FIELD_TYPES as readonly string[]).includes(String(r.type))
      ? (String(r.type) as CheckoutFieldType)
      : 'short_text'
    if (!key || !label) continue
    out.push({
      id: typeof r.id === 'string' ? r.id : key,
      key,
      label,
      type,
      required: r.required === true,
      placeholder: typeof r.placeholder === 'string' ? r.placeholder : undefined,
      options: Array.isArray(r.options)
        ? r.options.filter((o): o is string => typeof o === 'string')
        : undefined,
    })
  }
  return out
}

export const CatalogSubmissionPayload = z.object({
  items: z
    .union([
      z.string().transform((value, ctx) => {
        try {
          return JSON.parse(value) as unknown
        } catch {
          ctx.addIssue({
            code: 'custom',
            message: 'Invalid cart JSON',
          })
          return z.NEVER
        }
      }),
      z.array(CatalogItem),
    ])
    .pipe(z.array(CatalogItem).min(1).max(100)),
  customer_name: z.string().trim().max(160).optional(),
  customer_email: z.string().trim().max(320).optional(),
  customer_phone: z.string().trim().max(40).optional(),
  customer_notes: z.string().trim().max(2000).optional(),
  payment_method_id: z.string().uuid().optional(),
  custom: z
    .union([
      z.string().transform((value, ctx) => {
        try {
          return JSON.parse(value) as unknown
        } catch {
          ctx.addIssue({ code: 'custom', message: 'Invalid custom fields JSON' })
          return z.NEVER
        }
      }),
      z.record(z.string(), z.unknown()),
    ])
    .optional(),
})

function validateCustom(
  raw: unknown,
  fields: CheckoutFieldDef[],
): Record<string, string> {
  const obj = (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {})
  const out: Record<string, string> = {}
  for (const f of fields) {
    const v = obj[f.key]
    const str = v == null ? '' : String(v).trim()
    if (!str) {
      if (f.required) throw new Error(`Missing required field: ${f.label}`)
      continue
    }
    if (str.length > 4000) throw new Error(`Field too long: ${f.label}`)
    if (f.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str)) {
      throw new Error(`Invalid email for ${f.label}`)
    }
    if (f.type === 'number' && Number.isNaN(Number(str))) {
      throw new Error(`Invalid number for ${f.label}`)
    }
    if (f.type === 'select' && f.options && !f.options.includes(str)) {
      throw new Error(`Invalid choice for ${f.label}`)
    }
    if (f.type === 'image' && !/^https?:\/\//i.test(str)) {
      throw new Error(`Invalid image upload for ${f.label}`)
    }
    out[f.key] = str
  }
  return out
}

export function parseCatalogSubmission(
  payload: Record<string, unknown>,
  config: Record<string, unknown> = {},
): ParsedSubmission {
  const parsed = CatalogSubmissionPayload.parse(payload)
  const fields = parseCheckoutFields(config)
  const custom = validateCustom(parsed.custom, fields)

  return {
    outcome: 'checked_out',
    data: {
      items: parsed.items,
      payment_method_id: parsed.payment_method_id ?? null,
      customer: {
        name: parsed.customer_name ?? null,
        email: parsed.customer_email ?? null,
        phone: parsed.customer_phone ?? null,
        notes: parsed.customer_notes ?? null,
        custom,
      },
    },
  }
}

registerHandler('catalog', parseCatalogSubmission)
