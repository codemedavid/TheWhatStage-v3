import { createAdminClient } from '@/lib/supabase/admin';
import { runJob, type EmbedJobRow, type SourceFetchers } from './worker/embed-job';
import { buildMediaRagText } from '@/lib/media/rag-text';
import type { SourceKind } from './types';

function sourceColumn(kind: SourceKind): 'document_id' | 'faq_id' | 'business_item_id' | 'media_asset_id' {
  switch (kind) {
    case 'document':
      return 'document_id';
    case 'faq':
      return 'faq_id';
    case 'business_item':
      return 'business_item_id';
    case 'media_asset':
      return 'media_asset_id';
  }
}

function buildFetchers(client: ReturnType<typeof createAdminClient>): SourceFetchers {
  return {
    async fetchDocument(id) {
      const { data, error } = await client
        .from('knowledge_documents')
        .select('title, content_json, version')
        .eq('id', id)
        .single();
      if (error || !data) throw new Error(`document ${id} missing: ${error?.message}`);
      return { title: data.title, contentJson: data.content_json, version: data.version };
    },
    async fetchFaq(id) {
      const { data, error } = await client
        .from('knowledge_faqs')
        .select('question, answer, version')
        .eq('id', id)
        .single();
      if (error || !data) throw new Error(`faq ${id} missing: ${error?.message}`);
      return { question: data.question, answer: data.answer, version: data.version };
    },
    async fetchBusinessItem(id) {
      const { data, error } = await client
        .from('business_items')
        .select('title, rag_text, version, status, rag_enabled')
        .eq('id', id)
        .single();
      if (error || !data) throw new Error(`business item ${id} missing: ${error?.message}`);
      return {
        title: data.title,
        ragText: data.rag_text,
        version: data.version,
        status: data.status,
        ragEnabled: data.rag_enabled,
      };
    },
    async fetchMediaAsset(id) {
      const { data, error } = await client
        .from('media_assets')
        .select('name, slug, description, version, is_archived, media_folders!inner(name, slug, description)')
        .eq('id', id)
        .single();
      if (error || !data) throw new Error(`media asset ${id} missing: ${error?.message}`);
      const folder = Array.isArray(data.media_folders) ? data.media_folders[0] : data.media_folders;
      return {
        name: data.name,
        version: data.version,
        isArchived: data.is_archived,
        ragText: buildMediaRagText({
          folderName: folder.name,
          folderSlug: folder.slug,
          folderDescription: folder.description,
          assetName: data.name,
          assetSlug: data.slug,
          assetDescription: data.description,
        }),
      };
    },
  };
}

/**
 * Drain queued jobs for a single source on the current request's Fluid Compute
 * instance. Called from `after()` in server actions so a save kicks off its
 * own embedding without waiting on cron. The job row still exists in the queue
 * so if this instance dies mid-flight, cron picks it up on the next tick.
 *
 * Atomic claim by source id avoids racing with cron: whichever side wins the
 * UPDATE...status='queued' check is the only one that runs the work.
 */
export async function processSourceInline(args: {
  kind: SourceKind;
  sourceId: string;
}): Promise<void> {
  const client = createAdminClient();
  const col = sourceColumn(args.kind);

  const { data: claimed, error } = await client
    .from('knowledge_embedding_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq(col, args.sourceId)
    .eq('status', 'queued')
    .select(
      'id, document_id, faq_id, business_item_id, media_asset_id, user_id, attempts, source_version',
    );

  if (error) {
    console.error('[processSourceInline] claim failed', error);
    return;
  }
  if (!claimed?.length) return;

  const fetchers = buildFetchers(client);
  const log = {
    info: (msg: string, meta?: Record<string, unknown>) =>
      console.log(JSON.stringify({ msg, ...meta })),
    error: (msg: string, meta?: Record<string, unknown>) =>
      console.error(JSON.stringify({ msg, ...meta })),
  };

  for (const job of claimed as EmbedJobRow[]) {
    try {
      await runJob(client, job, fetchers, undefined, log);
    } catch (e) {
      console.error('[processSourceInline] runJob threw', e);
    }
  }
}
