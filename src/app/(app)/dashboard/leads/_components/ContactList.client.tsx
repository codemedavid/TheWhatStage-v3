'use client'
import { useState } from 'react'
import { LeadDrawer } from './LeadDrawer'
import type { ContactLeadRow, StageRow, FieldDefRow, CampaignOption } from '../_lib/queries'
import { Pagination } from './Pagination'
import type { LeadsQuery } from '../_lib/schemas'

function relativeAge(iso: string | null): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days < 1) return 'today'
  if (days === 1) return '1d ago'
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

function sourceLabel(s: string): string {
  switch (s) {
    case 'messenger': return 'Messenger'
    case 'form':      return 'Form'
    case 'booking':   return 'Booking'
    case 'catalog':   return 'Catalog'
    case 'manual':    return 'Manual'
    default:          return s
  }
}

export function ContactListClient({
  rows, total, stages, fieldDefs, campaigns, page, params,
}: {
  rows: ContactLeadRow[]
  total: number
  stages: StageRow[]
  fieldDefs: FieldDefRow[]
  campaigns: CampaignOption[]
  page: number
  params: LeadsQuery
}) {
  const [editing, setEditing] = useState<ContactLeadRow | null>(null)

  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? '—'

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value) } catch { /* clipboard unavailable */ }
  }

  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{
        background: 'var(--lead-surface)',
        border: '1px solid var(--lead-line)',
        boxShadow: 'var(--lead-shadow-sm)',
      }}
    >
      <div className="overflow-x-auto lead-scroll">
        <table className="w-full text-[13px]">
          <thead
            className="sticky top-0 z-[1]"
            style={{ background: 'var(--lead-surface-2)', borderBottom: '1px solid var(--lead-line)' }}
          >
            <tr style={{ color: 'var(--lead-muted)' }}>
              <th className="px-3 py-2.5 text-left">Name</th>
              <th className="px-3 py-2.5 text-left">Phone</th>
              <th className="px-3 py-2.5 text-left">Email</th>
              <th className="px-3 py-2.5 text-left">Last contact</th>
              <th className="px-3 py-2.5 text-left">Campaign</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-12 text-center" style={{ color: 'var(--lead-muted)' }}>
                  <div className="text-[14px] font-medium" style={{ color: 'var(--lead-ink)' }}>
                    No reachable leads
                  </div>
                  <div className="mt-1 text-[12px]">
                    No leads match the current contact filter.
                  </div>
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer hover:bg-[color:var(--lead-surface-2)]"
                style={{ borderTop: '1px solid var(--lead-line)' }}
                onClick={() => setEditing(r)}
              >
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    {r.picture_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.picture_url} alt="" className="h-6 w-6 rounded-full object-cover" />
                    ) : (
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--lead-surface-2)] text-[10px]" style={{ color: 'var(--lead-muted)' }}>
                        {r.name.slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <div className="flex flex-col">
                      <span style={{ color: 'var(--lead-ink)' }}>{r.name}</span>
                      <span className="text-[11px]" style={{ color: 'var(--lead-muted)' }}>{stageName(r.stage_id)}</span>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  {r.latest_phone ? (
                    <div className="flex flex-col" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <a href={`tel:${r.latest_phone.value}`} className="hover:underline" style={{ color: 'var(--lead-ink)' }}>
                          {r.latest_phone.value}
                        </a>
                        <button
                          type="button"
                          onClick={() => copy(r.latest_phone!.value)}
                          className="text-[11px] underline"
                          style={{ color: 'var(--lead-muted)' }}
                        >
                          copy
                        </button>
                      </div>
                      <span className="text-[11px]" style={{ color: 'var(--lead-muted)' }}>
                        {relativeAge(r.latest_phone.collected_at)} · {sourceLabel(r.latest_phone.source)}
                      </span>
                    </div>
                  ) : (
                    <span style={{ color: 'var(--lead-faint)' }}>—</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {r.latest_email ? (
                    <div className="flex flex-col" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-2">
                        <a href={`mailto:${r.latest_email.value}`} className="hover:underline" style={{ color: 'var(--lead-ink)' }}>
                          {r.latest_email.value}
                        </a>
                        <button
                          type="button"
                          onClick={() => copy(r.latest_email!.value)}
                          className="text-[11px] underline"
                          style={{ color: 'var(--lead-muted)' }}
                        >
                          copy
                        </button>
                      </div>
                      <span className="text-[11px]" style={{ color: 'var(--lead-muted)' }}>
                        {relativeAge(r.latest_email.collected_at)} · {sourceLabel(r.latest_email.source)}
                      </span>
                    </div>
                  ) : (
                    <span style={{ color: 'var(--lead-faint)' }}>—</span>
                  )}
                </td>
                <td className="px-3 py-2.5" style={{ color: 'var(--lead-muted)' }}>
                  {relativeAge(r.latest_contact_at)}
                </td>
                <td className="px-3 py-2.5" style={{ color: 'var(--lead-muted)' }}>
                  {r.campaign_name ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination total={total} page={page} makeHref={(p) => buildHref(params, p)} />

      {editing && (
        <LeadDrawer
          mode="edit"
          lead={editing}
          stages={stages}
          fieldDefs={fieldDefs}
          campaigns={campaigns}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function buildHref(params: LeadsQuery, page: number) {
  const u = new URLSearchParams()
  u.set('view', 'contact')
  if (params.q) u.set('q', params.q)
  u.set('range', params.range)
  if (params.from) u.set('from', params.from)
  if (params.to) u.set('to', params.to)
  u.set('contact_filter', params.contact_filter)
  u.set('contact_sort', params.contact_sort)
  u.set('page', String(page))
  return `/dashboard/leads?${u.toString()}`
}
