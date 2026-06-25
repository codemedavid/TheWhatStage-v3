import { buildStageDistribution, formatCount, formatPct, stageKindGroup } from '@/lib/analytics/metrics'
import type { StageDistributionRow } from '@/lib/analytics/leads-analytics'

interface StageDistributionProps {
  title: string
  rows: StageDistributionRow[]
  unit?: string
}

/** Bar tint + optional pill by stage kind group. Uncurated (all-nurture) boards
 *  render every stage as a neutral "active" bar — still an exact board match. */
const GROUP: Record<string, { color: string; pill: string | null }> = {
  won: { color: '#16a34a', pill: 'won' },
  lost: { color: '#dc2626', pill: 'off-ramp' },
  active: { color: '#2563eb', pill: null },
}

/**
 * "Where your leads are now" — current lead count per pipeline stage, in board
 * order. Mirrors the kanban board exactly (no monotonic "reached" inflation, no
 * dependence on stage `kind` being curated).
 */
export function StageDistribution({ title, rows, unit = 'leads' }: StageDistributionProps) {
  const { rows: stages, total } = buildStageDistribution(rows)

  if (!stages.length) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-5">
        <h3 className="text-[14px] font-semibold text-neutral-900">{title}</h3>
        <p className="mt-2 text-[13px] text-neutral-400">No stages to show yet.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-neutral-200/80 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-neutral-900">{title}</h3>
        <span className="text-[12px] tabular-nums text-neutral-500">
          {formatCount(total)} {unit}
        </span>
      </div>

      <div className="space-y-2.5">
        {stages.map((stage) => {
          const group = GROUP[stageKindGroup(stage.kind)]
          const width = Math.max(stage.barPct, stage.count > 0 ? 1.5 : 0)
          return (
            <div key={stage.stageId}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-[12px]">
                <span className="flex items-center gap-1.5 font-medium text-neutral-700">
                  {stage.name}
                  {group.pill ? (
                    <span
                      className="rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                      style={{ color: group.color, background: `${group.color}14` }}
                    >
                      {group.pill}
                    </span>
                  ) : null}
                </span>
                <span className="tabular-nums text-neutral-500">
                  {formatCount(stage.count)} {unit} · {formatPct(stage.share, 0)}
                </span>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-neutral-100">
                <div className="h-full rounded-full" style={{ width: `${width}%`, background: group.color }} />
              </div>
            </div>
          )
        })}
      </div>

      <p className="mt-3 text-[11px] text-neutral-400">
        Live count of leads in each board column — matches your kanban exactly.
      </p>
    </div>
  )
}
