import { enqueueEmbedJob } from '@/lib/rag/queue';
import type { SupabaseLike } from '@/lib/rag/ingest';

interface SyncOptions {
  _enqueue?: typeof enqueueEmbedJob;
}

/**
 * Sync a payment method into the RAG pipeline. Call this from every
 * server action that creates or updates a payment_methods row.
 */
export async function syncPaymentMethodToKnowledge(
  client: SupabaseLike,
  userId: string,
  paymentMethodId: string,
  opts: SyncOptions = {},
): Promise<void> {
  const enqueue = opts._enqueue ?? enqueueEmbedJob;
  await enqueue(client, {
    kind: 'payment_method',
    sourceId: paymentMethodId,
    userId,
  });
}
