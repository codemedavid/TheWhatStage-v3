import type { LeadRow, StageRow, FieldDefRow } from './queries'

const CORE_COLUMNS = [
  'id', 'name', 'email', 'phone', 'company', 'job_title',
  'source', 'estimated_value', 'notes', 'stage', 'created_at', 'updated_at',
] as const

function escape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function leadsToCsv(
  leads: LeadRow[],
  stages: StageRow[],
  fieldDefs: FieldDefRow[],
): string {
  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? ''
  const cfHeaders = fieldDefs.map((f) => f.key)
  const headers = [...CORE_COLUMNS, ...cfHeaders]

  const lines = [headers.join(',')]
  for (const l of leads) {
    const row = [
      l.id, l.name, l.email, l.phone, l.company, l.job_title,
      l.source, l.estimated_value, l.notes, stageName(l.stage_id),
      l.created_at, l.updated_at,
      ...cfHeaders.map((k) => l.custom_fields?.[k]),
    ]
    lines.push(row.map(escape).join(','))
  }
  return lines.join('\n')
}
