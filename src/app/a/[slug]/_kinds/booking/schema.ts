import { z } from 'zod'

/**
 * Zod schemas for the Booking kind config + payload.
 *
 * These power both the public renderer (lenient parse with defaults so a
 * partly-configured page still renders) and the server handler (strict parse
 * to validate submission payloads).
 */

const HHMM = z.string().regex(/^\d{2}:\d{2}$/, 'must be HH:MM')

export const BookingThemeSchema = z.object({
  background_color: z.string().default('#FFFFFF'),
  accent_color: z.string().default('#059669'),
  button_text_color: z.string().default('#FFFFFF'),
})

export const BookingAppointmentSchema = z.object({
  duration_min: z.number().int().min(5).max(480).default(30),
  buffer_min: z.number().int().min(0).max(120).default(0),
  timezone: z.string().min(1).default('Asia/Manila'),
})

export const BookingWindowSchema = z.object({
  start: HHMM,
  end: HHMM,
})

export const BookingDaySchema = z.object({
  weekday: z.number().int().min(0).max(6),
  enabled: z.boolean().default(false),
  windows: z.array(BookingWindowSchema).default([]),
})

export const BookingDateRangeSchema = z.object({
  from: z.string().nullable().default(null),
  to: z.string().nullable().default(null),
})

export const BookingFormFieldKindSchema = z.enum(['short_text', 'email', 'phone'])

export const BookingFormFieldSchema = z.object({
  id: z.string().min(1),
  key: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_]+$/, 'lowercase letters, digits and underscores only'),
  label: z.string().min(1).max(120),
  field_kind: BookingFormFieldKindSchema,
  required: z.boolean().default(false),
})

export const BookingFormSchema = z.object({
  // Only `inline` ships in this PR; `attached` is reserved for a follow-up
  // that lets a Booking page pull its fields from a separate Form page.
  mode: z.enum(['inline']).default('inline'),
  fields: z.array(BookingFormFieldSchema).default([]),
})

export const BookingConfigSchema = z.object({
  theme: BookingThemeSchema.default({
    background_color: '#FFFFFF',
    accent_color: '#059669',
    button_text_color: '#FFFFFF',
  }),
  appointment: BookingAppointmentSchema.default({
    duration_min: 30,
    buffer_min: 0,
    timezone: 'Asia/Manila',
  }),
  availability: z
    .array(BookingDaySchema)
    .default([])
    .transform((days) => normalizeAvailability(days)),
  date_range: BookingDateRangeSchema.default({ from: null, to: null }),
  slots_per_window: z.number().int().min(1).max(50).default(1),
  form: BookingFormSchema.default({ mode: 'inline', fields: [] }),
})

export type BookingConfig = z.infer<typeof BookingConfigSchema>
export type BookingDay = z.infer<typeof BookingDaySchema>
export type BookingFormField = z.infer<typeof BookingFormFieldSchema>

/**
 * Ensures all 7 weekdays exist in the availability array and are sorted.
 * The editor relies on a stable 7-row layout.
 */
export function normalizeAvailability(
  days: Array<{ weekday: number; enabled: boolean; windows: { start: string; end: string }[] }>,
): BookingDay[] {
  const byDay = new Map<number, BookingDay>()
  for (const d of days) {
    byDay.set(d.weekday, {
      weekday: d.weekday as BookingDay['weekday'],
      enabled: d.enabled,
      windows: d.windows,
    })
  }
  const out: BookingDay[] = []
  for (let i = 0; i < 7; i++) {
    out.push(
      byDay.get(i) ?? {
        weekday: i as BookingDay['weekday'],
        enabled: false,
        windows: [],
      },
    )
  }
  return out
}

export function defaultBookingConfig(): BookingConfig {
  return BookingConfigSchema.parse({})
}

/**
 * Tolerantly parse a booking config blob — anything missing falls back to
 * defaults. Used by the renderer to keep the public page robust even when
 * the saved config predates a schema change.
 */
export function parseBookingConfig(input: unknown): BookingConfig {
  const result = BookingConfigSchema.safeParse(input ?? {})
  if (result.success) return result.data
  return defaultBookingConfig()
}

/**
 * Strict payload validator used by the submit handler.
 */
export const BookingPayloadSchema = z.object({
  slot_iso: z.string().datetime().optional(),
})
