import type { ProjectStats } from '../_lib/stats'
import { formatMoney } from '../_lib/format'

// Overview strip above the board. Numbers reflect the active filter (the same
// rows the board renders), so "Today" shows today's pipeline, not the all-time
// totals. Kept presentational — all aggregation happens in computeProjectStats.
export function ProjectStats({ stats }: { stats: ProjectStats }) {
  const cards: { label: string; value: string; accent?: string }[] = [
    { label: 'Projects', value: String(stats.total) },
    { label: 'Open', value: String(stats.open) },
    { label: 'Won', value: String(stats.won), accent: 'var(--lead-accent)' },
    { label: 'Lost', value: String(stats.lost), accent: 'var(--lead-danger)' },
    { label: 'Pipeline value', value: formatMoney(stats.openValue, stats.currency) || '—' },
    { label: 'Value won', value: formatMoney(stats.wonValue, stats.currency) || '—', accent: 'var(--lead-accent)' },
    { label: 'Unread', value: String(stats.unread) },
    { label: 'Missed', value: String(stats.missed) },
  ]

  return (
    <section aria-label="Project statistics" className="mt-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        {cards.map((c) => (
          <StatCard key={c.label} label={c.label} value={c.value} accent={c.accent} />
        ))}
      </div>

      {stats.perStage.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {stats.perStage.map((s) => (
            <span
              key={s.stageId}
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px]"
              style={{ background: 'var(--lead-surface-2)', border: '1px solid var(--lead-line)', color: 'var(--lead-body)' }}
            >
              <span className="font-medium" style={{ color: 'var(--lead-ink)' }}>{s.name}</span>
              <span style={{ color: 'var(--lead-muted)' }}>{s.count}</span>
              {s.subtotal > 0 && (
                <span style={{ color: 'var(--lead-accent)' }}>{formatMoney(s.subtotal, stats.currency)}</span>
              )}
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div
      className="rounded-xl px-3 py-2"
      style={{ background: 'var(--lead-surface)', border: '1px solid var(--lead-line)' }}
    >
      <div className="text-[11px] font-medium uppercase tracking-wide" style={{ color: 'var(--lead-muted)' }}>
        {label}
      </div>
      <div className="mt-0.5 text-[16px] font-semibold tabular-nums" style={{ color: accent ?? 'var(--lead-ink)' }}>
        {value}
      </div>
    </div>
  )
}
