import Link from 'next/link'
import type { ProjectCardRow, StageRunStatus } from '../../../_lib/queries'
import { formatMoney } from '../../../_lib/format'
import { Pagination } from '../../../_components/Pagination'

// Roomy, paginated list of the deals (project cards) sitting in one stage — the
// readable counterpart to the cramped kanban column. Rows deep-link to the
// board's project drawer (?project=) so editing reuses the existing surface.
export function StageLeadsList({
  rows,
  runStatus,
  total,
  page,
  makeHref,
}: {
  rows: ProjectCardRow[]
  runStatus: Map<string, StageRunStatus>
  total: number
  page: number
  makeHref: (p: number) => string
}) {
  return (
    <div>
      <div
        className="overflow-hidden rounded-2xl"
        style={{ background: 'var(--lead-surface)', border: '1px solid var(--lead-line)', boxShadow: 'var(--lead-shadow-sm)' }}
      >
        {rows.length === 0 ? (
          <div className="px-6 py-12 text-center" style={{ color: 'var(--lead-muted)' }}>
            <div className="text-[14px] font-medium" style={{ color: 'var(--lead-ink)' }}>No deals in this stage</div>
            <div className="mt-1 text-[12.5px]">Drag a card here on the board, or clear the search.</div>
          </div>
        ) : (
          <ul>
            {rows.map((r, i) => (
              <LeadRow key={r.id} row={r} run={runStatus.get(r.id) ?? null} first={i === 0} />
            ))}
          </ul>
        )}
      </div>
      <div className="mt-3">
        <Pagination total={total} page={page} makeHref={makeHref} />
      </div>
    </div>
  )
}

function LeadRow({ row, run, first }: { row: ProjectCardRow; run: StageRunStatus | null; first: boolean }) {
  const subtitle = [row.lead_name ?? 'Unknown customer', row.lead_company].filter(Boolean).join(' · ')
  return (
    <li>
      <Link
        href={`/dashboard/projects?project=${row.id}`}
        className="lead-focus flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-[color:var(--lead-surface-2)]"
        style={{ borderTop: first ? 'none' : '1px solid var(--lead-line)' }}
      >
        <Avatar src={row.lead_picture_url} name={row.lead_name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-medium" style={{ color: 'var(--lead-ink)' }}>{row.title}</span>
            {row.unread_count > 0 && (
              <Chip title={`${row.unread_count} unread message(s)`} bg="#dc2626" fg="#fff">{row.unread_count}</Chip>
            )}
            {row.unread_count === 0 && row.missed_count > 0 && (
              <Chip title={`${row.missed_count} missed message(s)`} bg="#fffbeb" fg="#b45309">{row.missed_count}</Chip>
            )}
          </div>
          <div className="truncate text-[11.5px]" style={{ color: 'var(--lead-muted)' }}>{subtitle}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {row.value != null && (
            <span className="text-[12.5px] font-semibold" style={{ color: 'var(--lead-accent)' }}>
              {formatMoney(row.value, row.currency)}
            </span>
          )}
          {run && (
            <span
              className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
              title={`Next follow-up: ${new Date(run.next_run_at).toLocaleString()}`}
              suppressHydrationWarning
              style={{ background: 'var(--lead-accent-soft)', color: 'var(--lead-accent)' }}
            >
              Follow-up active
            </span>
          )}
        </div>
      </Link>
    </li>
  )
}

function Chip({ children, title, bg, fg }: { children: React.ReactNode; title: string; bg: string; fg: string }) {
  return (
    <span
      className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums"
      title={title}
      style={{ background: bg, color: fg }}
    >
      {children}
    </span>
  )
}

function Avatar({ src, name }: { src: string | null; name: string | null }) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" referrerPolicy="no-referrer" className="h-7 w-7 shrink-0 rounded-full object-cover" />
    )
  }
  return (
    <span
      aria-hidden
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
      style={{ background: 'var(--lead-accent)' }}
    >
      {(name ?? '?').charAt(0).toUpperCase()}
    </span>
  )
}
