'use client'

import { useEffect, useMemo, useState } from 'react'
import type { BookingConfig } from './schema'
import {
  formatSlotLabel,
  listEnabledDates,
} from '@/lib/action-pages/handlers/booking.slots'

interface SlotApiItem {
  start_iso: string
  end_iso: string
  capacity: number
  taken: number
}

interface Props {
  slug: string
  config: BookingConfig
  /**
   * Hidden inputs the renderer must include (slug + signed deeplink claims).
   * Rendered into the form so submit /api/action-pages/submit gets attribution.
   */
  hidden: {
    slug: string
    p?: string | null
    g?: string | null
    e?: string | null
    t?: string | null
  }
}

export default function BookingPicker({ slug, config, hidden }: Props) {
  const enabledDates = useMemo(
    () => listEnabledDates(config, { now: new Date(), horizonDays: 30 }),
    [config],
  )

  const [date, setDate] = useState<string | null>(enabledDates[0] ?? null)
  const [slots, setSlots] = useState<SlotApiItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pickedSlot, setPickedSlot] = useState<string | null>(null)

  useEffect(() => {
    if (!date) {
      setSlots([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setPickedSlot(null)
    fetch(`/api/action-pages/${encodeURIComponent(slug)}/slots?date=${date}`, {
      cache: 'no-store',
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as { slots: SlotApiItem[] }
      })
      .then((body) => {
        if (cancelled) return
        setSlots(body.slots)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'failed_to_load_slots')
        setSlots([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug, date])

  const accent = config.theme.accent_color
  const buttonText = config.theme.button_text_color

  const formatDateLabel = (ymd: string) => {
    const [y, m, d] = ymd.split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d))
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'UTC',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(dt)
  }

  const availableSlots = (slots ?? []).filter((s) => s.taken < s.capacity)

  return (
    <form action="/api/action-pages/submit" method="post" className="space-y-5">
      <input type="hidden" name="slug" value={hidden.slug} />
      {hidden.p && hidden.g && hidden.e && hidden.t && (
        <>
          <input type="hidden" name="p" value={hidden.p} />
          <input type="hidden" name="g" value={hidden.g} />
          <input type="hidden" name="e" value={hidden.e} />
          <input type="hidden" name="t" value={hidden.t} />
        </>
      )}
      <input type="hidden" name="data.slot_iso" value={pickedSlot ?? ''} />

      <section>
        <h2 className="text-[13px] font-semibold text-[#111827]">Pick a date</h2>
        {enabledDates.length === 0 ? (
          <p className="mt-2 text-[13px] text-[#6B7280]">
            No availability in the next 30 days.
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {enabledDates.map((d) => {
              const active = d === date
              return (
                <button
                  type="button"
                  key={d}
                  onClick={() => setDate(d)}
                  className="rounded-md border px-3 py-2 text-[13px] font-semibold"
                  style={{
                    borderColor: active ? accent : '#E5E7EB',
                    background: active ? accent : '#FFFFFF',
                    color: active ? buttonText : '#374151',
                  }}
                >
                  {formatDateLabel(d)}
                </button>
              )
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-[13px] font-semibold text-[#111827]">Pick a time</h2>
        {loading && (
          <p className="mt-2 text-[13px] text-[#6B7280]">Loading slots…</p>
        )}
        {error && !loading && (
          <p className="mt-2 text-[13px] text-red-600">
            Could not load slots: {error}
          </p>
        )}
        {!loading && !error && availableSlots.length === 0 && (
          <p className="mt-2 text-[13px] text-[#6B7280]">
            No open slots for this date.
          </p>
        )}
        {!loading && !error && availableSlots.length > 0 && (
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {availableSlots.map((s) => {
              const active = s.start_iso === pickedSlot
              return (
                <button
                  type="button"
                  key={s.start_iso}
                  onClick={() => setPickedSlot(s.start_iso)}
                  className="rounded-md border px-3 py-2 text-[13px] font-semibold"
                  style={{
                    borderColor: active ? accent : '#E5E7EB',
                    background: active ? accent : '#FFFFFF',
                    color: active ? buttonText : '#374151',
                  }}
                >
                  {formatSlotLabel(s.start_iso, config.appointment.timezone)}
                </button>
              )
            })}
          </div>
        )}
      </section>

      {config.form.fields.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[13px] font-semibold text-[#111827]">Your details</h2>
          {config.form.fields.map((f) => (
            <label key={f.id} className="block">
              <span className="mb-1 block text-[12px] font-semibold text-[#374151]">
                {f.label}
                {f.required && <span className="ml-1 text-red-600">*</span>}
              </span>
              <input
                name={`data.${f.key}`}
                type={f.field_kind === 'email' ? 'email' : f.field_kind === 'phone' ? 'tel' : 'text'}
                required={f.required}
                className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
              />
            </label>
          ))}
        </section>
      )}

      <button
        type="submit"
        disabled={!pickedSlot}
        className="w-full rounded-md px-3 py-2 text-[14px] font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        style={{ background: accent, color: buttonText }}
      >
        {pickedSlot ? 'Book this slot' : 'Pick a slot first'}
      </button>
    </form>
  )
}
