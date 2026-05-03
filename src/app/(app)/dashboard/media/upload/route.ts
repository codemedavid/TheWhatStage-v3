import { NextResponse } from 'next/server'
import { enqueueEmbedJob } from '@/lib/rag'
import { makeSlug } from '@/lib/media/slug'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const form = await req.formData()
  const folderId = String(form.get('folderId') ?? '')
  const sharedDescription = String(form.get('sharedDescription') ?? '').trim()
  const files = form.getAll('files').filter((entry): entry is File => entry instanceof File)
  if (!folderId) return NextResponse.json({ error: 'folderId is required' }, { status: 400 })
  if (files.length === 0) return NextResponse.json({ error: 'No images selected' }, { status: 400 })

  const { data: folder, error: folderErr } = await supabase
    .from('media_folders')
    .select('id, name, slug, description')
    .eq('id', folderId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (folderErr || !folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 })

  const created: string[] = []
  try {
    for (const file of files) {
      if (!ALLOWED.has(file.type)) {
        return NextResponse.json({ error: `${file.name} is not a supported image` }, { status: 400 })
      }
      const assetName = file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Image'
      const assetSlug = `${makeSlug(assetName, 'image', 90)}-${Date.now().toString(36)}`
      const { data: inserted, error: insertErr } = await supabase
        .from('media_assets')
        .insert({
          user_id: user.id,
          folder_id: folder.id,
          name: assetName,
          slug: assetSlug,
          description: sharedDescription || null,
          storage_path: 'pending',
          mime_type: file.type,
          byte_size: file.size,
          version: Date.now(),
        })
        .select('id, version')
        .single()
      if (insertErr || !inserted) throw insertErr ?? new Error('Media insert failed')

      const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '')
      const path = `${user.id}/${folder.id}/${inserted.id}-${safeName || 'image'}`
      const { error: uploadErr } = await supabase.storage.from('media-assets').upload(path, file, {
        cacheControl: '31536000',
        upsert: false,
        contentType: file.type,
      })
      if (uploadErr) throw uploadErr
      created.push(path)

      const { error: updateErr } = await supabase
        .from('media_assets')
        .update({ storage_path: path, embedding_status: 'stale' })
        .eq('id', inserted.id)
      if (updateErr) throw updateErr
      await enqueueEmbedJob(supabase, {
        kind: 'media_asset',
        sourceId: inserted.id,
        userId: user.id,
        sourceVersion: inserted.version,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    for (const path of created) await supabase.storage.from('media-assets').remove([path])
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Upload failed' }, { status: 500 })
  }
}
