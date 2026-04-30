'use client'

import { useState } from 'react'
import type { PipelineRule } from '../_lib/schemas'

interface Stage {
  id: string
  name: string
}

export function PipelineRulesEditor({
  initial,
  stages,
}: {
  initial: PipelineRule[]
  stages: Stage[]
}) {
  const [rules, setRules] = useState<PipelineRule[]>(
    initial.length ? initial : [{ outcome: 'submitted', to_stage_id: null, reason: '' }],
  )

  function update(i: number, patch: Partial<PipelineRule>) {
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function remove(i: number) {
    setRules((rs) => rs.filter((_, idx) => idx !== i))
  }
  function add() {
    setRules((rs) => [...rs, { outcome: '', to_stage_id: null, reason: '' }])
  }

  return (
    <div className="space-y-2">
      <input type="hidden" name="pipeline_rules" value={JSON.stringify(rules)} />
      <p className="text-[12px] text-[#6B7280]">
        When a submission resolves to an outcome, move the lead into the configured
        stage. Leave the stage empty to record the outcome without moving the lead.
      </p>
      <div className="overflow-hidden rounded-md border border-[#E5E7EB]">
        <table className="min-w-full text-[13px]">
          <thead className="bg-[#F9FAFB] text-left text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
            <tr>
              <th className="px-3 py-2">Outcome</th>
              <th className="px-3 py-2">Move to stage</th>
              <th className="px-3 py-2">Reason (optional)</th>
              <th className="px-3 py-2 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#F3F4F6]">
            {rules.map((rule, i) => (
              <tr key={i}>
                <td className="px-3 py-2">
                  <input
                    value={rule.outcome}
                    onChange={(e) => update(i, { outcome: e.target.value })}
                    placeholder="submitted"
                    className="w-full rounded border border-[#E5E7EB] px-2 py-1 font-mono text-[12px]"
                  />
                </td>
                <td className="px-3 py-2">
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
                </td>
                <td className="px-3 py-2">
                  <input
                    value={rule.reason ?? ''}
                    onChange={(e) => update(i, { reason: e.target.value })}
                    placeholder="Form submitted"
                    className="w-full rounded border border-[#E5E7EB] px-2 py-1 text-[13px]"
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    aria-label="Remove rule"
                    className="text-[12px] text-[#9CA3AF] hover:text-red-600"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        type="button"
        onClick={add}
        className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-[12px] font-semibold text-[#374151] hover:bg-[#F9FAFB]"
      >
        + Add rule
      </button>
    </div>
  )
}
