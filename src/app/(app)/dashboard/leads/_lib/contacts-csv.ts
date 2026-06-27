import type { ContactLeadRow, StageRow, FieldDefRow } from './queries'

/**
 * A contact row enriched for export: the on-screen contact data plus the stage
 * name of the lead's most recent project (null when the lead has no projects).
 */
export type ContactExportRow = ContactLeadRow & { project_status: string | null }

const CORE_COLUMNS = [
  'id', 'name', 'phones', 'emails',
  'latest_phone', 'latest_phone_source', 'latest_email', 'latest_email_source',
  'last_contact_at', 'company', 'job_title', 'source', 'estimated_value',
  'lead_stage', 'project_status', 'campaign', 'notes', 'created_at', 'updated_at',
] as const

const PHONE_SEPARATOR = '; '

function escape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

// All known phone numbers, preferring the multi-value `phones` array and
// falling back to the legacy single `phone` field when the array is empty.
function allPhones(row: ContactExportRow): string {
  if (row.phones && row.phones.length > 0) return row.phones.join(PHONE_SEPARATOR)
  return row.phone ?? ''
}

function allEmails(row: ContactExportRow): string {
  if (row.emails && row.emails.length > 0) return row.emails.join(PHONE_SEPARATOR)
  return row.email ?? ''
}

/**
 * Serialise contact rows to CSV. Exports every reachable phone/email plus the
 * lead's pipeline stage and most recent project status, followed by any custom
 * field columns. Pure: all data must be resolved by the caller.
 */
export function contactsToCsv(
  rows: ContactExportRow[],
  stages: StageRow[],
  fieldDefs: FieldDefRow[],
): string {
  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? ''
  const cfHeaders = fieldDefs.map((f) => f.key)
  const headers = [...CORE_COLUMNS, ...cfHeaders]

  const lines = [headers.join(',')]
  for (const r of rows) {
    const row = [
      r.id, r.name, allPhones(r), allEmails(r),
      r.latest_phone?.value ?? '', r.latest_phone?.source ?? '',
      r.latest_email?.value ?? '', r.latest_email?.source ?? '',
      r.latest_contact_at, r.company, r.job_title, r.source, r.estimated_value,
      stageName(r.stage_id), r.project_status, r.campaign_name, r.notes,
      r.created_at, r.updated_at,
      ...cfHeaders.map((k) => r.custom_fields?.[k]),
    ]
    lines.push(row.map(escape).join(','))
  }
  return lines.join('\n')
}
