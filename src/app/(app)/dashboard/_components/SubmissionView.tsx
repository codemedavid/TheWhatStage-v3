type Theme = 'panel' | 'plain'

interface Props {
  kind?: string | null
  data: Record<string, unknown>
  theme?: Theme
}

export function SubmissionView({ kind, data, theme = 'panel' }: Props) {
  const muted = theme === 'panel' ? 'var(--lead-muted)' : '#6B7280'
  const ink = theme === 'panel' ? 'var(--lead-ink)' : '#111827'
  const faint = theme === 'panel' ? 'var(--lead-faint)' : '#9CA3AF'

  const rows = buildRows(kind, data)
  if (rows.length === 0) {
    return (
      <div className="text-[12px]" style={{ color: muted }}>
        (no fields)
      </div>
    )
  }

  return (
    <dl className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[140px_1fr] gap-3">
          <dt
            className="text-[11.5px] font-medium leading-snug"
            style={{ color: muted }}
          >
            {r.label}
          </dt>
          <dd
            className="text-[13px] leading-snug break-words"
            style={{ color: r.dim ? faint : ink }}
          >
            {Array.isArray(r.value) ? (
              <ul className="space-y-0.5">
                {r.value.map((v, j) => (
                  <li key={j}>{v}</li>
                ))}
              </ul>
            ) : (
              r.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

interface Row {
  label: string
  value: string | string[]
  dim?: boolean
}

function buildRows(kind: string | null | undefined, data: Record<string, unknown>): Row[] {
  switch (kind) {
    case 'qualification':
      return qualificationRows(data)
    case 'booking':
      return bookingRows(data)
    case 'catalog':
      return catalogRows(data)
    case 'form':
      return formRows(data)
    default:
      return genericRows(data)
  }
}

interface DisplayAnswer {
  questionId?: string
  prompt?: string
  value?: unknown
  display?: unknown
}

function qualificationRows(data: Record<string, unknown>): Row[] {
  const rows: Row[] = []
  const answers = data.answers

  if (Array.isArray(answers)) {
    for (let i = 0; i < answers.length; i++) {
      const a = answers[i] as DisplayAnswer
      const label = a.prompt ?? a.questionId ?? `Q${i + 1}`
      const display = a.display ?? a.value
      rows.push({ label, value: formatValue(display) })
    }
  } else if (answers && typeof answers === 'object') {
    for (const [k, v] of Object.entries(answers as Record<string, unknown>)) {
      rows.push({ label: k, value: formatValue(v) })
    }
  }

  if (typeof data.score === 'number') {
    rows.push({ label: 'Score', value: String(data.score) })
  }

  const meta = data.meta as { validation_errors?: { missing_required?: string[] } } | undefined
  const missing = meta?.validation_errors?.missing_required
  if (Array.isArray(missing) && missing.length > 0) {
    rows.push({ label: 'Missing required', value: missing.join(', '), dim: true })
  }

  return rows
}

function bookingRows(data: Record<string, unknown>): Row[] {
  const rows: Row[] = []
  if (typeof data.reason === 'string') {
    rows.push({ label: 'Status', value: humanize(data.reason) })
  }
  if (typeof data.slot_iso === 'string') {
    rows.push({ label: 'Slot', value: formatDateTime(data.slot_iso) })
  }
  const fields = data.fields
  if (fields && typeof fields === 'object') {
    for (const [k, v] of Object.entries(fields as Record<string, unknown>)) {
      rows.push({ label: humanize(k), value: formatValue(v) })
    }
  }
  return rows
}

function catalogRows(data: Record<string, unknown>): Row[] {
  const rows: Row[] = []
  const items = data.items
  if (Array.isArray(items) && items.length > 0) {
    const lines = items.map((it) => {
      const item = it as { id?: string; quantity?: number; name?: string }
      const name = item.name ?? (item.id ? `Item ${item.id.slice(0, 8)}` : 'Item')
      return `${name} × ${item.quantity ?? 1}`
    })
    rows.push({ label: `Items (${items.length})`, value: lines })
  }

  const customer = data.customer as Record<string, unknown> | undefined
  if (customer) {
    if (customer.name) rows.push({ label: 'Name', value: String(customer.name) })
    if (customer.email) rows.push({ label: 'Email', value: String(customer.email) })
    if (customer.phone) rows.push({ label: 'Phone', value: String(customer.phone) })
    if (customer.notes) rows.push({ label: 'Notes', value: String(customer.notes) })
  }

  return rows
}

function formRows(data: Record<string, unknown>): Row[] {
  const fields = data.fields
  if (!fields || typeof fields !== 'object') return genericRows(data)
  return Object.entries(fields as Record<string, unknown>).map(([k, v]) => ({
    label: humanize(k),
    value: formatValue(v),
  }))
}

function genericRows(data: Record<string, unknown>): Row[] {
  return Object.entries(data).map(([k, v]) => ({
    label: humanize(k),
    value: formatValue(v),
  }))
}

function formatValue(v: unknown): string | string[] {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) {
    if (v.length === 0) return '—'
    return v.map((x) => {
      const s = formatValue(x)
      return Array.isArray(s) ? s.join(', ') : s
    })
  }
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, val]) => val !== null && val !== undefined && val !== '')
      .map(([k, val]) => {
        const s = formatValue(val)
        return `${humanize(k)}: ${Array.isArray(s) ? s.join(', ') : s}`
      })
    return entries.length > 0 ? entries.join(' · ') : '—'
  }
  return String(v)
}

function humanize(key: string): string {
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
