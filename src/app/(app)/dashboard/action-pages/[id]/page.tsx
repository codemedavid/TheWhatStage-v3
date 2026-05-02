import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchActionPage, fetchPipelineStages } from '../_lib/queries'
import { EditActionPageShell } from '../_components/EditActionPageShell'

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

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [page, stages] = await Promise.all([
    fetchActionPage(supabase, user.id, id),
    fetchPipelineStages(supabase, user.id),
  ])
  if (!page) notFound()

  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '')
  const publicUrl = `${baseUrl}/a/${page.slug}`
  const embedUrl = `${baseUrl}/a/${page.slug}/embed`
  const embedSnippet = `<iframe src="${embedUrl}" width="100%" height="640" frameborder="0"></iframe>`

  return (
    <EditActionPageShell
      page={page}
      stages={stages}
      publicUrl={publicUrl}
      embedUrl={embedUrl}
      embedSnippet={embedSnippet}
      saved={saved}
      errorBanner={errorBanner}
    />
  )
}
