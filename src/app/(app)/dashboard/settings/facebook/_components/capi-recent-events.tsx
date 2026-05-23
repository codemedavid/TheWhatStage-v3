type LogRow = {
  id: string
  created_at: string
  status: 'sent' | 'skipped' | 'error'
  skip_reason: string | null
  event_name: string | null
  http_status: number | null
  page_name: string | null
  error_message: string | null
}

const SKIP_REASON_LABEL: Record<string, string> = {
  no_messenger_context: 'no messenger context',
  disabled: 'CAPI disabled',
  not_configured: 'not configured',
  outcome_skip: 'outcome skipped',
}

export function CapiRecentEvents({ rows }: { rows: LogRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[#E5E7EB] bg-[#F9FAFB] px-4 py-8 text-center">
        <p className="text-[13px] text-[#6B7280]">No CAPI events yet.</p>
        <p className="mt-1 text-[12px] text-[#9CA3AF]">
          Submit through an action page or use{' '}
          <span className="font-medium text-[#374151]">Send test event</span> above.
        </p>
      </div>
    )
  }

  return (
    <ul className="divide-y divide-[#F3F4F6] overflow-hidden rounded-lg border border-[#E5E7EB]">
      {rows.map((r) => (
        <li key={r.id} className="px-3 py-2.5">
          <div className="flex items-center gap-3">
            <StatusBadge status={r.status} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#111827]">
              {r.event_name ?? humanSkip(r.skip_reason) ?? '—'}
            </span>
            <span className="hidden sm:inline truncate text-[12px] text-[#6B7280]">
              {r.page_name ?? 'Unknown page'}
            </span>
            <span className="shrink-0 text-[12px] tabular-nums text-[#9CA3AF]">
              {formatTime(r.created_at)}
            </span>
          </div>
          {(r.status === 'sent' || r.status === 'error') && (
            <div className="mt-1 pl-7 text-[11px] text-[#6B7280]">
              {r.status === 'sent' ? (
                <>HTTP {r.http_status ?? '?'}</>
              ) : (
                <span className="text-[#B91C1C]">
                  {r.http_status ? `HTTP ${r.http_status} · ` : ''}
                  {r.error_message ?? 'Unknown error'}
                </span>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

function StatusBadge({ status }: { status: LogRow['status'] }) {
  if (status === 'sent') {
    return (
      <span className="inline-flex h-5 w-12 shrink-0 items-center justify-center rounded-full bg-[#ECFDF5] text-[10px] font-semibold uppercase tracking-wide text-[#047857]">
        Sent
      </span>
    )
  }
  if (status === 'skipped') {
    return (
      <span className="inline-flex h-5 w-14 shrink-0 items-center justify-center rounded-full bg-[#F3F4F6] text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">
        Skipped
      </span>
    )
  }
  return (
    <span className="inline-flex h-5 w-12 shrink-0 items-center justify-center rounded-full bg-[#FEF2F2] text-[10px] font-semibold uppercase tracking-wide text-[#B91C1C]">
      Error
    </span>
  )
}

function humanSkip(reason: string | null): string | null {
  if (!reason) return null
  return SKIP_REASON_LABEL[reason] ?? reason
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = Date.now()
  const diffMs = now - d.getTime()
  if (diffMs < 60_000) return 'just now'
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
