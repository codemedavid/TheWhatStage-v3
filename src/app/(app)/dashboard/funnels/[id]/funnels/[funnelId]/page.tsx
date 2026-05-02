import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  fetchActionPageOptions,
  fetchCampaign,
  fetchCampaignFunnels,
  fetchFunnel,
  fetchLeadFieldOptions,
} from '../../../_lib/queries'
import { FunnelEditorShell } from '../../../_components/FunnelEditorShell'
import '../../../funnels.css'

export default async function FunnelEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; funnelId: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id, funnelId } = await params
  const sp = await searchParams

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [campaign, funnel] = await Promise.all([
    fetchCampaign(supabase, user.id, id),
    fetchFunnel(supabase, user.id, funnelId),
  ])
  if (!campaign || !funnel || funnel.campaign_id !== campaign.id) notFound()

  const [actionPages, leadFields, siblings] = await Promise.all([
    fetchActionPageOptions(supabase, user.id),
    fetchLeadFieldOptions(supabase, user.id),
    fetchCampaignFunnels(supabase, user.id, id),
  ])

  const error = typeof sp.error === 'string' ? sp.error : null
  const detail = typeof sp.detail === 'string' ? sp.detail : null
  const saved = sp.saved === '1'
  const banner = error
    ? { kind: 'error' as const, text: detail ? `${error} — ${detail}` : error }
    : saved
      ? { kind: 'saved' as const, text: 'Funnel saved.' }
      : null

  return (
    <FunnelEditorShell
      campaign={campaign}
      funnel={funnel}
      actionPages={actionPages}
      leadFields={leadFields}
      siblings={siblings.filter((f) => f.id !== funnel.id)}
      banner={banner}
    />
  )
}
