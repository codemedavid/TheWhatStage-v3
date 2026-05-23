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

function statusIcon(status: LogRow['status']) {
  if (status === 'sent') return '✓'
  if (status === 'skipped') return '⊘'
  return '✗'
}

export function CapiRecentEvents({ rows }: { rows: LogRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic">
        No CAPI events yet. Submit through an action page or use &quot;Send test event&quot;.
      </p>
    )
  }
  return (
    <ul className="space-y-1 text-sm font-mono">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center gap-2">
          <span aria-hidden>{statusIcon(r.status)}</span>
          <time className="text-xs text-muted-foreground">
            {new Date(r.created_at).toLocaleTimeString()}
          </time>
          <span className="text-xs text-muted-foreground">{r.page_name ?? '—'}</span>
          <span>·</span>
          <span>{r.event_name ?? r.skip_reason ?? '—'}</span>
          <span>·</span>
          <span>
            {r.status === 'sent'
              ? `sent (HTTP ${r.http_status ?? '?'})`
              : r.status === 'error'
                ? `error ${r.http_status ?? ''} ${r.error_message ?? ''}`.trim()
                : `skipped (${r.skip_reason ?? '?'})`}
          </span>
        </li>
      ))}
    </ul>
  )
}
