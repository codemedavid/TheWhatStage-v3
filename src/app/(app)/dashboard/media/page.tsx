import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchMediaAssets, fetchMediaFolders } from './_lib/queries'
import { MediaManager } from './_components/MediaManager.client'

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const folders = await fetchMediaFolders(supabase, user.id)
  const selectedFolderId = sp.folder && folders.some((f) => f.id === sp.folder)
    ? sp.folder
    : folders[0]?.id ?? null
  const assets = await fetchMediaAssets(supabase, user.id, selectedFolderId)

  return (
    <div className="space-y-5">
      <header className="border-b border-[#E5E7EB] pb-5">
        <h1 className="text-[22px] font-semibold tracking-tight text-[#111827]">Media</h1>
        <p className="mt-1 text-[13.5px] text-[#6B7280]">
          Organize reusable images for chatbot replies. Use folder refs like #image-review and image refs like @new-review-customer-ryan in knowledge documents.
        </p>
      </header>
      <MediaManager folders={folders} assets={assets} selectedFolderId={selectedFolderId} />
    </div>
  )
}
