import type { SourceKind } from './types';
import type { SupabaseLike } from './ingest';

function sourceMeta(kind: SourceKind): {
  sourceCol: 'document_id' | 'faq_id' | 'business_item_id' | 'media_asset_id' | 'payment_method_id';
  sourceTable: 'knowledge_documents' | 'knowledge_faqs' | 'business_items' | 'media_assets' | 'payment_methods';
} {
  switch (kind) {
    case 'document':
      return { sourceCol: 'document_id', sourceTable: 'knowledge_documents' };
    case 'faq':
      return { sourceCol: 'faq_id', sourceTable: 'knowledge_faqs' };
    case 'business_item':
      return { sourceCol: 'business_item_id', sourceTable: 'business_items' };
    case 'media_asset':
      return { sourceCol: 'media_asset_id', sourceTable: 'media_assets' };
    case 'payment_method':
      return { sourceCol: 'payment_method_id', sourceTable: 'payment_methods' };
  }
}

/**
 * Enqueue (or re-arm) an embed job for a source. Idempotent: the partial
 * unique index in the migration ensures only one active job per source.
 * If a queued/running job already exists, move it to the newest source version.
 */
export async function enqueueEmbedJob(
  client: SupabaseLike,
  args: { kind: SourceKind; sourceId: string; userId: string; sourceVersion?: number },
): Promise<void> {
  const { sourceCol, sourceTable } = sourceMeta(args.kind);
  const sourceVersion = args.sourceVersion ?? (await loadSourceVersion(client, sourceTable, args.sourceId));

  const { data: existing, error: selErr } = await client
    .from('knowledge_embedding_jobs')
    .select('id, status')
    .eq(sourceCol, args.sourceId)
    .in('status', ['queued', 'running'])
    .limit(1);
  if (selErr) throw new Error(`enqueue check failed: ${selErr.message ?? selErr}`);

  if (existing?.length) {
    const job = existing[0] as { id: string; status: string };
    const patch =
      job.status === 'queued'
        ? { scheduled_at: new Date().toISOString(), source_version: sourceVersion }
        : { source_version: sourceVersion };
    await client
      .from('knowledge_embedding_jobs')
      .update(patch)
      .eq('id', job.id);

    await client.from(sourceTable).update({ embedding_status: 'stale' }).eq('id', args.sourceId);
    return;
  }

  const row = {
    [sourceCol]: args.sourceId,
    user_id: args.userId,
    status: 'queued' as const,
    source_version: sourceVersion,
    scheduled_at: new Date().toISOString(),
  };
  const { error } = await client.from('knowledge_embedding_jobs').insert(row);
  if (error) throw new Error(`enqueue failed: ${error.message ?? error}`);

  // Mark the source itself stale so the UI can show "indexing in progress".
  await client.from(sourceTable).update({ embedding_status: 'stale' }).eq('id', args.sourceId);
}

async function loadSourceVersion(
  client: SupabaseLike,
  sourceTable: string,
  sourceId: string,
): Promise<number> {
  const { data, error } = await client
    .from(sourceTable)
    .select('version')
    .eq('id', sourceId)
    .single();
  if (error || !data) throw new Error(`load source version failed: ${error?.message ?? error}`);
  return Number((data as { version?: number }).version ?? 0);
}
