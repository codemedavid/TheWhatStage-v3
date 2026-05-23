// src/lib/chatbot/source-images.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export interface RetrievedChunk {
  document_id: string | null;
  faq_id: string | null;
  business_item_id: string | null;
  media_asset_id: string | null;
  payment_method_id: string | null;
  content: string;
  rrf_score: number;
}

export interface SourceImage {
  sourceKey: string;
  imageUrl: string;
  altText?: string;
  rerankerScore: number;
}

interface BusinessItemRow {
  id: string;
  kind: string;
  title: string;
  cover_image_url: string | null;
}

interface PaymentMethodRow {
  id: string;
  name: string;
  details: { qr_image_url?: string } | null;
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

async function fetchBusinessItems(client: SupabaseClient, ids: string[]): Promise<BusinessItemRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from('business_items')
    .select('id, kind, title, cover_image_url')
    .in('id', ids);
  if (error) throw new Error(`resolveSourceImages: business_items fetch failed: ${error.message}`);
  return (data ?? []) as BusinessItemRow[];
}

async function fetchPaymentMethods(client: SupabaseClient, ids: string[]): Promise<PaymentMethodRow[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client
    .from('payment_methods')
    .select('id, name, details')
    .in('id', ids);
  if (error) throw new Error(`resolveSourceImages: payment_methods fetch failed: ${error.message}`);
  return (data ?? []) as PaymentMethodRow[];
}

/**
 * For each retrieved chunk, look up its source item and return an image URL
 * if one exists. Document/FAQ chunks have no image. Media chunks never
 * reach this resolver (they flow through selectMediaForReply separately).
 *
 * Dedupes within a single turn by sourceKey, keeping the highest reranker
 * score's chunk as the anchor for ordering.
 */
export async function resolveSourceImages(
  client: SupabaseClient,
  chunks: RetrievedChunk[],
): Promise<SourceImage[]> {
  const businessItemIds = unique(chunks.filter((c) => c.business_item_id).map((c) => c.business_item_id!));
  const paymentMethodIds = unique(chunks.filter((c) => c.payment_method_id).map((c) => c.payment_method_id!));

  const [biRows, pmRows] = await Promise.all([
    fetchBusinessItems(client, businessItemIds),
    fetchPaymentMethods(client, paymentMethodIds),
  ]);

  const biById = new Map(biRows.map((r) => [r.id, r]));
  const pmById = new Map(pmRows.map((r) => [r.id, r]));

  const best = new Map<string, SourceImage>();
  for (const chunk of chunks) {
    let resolved: SourceImage | null = null;

    if (chunk.business_item_id) {
      const bi = biById.get(chunk.business_item_id);
      if (bi && bi.cover_image_url) {
        resolved = {
          sourceKey: `product:${bi.id}`,
          imageUrl: bi.cover_image_url,
          altText: bi.title,
          rerankerScore: chunk.rrf_score,
        };
      }
    } else if (chunk.payment_method_id) {
      const pm = pmById.get(chunk.payment_method_id);
      const qr = pm?.details?.qr_image_url;
      if (qr) {
        resolved = {
          sourceKey: `payment:${pm!.id}`,
          imageUrl: qr,
          altText: pm!.name,
          rerankerScore: chunk.rrf_score,
        };
      }
    }

    if (!resolved) continue;
    const prev = best.get(resolved.sourceKey);
    if (!prev || resolved.rerankerScore > prev.rerankerScore) {
      best.set(resolved.sourceKey, resolved);
    }
  }

  return Array.from(best.values());
}
