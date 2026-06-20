'use client'

import { useMemo, useState } from 'react'
import { crosstabLookup, formatCount, formatPct, type CrosstabCell } from '@/lib/analytics/metrics'
import { DrilldownButton, type DrilldownFilters } from './DrilldownButton'
import { Card } from './ui'

interface CrossStageExplorerProps {
  cells: CrosstabCell[]
  filters: DrilldownFilters
  currency: string
}

interface StageRef {
  rank: number
  name: string
  kind: string
}

function uniqueStages(
  cells: CrosstabCell[],
  rankOf: (c: CrosstabCell) => number,
  nameOf: (c: CrosstabCell) => string,
  kindOf: (c: CrosstabCell) => string,
): StageRef[] {
  const byRank = new Map<number, StageRef>()
  for (const c of cells) {
    const rank = rankOf(c)
    if (!byRank.has(rank)) byRank.set(rank, { rank, name: nameOf(c), kind: kindOf(c) })
  }
  return [...byRank.values()].sort((a, b) => a.rank - b.rank)
}

/**
 * The lead-stage -> project-stage explorer: pick any lead stage and any project
 * stage to see how many leads that reached the first also reached the second,
 * with conversion %, ratio, and a drill-down into the actual leads.
 */
export function CrossStageExplorer({ cells, filters, currency }: CrossStageExplorerProps) {
  const leadStages = useMemo(
    () => uniqueStages(cells, (c) => c.leadRank, (c) => c.leadStageName, (c) => c.leadKind ?? ''),
    [cells],
  )
  const projectStages = useMemo(
    () => uniqueStages(cells, (c) => c.projectRank, (c) => c.projectStageName, (c) => c.projectKind),
    [cells],
  )

  const defaultLead = leadStages.find((s) => s.kind === 'qualifying')?.rank ?? leadStages[0]?.rank ?? 0
  const defaultProject =
    projectStages.find((s) => s.kind === 'won')?.rank ?? projectStages[projectStages.length - 1]?.rank ?? 0

  const [leadRank, setLeadRank] = useState(defaultLead)
  const [projectRank, setProjectRank] = useState(defaultProject)

  const leadStage = leadStages.find((s) => s.rank === leadRank)
  const projectStage = projectStages.find((s) => s.rank === projectRank)
  const result = crosstabLookup(cells, leadRank, projectRank)

  if (!leadStages.length || !projectStages.length) {
    return (
      <Card className="p-5">
        <p className="text-[13px] text-neutral-400">
          Not enough stage data yet to compare lead and project stages.
        </p>
      </Card>
    )
  }

  const selectClass =
    'h-9 rounded-lg border border-neutral-200 bg-white px-2.5 text-[13px] font-medium text-neutral-800 focus:border-blue-400 focus:outline-none'

  return (
    <Card className="overflow-hidden">
      <div className="grid gap-0 lg:grid-cols-[1.1fr_1fr]">
        {/* Left: the question + controls */}
        <div className="border-b border-neutral-100 p-5 lg:border-b-0 lg:border-r">
          <p className="text-[13px] leading-relaxed text-neutral-600">
            Of the leads that reached
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select
              value={leadRank}
              aria-label="Lead stage"
              onChange={(e) => setLeadRank(Number(e.target.value))}
              className={selectClass}
            >
              {leadStages.map((s) => (
                <option key={s.rank} value={s.rank}>
                  {s.name}
                </option>
              ))}
            </select>
            <span className="text-[13px] text-neutral-500">→ how many reached project stage</span>
            <select
              value={projectRank}
              aria-label="Project stage"
              onChange={(e) => setProjectRank(Number(e.target.value))}
              className={selectClass}
            >
              {projectStages.map((s) => (
                <option key={s.rank} value={s.rank}>
                  {s.name}
                </option>
              ))}
            </select>
            <span className="text-[13px] text-neutral-500">?</span>
          </div>

          {/* Quick scan: conversion to each project stage at the chosen lead stage */}
          <div className="mt-5 space-y-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-400">
              From {leadStage?.name ?? 'this stage'} to each project stage
            </p>
            {projectStages.map((s) => {
              const r = crosstabLookup(cells, leadRank, s.rank)
              const width = Math.max(r.pct, 0)
              const active = s.rank === projectRank
              return (
                <button
                  key={s.rank}
                  type="button"
                  onClick={() => setProjectRank(s.rank)}
                  className="block w-full text-left"
                  aria-pressed={active}
                >
                  <div className="mb-0.5 flex items-baseline justify-between text-[11.5px]">
                    <span className={active ? 'font-semibold text-neutral-900' : 'text-neutral-600'}>
                      {s.name}
                    </span>
                    <span className="tabular-nums text-neutral-500">
                      {formatCount(r.leads)} · {formatPct(r.pct, 0)}
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${width}%`, background: active ? '#16a34a' : '#cbd5e1' }}
                    />
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Right: the headline result */}
        <div className="flex flex-col justify-center bg-neutral-50/60 p-5">
          <div className="text-[12px] text-neutral-500">
            {leadStage?.name} → {projectStage?.name}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-[40px] font-semibold leading-none tracking-tight tabular-nums text-neutral-900">
              {formatPct(result.pct)}
            </span>
            <span className="text-[13px] text-neutral-400">conversion</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <Stat label={`leads at ${leadStage?.name ?? ''}`} value={formatCount(result.total)} />
            <Stat label={`reached ${projectStage?.name ?? ''}`} value={formatCount(result.leads)} accent="#16a34a" />
          </div>
          <div className="mt-3 text-[12.5px] text-neutral-500">
            {result.ratio > 0 ? (
              <>
                <span className="font-semibold tabular-nums text-neutral-800">
                  {result.ratio.toFixed(1)} → 1
                </span>{' '}
                — {result.ratio.toFixed(1)} leads at this stage per conversion
              </>
            ) : (
              'No conversions in this segment yet.'
            )}
          </div>
          {result.leads > 0 ? (
            <div className="mt-4">
              <DrilldownButton
                filters={filters}
                leadRank={leadRank}
                projectRank={projectRank}
                title={`${leadStage?.name} → ${projectStage?.name}`}
                currency={currency}
                className="inline-flex h-8 items-center rounded-lg bg-neutral-900 px-3 text-[12.5px] font-medium text-white hover:bg-neutral-800"
              >
                View {formatCount(result.leads)} leads
              </DrilldownButton>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200/70 bg-white p-2.5">
      <div className="flex items-center gap-1.5">
        {accent ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: accent }} /> : null}
        <span className="text-[18px] font-semibold tabular-nums text-neutral-900">{value}</span>
      </div>
      <div className="mt-0.5 truncate text-[11px] text-neutral-400">{label}</div>
    </div>
  )
}
