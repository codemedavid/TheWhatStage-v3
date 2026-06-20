'use client'
import { useState } from 'react'
import { buildFunnel, conversionPct, formatCount, formatPct } from '@/lib/analytics/metrics'
import type { FunnelRow } from '@/lib/analytics/leads-analytics'

interface StageJourneyProps {
  title: string
  rows: FunnelRow[]
  unit: string
  accent?: string
  showSelector?: boolean
  footnote?: string
}

/**
 * Monotonic funnel of distinct entities reaching each stage, with step-to-step
 * and overall conversion percentages. When `showSelector` is set, a From → To
 * picker shows the conversion between any two stages.
 */
export function StageJourney({
  title,
  rows,
  unit,
  accent = '#2563eb',
  showSelector = false,
  footnote,
}: StageJourneyProps) {
  const funnel = buildFunnel(rows)
  const max = funnel[0]?.reached ?? 0
  const [fromId, setFromId] = useState(funnel[0]?.stageId ?? '')
  const [toId, setToId] = useState(funnel[funnel.length - 1]?.stageId ?? '')

  const reached = (id: string) => funnel.find((s) => s.stageId === id)?.reached ?? 0
  const selPct = conversionPct(reached(toId), reached(fromId))

  if (!funnel.length) {
    return (
      <div className="rounded-xl border border-neutral-200 bg-white p-5">
        <h3 className="text-[14px] font-semibold text-neutral-900">{title}</h3>
        <p className="mt-2 text-[13px] text-neutral-400">No stages to show yet.</p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <h3 className="mb-4 text-[14px] font-semibold text-neutral-900">{title}</h3>

      <div className="space-y-2.5">
        {funnel.map((step) => {
          const width = max > 0 ? Math.max((step.reached / max) * 100, 1.5) : 0
          return (
            <div key={step.stageId}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
                <span className="font-medium text-neutral-700">{step.name}</span>
                <span className="tabular-nums text-neutral-500">
                  {formatCount(step.reached)} {unit} · {formatPct(step.overallPct, 0)} of top · {formatPct(step.stepPct, 0)} step
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-100">
                <div className="h-full rounded-full" style={{ width: `${width}%`, background: accent }} />
              </div>
            </div>
          )
        })}
      </div>

      {showSelector && funnel.length > 1 && (
        <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-4 text-[12px]">
          <span className="text-neutral-500">Convert</span>
          <select
            value={fromId}
            aria-label="From stage"
            onChange={(e) => setFromId(e.target.value)}
            className="h-7 rounded-md border border-neutral-200 bg-white px-2 text-neutral-700"
          >
            {funnel.map((s) => (
              <option key={s.stageId} value={s.stageId}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="text-neutral-400">→</span>
          <select
            value={toId}
            aria-label="To stage"
            onChange={(e) => setToId(e.target.value)}
            className="h-7 rounded-md border border-neutral-200 bg-white px-2 text-neutral-700"
          >
            {funnel.map((s) => (
              <option key={s.stageId} value={s.stageId}>
                {s.name}
              </option>
            ))}
          </select>
          <span className="ml-1 font-semibold tabular-nums text-neutral-900">{formatPct(selPct)}</span>
          <span className="text-neutral-400">
            ({formatCount(reached(fromId))} → {formatCount(reached(toId))})
          </span>
        </div>
      )}

      {footnote ? <p className="mt-3 text-[11px] text-neutral-400">{footnote}</p> : null}
    </div>
  )
}
