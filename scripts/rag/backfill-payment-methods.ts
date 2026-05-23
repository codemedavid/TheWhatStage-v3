// scripts/rag/backfill-payment-methods.ts
//
// One-off (idempotent) backfill: enqueue an embed job for every existing
// payment method so they get indexed into knowledge_chunks. Safe to re-run —
// enqueueEmbedJob is idempotent per source.
//
// Usage:
//   npx tsx scripts/rag/backfill-payment-methods.ts
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { syncPaymentMethodToKnowledge } from '@/lib/payment-methods/sync';

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required');
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const pageSize = 500;
  let from = 0;
  let total = 0;

  for (;;) {
    const { data, error } = await supabase
      .from('payment_methods')
      .select('id, user_id')
      .order('created_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      await syncPaymentMethodToKnowledge(supabase, row.user_id, row.id);
      total++;
    }
    if (data.length < pageSize) break;
    from += pageSize;
  }

  console.log(`Enqueued embed jobs for ${total} payment methods.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
