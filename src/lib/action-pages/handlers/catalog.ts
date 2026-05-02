import { z } from 'zod'
import { registerHandler, type ParsedSubmission } from '../dispatch'

const CatalogItem = z.object({
  id: z.string().uuid(),
  quantity: z.coerce.number().int().min(1).max(999),
})

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
})

export function parseCatalogSubmission(
  payload: Record<string, unknown>,
): ParsedSubmission {
  const parsed = CatalogSubmissionPayload.parse(payload)

  return {
    outcome: 'checked_out',
    data: {
      items: parsed.items,
      customer: {
        name: parsed.customer_name ?? null,
        email: parsed.customer_email ?? null,
        phone: parsed.customer_phone ?? null,
        notes: parsed.customer_notes ?? null,
      },
    },
  }
}

registerHandler('catalog', parseCatalogSubmission)
