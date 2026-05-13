import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchActionPage, fetchPipelineStages, fetchActionPageOptions } from '../_lib/queries'
import { seedDefaultStagesIfEmpty } from '../../leads/_lib/seed'
import { EditActionPageShell } from '../_components/EditActionPageShell'
import { PublishedPrimaryGoalBanner } from '../_components/PublishedPrimaryGoalBanner'

export default async function ActionPageEditor({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  const error = typeof sp.error === 'string' ? sp.error : null
  const detail = typeof sp.detail === 'string' ? sp.detail : null
  const saved = sp.saved === '1'
  const errorBanner = error ? (detail ? `${error} — ${detail}` : error) : null
  const justPublished = sp.just_published === '1'
  const offerMode: 'offer' | 'switch' | null =
    sp.offer_primary === 'switch'
      ? 'switch'
      : sp.offer_primary === '1'
        ? 'offer'
        : null

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  await seedDefaultStagesIfEmpty(supabase, user.id)

  const [page, stages, actionPages] = await Promise.all([
    fetchActionPage(supabase, user.id, id),
    fetchPipelineStages(supabase, user.id),
    fetchActionPageOptions(supabase, user.id),
  ])
  if (!page) notFound()

  let currentGoalTitle: string | null = null
  if (justPublished && offerMode === 'switch') {
    const { data: cfg } = await supabase
      .from('chatbot_configs')
      .select('primary_action_page_id')
      .eq('user_id', user.id)
      .maybeSingle<{ primary_action_page_id: string | null }>()
    if (cfg?.primary_action_page_id) {
      const { data: cur } = await supabase
        .from('action_pages')
        .select('title')
        .eq('id', cfg.primary_action_page_id)
        .maybeSingle<{ title: string }>()
      currentGoalTitle = cur?.title ?? null
    }
  }

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  const publicUrl = `${baseUrl}/a/${page.slug}`
  const embedUrl = `${baseUrl}/a/${page.slug}/embed`
  const embedSnippet = `<iframe src="${embedUrl}" width="100%" height="640" frameborder="0"></iframe>`

  return (
    <>
      {justPublished && offerMode && (
        <PublishedPrimaryGoalBanner
          actionPageId={page.id}
          mode={offerMode}
          currentGoalTitle={currentGoalTitle}
        />
      )}
      <EditActionPageShell
        page={page}
        stages={stages}
        actionPages={actionPages}
        publicUrl={publicUrl}
        embedUrl={embedUrl}
        embedSnippet={embedSnippet}
        saved={saved}
        errorBanner={errorBanner}
      />
    </>
  )
}
