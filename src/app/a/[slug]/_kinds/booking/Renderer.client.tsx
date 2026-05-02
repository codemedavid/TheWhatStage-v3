'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import type { BookingConfig } from './schema'
import { formatSlotLabel } from '@/lib/action-pages/handlers/booking.slots'

interface SlotApiItem {
  start_iso: string
  end_iso: string
  capacity: number
  taken: number
}

interface Props {
  slug: string
  config: BookingConfig
  hidden: {
    slug: string
    p?: string | null
    g?: string | null
    e?: string | null
    t?: string | null
  }
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Mode = 'pick' | 'confirm' | 'done'

function ymd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function fmtLong(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

function fmtShort(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export default function BookingPicker({ slug, config, hidden }: Props) {
  const accent = config.theme.accent_color
  const buttonText = config.theme.button_text_color

  const today = useMemo(() => {
    const t = new Date()
    return new Date(t.getFullYear(), t.getMonth(), t.getDate())
  }, [])

  const [viewMonth, setViewMonth] = useState<Date>(
    () => new Date(today.getFullYear(), today.getMonth(), 1),
  )
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [pickedSlotIso, setPickedSlotIso] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('pick')

  const [slots, setSlots] = useState<SlotApiItem[]>([])
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [slotsError, setSlotsError] = useState<string | null>(null)

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  const dateRange = config.date_range

  function isWithinRange(d: Date): boolean {
    const k = ymd(d)
    if (dateRange.from && k < dateRange.from) return false
    if (dateRange.to && k > dateRange.to) return false
    return true
  }

  function dayHasAvailability(d: Date): boolean {
    if (d < today) return false
    if (!isWithinRange(d)) return false
    const wd = d.getDay()
    const dayCfg = config.availability.find((x) => x.weekday === wd)
    if (!dayCfg || !dayCfg.enabled || dayCfg.windows.length === 0) return false
    return true
  }

  useEffect(() => {
    if (!selectedDate) {
      setSlots([])
      return
    }
    let cancelled = false
    setLoadingSlots(true)
    setSlotsError(null)
    setPickedSlotIso(null)
    fetch(
      `/api/action-pages/${encodeURIComponent(slug)}/slots?date=${ymd(selectedDate)}`,
      { cache: 'no-store' },
    )
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
        setSlotsError(e instanceof Error ? e.message : 'failed_to_load_slots')
        setSlots([])
      })
      .finally(() => {
        if (!cancelled) setLoadingSlots(false)
      })
    return () => {
      cancelled = true
    }
  }, [slug, selectedDate])

  const availableSlots = slots.filter((s) => s.taken < s.capacity)

  const cssVars: CSSProperties = {
    ['--ws-accent' as string]: accent,
    ['--ws-button-text' as string]: buttonText,
  }

  function gotoPrevMonth() {
    setViewMonth(
      (m) => new Date(m.getFullYear(), m.getMonth() - 1, 1),
    )
  }
  function gotoNextMonth() {
    setViewMonth(
      (m) => new Date(m.getFullYear(), m.getMonth() + 1, 1),
    )
  }

  const prevDisabled =
    viewMonth.getFullYear() === today.getFullYear() &&
    viewMonth.getMonth() === today.getMonth()

  const monthDays: { date: Date; inMonth: boolean }[] = useMemo(() => {
    const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1)
    const offset = first.getDay()
    const days = new Date(
      viewMonth.getFullYear(),
      viewMonth.getMonth() + 1,
      0,
    ).getDate()
    const arr: { date: Date; inMonth: boolean }[] = []
    for (let i = 0; i < offset; i++) {
      arr.push({
        date: new Date(viewMonth.getFullYear(), viewMonth.getMonth(), i - offset + 1),
        inMonth: false,
      })
    }
    for (let day = 1; day <= days; day++) {
      arr.push({
        date: new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day),
        inMonth: true,
      })
    }
    return arr
  }, [viewMonth])

  function pickDate(d: Date) {
    setSelectedDate(d)
    setPickedSlotIso(null)
    setMode('pick')
  }

  function pickSlot(iso: string) {
    setPickedSlotIso(iso)
    setMode('confirm')
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!pickedSlotIso) return
    const form = e.currentTarget
    const fd = new FormData(form)
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch('/api/action-pages/submit', {
        method: 'POST',
        body: fd,
      })
      if (!res.ok && res.type !== 'opaqueredirect') {
        const text = await res.text().catch(() => '')
        throw new Error(text || `submit_failed_${res.status}`)
      }
      setMode('done')
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'submit_failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (mode === 'done' && selectedDate && pickedSlotIso) {
    return (
      <div
        className="flex flex-col items-center gap-3.5 px-2 pb-4 pt-2 text-center"
        style={cssVars}
      >
        <div
          className="grid h-12 w-12 place-items-center rounded-full"
          style={{
            background: 'color-mix(in srgb, var(--ws-accent) 15%, white)',
            color: accent,
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h2
          className="m-0 text-[28px] font-normal tracking-[-0.01em]"
          style={{ fontFamily: "'Instrument Serif', Georgia, serif" }}
        >
          You&apos;re booked.
        </h2>
        <p className="m-0 max-w-[320px] text-[13px] text-[#6B6960]">
          We&apos;ve got your details. You&apos;ll receive a confirmation
          shortly.
        </p>
        <div className="mt-1 flex w-full flex-col gap-1.5 rounded-lg border border-[#E8E6DE] bg-[#F6F5F1] p-3.5 text-left">
          <div className="flex justify-between gap-2.5 text-[12.5px]">
            <span className="text-[#9C9A90]">When</span>
            <span className="font-medium text-[#1A1915]">
              {fmtLong(selectedDate)} ·{' '}
              {formatSlotLabel(pickedSlotIso, config.appointment.timezone)}
            </span>
          </div>
          <div className="flex justify-between gap-2.5 text-[12.5px]">
            <span className="text-[#9C9A90]">Duration</span>
            <span className="font-medium text-[#1A1915]">
              {config.appointment.duration_min} minutes
            </span>
          </div>
          <div className="flex justify-between gap-2.5 text-[12.5px]">
            <span className="text-[#9C9A90]">Timezone</span>
            <span className="font-medium text-[#1A1915]">
              {config.appointment.timezone}
            </span>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-[18px]" style={cssVars}>
      <div className="flex items-center justify-between">
        <span className="text-[15px] font-semibold tracking-[-0.005em] text-[#1A1915]">
          {MONTHS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            aria-label="Previous month"
            disabled={prevDisabled}
            onClick={gotoPrevMonth}
            className="grid h-7 w-7 place-items-center rounded-[7px] border border-[#E8E6DE] bg-white text-[#3F3D36] transition-colors hover:enabled:border-[#D9D6CC] hover:enabled:bg-[#F6F5F1] disabled:cursor-not-allowed disabled:opacity-35"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={gotoNextMonth}
            className="grid h-7 w-7 place-items-center rounded-[7px] border border-[#E8E6DE] bg-white text-[#3F3D36] transition-colors hover:border-[#D9D6CC] hover:bg-[#F6F5F1]"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>

      <div role="grid" className="grid grid-cols-7 gap-0.5">
        {DOW.map((d) => (
          <div
            key={d}
            className="py-1 text-center text-[10.5px] font-medium uppercase tracking-[0.08em] text-[#9C9A90]"
          >
            {d}
          </div>
        ))}
        {monthDays.map(({ date, inMonth }, idx) => {
          if (!inMonth) {
            return <div key={`e-${idx}`} aria-hidden className="aspect-square" />
          }
          const has = dayHasAvailability(date)
          const isToday = ymd(date) === ymd(today)
          const isSelected =
            selectedDate !== null && ymd(date) === ymd(selectedDate)
          return (
            <button
              key={ymd(date)}
              type="button"
              disabled={!has}
              onClick={() => pickDate(date)}
              className="relative grid aspect-square place-items-center rounded-lg border border-transparent text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35"
              style={{
                background: isSelected ? '#1A1915' : 'transparent',
                color: isSelected
                  ? '#FFFFFF'
                  : has
                    ? '#1A1915'
                    : '#9C9A90',
                fontWeight: has || isSelected ? 600 : 500,
                boxShadow:
                  isToday && !isSelected
                    ? 'inset 0 0 0 1px #D9D6CC'
                    : undefined,
              }}
              onMouseEnter={(e) => {
                if (!isSelected && has)
                  e.currentTarget.style.background = '#F6F5F1'
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.background = 'transparent'
              }}
            >
              {date.getDate()}
              {has && (
                <span
                  className="absolute bottom-[5px] left-1/2 h-1 w-1 -translate-x-1/2 rounded-full"
                  style={{
                    background: isSelected ? '#FFFFFF' : accent,
                  }}
                />
              )}
            </button>
          )
        })}
      </div>

      {selectedDate && mode === 'pick' && (
        <div className="flex flex-col gap-2.5 border-t border-[#E8E6DE] pt-4">
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] font-semibold text-[#1A1915]">
              {fmtShort(selectedDate)}
            </span>
            <span className="text-[11.5px] text-[#9C9A90]">
              {config.appointment.timezone}
            </span>
          </div>
          {loadingSlots && (
            <p className="m-0 text-[13px] text-[#6B6960]">Loading times…</p>
          )}
          {slotsError && !loadingSlots && (
            <p className="m-0 text-[13px] text-[#B23A2B]">
              Could not load times: {slotsError}
            </p>
          )}
          {!loadingSlots && !slotsError && availableSlots.length === 0 && (
            <div className="rounded-lg border border-dashed border-[#D9D6CC] bg-[#F6F5F1] px-3 py-4.5 text-center text-[12.5px] text-[#6B6960]">
              No available times this day.
            </div>
          )}
          {!loadingSlots && !slotsError && availableSlots.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {availableSlots.map((s) => (
                <button
                  key={s.start_iso}
                  type="button"
                  onClick={() => pickSlot(s.start_iso)}
                  className="rounded-[7px] border border-[#E8E6DE] bg-white px-2.5 py-2.5 text-[13px] font-medium tabular-nums text-[#1A1915] transition-colors hover:border-[#1A1915]"
                  style={{
                    fontFamily:
                      "var(--font-geist-mono), ui-monospace, monospace",
                  }}
                >
                  {formatSlotLabel(s.start_iso, config.appointment.timezone)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {selectedDate && mode === 'confirm' && pickedSlotIso && (
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="flex flex-col gap-3 border-t border-[#E8E6DE] pt-4"
        >
          <input type="hidden" name="slug" value={hidden.slug} />
          {hidden.p && hidden.g && hidden.e && hidden.t && (
            <>
              <input type="hidden" name="p" value={hidden.p} />
              <input type="hidden" name="g" value={hidden.g} />
              <input type="hidden" name="e" value={hidden.e} />
              <input type="hidden" name="t" value={hidden.t} />
            </>
          )}
          <input type="hidden" name="data.slot_iso" value={pickedSlotIso} />

          <span
            className="inline-flex items-center gap-2 self-start rounded-lg border px-3 py-2 text-[13px] font-medium"
            style={{
              background: `color-mix(in srgb, ${accent} 8%, white)`,
              borderColor: `color-mix(in srgb, ${accent} 25%, white)`,
              color: `color-mix(in srgb, ${accent} 70%, #0F4A30)`,
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke={accent}
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {fmtShort(selectedDate)} ·{' '}
            {formatSlotLabel(pickedSlotIso, config.appointment.timezone)}
          </span>

          {config.form.fields.length > 0 ? (
            <div className="grid gap-2.5 sm:grid-cols-2">
              {config.form.fields.map((f) => (
                <label key={f.id} className="flex flex-col gap-1.5">
                  <span className="text-[12px] font-medium text-[#3F3D36]">
                    {f.label}
                    {f.required && (
                      <span className="ml-0.5 text-[#B23A2B]">*</span>
                    )}
                  </span>
                  <input
                    name={`data.${f.key}`}
                    type={
                      f.field_kind === 'email'
                        ? 'email'
                        : f.field_kind === 'phone'
                          ? 'tel'
                          : 'text'
                    }
                    required={f.required}
                    className="h-[38px] w-full rounded-[7px] border border-[#D9D6CC] bg-white px-3 text-[13.5px] text-[#1A1915] outline-none transition-shadow focus:border-[var(--ws-accent)] focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ws-accent)_18%,white)]"
                  />
                </label>
              ))}
            </div>
          ) : null}

          {submitError && (
            <p className="m-0 text-[12.5px] text-[#B23A2B]">{submitError}</p>
          )}

          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setMode('pick')
                setPickedSlotIso(null)
              }}
              className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-transparent px-4 text-[13.5px] font-medium text-[#3F3D36] transition-colors hover:bg-[#F6F5F1]"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg px-4 text-[13.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                background: accent,
                color: buttonText,
                borderColor: accent,
              }}
            >
              {submitting ? 'Booking…' : 'Confirm booking'}
            </button>
          </div>
        </form>
      )}

      {!selectedDate && (
        <div className="flex flex-col gap-2.5 border-t border-[#E8E6DE] pt-4">
          <div className="rounded-lg border border-dashed border-[#D9D6CC] bg-[#F6F5F1] px-3 py-4.5 text-center text-[12.5px] text-[#6B6960]">
            Pick a date with a dot to see available times.
          </div>
        </div>
      )}
    </div>
  )
}
