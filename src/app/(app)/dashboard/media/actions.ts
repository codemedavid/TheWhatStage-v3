'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { enqueueEmbedJob } from '@/lib/rag'
import { createClient } from '@/lib/supabase/server'
import { CreateMediaFolderInput, UpdateMediaAssetInput, UpdateMediaFolderInput } from '@/lib/media/schemas'
import { makeSlug } from '@/lib/media/slug'

async function requireUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

function nullable(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export async function createMediaFolder(formData: FormData): Promise<void> {
  const input = CreateMediaFolderInput.parse({
    name: formData.get('name'),
    slug: nullable(formData.get('slug')) ?? undefined,
    description: nullable(formData.get('description')),
  })
  const { supabase, userId } = await requireUser()
  const slug = input.slug ?? makeSlug(input.name, 'folder')
  const { error } = await supabase.from('media_folders').insert({
    user_id: userId,
    name: input.name,
    slug,
    description: input.description,
  })
  if (error) throw error
  revalidatePath('/dashboard/media')
}

export async function updateMediaFolder(formData: FormData): Promise<void> {
  const input = UpdateMediaFolderInput.parse({
    id: formData.get('id'),
    name: formData.get('name'),
    slug: formData.get('slug'),
    description: nullable(formData.get('description')),
  })
  const { supabase, userId } = await requireUser()
  const { error } = await supabase
    .from('media_folders')
    .update({ name: input.name, slug: input.slug, description: input.description })
    .eq('id', input.id)
    .eq('user_id', userId)
  if (error) throw error

  const { data: assets } = await supabase
    .from('media_assets')
    .select('id, version')
    .eq('folder_id', input.id)
    .eq('user_id', userId)
    .eq('is_archived', false)
  for (const asset of assets ?? []) {
    const nextVersion = Number(asset.version ?? 0) + 1
    await supabase.from('media_assets').update({ version: nextVersion, embedding_status: 'stale' }).eq('id', asset.id)
    await enqueueEmbedJob(supabase, { kind: 'media_asset', sourceId: asset.id, userId, sourceVersion: nextVersion })
  }
  revalidatePath('/dashboard/media')
}

export async function updateMediaAsset(formData: FormData): Promise<void> {
  const input = UpdateMediaAssetInput.parse({
    id: formData.get('id'),
    folderId: formData.get('folderId'),
    name: formData.get('name'),
    slug: formData.get('slug'),
    description: nullable(formData.get('description')),
    isArchived: formData.get('isArchived') === 'on',
  })
  const { supabase, userId } = await requireUser()
  const nextVersion = Date.now()
  const { data, error } = await supabase
    .from('media_assets')
    .update({
      folder_id: input.folderId,
      name: input.name,
      slug: input.slug,
      description: input.description,
      is_archived: input.isArchived,
      version: nextVersion,
      embedding_status: input.isArchived ? 'pending' : 'stale',
    })
    .eq('id', input.id)
    .eq('user_id', userId)
    .select('id')
    .single()
  if (error) throw error
  if (!data) throw new Error('Media asset not found')
  if (input.isArchived) {
    await supabase.from('knowledge_chunks').delete().eq('media_asset_id', input.id).eq('user_id', userId)
  } else {
    await enqueueEmbedJob(supabase, { kind: 'media_asset', sourceId: input.id, userId, sourceVersion: nextVersion })
  }
  revalidatePath('/dashboard/media')
}
