import { conversionPct, formatCount, formatPct, formatRatio } from '@/lib/analytics/metrics'

interface ConversionCardProps {
  title: string
  /** Top-of-funnel population (denominator). */
  from: number
  fromLabel: string
  /** Outcome population (numerator). */
  to: number
  toLabel: string
  note?: string
}

/**
 * One conversion expressed both ways: the percentage that converts and the
 * "N from → 1 to" ratio (how many of `from` it takes to get one `to`).
 */
export function ConversionCard({ title, from, fromLabel, to, toLabel, note }: ConversionCardProps) {
  const pct = conversionPct(to, from)
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5">
      <div className="text-[12px] font-medium text-neutral-500">{title}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-[28px] font-semibold tabular-nums text-neutral-900">{formatPct(pct)}</span>
        <span className="text-[13px] text-neutral-400">conversion</span>
      </div>
      <div className="mt-1 text-[13px] text-neutral-600">
        {formatRatio(from, to)} <span className="text-neutral-400">({fromLabel} per {toLabel})</span>
      </div>
      <div className="mt-2 text-[12px] text-neutral-400">
        {formatCount(from)} {fromLabel} → {formatCount(to)} {toLabel}
      </div>
      {note ? <div className="mt-1 text-[11px] text-neutral-400">{note}</div> : null}
    </div>
  )
}
