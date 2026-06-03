import { getSession } from '@/lib/auth/get-session'
import { createClient } from '@/lib/supabase/server'
import DashboardClient, {
  type DashStats,
  type RecentSubmission,
} from './_components/DashboardClient'
import SuperadminDashboard from './_components/SuperadminDashboard'

export default async function DashboardPage() {
  const session = await getSession()
  const userId = session?.userId ?? ''
  const userName = session?.fullName ?? 'there'

  if (session?.role === 'superadmin') {
    return <SuperadminDashboard userName={userName} />
  }

  const supabase = await createClient()

  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const startOfMonth = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()

  /* ── 1. Fetch user's action page IDs (needed for submission queries) ── */
  const { data: userPages } = await supabase
    .from('action_pages')
    .select('id, status, title')
    .eq('user_id', userId)

  const allPageIds = (userPages ?? []).map(p => p.id)
  const hasActiveActionPages = (userPages ?? []).some(p => p.status === 'published')

  /* ── 2. Parallel queries ── */
  const [
    personalityResult,
    facebookResult,
    businessResult,
    knowledgeDocsResult,
    knowledgeFaqsResult,
    bookingsTodayResult,
    bookingsWeekResult,
    submissionsMonthResult,
    recentResult,
  ] = await Promise.all([
    supabase
      .from('chatbot_configs')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle(),

    supabase
      .from('facebook_connections')
      .select('id, facebook_pages(id)')
      .eq('user_id', userId)
      .maybeSingle(),

    // "Tell us about your business" — completed once business_basics is saved
    // (set during the /onboarding/business step).
    supabase
      .from('onboarding_state')
      .select('business_completed_at, business_basics')
      .eq('profile_id', userId)
      .maybeSingle(),

    // "Add your knowledge" — done when the user has at least one doc or FAQ.
    supabase
      .from('knowledge_documents')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),

    supabase
      .from('knowledge_faqs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),

    allPageIds.length > 0
      ? supabase
          .from('action_page_submissions')
          .select('id', { count: 'exact', head: true })
          .in('action_page_id', allPageIds)
          .gte('created_at', startOfToday)
      : Promise.resolve({ count: 0 }),

    allPageIds.length > 0
      ? supabase
          .from('action_page_submissions')
          .select('id', { count: 'exact', head: true })
          .in('action_page_id', allPageIds)
          .gte('created_at', startOfWeek)
      : Promise.resolve({ count: 0 }),

    allPageIds.length > 0
      ? supabase
          .from('action_page_submissions')
          .select('id', { count: 'exact', head: true })
          .in('action_page_id', allPageIds)
          .gte('created_at', startOfMonth)
      : Promise.resolve({ count: 0 }),

    allPageIds.length > 0
      ? supabase
          .from('action_page_submissions')
          .select('id, data, created_at, action_page_id')
          .in('action_page_id', allPageIds)
          .order('created_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),
  ])

  const hasPersonality = !!personalityResult.data

  const fbConn = facebookResult.data as { id: string; facebook_pages: { id: string }[] } | null
  const hasFacebook = !!(fbConn && Array.isArray(fbConn.facebook_pages) && fbConn.facebook_pages.length > 0)

  const biz = businessResult.data as { business_completed_at: string | null; business_basics: unknown } | null
  const hasBusiness = !!(biz && (biz.business_completed_at || (biz.business_basics && Object.keys(biz.business_basics as object).length > 0)))

  const hasKnowledge = (knowledgeDocsResult.count ?? 0) > 0 || (knowledgeFaqsResult.count ?? 0) > 0

  const stats: DashStats = {
    bookingsToday: bookingsTodayResult.count ?? 0,
    bookingsWeek: bookingsWeekResult.count ?? 0,
    leadsWeek: bookingsWeekResult.count ?? 0,
    submissionsMonth: submissionsMonthResult.count ?? 0,
  }

  /* Build page title lookup */
  const pageTitleById = Object.fromEntries(
    (userPages ?? []).map(p => [p.id, p.title ?? 'Action page'])
  )

  const recentSubmissions: RecentSubmission[] = ((recentResult.data ?? []) as {
    id: string
    data: Record<string, unknown>
    created_at: string
    action_page_id: string
  }[]).map(row => ({
    id: row.id,
    name:
      (row.data?.full_name as string | undefined) ??
      (row.data?.name as string | undefined) ??
      null,
    actionPageTitle: pageTitleById[row.action_page_id] ?? 'Action page',
    createdAt: row.created_at,
  }))

  return (
    <DashboardClient
      userName={userName}
      hasBusiness={hasBusiness}
      hasKnowledge={hasKnowledge}
      hasPersonality={hasPersonality}
      hasActiveActionPages={hasActiveActionPages}
      hasFacebook={hasFacebook}
      stats={stats}
      recentSubmissions={recentSubmissions}
    />
  )
}
