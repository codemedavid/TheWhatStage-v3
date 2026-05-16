'use client'

import { useState } from 'react'
import type { ActionPageKind } from '@/lib/action-pages/kinds'
import type { PipelineRule } from '../_lib/schemas'

interface Stage {
  id: string
  name: string
}

const OUTCOMES_BY_KIND: Record<string, { value: string; label: string }[]> = {
  form:          [{ value: 'submitted', label: 'Submitted' }],
  booking:       [
    { value: 'booked',   label: 'Booked' },
    { value: 'no_show',  label: 'No-show' },
  ],
  qualification: [
    { value: 'qualified',      label: 'Qualified' },
    { value: 'disqualified',   label: 'Disqualified' },
    { value: 'pending_review', label: 'Pending review' },
  ],
  sales:         [{ value: 'submitted',       label: 'Submitted' }],
  catalog:       [{ value: 'checked_out',     label: 'Checked out' }],
  realestate:    [{ value: 'viewing_booked',  label: 'Viewing booked' }],
}

export function PipelineRulesEditor({
  initial,
  stages,
  kind,
}: {
  initial: PipelineRule[]
  stages: Stage[]
  kind: ActionPageKind
}) {
  const outcomes = OUTCOMES_BY_KIND[kind] ?? []
  const firstOutcome = outcomes[0]?.value ?? ''
  const allowCustomOutcome = kind === 'qualification'

  const [rules, setRules] = useState<PipelineRule[]>(
    initial.length ? initial : [{ outcome: firstOutcome, to_stage_id: null, reason: '' }],
  )

  function update(i: number, patch: Partial<PipelineRule>) {
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function remove(i: number) {
    setRules((rs) => rs.filter((_, idx) => idx !== i))
  }
  function add() {
    setRules((rs) => [...rs, { outcome: firstOutcome, to_stage_id: null, reason: '' }])
  }

  // Only submit rules that have a valid outcome selected.
  const submittableRules = rules.filter((r) => r.outcome.trim().length > 0)

  return (
    <div className="space-y-2">
      <input type="hidden" name="pipeline_rules" value={JSON.stringify(submittableRules)} />
      <p className="text-[12px] text-[#6B7280]">
        When a submission resolves to an outcome, move the lead into the configured
        stage and (optionally) send them a Messenger reply. Leave the stage empty
        to record the outcome without moving the lead.
      </p>
      <div className="space-y-2">
        {rules.map((rule, i) => (
          <div
            key={i}
            className="rounded-md border border-[#E5E7EB] bg-white p-3 space-y-2"
          >
            <div className="grid grid-cols-[1fr_1fr_1fr_28px] items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                  Outcome
                </span>
                {allowCustomOutcome ? (
                  <div className="space-y-1">
                    <select
                      value={outcomes.some((o) => o.value === rule.outcome) ? rule.outcome : ''}
                      onChange={(e) => update(i, { outcome: e.target.value })}
                      className="w-full rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
                    >
                      <option value="">Custom outcome</option>
                      {outcomes.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <input
                      value={rule.outcome}
                      onChange={(e) => update(i, { outcome: e.target.value })}
                      placeholder="custom_outcome"
                      className="w-full rounded border border-[#E5E7EB] px-2 py-1 font-mono text-[12px]"
                    />
                  </div>
                ) : outcomes.length > 0 ? (
                  <select
                    value={rule.outcome}
                    onChange={(e) => update(i, { outcome: e.target.value })}
                    className="w-full rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
                  >
                    {outcomes.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                    {rule.outcome && !outcomes.some((o) => o.value === rule.outcome) ? (
                      <option key={rule.outcome} value={rule.outcome}>
                        {rule.outcome} (legacy)
                      </option>
                    ) : null}
                  </select>
                ) : (
                  <input
                    value={rule.outcome}
                    onChange={(e) => update(i, { outcome: e.target.value })}
                    placeholder="submitted"
                    className="w-full rounded border border-[#E5E7EB] px-2 py-1 font-mono text-[12px]"
                  />
                )}
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                  Move to stage
                </span>
                <select
                  value={rule.to_stage_id ?? ''}
                  onChange={(e) =>
                    update(i, { to_stage_id: e.target.value || null })
                  }
                  className="w-full rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
                >
                  <option value="">— no move —</option>
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {stages.length === 0 && (
                  <p className="mt-1 text-[11px] text-[#B45309]">
                    No pipeline stages yet.{' '}
                    <a
                      href="/dashboard/leads/stages"
                      className="underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Set up stages
                    </a>
                    .
                  </p>
                )}
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                  Reason
                </span>
                <input
                  value={rule.reason ?? ''}
                  onChange={(e) => update(i, { reason: e.target.value })}
                  placeholder="Form submitted"
                  className="w-full rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
                />
              </label>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove rule"
                className="h-7 w-7 self-end rounded border border-[#E5E7EB] bg-white text-[12px] text-[#9CA3AF] hover:text-red-600"
              >
                ✕
              </button>
            </div>
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
                Messenger reply for this outcome (optional)
              </span>
              <textarea
                value={rule.notify_text ?? ''}
                onChange={(e) => update(i, { notify_text: e.target.value })}
                rows={2}
                maxLength={640}
                placeholder="Overrides the global Messenger echo when this outcome fires."
                className="w-full rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
              />
            </label>
          </div>
        ))}
      </div>
      {outcomes.length > 1 || rules.length === 0 ? (
        <button
          type="button"
          onClick={add}
          className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
        >
          + Add rule
        </button>
      ) : null}
    </div>
  )
}
