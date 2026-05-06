import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchCategories, fetchDocument, fetchTags } from '../_lib/queries'
import { fetchMediaAssets, fetchMediaFolders } from '@/app/(app)/dashboard/media/_lib/queries'
import { DocumentEditor } from '../_components/DocumentEditor.client'

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [doc, categories, tags, mediaFolders, mediaAssets] = await Promise.all([
    fetchDocument(supabase, user.id, id),
    fetchCategories(supabase, user.id),
    fetchTags(supabase, user.id),
    fetchMediaFolders(supabase, user.id),
    fetchMediaAssets(supabase, user.id, null),
  ])

  if (!doc) notFound()

  return (
    <DocumentEditor
      doc={doc}
      categories={categories}
      tags={tags}
      mediaFolders={mediaFolders}
      mediaAssets={mediaAssets}
    />
  )
}
