import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  fetchActionPageOptions,
  fetchCampaign,
  fetchCampaignFunnels,
  fetchCampaignLeads,
  type CampaignLeadRow,
} from '../_lib/queries'
import { CampaignEditor } from '../_components/CampaignEditor'
import '../funnels.css'

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const campaign = await fetchCampaign(supabase, user.id, id)
  if (!campaign) notFound()

  const [funnels, actionPages, leads] = await Promise.all([
    fetchCampaignFunnels(supabase, user.id, id),
    fetchActionPageOptions(supabase, user.id),
    fetchCampaignLeads(supabase, user.id, id),
  ])

  const error = typeof sp.error === 'string' ? sp.error : null
  const detail = typeof sp.detail === 'string' ? sp.detail : null
  const saved = sp.saved === '1'
  const banner = error
    ? { kind: 'error' as const, text: detail ? `${error} — ${detail}` : error }
    : saved
      ? { kind: 'saved' as const, text: 'Campaign saved.' }
      : null

  return (
    <>
      <CampaignEditor
        campaign={campaign}
        funnels={funnels}
        actionPages={actionPages}
        banner={banner}
      />
      <CampaignLeadsSection leads={leads} />
    </>
  )
}

function CampaignLeadsSection({ leads }: { leads: CampaignLeadRow[] }) {
  return (
    <div data-funnels-root>
      <div className="fn-wrap" style={{ marginTop: 0 }}>
        <section
          style={{
            background: 'var(--fn-surface, #fff)',
            border: '1px solid var(--fn-line, #e5e7eb)',
            borderRadius: 16,
            padding: 20,
            marginBottom: 24,
          }}
        >
          <header
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: 8,
              marginBottom: 12,
            }}
          >
            <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>
              Leads on this campaign
            </h2>
            <span style={{ fontSize: 12, color: '#6b7280' }}>
              {leads.length === 0
                ? 'None yet'
                : `${leads.length}${leads.length === 50 ? '+' : ''}`}
            </span>
          </header>
          {leads.length === 0 ? (
            <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>
              New leads with assignment_mode &ldquo;random&rdquo; on an active
              campaign will land here automatically. You can also assign a lead
              manually from the leads drawer.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#6b7280' }}>
                    <th style={{ padding: '6px 8px', fontWeight: 500 }}>Name</th>
                    <th style={{ padding: '6px 8px', fontWeight: 500 }}>Company</th>
                    <th style={{ padding: '6px 8px', fontWeight: 500 }}>Stage</th>
                    <th style={{ padding: '6px 8px', fontWeight: 500, textAlign: 'right' }}>
                      Created
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map((l) => (
                    <tr
                      key={l.id}
                      style={{ borderTop: '1px solid var(--fn-line, #e5e7eb)' }}
                    >
                      <td style={{ padding: '8px', color: '#111827', fontWeight: 500 }}>
                        {l.name}
                      </td>
                      <td style={{ padding: '8px', color: '#374151' }}>
                        {l.company ?? '—'}
                      </td>
                      <td style={{ padding: '8px', color: '#374151' }}>
                        {l.stage_name ?? '—'}
                      </td>
                      <td
                        style={{
                          padding: '8px',
                          textAlign: 'right',
                          color: '#6b7280',
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {new Date(l.created_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
