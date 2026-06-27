'use client'

import { useState } from 'react'
import { formatMoney } from '../../projects/_lib/format'
import { fetchDrilldownLeads, type DrilldownResult } from '../actions/drilldown'
import type { DrilldownLead } from '@/lib/analytics/leads-analytics'

export interface DrilldownFilters {
  from: string | null
  to: string | null
  source: string | null
  campaign: string | null
  workspace: string | null
}

interface DrilldownButtonProps {
  filters: DrilldownFilters
  leadRank: number
  projectRank: number
  title: string
  currency: string
  className?: string
  children: React.ReactNode
}

/** A button that opens a modal listing the leads behind a cross-tab / funnel cell. */
export function DrilldownButton({
  filters,
  leadRank,
  projectRank,
  title,
  currency,
  className,
  children,
}: DrilldownButtonProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<DrilldownResult | null>(null)

  const load = async () => {
    setOpen(true)
    setLoading(true)
    setResult(null)
    const res = await fetchDrilldownLeads({ ...filters, leadRank, projectRank, limit: 200 })
    setResult(res)
    setLoading(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={load}
        className={className ?? 'text-[12px] font-medium text-blue-600 hover:text-blue-700 hover:underline'}
      >
        {children}
      </button>

      {open ? (
        <DrilldownModal
          title={title}
          currency={currency}
          loading={loading}
          result={result}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  )
}

function DrilldownModal({
  title,
  currency,
  loading,
  result,
  onClose,
}: {
  title: string
  currency: string
  loading: boolean
  result: DrilldownResult | null
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-3.5">
          <div>
            <h3 className="text-[14px] font-semibold text-neutral-900">{title}</h3>
            {result?.ok ? (
              <p className="text-[12px] text-neutral-400">{result.leads.length} leads</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-7 w-7 place-items-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            ✕
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-3">
          {loading ? (
            <DrilldownSkeleton />
          ) : result && !result.ok ? (
            <p className="py-6 text-center text-[13px] text-rose-600">{result.error}</p>
          ) : result && result.leads.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-neutral-400">No leads in this segment.</p>
          ) : (
            <DrilldownTable leads={result?.leads ?? []} currency={currency} />
          )}
        </div>
      </div>
    </div>
  )
}

function DrilldownTable({ leads, currency }: { leads: DrilldownLead[]; currency: string }) {
  return (
    <table className="w-full text-[12.5px]">
      <thead>
        <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-400">
          <th className="py-1.5 pr-3 font-medium">Lead</th>
          <th className="py-1.5 pr-3 font-medium">Source</th>
          <th className="py-1.5 pr-3 font-medium">Best stage</th>
          <th className="py-1.5 pr-3 text-right font-medium">Projects</th>
          <th className="py-1.5 text-right font-medium">Value</th>
        </tr>
      </thead>
      <tbody>
        {leads.map((lead) => (
          <tr key={lead.leadId} className="border-t border-neutral-100">
            <td className="py-2 pr-3 font-medium text-neutral-800">{lead.leadName}</td>
            <td className="py-2 pr-3 text-neutral-500">{lead.source ?? '—'}</td>
            <td className="py-2 pr-3 text-neutral-500">{lead.bestProjectStage ?? '—'}</td>
            <td className="py-2 pr-3 text-right tabular-nums text-neutral-600">{lead.projectCount}</td>
            <td className="py-2 text-right tabular-nums text-neutral-700">
              {lead.valueSum > 0 ? formatMoney(lead.valueSum, lead.currency ?? currency) : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function DrilldownSkeleton() {
  return (
    <div className="space-y-2 py-2" aria-hidden>
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-7 w-full animate-pulse rounded-md bg-neutral-100" />
      ))}
    </div>
  )
}
