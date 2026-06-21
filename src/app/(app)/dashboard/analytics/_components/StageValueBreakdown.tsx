import type { ProjectStageValue } from '@/lib/analytics/leads-analytics'
import { formatCount } from '@/lib/analytics/metrics'
import { formatMoney } from '../../projects/_lib/format'
import { Card } from './ui'

function toneFor(kind: string): string {
  if (kind === 'won') return '#16a34a'
  if (kind === 'lost') return '#ef4444'
  return '#2563eb'
}

/** Value contribution per current project stage — where the money sits right now. */
export function StageValueBreakdown({
  rows,
  currency,
}: {
  rows: ProjectStageValue[]
  currency: string
}) {
  const maxValue = Math.max(0, ...rows.map((r) => r.valueSum))
  const totalValue = rows.reduce((sum, r) => sum + r.valueSum, 0)

  if (!rows.length) {
    return (
      <Card className="p-5">
        <p className="text-[13px] text-neutral-400">No project stages to show yet.</p>
      </Card>
    )
  }

  return (
    <Card className="p-5">
      <div className="space-y-3">
        {rows.map((row) => {
          const width = maxValue > 0 ? Math.max((row.valueSum / maxValue) * 100, row.valueSum > 0 ? 2 : 0) : 0
          const share = totalValue > 0 ? (row.valueSum / totalValue) * 100 : 0
          return (
            <div key={row.stageId}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
                <span className="font-medium text-neutral-700">{row.name}</span>
                <span className="tabular-nums text-neutral-500">
                  {formatMoney(row.valueSum, currency)} · {formatCount(row.projectCount)} projects · {share.toFixed(0)}%
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-100">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${width}%`, background: toneFor(row.kind) }}
                />
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-4 text-[11px] text-neutral-400">
        Value by the project&apos;s current stage (not monotonic). Total {formatMoney(totalValue, currency)}.
      </p>
    </Card>
  )
}
