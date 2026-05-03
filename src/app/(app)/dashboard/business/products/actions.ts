'use server'

import { after } from 'next/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { ProductFormInput } from '@/lib/business/schemas'
import { buildProductRagText } from '@/lib/business/product-rag'
import { enqueueEmbedJob } from '@/lib/rag'
import { processSourceInline } from '@/lib/rag/process-now'
import { createClient } from '@/lib/supabase/server'

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, userId: user.id }
}

function parseJsonField<T>(value: FormDataEntryValue | null, fallback: T): T {
  if (typeof value !== 'string' || value.trim() === '') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function nullable(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

async function finishActiveProductEmbedJobs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: { productId: string; userId: string; reason: string },
) {
  await supabase
    .from('knowledge_embedding_jobs')
    .update({
      status: 'done',
      finished_at: new Date().toISOString(),
      last_error: args.reason,
    })
    .eq('business_item_id', args.productId)
    .eq('user_id', args.userId)
    .in('status', ['queued', 'running'])
}

export async function createProduct(): Promise<void> {
  const { supabase, userId } = await requireUser()
  const { data, error } = await supabase
    .from('business_items')
    .insert({
      user_id: userId,
      kind: 'product',
      title: 'Untitled product',
      slug: `product-${Date.now()}`,
      status: 'draft',
      currency: 'PHP',
      pricing_model: 'fixed',
      details: {},
      recommendation_hints: {},
      tags: [],
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(error?.message ?? 'create product failed')
  revalidatePath('/dashboard/business/products')
  redirect(`/dashboard/business/products/${data.id}`)
}

export async function saveProduct(formData: FormData): Promise<void> {
  const input = ProductFormInput.parse({
    id: formData.get('id') || undefined,
    title: formData.get('title'),
    slug: formData.get('slug'),
    status: formData.get('status'),
    summary: nullable(formData.get('summary')),
    description: nullable(formData.get('description')),
    price_amount: nullable(formData.get('price_amount')),
    compare_at_amount: nullable(formData.get('compare_at_amount')),
    currency: formData.get('currency') || 'PHP',
    pricing_model: formData.get('pricing_model') || 'fixed',
    sku: nullable(formData.get('sku')),
    inventory_status: formData.get('inventory_status') || 'not_tracked',
    tags: parseJsonField(formData.get('tags'), []),
    details: parseJsonField(formData.get('details'), {}),
    recommendation_hints: parseJsonField(formData.get('recommendation_hints'), {}),
    rag_enabled: formData.get('rag_enabled') === 'on',
  })
  if (!input.id) throw new Error('Product id is required')

  const { supabase, userId } = await requireUser()
  const ragText = buildProductRagText(input)
  const nextVersion = Date.now()
  const publishedAt = input.status === 'published' ? new Date().toISOString() : null

  const { data: updated, error } = await supabase
    .from('business_items')
    .update({
      title: input.title,
      slug: input.slug,
      status: input.status,
      summary: input.summary,
      description: input.description,
      price_amount: input.price_amount,
      compare_at_amount: input.compare_at_amount,
      currency: input.currency,
      pricing_model: input.pricing_model,
      sku: input.sku,
      inventory_status: input.inventory_status,
      tags: input.tags,
      details: input.details,
      recommendation_hints: input.recommendation_hints,
      rag_enabled: input.rag_enabled,
      rag_text: ragText,
      version: nextVersion,
      embedding_status: input.status === 'published' && input.rag_enabled ? 'stale' : 'pending',
      published_at: publishedAt,
    })
    .eq('id', input.id)
    .eq('user_id', userId)
    .eq('kind', 'product')
    .select('id')
    .single<{ id: string }>()
  if (error) throw error
  if (!updated) throw new Error('Product not found')

  if (input.status === 'published' && input.rag_enabled) {
    const productId = input.id
    await enqueueEmbedJob(supabase, {
      kind: 'business_item',
      sourceId: productId,
      userId,
      sourceVersion: nextVersion,
    })
    after(async () => {
      try {
        await processSourceInline({ kind: 'business_item', sourceId: productId })
      } catch (e) {
        console.error('[saveProduct] inline embed failed', e)
      }
    })
  } else {
    await supabase.from('knowledge_chunks').delete().eq('business_item_id', input.id).eq('user_id', userId)
    await finishActiveProductEmbedJobs(supabase, {
      productId: input.id,
      userId,
      reason: 'Product is not published or RAG-enabled',
    })
  }

  revalidatePath('/dashboard/business/products')
  revalidatePath(`/dashboard/business/products/${input.id}`)
}

export async function deleteProduct(formData: FormData): Promise<void> {
  const id = String(formData.get('id') ?? '')
  if (!id) throw new Error('Product id is required')
  const { supabase, userId } = await requireUser()
  const { data: deleted, error } = await supabase
    .from('business_items')
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .eq('kind', 'product')
    .select('id')
    .single<{ id: string }>()
  if (error) throw error
  if (!deleted) throw new Error('Product not found')
  revalidatePath('/dashboard/business/products')
  redirect('/dashboard/business/products')
}
