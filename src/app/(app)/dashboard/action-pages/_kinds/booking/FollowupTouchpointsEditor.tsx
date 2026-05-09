'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  loadFollowupsForPage,
  saveFollowupsForPage,
  resetFollowupManagementForPage,
  type ApprovedTemplateOption,
} from './followups-actions'
import type { FollowupTouchpoint } from '@/lib/workflow/booking-followups'
import { renderTemplateVariables, type LeadForRender } from '@/lib/messenger-templates/render'

const MAX_TOUCHPOINTS = 7

const OFFSET_PRESETS: Array<{ value: string; label: string }> = [
  { value: '-3d', label: '3 days before' },
  { value: '-2d', label: '2 days before' },
  { value: '-1d', label: '1 day before' },
  { value: '-2h', label: '2 hours before' },
  { value: '-1h', label: '1 hour before' },
  { value: '-30m', label: '30 minutes before' },
  { value: '-10m', label: '10 minutes before' },
  { value: '-5m', label: '5 minutes before' },
  { value: '0', label: 'At booking time' },
  { value: '+1h', label: '1 hour after' },
  { value: '+1d', label: '1 day after' },
]

const SAMPLE_LEAD: LeadForRender = {
  name: 'Sarah',
  custom_fields: {},
  booking: {
    event_at: '2026-06-01T01:00:00Z',
    event_at_relative: 'in 24 hours',
    title: 'Sample booking',
  },
}

function genTpId(): string {
  return 'tp_' + Math.random().toString(36).slice(2, 9)
}

export function FollowupTouchpointsEditor({ pageId }: { pageId: string }) {
  const [loading, setLoading] = useState(true)
  const [saving, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [touchpoints, setTouchpoints] = useState<FollowupTouchpoint[]>([])
  const [templates, setTemplates] = useState<ApprovedTemplateOption[]>([])
  const [manuallyEdited, setManuallyEdited] = useState(false)

  useEffect(() => {
    let mounted = true
    void (async () => {
      try {
        const { managed, approvedTemplates } = await loadFollowupsForPage(pageId)
        if (!mounted) return
        setTouchpoints(managed?.touchpoints ?? [])
        setTemplates(approvedTemplates)
        setManuallyEdited(managed?.manuallyEdited ?? false)
      } catch (e) {
        if (!mounted) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [pageId])

  const templateById = useMemo(() => {
    const m = new Map<string, ApprovedTemplateOption>()
    for (const t of templates) m.set(t.id, t)
    return m
  }, [templates])

  function patchTp(idx: number, patch: Partial<FollowupTouchpoint>) {
    setTouchpoints((tps) => tps.map((tp, i) => (i === idx ? { ...tp, ...patch } : tp)))
  }

  function addTp() {
    if (touchpoints.length >= MAX_TOUCHPOINTS) return
    setTouchpoints((tps) => [
      ...tps,
      {
        id: genTpId(),
        enabled: true,
        offset: '-1d',
        template_id: templates[0]?.id ?? '',
        variables: {},
      },
    ])
  }

  function removeTp(idx: number) {
    setTouchpoints((tps) => tps.filter((_, i) => i !== idx))
  }

  function save() {
    setError(null)
    setSavedAt(null)
    startTransition(async () => {
      const result = await saveFollowupsForPage(pageId, touchpoints)
      if (!result.ok) {
        setError(result.reason)
      } else {
        setSavedAt(Date.now())
      }
    })
  }

  function reset() {
    if (!confirm('Discard manual workflow edits and let the booking page manage this workflow again?')) return
    startTransition(async () => {
      await resetFollowupManagementForPage(pageId)
      setManuallyEdited(false)
    })
  }

  if (loading) return <p className="text-[13px] text-[#6B7280]">Loading follow-ups…</p>

  if (manuallyEdited) {
    return (
      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
        <p className="font-semibold">Managed externally</p>
        <p className="mt-1">
          This workflow was edited directly in the workflow editor. Saving from here is disabled
          until you reset.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-2 rounded-md border border-amber-300 bg-white px-2 py-1 text-[12px] font-semibold text-amber-900 hover:bg-amber-100"
        >
          Reset &amp; take over
        </button>
      </div>
    )
  }

  if (templates.length === 0) {
    return (
      <p className="rounded-md border border-[#D1D5DB] bg-[#F9FAFB] p-3 text-[13px] text-[#374151]">
        You don&apos;t have any approved Meta utility templates yet.{' '}
        <a href="/dashboard/templates" className="font-semibold text-[#059669] underline">
          Create one →
        </a>
      </p>
    )
  }

  return (
    <div>
      {error && (
        <p className="mb-2 rounded-md border border-red-200 bg-red-50 p-2 text-[12px] text-red-700">
          {error}
        </p>
      )}
      {savedAt && !error && (
        <p className="mb-2 rounded-md border border-emerald-200 bg-emerald-50 p-2 text-[12px] text-emerald-700">
          Saved.
        </p>
      )}

      <div className="space-y-3">
        {touchpoints.map((tp, idx) => {
          const tpl = templateById.get(tp.template_id)
          const variableCount = tpl?.variable_count ?? 0
          const previewBody = tpl
            ? renderPreview(tpl.body_text, tp, variableCount)
            : 'Pick a template to see a preview.'
          return (
            <div key={tp.id} className="rounded-md border border-[#D1D5DB] bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={tp.offset}
                  onChange={(e) => patchTp(idx, { offset: e.target.value })}
                  className="rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[13px]"
                >
                  {OFFSET_PRESETS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>

                <select
                  value={tp.template_id}
                  onChange={(e) => patchTp(idx, { template_id: e.target.value, variables: {} })}
                  className="rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[13px]"
                >
                  <option value="">— pick template —</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.display_name}
                    </option>
                  ))}
                </select>

                <label className="ml-auto flex items-center gap-1 text-[13px]">
                  <input
                    type="checkbox"
                    checked={tp.enabled}
                    onChange={(e) => patchTp(idx, { enabled: e.target.checked })}
                  />
                  Enabled
                </label>

                <button
                  type="button"
                  onClick={() => removeTp(idx)}
                  className="rounded-md border border-red-200 bg-white px-2 py-1 text-[12px] font-semibold text-red-600 hover:bg-red-50"
                >
                  Remove
                </button>
              </div>

              {tpl && variableCount > 0 && (
                <div className="mt-2 space-y-1 pl-4 text-[13px]">
                  {Array.from({ length: variableCount }, (_, i) => i + 1).map((slot) => {
                    const key = String(slot)
                    const rule = tp.variables[key]
                    return (
                      <div key={slot} className="flex items-center gap-2">
                        <span className="text-[12px] text-[#6B7280]">{`{{${slot}}}`}</span>
                        <select
                          value={rule?.kind ?? 'static'}
                          onChange={(e) => {
                            const kind = e.target.value as 'static' | 'lead_field' | 'booking_field'
                            const next =
                              kind === 'static'
                                ? { kind: 'static' as const, text: '' }
                                : kind === 'lead_field'
                                  ? { kind: 'lead_field' as const, field: 'name' }
                                  : { kind: 'booking_field' as const, field: 'event_at_relative' as const }
                            patchTp(idx, { variables: { ...tp.variables, [key]: next } })
                          }}
                          className="rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[13px]"
                        >
                          <option value="static">Static text</option>
                          <option value="lead_field">Lead field</option>
                          <option value="booking_field">Booking field</option>
                        </select>
                        {rule?.kind === 'static' && (
                          <input
                            type="text"
                            value={rule.text}
                            onChange={(e) =>
                              patchTp(idx, {
                                variables: { ...tp.variables, [key]: { kind: 'static', text: e.target.value } },
                              })
                            }
                            className="flex-1 rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[13px]"
                          />
                        )}
                        {rule?.kind === 'lead_field' && (
                          <select
                            value={rule.field}
                            onChange={(e) =>
                              patchTp(idx, {
                                variables: { ...tp.variables, [key]: { kind: 'lead_field', field: e.target.value } },
                              })
                            }
                            className="rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[13px]"
                          >
                            <option value="name">name</option>
                          </select>
                        )}
                        {rule?.kind === 'booking_field' && (
                          <select
                            value={rule.field}
                            onChange={(e) =>
                              patchTp(idx, {
                                variables: {
                                  ...tp.variables,
                                  [key]: {
                                    kind: 'booking_field',
                                    field: e.target.value as 'event_at' | 'event_at_relative' | 'title',
                                  },
                                },
                              })
                            }
                            className="rounded-md border border-[#D1D5DB] bg-white px-2 py-1 text-[13px]"
                          >
                            <option value="event_at_relative">when (relative)</option>
                            <option value="event_at">when (ISO)</option>
                            <option value="title">title</option>
                          </select>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              <p className="mt-2 rounded-md border border-[#E5E7EB] bg-[#F9FAFB] p-2 text-[12px] text-[#374151]">
                {previewBody}
              </p>
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={addTp}
          disabled={touchpoints.length >= MAX_TOUCHPOINTS}
          className="rounded-md border border-[#D1D5DB] bg-white px-3 py-1 text-[13px] font-semibold text-[#111827] hover:bg-[#F9FAFB] disabled:opacity-50"
        >
          + Add touchpoint
        </button>
        <span className="text-[12px] text-[#6B7280]">
          {touchpoints.length} / {MAX_TOUCHPOINTS}
        </span>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="ml-auto rounded-md bg-[#059669] px-3 py-1 text-[13px] font-semibold text-white hover:bg-[#047857] disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save touchpoints'}
        </button>
      </div>
    </div>
  )
}

function renderPreview(
  bodyText: string,
  tp: FollowupTouchpoint,
  variableCount: number,
): string {
  const params = renderTemplateVariables(tp.variables, variableCount, SAMPLE_LEAD)
  return bodyText.replace(/\{\{(\d+)\}\}/g, (_m, idx) => {
    const i = Number(idx)
    return params[i - 1] ?? ''
  })
}
