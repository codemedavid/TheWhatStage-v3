import {
  StaleSourceVersionError,
  applyIngest,
  loadExistingChunks,
  planIngest,
  type SupabaseLike,
} from '../ingest';
import { enqueueEmbedJob } from '../queue';
import { type Embedder } from '../hf-client';
import { createEmbedder } from '../factory';
import type { SourceKind } from '../types';
import type { ParseInput } from '../parsers';

export interface EmbedJobRow {
  id: string;
  document_id: string | null;
  faq_id: string | null;
  business_item_id: string | null;
  media_asset_id: string | null;
  user_id: string;
  attempts: number;
  source_version: number;
}

export interface JobLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

const noopLogger: JobLogger = { info: () => {}, error: () => {} };

const MAX_ATTEMPTS = 5;
const RUNNING_STALE_MS = 10 * 60 * 1000;

interface PendingDocumentRow {
  id: string;
  user_id: string;
  version: number;
}

interface PendingFaqRow {
  id: string;
  user_id: string;
  version: number;
}

interface PendingBusinessItemRow {
  id: string;
  user_id: string;
  version: number;
}

interface PendingMediaAssetRow {
  id: string;
  user_id: string;
  version: number;
}

function sourceTable(kind: SourceKind): 'knowledge_documents' | 'knowledge_faqs' | 'business_items' | 'media_assets' {
  switch (kind) {
    case 'document':
      return 'knowledge_documents';
    case 'faq':
      return 'knowledge_faqs';
    case 'business_item':
      return 'business_items';
    case 'media_asset':
      return 'media_assets';
  }
}

function sourceIdColumn(kind: SourceKind): 'document_id' | 'faq_id' | 'business_item_id' | 'media_asset_id' {
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

export async function enqueuePendingSources(
  client: SupabaseLike,
  opts: { limit?: number } = {},
): Promise<{ enqueued: number }> {
  const limit = opts.limit ?? 50;
  const [docsRes, faqsRes, itemsRes, assetsRes] = await Promise.all([
    client
      .from('knowledge_documents')
      .select('id, user_id, version')
      .in('embedding_status', ['pending', 'stale'])
      .not('content_json', 'is', null)
      .limit(limit),
    client
      .from('knowledge_faqs')
      .select('id, user_id, version')
      .in('embedding_status', ['pending', 'stale'])
      .neq('answer', '')
      .limit(limit),
    client
      .from('business_items')
      .select('id, user_id, version')
      .in('kind', ['product', 'property', 'service'])
      .eq('status', 'published')
      .eq('rag_enabled', true)
      .in('embedding_status', ['pending', 'stale'])
      .not('rag_text', 'is', null)
      .limit(limit),
    client
      .from('media_assets')
      .select('id, user_id, version')
      .eq('is_archived', false)
      .in('embedding_status', ['pending', 'stale'])
      .limit(limit),
  ]);

  if (docsRes.error) throw new Error(`load pending documents failed: ${docsRes.error.message ?? docsRes.error}`);
  if (faqsRes.error) throw new Error(`load pending faqs failed: ${faqsRes.error.message ?? faqsRes.error}`);
  if (itemsRes.error) throw new Error(`load pending business items failed: ${itemsRes.error.message ?? itemsRes.error}`);
  if (assetsRes.error) throw new Error(`load pending media assets failed: ${assetsRes.error.message ?? assetsRes.error}`);

  let enqueued = 0;
  for (const row of (docsRes.data ?? []) as PendingDocumentRow[]) {
    await enqueueEmbedJob(client, {
      kind: 'document',
      sourceId: row.id,
      userId: row.user_id,
      sourceVersion: row.version ?? 0,
    });
    enqueued++;
  }

  for (const row of (faqsRes.data ?? []) as PendingFaqRow[]) {
    await enqueueEmbedJob(client, {
      kind: 'faq',
      sourceId: row.id,
      userId: row.user_id,
      sourceVersion: row.version ?? 0,
    });
    enqueued++;
  }

  for (const row of (itemsRes.data ?? []) as PendingBusinessItemRow[]) {
    await enqueueEmbedJob(client, {
      kind: 'business_item',
      sourceId: row.id,
      userId: row.user_id,
      sourceVersion: row.version ?? 0,
    });
    enqueued++;
  }

  for (const row of (assetsRes.data ?? []) as PendingMediaAssetRow[]) {
    await enqueueEmbedJob(client, {
      kind: 'media_asset',
      sourceId: row.id,
      userId: row.user_id,
      sourceVersion: row.version ?? 0,
    });
    enqueued++;
  }

  return { enqueued };
}

/**
 * Claim up to `limit` queued jobs atomically. Uses a single update statement
 * with a CTE-like pattern to avoid races between workers.
 *
 * NOTE: Supabase JS doesn't expose `for update skip locked` directly, so we
 * fall back to an optimistic update keyed on (id, status='queued'). Workers
 * that lose the race get zero rows back and try again.
 */
export async function claimJobs(
  client: SupabaseLike,
  limit: number,
): Promise<EmbedJobRow[]> {
  await client
    .from('knowledge_embedding_jobs')
    .update({ status: 'queued', started_at: null })
    .eq('status', 'running')
    .lte('started_at', new Date(Date.now() - RUNNING_STALE_MS).toISOString());

  const { data: candidates, error: pickErr } = await client
    .from('knowledge_embedding_jobs')
    .select('id, document_id, faq_id, business_item_id, media_asset_id, user_id, attempts, source_version')
    .eq('status', 'queued')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(limit);
  if (pickErr) throw new Error(`pick jobs failed: ${pickErr.message ?? pickErr}`);
  if (!candidates?.length) return [];

  const ids = (candidates as EmbedJobRow[]).map((r) => r.id);
  const { data: claimed, error: claimErr } = await client
    .from('knowledge_embedding_jobs')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .in('id', ids)
    .eq('status', 'queued')
    .select('id, document_id, faq_id, business_item_id, media_asset_id, user_id, attempts, source_version');
  if (claimErr) throw new Error(`claim jobs failed: ${claimErr.message ?? claimErr}`);
  return (claimed ?? []) as EmbedJobRow[];
}

/**
 * Build a ParseInput from a source row id. Caller injects fetchers because
 * the row shape differs between sources and we keep the worker pure-ish.
 */
export interface SourceFetchers {
  fetchDocument: (id: string) => Promise<{
    title: string;
    contentJson: unknown;
    contentText?: string | null;
    version?: number;
  }>;
  fetchFaq: (id: string) => Promise<{ question: string; answer: string; version?: number }>;
  fetchBusinessItem?: (id: string) => Promise<{
    title: string;
    ragText: string | null;
    version?: number;
    status?: string;
    ragEnabled?: boolean;
  }>;
  fetchMediaAsset?: (id: string) => Promise<{
    name: string;
    ragText: string;
    version?: number;
    isArchived?: boolean;
  }>;
}

type BuildParseResult =
  | { kind: SourceKind; sourceId: string; sourceVersion: number; parseInput: ParseInput }
  | { kind: 'business_item' | 'media_asset'; sourceId: string; sourceVersion: number; disabledReason: string };

async function buildParseInput(
  job: EmbedJobRow,
  fetchers: SourceFetchers,
): Promise<BuildParseResult> {
  if (job.document_id) {
    const doc = await fetchers.fetchDocument(job.document_id);
    return {
      kind: 'document',
      sourceId: job.document_id,
      sourceVersion: doc.version ?? 0,
      parseInput: {
        kind: 'document',
        title: doc.title,
        contentJson: doc.contentJson,
        contentText: doc.contentText,
      },
    };
  }
  if (job.faq_id) {
    const faq = await fetchers.fetchFaq(job.faq_id);
    return {
      kind: 'faq',
      sourceId: job.faq_id,
      sourceVersion: faq.version ?? 0,
      parseInput: { kind: 'faq', question: faq.question, answer: faq.answer },
    };
  }
  if (job.business_item_id) {
    if (!fetchers.fetchBusinessItem) {
      throw new Error(`job ${job.id} requires fetchBusinessItem`);
    }
    const item = await fetchers.fetchBusinessItem(job.business_item_id);
    if (
      item.status !== undefined &&
      (item.status !== 'published' || item.ragEnabled === false || !item.ragText?.trim())
    ) {
      return {
        kind: 'business_item',
        sourceId: job.business_item_id,
        sourceVersion: item.version ?? 0,
        disabledReason: 'business item is not published or RAG-enabled',
      };
    }
    return {
      kind: 'business_item',
      sourceId: job.business_item_id,
      sourceVersion: item.version ?? 0,
      parseInput: { kind: 'business_item', title: item.title, ragText: item.ragText ?? '' },
    };
  }
  if (job.media_asset_id) {
    if (!fetchers.fetchMediaAsset) {
      throw new Error(`job ${job.id} requires fetchMediaAsset`);
    }
    const asset = await fetchers.fetchMediaAsset(job.media_asset_id);
    if (asset.isArchived || !asset.ragText.trim()) {
      return {
        kind: 'media_asset',
        sourceId: job.media_asset_id,
        sourceVersion: asset.version ?? 0,
        disabledReason: 'media asset is archived or empty',
      };
    }
    return {
      kind: 'media_asset',
      sourceId: job.media_asset_id,
      sourceVersion: asset.version ?? 0,
      parseInput: { kind: 'media_asset', title: asset.name, ragText: asset.ragText },
    };
  }
  throw new Error(`job ${job.id} has no source id`);
}

async function requeueStaleJob(
  client: SupabaseLike,
  jobId: string,
  currentVersion: number,
): Promise<void> {
  await client
    .from('knowledge_embedding_jobs')
    .update({
      status: 'queued',
      source_version: currentVersion,
      scheduled_at: new Date().toISOString(),
      started_at: null,
    })
    .eq('id', jobId);
}

export async function runJob(
  client: SupabaseLike,
  job: EmbedJobRow,
  fetchers: SourceFetchers,
  embedder: Embedder = createEmbedder(),
  log: JobLogger = noopLogger,
): Promise<void> {
  try {
    const built = await buildParseInput(job, fetchers);
    if ('disabledReason' in built) {
      await client
        .from('knowledge_chunks')
        .delete()
        .eq(sourceIdColumn(built.kind), built.sourceId)
        .eq('user_id', job.user_id);

      await client
        .from(sourceTable(built.kind))
        .update({ embedding_status: 'pending', embedded_at: null })
        .eq('id', built.sourceId)
        .eq('user_id', job.user_id);

      await client
        .from('knowledge_embedding_jobs')
        .update({
          status: 'done',
          finished_at: new Date().toISOString(),
          last_error: built.disabledReason,
          source_version: built.sourceVersion,
        })
        .eq('id', job.id);

      log.info('embed_job.skipped_disabled_source', {
        jobId: job.id,
        kind: built.kind,
        sourceId: built.sourceId,
        reason: built.disabledReason,
      });
      return;
    }

    const { kind, sourceId, sourceVersion, parseInput } = built;
    if (sourceVersion !== job.source_version) {
      await requeueStaleJob(client, job.id, sourceVersion);
      log.info('embed_job.stale_requeued', {
        jobId: job.id,
        sourceId,
        jobVersion: job.source_version,
        currentVersion: sourceVersion,
      });
      return;
    }

    const existing = await loadExistingChunks(client, { kind, sourceId });
    const { diff } = planIngest(parseInput, existing);
    const result = await applyIngest(
      client,
      {
        kind,
        sourceId,
        userId: job.user_id,
        sourceVersion: job.source_version,
        useAtomicRpc: true,
        parseInput,
      },
      diff,
      embedder,
    );

    // Mark the source itself as indexed.
    await client
      .from(sourceTable(kind))
      .update({ embedding_status: 'indexed', embedded_at: new Date().toISOString() })
      .eq('id', sourceId)
      .eq('version', job.source_version);

    const { data: doneRows } = await client
      .from('knowledge_embedding_jobs')
      .update({ status: 'done', finished_at: new Date().toISOString(), last_error: null })
      .eq('id', job.id)
      .eq('source_version', job.source_version)
      .select('id');

    if (!doneRows?.length) {
      await client
        .from('knowledge_embedding_jobs')
        .update({ status: 'queued', scheduled_at: new Date().toISOString(), started_at: null })
        .eq('id', job.id)
        .eq('status', 'running');
    }

    log.info('embed_job.done', { jobId: job.id, sourceId, ...result.diff });
  } catch (err) {
    if (err instanceof StaleSourceVersionError) {
      await requeueStaleJob(client, job.id, err.currentVersion);
      log.info('embed_job.stale_requeued', {
        jobId: job.id,
        jobVersion: job.source_version,
        currentVersion: err.currentVersion,
      });
      return;
    }

    const attempts = job.attempts + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    await client
      .from('knowledge_embedding_jobs')
      .update({
        status: failed ? 'failed' : 'queued',
        attempts,
        last_error: String(err instanceof Error ? err.message : err),
        scheduled_at: new Date(Date.now() + Math.min(60_000 * attempts, 300_000)).toISOString(),
        finished_at: failed ? new Date().toISOString() : null,
      })
      .eq('id', job.id);
    log.error('embed_job.failed', { jobId: job.id, attempts, failed, error: String(err) });
  }
}

export async function runDueJobs(
  client: SupabaseLike,
  fetchers: SourceFetchers,
  opts: { limit?: number; embedder?: Embedder; log?: JobLogger } = {},
): Promise<{ processed: number }> {
  const jobs = await claimJobs(client, opts.limit ?? 5);
  for (const job of jobs) {
    await runJob(client, job, fetchers, opts.embedder, opts.log);
  }
  return { processed: jobs.length };
}
