import type { SupabaseClient } from '@supabase/supabase-js'
import type { RealestateConfig } from '@/app/a/[slug]/_kinds/realestate/schema'
import type { SalesConfig } from '@/app/a/[slug]/_kinds/sales/schema'
import { buildPropertyRagText, propertySlug } from './property-rag-text'
import { buildSalesRagText } from './sales-rag-text'
import { enqueueEmbedJob } from '@/lib/rag/queue'

/**
 * Upsert all non-draft properties from a realestate action page into
 * `business_items` and queue embedding jobs. Archives items for properties
 * that were removed from the config.
 */
export async function syncRealestateToBusinessItems(
  supabase: SupabaseClient,
  userId: string,
  actionPageId: string,
  config: RealestateConfig,
): Promise<void> {
  const activeProperties = config.properties.filter((p) => p.status !== 'draft' && p.title.trim())
  const activeSlugs = activeProperties.map((p) => propertySlug(p.id))

  for (const prop of activeProperties) {
    const slug = propertySlug(prop.id)
    const ragText = buildPropertyRagText(prop)
    const title = prop.title.trim().slice(0, 160) || 'Untitled Property'

    const { data: upserted, error } = await supabase
      .from('business_items')
      .upsert(
        {
          user_id: userId,
          action_page_id: actionPageId,
          kind: 'property',
          status: 'published',
          title,
          slug,
          summary: [
            prop.address.city,
            prop.address.region,
          ].filter(Boolean).join(', ') || null,
          description: prop.description.slice(0, 8000) || null,
          price_amount: prop.price.amount,
          currency: prop.price.currency || 'PHP',
          pricing_model: 'fixed',
          rag_enabled: true,
          rag_text: ragText,
          details: {
            property_status: prop.status,
            address: prop.address,
            specs: prop.specs,
            amenities: prop.amenities,
          },
          // version is handled by the DB trigger (set_updated_at) — bump via separate update
        },
        { onConflict: 'user_id,kind,slug', ignoreDuplicates: false },
      )
      .select('id, version')
      .maybeSingle<{ id: string; version: number }>()

    if (error) {
      console.error('[rag.sync.realestate] upsert failed', { slug, error: error.message })
      continue
    }
    if (!upserted) continue

    // Bump version so the embed worker treats this as a new revision
    const { data: bumped } = await supabase
      .from('business_items')
      .update({ version: (upserted.version ?? 0) + 1, embedding_status: 'pending' })
      .eq('id', upserted.id)
      .eq('user_id', userId)
      .select('version')
      .single<{ version: number }>()

    const version = bumped?.version ?? (upserted.version ?? 0) + 1

    await enqueueEmbedJob(supabase, {
      kind: 'business_item',
      sourceId: upserted.id,
      userId,
      sourceVersion: version,
    }).catch((err) => {
      console.error('[rag.sync.realestate] enqueue failed', { sourceId: upserted.id, err: String(err) })
    })
  }

  // Archive items for properties that were removed from the config
  const activeSlugSet = new Set(activeSlugs)
  const { data: existingItems } = await supabase
    .from('business_items')
    .select('id, slug')
    .eq('user_id', userId)
    .eq('action_page_id', actionPageId)
    .eq('kind', 'property')
    .neq('status', 'archived')

  const orphanIds = (existingItems ?? [])
    .filter((item: { id: string; slug: string }) => !activeSlugSet.has(item.slug))
    .map((item: { id: string; slug: string }) => item.id)

  if (orphanIds.length > 0) {
    await supabase
      .from('business_items')
      .update({ status: 'archived', rag_enabled: false, embedding_status: 'pending' })
      .in('id', orphanIds)
      .eq('user_id', userId)
  }
}

/**
 * Upsert the sales product from a sales action page into `business_items`
 * and queue an embedding job. Uses the action_page_id + kind='service' for stable lookup.
 */
export async function syncSalesToBusinessItems(
  supabase: SupabaseClient,
  userId: string,
  actionPageId: string,
  actionPageSlug: string,
  config: SalesConfig,
): Promise<void> {
  const name = config.product.name.trim()
  if (!name) return

  const ragText = buildSalesRagText(config)
  if (!ragText) return

  const title = name.slice(0, 160)

  const { data: upserted, error } = await supabase
    .from('business_items')
    .upsert(
      {
        user_id: userId,
        action_page_id: actionPageId,
        kind: 'service',
        status: 'published',
        title,
        slug: actionPageSlug,
        summary: config.product.headline.slice(0, 280) || null,
        description: config.product.description.slice(0, 8000) || null,
        price_amount: config.price.amount,
        compare_at_amount: config.price.compare_at_amount,
        currency: config.price.currency || 'PHP',
        pricing_model: 'fixed',
        rag_enabled: true,
        rag_text: ragText,
        details: { product_type: config.product.type, delivery_type: config.delivery.type },
      },
      { onConflict: 'user_id,kind,slug', ignoreDuplicates: false },
    )
    .select('id, version')
    .maybeSingle<{ id: string; version: number }>()

  if (error) {
    console.error('[rag.sync.sales] upsert failed', { slug: actionPageSlug, error: error.message })
    return
  }
  if (!upserted) return

  const { data: bumped } = await supabase
    .from('business_items')
    .update({ version: (upserted.version ?? 0) + 1, embedding_status: 'pending' })
    .eq('id', upserted.id)
    .eq('user_id', userId)
    .select('version')
    .single<{ version: number }>()

  const version = bumped?.version ?? (upserted.version ?? 0) + 1

  await enqueueEmbedJob(supabase, {
    kind: 'business_item',
    sourceId: upserted.id,
    userId,
    sourceVersion: version,
  }).catch((err) => {
    console.error('[rag.sync.sales] enqueue failed', { sourceId: upserted.id, err: String(err) })
  })
}
