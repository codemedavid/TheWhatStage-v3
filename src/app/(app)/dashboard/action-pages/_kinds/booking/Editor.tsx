'use client'

import { useMemo, useState } from 'react'
import type { KindEditorProps } from '../types'
import { FollowupTouchpointsEditor } from './FollowupTouchpointsEditor'
import { KIND_REGISTRY } from '@/lib/action-pages/kinds'
import {
  defaultBookingConfig,
  parseBookingConfig,
  type BookingConfig,
  type BookingDay,
  type BookingFormField,
} from '@/app/a/[slug]/_kinds/booking/schema'

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

const FIELD_KIND_OPTIONS: Array<{ value: BookingFormField['field_kind']; label: string }> = [
  { value: 'short_text', label: 'Short text' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
]

function genId(): string {
  return Math.random().toString(36).slice(2, 10)
}

export default function BookingEditor({ page }: KindEditorProps) {
  const initial = useMemo<BookingConfig>(() => {
    const parsed = parseBookingConfig(page.config)
    // If page.config was an empty object the schema gave us defaults; that's
    // fine — but make sure availability has all 7 days.
    if (parsed.availability.length === 7) return parsed
    return { ...parsed, availability: defaultBookingConfig().availability }
  }, [page.config])

  const [config, setConfig] = useState<BookingConfig>(initial)

  const updateTheme = (patch: Partial<BookingConfig['theme']>) => {
    setConfig((c) => ({ ...c, theme: { ...c.theme, ...patch } }))
  }
  const updateAppointment = (patch: Partial<BookingConfig['appointment']>) => {
    setConfig((c) => ({ ...c, appointment: { ...c.appointment, ...patch } }))
  }
  const updateDateRange = (patch: Partial<BookingConfig['date_range']>) => {
    setConfig((c) => ({ ...c, date_range: { ...c.date_range, ...patch } }))
  }

  const updateDay = (weekday: number, patch: Partial<BookingDay>) => {
    setConfig((c) => ({
      ...c,
      availability: c.availability.map((d) =>
        d.weekday === weekday ? { ...d, ...patch } : d,
      ),
    }))
  }

  const addWindow = (weekday: number) => {
    updateDay(weekday, {
      enabled: true,
      windows: [
        ...(config.availability.find((d) => d.weekday === weekday)?.windows ?? []),
        { start: '09:00', end: '17:00' },
      ],
    })
  }

  const removeWindow = (weekday: number, idx: number) => {
    const day = config.availability.find((d) => d.weekday === weekday)
    if (!day) return
    updateDay(weekday, { windows: day.windows.filter((_, i) => i !== idx) })
  }

  const updateWindow = (
    weekday: number,
    idx: number,
    patch: Partial<{ start: string; end: string }>,
  ) => {
    const day = config.availability.find((d) => d.weekday === weekday)
    if (!day) return
    updateDay(weekday, {
      windows: day.windows.map((w, i) => (i === idx ? { ...w, ...patch } : w)),
    })
  }

  const addField = () => {
    setConfig((c) => ({
      ...c,
      form: {
        ...c.form,
        fields: [
          ...c.form.fields,
          {
            id: genId(),
            key: `field_${c.form.fields.length + 1}`,
            label: 'New field',
            field_kind: 'short_text',
            required: false,
          },
        ],
      },
    }))
  }

  const updateField = (id: string, patch: Partial<BookingFormField>) => {
    setConfig((c) => ({
      ...c,
      form: {
        ...c.form,
        fields: c.form.fields.map((f) => (f.id === id ? { ...f, ...patch } : f)),
      },
    }))
  }

  const removeField = (id: string) => {
    setConfig((c) => ({
      ...c,
      form: { ...c.form, fields: c.form.fields.filter((f) => f.id !== id) },
    }))
  }

  return (
    <div className="space-y-6">
      <input type="hidden" name="config" value={JSON.stringify(config)} />

      <SubSection title="Theme">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <ColorField
            label="Background"
            value={config.theme.background_color}
            onChange={(v) => updateTheme({ background_color: v })}
          />
          <ColorField
            label="Accent"
            value={config.theme.accent_color}
            onChange={(v) => updateTheme({ accent_color: v })}
          />
          <ColorField
            label="Button text"
            value={config.theme.button_text_color}
            onChange={(v) => updateTheme({ button_text_color: v })}
          />
        </div>
      </SubSection>

      <SubSection title="Appointment">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <NumberField
            label="Duration (min)"
            min={5}
            max={480}
            value={config.appointment.duration_min}
            onChange={(v) => updateAppointment({ duration_min: v })}
          />
          <NumberField
            label="Buffer after slot (min)"
            min={0}
            max={120}
            value={config.appointment.buffer_min}
            onChange={(v) => updateAppointment({ buffer_min: v })}
          />
          <TextField
            label="Timezone (IANA)"
            value={config.appointment.timezone}
            onChange={(v) => updateAppointment({ timezone: v })}
            placeholder="Asia/Manila"
          />
        </div>
      </SubSection>

      <SubSection title="Weekly availability">
        <div className="space-y-2">
          {config.availability.map((day) => (
            <div
              key={day.weekday}
              className="rounded-md border border-[#E5E7EB] bg-white p-3"
            >
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-[13px] font-semibold text-[#374151]">
                  <input
                    type="checkbox"
                    checked={day.enabled}
                    onChange={(e) =>
                      updateDay(day.weekday, { enabled: e.target.checked })
                    }
                  />
                  <span className="w-10">{WEEKDAY_LABELS[day.weekday]}</span>
                </label>
                <button
                  type="button"
                  onClick={() => addWindow(day.weekday)}
                  className="ml-auto rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[12px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
                >
                  + Add window
                </button>
              </div>
              {day.enabled && day.windows.length > 0 && (
                <div className="mt-2 space-y-2">
                  {day.windows.map((w, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        type="time"
                        value={w.start}
                        onChange={(e) =>
                          updateWindow(day.weekday, i, { start: e.target.value })
                        }
                        className="rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[13px]"
                      />
                      <span className="text-[12px] text-[#6B7280]">to</span>
                      <input
                        type="time"
                        value={w.end}
                        onChange={(e) =>
                          updateWindow(day.weekday, i, { end: e.target.value })
                        }
                        className="rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[13px]"
                      />
                      <button
                        type="button"
                        onClick={() => removeWindow(day.weekday, i)}
                        className="ml-2 rounded-md border border-red-200 bg-white px-2 py-1 text-[12px] font-semibold text-red-600 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </SubSection>

      <SubSection title="Date range">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DateField
            label="From"
            value={config.date_range.from}
            onChange={(v) => updateDateRange({ from: v })}
          />
          <DateField
            label="To"
            value={config.date_range.to}
            onChange={(v) => updateDateRange({ to: v })}
          />
        </div>
        <p className="mt-1 text-[12px] text-[#6B7280]">
          Leave blank for no boundary. Dates outside this range hide in the picker.
        </p>
      </SubSection>

      <SubSection title="Slots per window">
        <NumberField
          label="Capacity"
          min={1}
          max={50}
          value={config.slots_per_window}
          onChange={(v) =>
            setConfig((c) => ({ ...c, slots_per_window: v }))
          }
        />
        <p className="mt-1 text-[12px] text-[#6B7280]">
          How many leads can book the same start time. Default 1.
        </p>
      </SubSection>

      <SubSection title="Inline form fields">
        <div className="space-y-2">
          {config.form.fields.map((f) => (
            <div
              key={f.id}
              className="rounded-md border border-[#E5E7EB] bg-white p-3"
            >
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                <div className="sm:col-span-3">
                  <TextField
                    label="Key"
                    value={f.key}
                    onChange={(v) => updateField(f.id, { key: v })}
                    placeholder="full_name"
                  />
                </div>
                <div className="sm:col-span-4">
                  <TextField
                    label="Label"
                    value={f.label}
                    onChange={(v) => updateField(f.id, { label: v })}
                  />
                </div>
                <div className="sm:col-span-3">
                  <SelectField
                    label="Type"
                    value={f.field_kind}
                    onChange={(v) =>
                      updateField(f.id, {
                        field_kind: v as BookingFormField['field_kind'],
                      })
                    }
                    options={FIELD_KIND_OPTIONS}
                  />
                </div>
                <div className="flex items-end gap-2 sm:col-span-2">
                  <label className="flex items-center gap-1 text-[12px] text-[#374151]">
                    <input
                      type="checkbox"
                      checked={f.required}
                      onChange={(e) =>
                        updateField(f.id, { required: e.target.checked })
                      }
                    />
                    Required
                  </label>
                  <button
                    type="button"
                    onClick={() => removeField(f.id)}
                    className="ml-auto rounded-md border border-red-200 bg-white px-2 py-1 text-[12px] font-semibold text-red-600 hover:bg-red-50"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={addField}
            className="rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[13px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
          >
            + Add field
          </button>
        </div>
      </SubSection>

      {KIND_REGISTRY[page.kind].supportsFollowups && (
        <SubSection title="Follow-up touchpoints">
          <p className="mb-2 text-[12px] text-[#6B7280]">
            Send up to 7 Meta utility-template messages around the booking time. Templates must be
            approved on the Templates page first.
          </p>
          <FollowupTouchpointsEditor pageId={page.id} />
        </SubSection>
      )}
    </div>
  )
}

function SubSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold text-[#111827]">{title}</h3>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-[#374151]">
        {label}
      </span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-12 rounded-md border border-[#D1D5DB] bg-white"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-md border border-[#D1D5DB] bg-white px-2 py-1 font-mono text-[12px]"
        />
      </div>
    </label>
  )
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-[#374151]">
        {label}
      </span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value)
          onChange(Number.isFinite(n) ? n : 0)
        }}
        className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
      />
    </label>
  )
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-[#374151]">
        {label}
      </span>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
      />
    </label>
  )
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string | null
  onChange: (v: string | null) => void
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-[#374151]">
        {label}
      </span>
      <input
        type="date"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold text-[#374151]">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-[#D1D5DB] bg-white px-3 py-2 text-[14px]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}
