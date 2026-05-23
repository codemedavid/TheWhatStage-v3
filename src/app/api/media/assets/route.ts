import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface AssetRow {
  id: string
  name: string
  slug: string
  storage_path: string
  mime_type: string
  is_archived: boolean
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('media_assets')
    .select('id, name, slug, storage_path, mime_type, is_archived')
    .eq('user_id', user.id)
    .eq('is_archived', false)
    .order('updated_at', { ascending: false })
    .limit(200)
    .returns<AssetRow[]>()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const signed = await Promise.all(
    (data ?? []).map(async (row) => {
      const { data: s } = await supabase.storage
        .from('media-assets')
        .createSignedUrl(row.storage_path, 3600)
      return { id: row.id, name: row.name, slug: row.slug, mime_type: row.mime_type, thumbUrl: s?.signedUrl ?? null }
    }),
  )
  return NextResponse.json({ assets: signed })
}
