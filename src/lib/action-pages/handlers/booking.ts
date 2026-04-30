import { registerHandler } from '../dispatch'
import {
  parseBookingConfig,
  type BookingConfig,
} from '@/app/a/[slug]/_kinds/booking/schema'

const HHMM_RE = /^(\d{2}):(\d{2})$/

/**
 * Booking submission handler.
 *
 * Accepts payloads of the form `{ slot_iso, <field_key>... }` and returns
 *   { outcome: 'booked', data: { slot_iso, fields: { ... } } }
 * when the picked slot lies inside an enabled window for that weekday in the
 * configured timezone. Returns `outcome: 'invalid'` otherwise.
 *
 * NOTE: this handler intentionally does NOT enforce double-booking on the
 * server. The /api/action-pages/[slug]/slots endpoint already surfaces
 * existing bookings so the UI can hide taken slots. Tightening atomic
 * uniqueness will need a partial unique index on
 *   (action_page_id, (data->>'slot_iso'))
 * filtered by `outcome = 'booked'`. Intentionally deferred.
 */
registerHandler('booking', (payload, rawConfig) => {
  const config = parseBookingConfig(rawConfig)

  const slotIso = typeof payload.slot_iso === 'string' ? payload.slot_iso : null
  if (!slotIso || Number.isNaN(Date.parse(slotIso))) {
    return { outcome: 'invalid', data: { reason: 'missing_slot', payload } }
  }

  if (!slotMatchesAvailability(slotIso, config)) {
    return {
      outcome: 'invalid',
      data: { reason: 'slot_outside_window', slot_iso: slotIso },
    }
  }

  // Whitelist + validate the inline form fields against the saved config.
  const fields: Record<string, string> = {}
  for (const fieldDef of config.form.fields) {
    const raw = payload[fieldDef.key]
    const value = typeof raw === 'string' ? raw.trim() : ''
    if (!value) {
      if (fieldDef.required) {
        return {
          outcome: 'invalid',
          data: { reason: 'missing_field', field: fieldDef.key },
        }
      }
      continue
    }
    if (
      fieldDef.field_kind === 'email' &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ) {
      return {
        outcome: 'invalid',
        data: { reason: 'bad_email', field: fieldDef.key },
      }
    }
    fields[fieldDef.key] = value
  }

  return {
    outcome: 'booked',
    data: { slot_iso: slotIso, fields },
  }
})

function slotMatchesAvailability(slotIso: string, config: BookingConfig): boolean {
  const start = new Date(slotIso)
  if (Number.isNaN(start.getTime())) return false
  const tz = config.appointment.timezone

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = dtf.formatToParts(start)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  const weekdayLabel = get('weekday')
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  }
  const weekday = weekdayMap[weekdayLabel]
  if (weekday === undefined) return false

  const ymd = `${get('year')}-${get('month')}-${get('day')}`
  if (config.date_range.from && ymd < config.date_range.from) return false
  if (config.date_range.to && ymd > config.date_range.to) return false

  const hour = Number(get('hour') === '24' ? '0' : get('hour'))
  const minute = Number(get('minute'))
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false
  const slotMinutes = hour * 60 + minute

  const day = config.availability.find((d) => d.weekday === weekday)
  if (!day || !day.enabled) return false

  const duration = config.appointment.duration_min
  return day.windows.some((w) => {
    const ms = HHMM_RE.exec(w.start)
    const me = HHMM_RE.exec(w.end)
    if (!ms || !me) return false
    const startM = Number(ms[1]) * 60 + Number(ms[2])
    const endM = Number(me[1]) * 60 + Number(me[2])
    return slotMinutes >= startM && slotMinutes + duration <= endM
  })
}
