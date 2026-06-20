'use client'
import { useUrlState } from './useUrlState'
import type { AnalyticsQuery } from '../_lib/schemas'
import type { CampaignOption } from '@/lib/analytics/leads-analytics'

const RANGES: { value: AnalyticsQuery['range']; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All' },
]

interface AnalyticsToolbarProps {
  params: AnalyticsQuery
  sources: string[]
  campaigns: CampaignOption[]
}

export function AnalyticsToolbar({ params, sources, campaigns }: AnalyticsToolbarProps) {
  const { set, isPending } = useUrlState()
  const selectClass = 'h-8 rounded-md border border-neutral-200 bg-white px-2 text-[12px] text-neutral-700'

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={isPending}>
      <div className="inline-flex rounded-lg border border-neutral-200 bg-white p-0.5">
        {RANGES.map(({ value, label }) => {
          const active = params.range === value
          return (
            <button
              key={value}
              type="button"
              onClick={() => set({ range: value, from: undefined, to: undefined })}
              aria-pressed={active}
              className={`h-7 cursor-pointer rounded-md px-3 text-[12px] font-medium transition-colors ${
                active ? 'bg-neutral-900 text-white' : 'text-neutral-600 hover:bg-neutral-100'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>

      <input
        type="date"
        value={params.from ?? ''}
        aria-label="From date"
        onChange={(e) => set({ range: 'custom', from: e.target.value || undefined })}
        className={selectClass}
      />
      <input
        type="date"
        value={params.to ?? ''}
        aria-label="To date"
        onChange={(e) => set({ range: 'custom', to: e.target.value || undefined })}
        className={selectClass}
      />

      {sources.length > 0 && (
        <select
          value={params.source ?? ''}
          aria-label="Lead source"
          onChange={(e) => set({ source: e.target.value || undefined })}
          className={selectClass}
        >
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}

      {campaigns.length > 0 && (
        <select
          value={params.campaign ?? ''}
          aria-label="Campaign"
          onChange={(e) => set({ campaign: e.target.value || undefined })}
          className={selectClass}
        >
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )
}
