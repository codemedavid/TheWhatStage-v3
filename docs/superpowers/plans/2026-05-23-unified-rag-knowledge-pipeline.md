# Unified RAG Knowledge Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add payment methods to RAG, auto-attach images for retrieved products/properties/sales/payment QRs on first mention per thread, and tighten anti-hallucination guardrails — without changing the LLM-driven action-page deeplink decision or RAG-indexing orders/submissions.

**Architecture:** Extend the polymorphic `knowledge_chunks` table with a fifth source type (`payment_method`). Add a `messenger_threads.attached_item_keys` column for first-mention dedup. Inject a closed-world `paymentEnumBlock` into prompts. New runtime modules: `payment-enum.ts`, `source-images.ts`, `attach-gate.ts`, `visual-intent.ts`. Source markers on retrieved chunks anchor LLM facts to their origin.

**Tech Stack:** Next.js App Router, Supabase Postgres, BGE-M3 embeddings, BGE-Reranker-v2-m3, Vitest, TypeScript.

**Spec reference:** `docs/superpowers/specs/2026-05-23-unified-rag-knowledge-pipeline-design.md`

---

## File Structure

**Phase 1 — Payment methods enter RAG**

Create:
- `supabase/migrations/20260607000000_payment_methods_rag_columns.sql`
- `supabase/migrations/20260607000100_knowledge_chunks_payment_method_source.sql`
- `supabase/migrations/20260607000200_match_knowledge_hybrid_payment_methods.sql`
- `src/lib/payment-methods/rag-text.ts`
- `src/lib/payment-methods/rag-text.test.ts`
- `src/lib/payment-methods/sync.ts`
- `src/lib/payment-methods/sync.test.ts`
- `scripts/rag/backfill-payment-methods.ts`

Modify:
- `src/lib/rag/types.ts` — extend `SourceKind`
- `src/lib/rag/queue.ts` — `sourceMeta` switch
- `src/lib/rag/worker/embed-job.ts` — payment_method branch
- `src/app/(app)/dashboard/payment-methods/actions.ts` — call `syncPaymentMethodToKnowledge`

**Phase 2 — Closed-world payment enum block**

Create:
- `src/lib/chatbot/payment-enum.ts`
- `src/lib/chatbot/payment-enum.test.ts`

Modify:
- `src/lib/rag/prompt-builder.ts` — inject payment enum block + accept `paymentEnumBlock` param
- `src/lib/chatbot/classify.ts` — resolve active page, compute payment ids, pass through

**Phase 3 — Source resolver + first-mention attach gate**

Create:
- `supabase/migrations/20260607000300_messenger_threads_attached_item_keys.sql`
- `src/lib/chatbot/visual-intent.ts`
- `src/lib/chatbot/visual-intent.test.ts`
- `src/lib/chatbot/source-images.ts`
- `src/lib/chatbot/source-images.test.ts`
- `src/lib/chatbot/attach-gate.ts`
- `src/lib/chatbot/attach-gate.test.ts`

Modify:
- `src/app/api/messenger/process/route.ts` — wire in pipeline
- `src/lib/messenger/outbound.ts` — `sendProductRecommendation` skip-if-attached
- `src/lib/messenger/property-outbound.ts` — same

**Phase 4 — Source markers + grounding rules**

Modify:
- `src/lib/rag/prompt-builder.ts` — annotate chunks with source markers; extend grounding rules

---

# Phase 1 — Payment Methods Enter RAG

### Task 1.1: Add `version` and `embedding_status` columns to `payment_methods`

**Why:** `enqueueEmbedJob` reads `version` to set `source_version` and writes `embedding_status='stale'` on the source row. The existing `payment_methods` table has neither.

**Files:**
- Create: `supabase/migrations/20260607000000_payment_methods_rag_columns.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260607000000_payment_methods_rag_columns.sql
-- Add version + embedding_status columns so payment_methods can participate
-- in the knowledge_embedding_jobs pipeline like business_items and
-- knowledge_documents do.

alter table public.payment_methods
  add column if not exists version integer not null default 0,
  add column if not exists embedding_status text not null default 'idle'
    check (embedding_status in ('idle', 'stale', 'embedding', 'embedded', 'error'));

-- Bump version on every row update (mirrors existing business_items behavior).
create or replace function public.bump_payment_methods_version()
returns trigger
language plpgsql
as $$
begin
  new.version := coalesce(old.version, 0) + 1;
  return new;
end;
$$;

drop trigger if exists payment_methods_bump_version on public.payment_methods;
create trigger payment_methods_bump_version
  before update on public.payment_methods
  for each row
  execute function public.bump_payment_methods_version();
```

- [ ] **Step 2: Apply the migration locally**

Run: `supabase migration up` (or apply via Supabase MCP `apply_migration` tool).
Expected: migration applies without error.

- [ ] **Step 3: Verify columns exist**

Run: `psql -c "\d public.payment_methods"` (or `mcp__supabase__execute_sql` with `select column_name from information_schema.columns where table_name='payment_methods' and column_name in ('version','embedding_status')`).
Expected: both columns present.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260607000000_payment_methods_rag_columns.sql
git commit -m "feat(rag): add version + embedding_status columns to payment_methods"
```

---

### Task 1.2: Extend `SourceKind` to include `'payment_method'`

**Files:**
- Modify: `src/lib/rag/types.ts`

- [ ] **Step 1: Update the type**

Replace the `SourceKind` definition in `src/lib/rag/types.ts`:

```ts
export type SourceKind = 'document' | 'faq' | 'business_item' | 'media_asset' | 'payment_method';
```

- [ ] **Step 2: Run typecheck**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | grep "src/lib/rag\|src/lib/payment\|embed-job"`
Expected: TypeScript reports missing branches in switch statements in `queue.ts` and `embed-job.ts`. These get fixed in Tasks 1.5 and 1.6 — expected failures at this point.

- [ ] **Step 3: Commit (broken-but-typed checkpoint allowed for this single-line type extension)**

```bash
git add src/lib/rag/types.ts
git commit -m "feat(rag): extend SourceKind with payment_method"
```

---

### Task 1.3: Add `payment_method_id` column to `knowledge_chunks`

**Files:**
- Create: `supabase/migrations/20260607000100_knowledge_chunks_payment_method_source.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260607000100_knowledge_chunks_payment_method_source.sql
-- Fifth polymorphic source type on knowledge_chunks: payment_methods.
-- Mirrors the existing document_id / faq_id / business_item_id / media_asset_id
-- shape — exactly one source FK per row is set.

alter table public.knowledge_chunks
  add column if not exists payment_method_id uuid
  references public.payment_methods(id) on delete cascade;

-- Replace the one-source CHECK constraint to include the new column.
alter table public.knowledge_chunks
  drop constraint if exists knowledge_chunks_one_source;

alter table public.knowledge_chunks
  add constraint knowledge_chunks_one_source
  check (
    num_nonnulls(document_id, faq_id, business_item_id, media_asset_id, payment_method_id) = 1
  );

-- Upsert key per payment method (same shape as the other source uniques).
create unique index if not exists knowledge_chunks_payment_method_unique
  on public.knowledge_chunks (payment_method_id, chunk_index)
  where payment_method_id is not null;

-- Lookup index for the resolver / retrieval RPC.
create index if not exists knowledge_chunks_payment_method_id_idx
  on public.knowledge_chunks (payment_method_id)
  where payment_method_id is not null;
```

- [ ] **Step 2: Apply the migration**

Run: `supabase migration up`.
Expected: migration applies cleanly.

- [ ] **Step 3: Verify**

Run SQL: `select count(*) from public.knowledge_chunks where payment_method_id is not null;`
Expected: `0` (no payment chunks exist yet).

Run SQL: `select conname from pg_constraint where conrelid = 'public.knowledge_chunks'::regclass and conname = 'knowledge_chunks_one_source';`
Expected: one row returned.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260607000100_knowledge_chunks_payment_method_source.sql
git commit -m "feat(rag): add payment_method_id source to knowledge_chunks"
```

---

### Task 1.4: Implement `buildPaymentMethodRagText` (TDD)

**Files:**
- Create: `src/lib/payment-methods/rag-text.ts`
- Test: `src/lib/payment-methods/rag-text.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/payment-methods/rag-text.test.ts
import { describe, expect, it } from 'vitest';
import { buildPaymentMethodRagText } from './rag-text';
import type { PaymentMethod } from './types';

function makeMethod(overrides: Partial<PaymentMethod> = {}): PaymentMethod {
  return {
    id: 'pm-1',
    user_id: 'u-1',
    kind: 'gcash',
    name: 'GCash · Main',
    instructions: 'Send exact amount, then upload your receipt.',
    details: {
      account_name: 'Juan Dela Cruz',
      account_number: '0917-123-4567',
      qr_image_url: 'https://example.com/qr.png',
    },
    enabled: true,
    position: 0,
    created_at: '2026-05-01T00:00:00Z',
    updated_at: '2026-05-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildPaymentMethodRagText', () => {
  it('emits a stable text shape for a gcash method', () => {
    const out = buildPaymentMethodRagText(makeMethod());
    expect(out).toContain('Payment method: GCash · Main');
    expect(out).toContain('Kind: gcash');
    expect(out).toContain('Account name: Juan Dela Cruz');
    expect(out).toContain('Account number: 0917-123-4567');
    expect(out).toContain('Instructions: Send exact amount, then upload your receipt.');
    expect(out).toContain('QR image:');
  });

  it('handles bank_transfer fields', () => {
    const out = buildPaymentMethodRagText(
      makeMethod({
        kind: 'bank_transfer',
        name: 'BPI Savings',
        details: {
          bank_name: 'BPI',
          account_name: 'Juan Dela Cruz',
          account_number: '1234-5678-90',
          branch: 'Makati',
        },
      }),
    );
    expect(out).toContain('Kind: bank_transfer');
    expect(out).toContain('Bank: BPI');
    expect(out).toContain('Branch: Makati');
    expect(out).toContain('Account number: 1234-5678-90');
  });

  it('omits empty optional fields cleanly', () => {
    const out = buildPaymentMethodRagText(
      makeMethod({ instructions: null, details: { account_number: '0917-000-0000' } }),
    );
    expect(out).not.toContain('Instructions:');
    expect(out).not.toContain('Account name:');
    expect(out).toContain('Account number: 0917-000-0000');
  });

  it('skips the QR line when no qr_image_url is set', () => {
    const out = buildPaymentMethodRagText(
      makeMethod({ details: { account_number: '0917-000-0000' } }),
    );
    expect(out).not.toContain('QR image:');
  });

  it('returns an empty string when the method is disabled', () => {
    const out = buildPaymentMethodRagText(makeMethod({ enabled: false }));
    expect(out).toBe('');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/payment-methods/rag-text.test.ts`
Expected: FAIL with "Cannot find module './rag-text'" or "buildPaymentMethodRagText is not a function".

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/payment-methods/rag-text.ts
import type { PaymentMethod } from './types';

/**
 * Build the canonical text we embed for a payment method. Returns an empty
 * string when the method is disabled — the sync hook treats empty text as
 * "no chunks for this source" and removes any stale rows.
 *
 * Output shape is stable and one fact per line so the retriever / reranker
 * can latch onto specific fields ("what is the GCash number?"). Keep this
 * format additive — older chunks remain valid if we add new lines.
 */
export function buildPaymentMethodRagText(method: PaymentMethod): string {
  if (!method.enabled) return '';

  const lines: string[] = [];
  lines.push(`Payment method: ${method.name}`);
  lines.push(`Kind: ${method.kind}`);

  const d = method.details ?? {};
  if (d.bank_name) lines.push(`Bank: ${d.bank_name}`);
  if (d.account_name) lines.push(`Account name: ${d.account_name}`);
  if (d.account_number) lines.push(`Account number: ${d.account_number}`);
  if (d.branch) lines.push(`Branch: ${d.branch}`);

  if (method.instructions && method.instructions.trim()) {
    lines.push(`Instructions: ${method.instructions.trim()}`);
  }

  if (d.qr_image_url) {
    lines.push(`QR image: ${d.qr_image_url}`);
  }

  return lines.join('\n');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/payment-methods/rag-text.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payment-methods/rag-text.ts src/lib/payment-methods/rag-text.test.ts
git commit -m "feat(payment-methods): rag-text builder"
```

---

### Task 1.5: Extend `queue.ts` `sourceMeta` for `payment_method`

**Files:**
- Modify: `src/lib/rag/queue.ts`

- [ ] **Step 1: Update the `sourceMeta` function**

Replace the function body in `src/lib/rag/queue.ts` (lines ~4-18):

```ts
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
```

- [ ] **Step 2: Run typecheck to verify queue.ts now compiles cleanly**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | grep "queue.ts" | head -5`
Expected: no errors in `queue.ts` (errors in `embed-job.ts` remain — fixed in Task 1.6).

- [ ] **Step 3: Add `payment_method_id` to the embedding_jobs select**

`enqueueEmbedJob` already keys jobs by source-column generically — no further change needed here. The table needs the column though. Check if `knowledge_embedding_jobs.payment_method_id` exists:

Run SQL: `select column_name from information_schema.columns where table_name='knowledge_embedding_jobs' and column_name='payment_method_id';`

If empty, add it in a follow-up migration step:

Create `supabase/migrations/20260607000150_embedding_jobs_payment_method_id.sql`:

```sql
-- supabase/migrations/20260607000150_embedding_jobs_payment_method_id.sql
alter table public.knowledge_embedding_jobs
  add column if not exists payment_method_id uuid
  references public.payment_methods(id) on delete cascade;

-- Partial unique: only one active job per payment_method at a time.
create unique index if not exists knowledge_embedding_jobs_payment_method_active_unique
  on public.knowledge_embedding_jobs (payment_method_id)
  where payment_method_id is not null and status in ('queued', 'running');
```

Apply: `supabase migration up`.

- [ ] **Step 4: Commit**

```bash
git add src/lib/rag/queue.ts supabase/migrations/20260607000150_embedding_jobs_payment_method_id.sql
git commit -m "feat(rag): enqueueEmbedJob supports payment_method source"
```

---

### Task 1.6: Add `payment_method` branch to embed-job worker

**Files:**
- Modify: `src/lib/rag/worker/embed-job.ts`
- Test: `src/lib/rag/worker/embed-job.test.ts` (extend existing)

- [ ] **Step 1: Read the current worker shape**

Run: `grep -n "case '\|sourceTable\|sourceIdColumn\|case " src/lib/rag/worker/embed-job.ts`

Locate the four existing switch arms (`document` / `faq` / `business_item` / `media_asset`) in `sourceTable()`, `sourceIdColumn()`, and the main `runEmbedJob` body. Each gets a fifth arm.

- [ ] **Step 2: Write a failing test for the payment_method branch**

Append to `src/lib/rag/worker/embed-job.test.ts`:

```ts
describe('runEmbedJob — payment_method source', () => {
  it('builds rag-text via buildPaymentMethodRagText and upserts chunks', async () => {
    const supabase = makeFakeSupabaseForPaymentMethod({
      id: 'pm-1',
      user_id: 'u-1',
      kind: 'gcash',
      name: 'GCash · Main',
      enabled: true,
      version: 1,
      details: { account_number: '0917-123-4567' },
      instructions: null,
    });
    const job = {
      id: 'job-1',
      payment_method_id: 'pm-1',
      document_id: null,
      faq_id: null,
      business_item_id: null,
      media_asset_id: null,
      user_id: 'u-1',
      attempts: 0,
      source_version: 1,
    };
    const result = await runEmbedJob(supabase, job, fakeEmbedder);
    expect(result.kind).toBe('payment_method');
    expect(result.sourceId).toBe('pm-1');
    expect(supabase._upsertedChunks?.length).toBeGreaterThan(0);
    expect(supabase._upsertedChunks?.[0].payment_method_id).toBe('pm-1');
    expect(supabase._upsertedChunks?.[0].content).toContain('Account number: 0917-123-4567');
  });

  it('removes all chunks when method is disabled', async () => {
    const supabase = makeFakeSupabaseForPaymentMethod({
      id: 'pm-1',
      user_id: 'u-1',
      kind: 'gcash',
      name: 'GCash · Main',
      enabled: false,
      version: 2,
      details: {},
      instructions: null,
    });
    const job = {
      id: 'job-1',
      payment_method_id: 'pm-1',
      document_id: null,
      faq_id: null,
      business_item_id: null,
      media_asset_id: null,
      user_id: 'u-1',
      attempts: 0,
      source_version: 2,
    };
    const result = await runEmbedJob(supabase, job, fakeEmbedder);
    expect(result.disabledReason).toBeDefined();
    expect(supabase._upsertedChunks ?? []).toHaveLength(0);
  });
});
```

The `makeFakeSupabaseForPaymentMethod` helper mirrors the existing `makeFakeSupabaseForBusinessItem` (it already exists in the file for the `business_item` case). Copy and adapt the helper:

```ts
function makeFakeSupabaseForPaymentMethod(method: {
  id: string; user_id: string; kind: string; name: string; enabled: boolean;
  version: number; details: Record<string, string | undefined>; instructions: string | null;
}): FakeSupabase {
  const fake = makeBaseFakeSupabase();
  fake._sources['payment_methods'] = { [method.id]: method };
  return fake;
}
```

If `makeBaseFakeSupabase` doesn't exist, use the same factory pattern the existing tests use — copy from the `business_item` test setup verbatim and just swap the source table.

- [ ] **Step 3: Run tests to verify failure**

Run: `npx vitest run src/lib/rag/worker/embed-job.test.ts`
Expected: FAIL — "payment_method" source not handled.

- [ ] **Step 4: Implement the worker branch**

In `src/lib/rag/worker/embed-job.ts`:

In `sourceTable()` switch, add:
```ts
    case 'payment_method':
      return 'payment_methods';
```

In `sourceIdColumn()` switch, add:
```ts
    case 'payment_method':
      return 'payment_method_id';
```

In the main `runEmbedJob` body, find the existing `business_item` branch that fetches the row and runs `buildProductRagText`. Add a parallel branch for `payment_method`:

```ts
} else if (job.payment_method_id) {
  const { data: method, error } = await client
    .from('payment_methods')
    .select('id, user_id, kind, name, instructions, details, enabled, position, created_at, updated_at, version')
    .eq('id', job.payment_method_id)
    .single();
  if (error || !method) {
    return {
      kind: 'payment_method',
      sourceId: job.payment_method_id,
      sourceVersion: job.source_version,
      disabledReason: `payment_method not found: ${error?.message ?? 'no row'}`,
    };
  }
  const ragText = buildPaymentMethodRagText(method as PaymentMethod);
  if (!ragText) {
    return {
      kind: 'payment_method',
      sourceId: job.payment_method_id,
      sourceVersion: job.source_version,
      disabledReason: 'payment_method disabled or empty',
    };
  }
  parseInput = {
    title: method.name,
    body: ragText,
    atomic: false,  // payment methods are short but multi-field — let chunker decide
  };
}
```

Add the import at the top:
```ts
import { buildPaymentMethodRagText } from '@/lib/payment-methods/rag-text';
import type { PaymentMethod } from '@/lib/payment-methods/types';
```

Where chunks are upserted, the existing code uses `sourceIdColumn(kind)` and `sourceId` generically — no change needed.

In the post-chunk-write source-status update, ensure the `payment_methods` row is touched with `embedding_status='embedded'` and `version` left alone (the existing code uses `sourceTable(kind)` generically — no change needed).

In the select that loads jobs (around line 190 of embed-job.ts):
```ts
.select('id, document_id, faq_id, business_item_id, media_asset_id, payment_method_id, user_id, attempts, source_version')
```
Add `payment_method_id` to both selects (lines ~190 and ~204).

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/rag/worker/embed-job.test.ts`
Expected: PASS — all existing tests plus the two new ones.

- [ ] **Step 6: Run typecheck**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | grep "src/lib/rag\|payment-methods"`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rag/worker/embed-job.ts src/lib/rag/worker/embed-job.test.ts
git commit -m "feat(rag): embed-job worker handles payment_method source"
```

---

### Task 1.7: Update `match_knowledge_hybrid_service` RPC

**Files:**
- Create: `supabase/migrations/20260607000200_match_knowledge_hybrid_payment_methods.sql`

- [ ] **Step 1: Read the current RPC**

Run: `cat supabase/migrations/20260502090000_media_management.sql | sed -n '/match_knowledge_hybrid_service/,/^\$\$;/p' | head -100`

Capture the full function body — we'll replace it with a new `CREATE OR REPLACE` that adds the optional payment scoping and returns the new column.

- [ ] **Step 2: Write the migration**

```sql
-- supabase/migrations/20260607000200_match_knowledge_hybrid_payment_methods.sql
-- Extend match_knowledge_hybrid_service to:
--   1. Include payment_method chunks in the candidate set (when the parent
--      method is enabled).
--   2. Optionally scope payment chunks to a passed-in id set (used for
--      per-action-page payment_method_ids).
--   3. Return payment_method_id on results.
--
-- Media chunks remain excluded — semantic media retrieval continues to go
-- through match_media_assets_service / selectMediaForReply unchanged.

create or replace function public.match_knowledge_hybrid_service(
  p_user_id uuid,
  p_query_text text,
  p_query_embed vector(1024),
  p_match_limit int default 150,
  p_full_text_w float default 1.0,
  p_semantic_w float default 1.0,
  p_rrf_k int default 60,
  p_payment_method_ids uuid[] default null
)
returns table (
  id uuid,
  document_id uuid,
  faq_id uuid,
  business_item_id uuid,
  media_asset_id uuid,
  payment_method_id uuid,
  content text,
  heading_path text,
  rrf_score float
)
language sql
stable
as $$
  with candidate_chunks as (
    select kc.id, kc.document_id, kc.faq_id, kc.business_item_id, kc.media_asset_id,
           kc.payment_method_id, kc.content, kc.heading_path, kc.embedding
    from public.knowledge_chunks kc
    where kc.user_id = p_user_id
      and kc.media_asset_id is null
      and (
        -- existing document path
        (kc.document_id is not null
          and exists (
            select 1 from public.knowledge_documents d
            where d.id = kc.document_id and d.status = 'published'
          ))
        or
        -- existing FAQ path
        (kc.faq_id is not null
          and exists (
            select 1 from public.knowledge_faqs f
            where f.id = kc.faq_id and f.status = 'published'
          ))
        or
        -- existing business_item path (products/properties/sales)
        (kc.business_item_id is not null
          and exists (
            select 1 from public.business_items bi
            where bi.id = kc.business_item_id
              and bi.status = 'published'
              and bi.rag_enabled = true
          ))
        or
        -- NEW: payment_method path, scoped if p_payment_method_ids is provided
        (kc.payment_method_id is not null
          and exists (
            select 1 from public.payment_methods pm
            where pm.id = kc.payment_method_id and pm.enabled = true
          )
          and (p_payment_method_ids is null
               or kc.payment_method_id = any(p_payment_method_ids)))
      )
  ),
  fts as (
    select c.id,
           ts_rank_cd(to_tsvector('simple', c.content), plainto_tsquery('simple', p_query_text)) as score
    from candidate_chunks c
    where to_tsvector('simple', c.content) @@ plainto_tsquery('simple', p_query_text)
    order by score desc
    limit p_match_limit
  ),
  semantic as (
    select c.id, 1 - (c.embedding <=> p_query_embed) as score
    from candidate_chunks c
    order by c.embedding <=> p_query_embed
    limit p_match_limit
  ),
  fts_ranked as (
    select id, row_number() over (order by score desc) as r from fts
  ),
  semantic_ranked as (
    select id, row_number() over (order by score desc) as r from semantic
  ),
  fused as (
    select coalesce(f.id, s.id) as id,
           (coalesce(p_full_text_w / (p_rrf_k + f.r), 0)
            + coalesce(p_semantic_w / (p_rrf_k + s.r), 0)) as rrf_score
    from fts_ranked f
    full outer join semantic_ranked s on f.id = s.id
  )
  select c.id, c.document_id, c.faq_id, c.business_item_id, c.media_asset_id,
         c.payment_method_id, c.content, c.heading_path, f.rrf_score
  from fused f
  join candidate_chunks c on c.id = f.id
  order by f.rrf_score desc
  limit p_match_limit;
$$;

grant execute on function public.match_knowledge_hybrid_service(
  uuid, text, vector(1024), int, float, float, int, uuid[]
) to service_role;

-- Note: the previous 7-arg signature (without p_payment_method_ids) is now
-- redundant. Existing callers continue to work because the new param is
-- optional via DEFAULT NULL. We do NOT drop the old function — Postgres
-- allows multiple overloads and existing callers reference the 7-arg form.
-- If we ever want to clean this up, do it in a follow-up migration after
-- confirming all callers pass the 8th arg.
```

- [ ] **Step 3: Apply the migration**

Run: `supabase migration up`.
Expected: applies cleanly.

- [ ] **Step 4: Smoke-test the RPC**

Run via Supabase MCP `execute_sql`:
```sql
select count(*) from public.match_knowledge_hybrid_service(
  '00000000-0000-0000-0000-000000000000'::uuid,
  'gcash',
  array_fill(0::real, array[1024])::vector(1024),
  10
);
```
Expected: `0` (no data for fake user) — but no error means the new arg signature works.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260607000200_match_knowledge_hybrid_payment_methods.sql
git commit -m "feat(rag): match_knowledge_hybrid_service includes payment chunks with optional scoping"
```

---

### Task 1.8: Implement `syncPaymentMethodToKnowledge` (TDD)

**Files:**
- Create: `src/lib/payment-methods/sync.ts`
- Test: `src/lib/payment-methods/sync.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/payment-methods/sync.test.ts
import { describe, expect, it, vi } from 'vitest';
import { syncPaymentMethodToKnowledge } from './sync';

describe('syncPaymentMethodToKnowledge', () => {
  it('enqueues an embed job for the given payment method', async () => {
    const enqueue = vi.fn().mockResolvedValue(undefined);
    const supabase = {
      from: vi.fn(),
    } as unknown as Parameters<typeof syncPaymentMethodToKnowledge>[0];

    await syncPaymentMethodToKnowledge(
      supabase,
      'user-1',
      'pm-1',
      { _enqueue: enqueue },  // test-only injection
    );

    expect(enqueue).toHaveBeenCalledWith(supabase, {
      kind: 'payment_method',
      sourceId: 'pm-1',
      userId: 'user-1',
    });
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `npx vitest run src/lib/payment-methods/sync.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/payment-methods/sync.ts
import { enqueueEmbedJob } from '@/lib/rag/queue';
import type { SupabaseLike } from '@/lib/rag/ingest';

interface SyncOptions {
  _enqueue?: typeof enqueueEmbedJob;
}

/**
 * Sync a payment method into the RAG pipeline. Call this from every
 * server action that creates or updates a payment_methods row.
 *
 * The actual embedding happens asynchronously in the embed-job worker —
 * this function only enqueues the work. Disabled methods enqueue too
 * (the worker writes zero chunks and removes stale ones).
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/payment-methods/sync.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/payment-methods/sync.ts src/lib/payment-methods/sync.test.ts
git commit -m "feat(payment-methods): syncPaymentMethodToKnowledge enqueues embed jobs"
```

---

### Task 1.9: Wire sync into the payment-method server actions

**Files:**
- Modify: `src/app/(app)/dashboard/payment-methods/actions.ts`

- [ ] **Step 1: Locate the create and update actions**

Run: `grep -n "export async function\|insert\|update\|payment_methods" src/app/(app)/dashboard/payment-methods/actions.ts | head -30`

Identify the create and update server actions (likely named `createPaymentMethod` / `updatePaymentMethod` / `togglePaymentMethod`).

- [ ] **Step 2: Add the sync call after successful insert/update**

In each action, immediately after the Supabase `insert` / `update` returns the new row id, add:

```ts
import { syncPaymentMethodToKnowledge } from '@/lib/payment-methods/sync';

// ... inside the action, after the .insert() / .update() succeeds:
await syncPaymentMethodToKnowledge(supabase, userId, paymentMethodId);
```

For the delete action: no sync call needed — the `ON DELETE CASCADE` on `knowledge_chunks.payment_method_id` removes chunks automatically.

For an enable/disable toggle: still call `syncPaymentMethodToKnowledge`. The worker handles the disabled case by writing zero chunks.

- [ ] **Step 3: Run typecheck**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | grep "payment-methods/actions"`
Expected: no errors.

- [ ] **Step 4: Manual smoke test (optional but recommended)**

In the dashboard, create a new payment method. Then query:
```sql
select status, attempts, scheduled_at from public.knowledge_embedding_jobs
where payment_method_id = '<new id>' order by created_at desc limit 1;
```
Expected: one queued job row.

Wait for the worker tick (or run `npx tsx src/lib/rag/embed-now.ts` if available), then:
```sql
select chunk_index, left(content, 60) from public.knowledge_chunks
where payment_method_id = '<id>' order by chunk_index;
```
Expected: one or more chunks containing the method name.

- [ ] **Step 5: Commit**

```bash
git add src/app/(app)/dashboard/payment-methods/actions.ts
git commit -m "feat(payment-methods): server actions sync to RAG on create/update"
```

---

### Task 1.10: Backfill script

**Files:**
- Create: `scripts/rag/backfill-payment-methods.ts`

- [ ] **Step 1: Write the backfill script**

```ts
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
```

- [ ] **Step 2: Type-check the script**

Run: `npx tsc --noEmit --project tsconfig.json scripts/rag/backfill-payment-methods.ts`
(If the tsconfig doesn't include `scripts/`, do `npx tsc --noEmit scripts/rag/backfill-payment-methods.ts --target es2022 --module nodenext --moduleResolution nodenext --strict`.)
Expected: no errors.

- [ ] **Step 3: Run the script against the local DB**

Run: `npx tsx scripts/rag/backfill-payment-methods.ts`
Expected output: `Enqueued embed jobs for N payment methods.`

Then wait or trigger the worker. Verify chunks appear via:
```sql
select payment_method_id, count(*) from public.knowledge_chunks
where payment_method_id is not null group by payment_method_id;
```

- [ ] **Step 4: Commit**

```bash
git add scripts/rag/backfill-payment-methods.ts
git commit -m "chore(rag): backfill script for payment methods"
```

---

# Phase 2 — Closed-World Payment Enum Block

### Task 2.1: Implement `paymentEnumBlock` (TDD)

**Files:**
- Create: `src/lib/chatbot/payment-enum.ts`
- Test: `src/lib/chatbot/payment-enum.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/chatbot/payment-enum.test.ts
import { describe, expect, it, vi } from 'vitest';
import { paymentEnumBlock } from './payment-enum';

function makeFakeSupabase(rows: Record<string, unknown>[]) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: rows, error: null }),
    }),
  } as unknown as Parameters<typeof paymentEnumBlock>[0];
}

describe('paymentEnumBlock', () => {
  it('returns empty string when no enabled methods exist', async () => {
    const supabase = makeFakeSupabase([]);
    const out = await paymentEnumBlock(supabase, 'user-1', null, null);
    expect(out).toBe('');
  });

  it('lists enabled methods (global, no active page)', async () => {
    const supabase = makeFakeSupabase([
      { id: 'pm-1', kind: 'gcash', name: 'GCash · Main',
        instructions: 'Send exact amount.',
        details: { account_number: '0917-123-4567', account_name: 'Juan' } },
      { id: 'pm-2', kind: 'bank_transfer', name: 'BPI Savings',
        instructions: null,
        details: { account_number: '1234-5678-90', bank_name: 'BPI' } },
    ]);
    const out = await paymentEnumBlock(supabase, 'user-1', null, null);
    expect(out).toContain('Available Payment Methods');
    expect(out).toContain('GCash · Main');
    expect(out).toContain('0917-123-4567');
    expect(out).toContain('BPI Savings');
  });

  it('includes the scoping note when an active page is provided', async () => {
    const supabase = makeFakeSupabase([
      { id: 'pm-1', kind: 'gcash', name: 'GCash · Main',
        instructions: null, details: { account_number: '0917-000-0000' } },
    ]);
    const out = await paymentEnumBlock(supabase, 'user-1', 'Summer Catalog', ['pm-1']);
    expect(out).toContain('Available Payment Methods (scoped to Summer Catalog)');
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

Run: `npx vitest run src/lib/chatbot/payment-enum.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/chatbot/payment-enum.ts
import type { SupabaseClient } from '@supabase/supabase-js';

interface PaymentRow {
  id: string;
  kind: string;
  name: string;
  instructions: string | null;
  details: Record<string, string | undefined>;
}

/**
 * Build a closed-world prompt block listing the user's enabled payment
 * methods. Always injected when there are any enabled methods so the LLM
 * can answer "how do I pay?" without retrieval recall risk.
 *
 * Scoping:
 *   - If `paymentMethodIds` is non-empty, filter to that set (the active
 *     action page's `payment_method_ids[]`).
 *   - If null, return all enabled methods for the user.
 *
 * The system-prompt rule that pairs with this block says: "If a customer
 * asks how to pay, list only methods in 'Available Payment Methods'. Do
 * not mention methods not in that block."
 */
export async function paymentEnumBlock(
  client: SupabaseClient,
  userId: string,
  activePageTitle: string | null,
  paymentMethodIds: string[] | null,
): Promise<string> {
  let query = client
    .from('payment_methods')
    .select('id, kind, name, instructions, details')
    .eq('user_id', userId)
    .eq('enabled', true);

  if (paymentMethodIds && paymentMethodIds.length > 0) {
    query = query.in('id', paymentMethodIds);
  }

  const { data, error } = await query.order('position', { ascending: true });
  if (error) throw new Error(`paymentEnumBlock: ${error.message}`);
  const methods = (data ?? []) as PaymentRow[];
  if (methods.length === 0) return '';

  const header = activePageTitle
    ? `Available Payment Methods (scoped to ${activePageTitle}):`
    : 'Available Payment Methods:';

  const lines = methods.map((m) => {
    const d = m.details ?? {};
    const bits: string[] = [];
    if (d.account_number) bits.push(`Account ${d.account_number}`);
    if (d.account_name) bits.push(`name ${d.account_name}`);
    if (d.bank_name) bits.push(`bank ${d.bank_name}`);
    const detail = bits.length > 0 ? `: ${bits.join(', ')}` : '';
    const inst = m.instructions?.trim() ? ` — ${m.instructions.trim()}` : '';
    return `- ${m.name}${detail}${inst}`;
  });

  return [header, ...lines].join('\n');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/chatbot/payment-enum.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chatbot/payment-enum.ts src/lib/chatbot/payment-enum.test.ts
git commit -m "feat(chatbot): paymentEnumBlock builder"
```

---

### Task 2.2: Inject `paymentEnumBlock` into prompt assembly

**Files:**
- Modify: `src/lib/rag/prompt-builder.ts`
- Modify: `src/lib/rag/prompt-builder.test.ts`

- [ ] **Step 1: Read the current `assembleSystemPrompt` signature**

Run: `grep -n "assembleSystemPrompt\|export function\|paymentEnumBlock\|leadContext" src/lib/rag/prompt-builder.ts | head -20`

- [ ] **Step 2: Write a failing test**

Add to `src/lib/rag/prompt-builder.test.ts`:

```ts
describe('assembleSystemPrompt — payment enum block', () => {
  it('injects the payment enum block above retrieved chunks', () => {
    const prompt = assembleSystemPrompt({
      persona: DEFAULT_CHATBOT_PERSONA,
      instructions: '',
      summary: '',
      leadName: null,
      leadContextBlock: '',
      paymentEnumBlock: 'Available Payment Methods:\n- GCash: 0917-123-4567',
      retrievedChunks: [{ content: 'product info', headingPath: null, score: 0.7 }],
    });
    expect(prompt).toContain('Available Payment Methods');
    expect(prompt.indexOf('Available Payment Methods'))
      .toBeLessThan(prompt.indexOf('product info'));
  });

  it('does not inject anything when paymentEnumBlock is empty', () => {
    const prompt = assembleSystemPrompt({
      persona: DEFAULT_CHATBOT_PERSONA,
      instructions: '',
      summary: '',
      leadName: null,
      leadContextBlock: '',
      paymentEnumBlock: '',
      retrievedChunks: [],
    });
    expect(prompt).not.toContain('Available Payment Methods');
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npx vitest run src/lib/rag/prompt-builder.test.ts`
Expected: FAIL — `paymentEnumBlock` not a recognized param OR the param is silently ignored.

- [ ] **Step 4: Add the param and injection**

In `src/lib/rag/prompt-builder.ts`, find the `assembleSystemPrompt` input type and add `paymentEnumBlock?: string`. In the assembly body, inject above the retrieved-chunks section and below the lead-context block:

```ts
// In the input type:
paymentEnumBlock?: string;

// In the assembly (volatile sections, near where leadContextBlock is rendered):
if (input.paymentEnumBlock && input.paymentEnumBlock.trim()) {
  sections.push(input.paymentEnumBlock.trim());
}
```

Place it directly after `leadContextBlock` injection and before the retrieved chunks section.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/rag/prompt-builder.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/rag/prompt-builder.ts src/lib/rag/prompt-builder.test.ts
git commit -m "feat(chatbot): prompt builder injects paymentEnumBlock"
```

---

### Task 2.3: Wire active-page resolution and pass payment-scope to retriever + prompt

**Files:**
- Modify: `src/lib/chatbot/classify.ts`

- [ ] **Step 1: Find the retrieval and prompt-assembly call sites**

Run: `grep -n "match_knowledge_hybrid_service\|assembleSystemPrompt\|activeCatalogPageId\|activeRealestatePageId" src/lib/chatbot/classify.ts | head -20`

- [ ] **Step 2: Resolve `activePaymentMethodIds` and `activePageTitle`**

In `src/lib/chatbot/classify.ts`, near where `activeCatalogPageId` / `activeRealestatePageId` are read from options, add:

```ts
import { paymentEnumBlock } from './payment-enum';

// inside the function, after active page ids are known:
const activePageId =
  options.activeCatalogPageId ??
  options.activeSalesPageId ??     // add this option if it doesn't exist yet
  options.activeRealestatePageId ??
  null;

let activePaymentMethodIds: string[] | null = null;
let activePageTitle: string | null = null;

if (activePageId) {
  const { data: page } = await client
    .from('action_pages')
    .select('title, config')
    .eq('id', activePageId)
    .maybeSingle();
  if (page) {
    activePageTitle = page.title ?? null;
    const cfg = (page.config ?? {}) as { payment_method_ids?: string[] };
    if (Array.isArray(cfg.payment_method_ids) && cfg.payment_method_ids.length > 0) {
      activePaymentMethodIds = cfg.payment_method_ids;
    }
  }
}

const paymentBlock = await paymentEnumBlock(
  client, userId, activePageTitle, activePaymentMethodIds,
);
```

- [ ] **Step 3: Pass `activePaymentMethodIds` to the retriever RPC**

Find the call to `match_knowledge_hybrid_service` (or whichever wrapper invokes it — probably `src/lib/rag/retriever.ts`). Add `p_payment_method_ids: activePaymentMethodIds` to the RPC params object. If the retriever wrapper doesn't accept this param, update its signature first:

```ts
// in src/lib/rag/retriever.ts:
export interface RetrieveInput {
  // ... existing fields ...
  paymentMethodIds?: string[] | null;
}

// in the body:
const { data, error } = await client.rpc('match_knowledge_hybrid_service', {
  p_user_id: input.userId,
  p_query_text: input.queryText,
  p_query_embed: input.queryEmbed,
  p_match_limit: input.matchLimit ?? 150,
  p_payment_method_ids: input.paymentMethodIds ?? null,
});
```

Then in `classify.ts`:

```ts
const chunks = await retrieve({
  // ... existing fields ...
  paymentMethodIds: activePaymentMethodIds,
});
```

- [ ] **Step 4: Pass `paymentBlock` to `assembleSystemPrompt`**

```ts
const systemPrompt = assembleSystemPrompt({
  // ... existing fields ...
  paymentEnumBlock: paymentBlock,
});
```

- [ ] **Step 5: Run typecheck and tests**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | grep "chatbot/classify\|rag/retriever"`
Expected: no errors.

Run: `npx vitest run src/lib/chatbot/ src/lib/rag/`
Expected: existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/chatbot/classify.ts src/lib/rag/retriever.ts
git commit -m "feat(chatbot): wire payment scoping to retriever + paymentEnumBlock to prompt"
```

---

# Phase 3 — Source Resolver & First-Mention Attach Gate

### Task 3.1: Add `attached_item_keys` column to `messenger_threads`

**Files:**
- Create: `supabase/migrations/20260607000300_messenger_threads_attached_item_keys.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260607000300_messenger_threads_attached_item_keys.sql
-- Per-thread first-mention dedup keys for the source-image auto-attach
-- pipeline. Each key is shaped as "<source>:<id>", e.g. "product:abc",
-- "property:p-xyz", "sales:<action_page_id>", "payment:m-789". The worker
-- FIFO-trims to 100 entries to bound growth on long-lived threads.

alter table public.messenger_threads
  add column if not exists attached_item_keys text[] not null default '{}';
```

- [ ] **Step 2: Apply and verify**

Run: `supabase migration up`.
Run SQL: `select column_default from information_schema.columns where table_name='messenger_threads' and column_name='attached_item_keys';`
Expected: `'{}'::text[]`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260607000300_messenger_threads_attached_item_keys.sql
git commit -m "feat(messenger): attached_item_keys column for first-mention dedup"
```

---

### Task 3.2: Implement `hasVisualIntent` (TDD)

**Files:**
- Create: `src/lib/chatbot/visual-intent.ts`
- Test: `src/lib/chatbot/visual-intent.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/chatbot/visual-intent.test.ts
import { describe, expect, it } from 'vitest';
import { hasVisualIntent } from './visual-intent';

describe('hasVisualIntent', () => {
  it.each([
    ['show me the X10', true],
    ['can you send a photo', true],
    ['any pictures?', true],
    ['what does it look like', true],
    ['I want to see it', true],
    ['pakita mo nga', true],         // Tagalog: show me
    ['may litrato ba?', true],       // Tagalog: do you have a picture
    ['ipakita mo sa akin', true],    // Tagalog: show it to me
  ])('returns true for %p', (msg, expected) => {
    expect(hasVisualIntent(msg)).toBe(expected);
  });

  it.each([
    ['what is the price', false],
    ['how do I pay', false],
    ['is it in stock', false],
    ['', false],
    ['I love this product', false],
  ])('returns false for %p', (msg, expected) => {
    expect(hasVisualIntent(msg)).toBe(expected);
  });

  it('is case-insensitive', () => {
    expect(hasVisualIntent('SHOW ME PLEASE')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/lib/chatbot/visual-intent.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/chatbot/visual-intent.ts

// Word-or-phrase tokens that signal the customer wants to *see* something.
// We match as substrings with word boundaries where possible. The set is
// small on purpose — false negatives (missing intent) just mean we keep
// the existing "skip already attached" behavior. False positives spam
// images, so we err on the side of recall over precision.
const VISUAL_TOKENS = [
  // English
  'show me', 'show it', 'send me a photo', 'send a photo', 'photo',
  'picture', 'pic', 'see it', 'see them', 'look at', 'looks like',
  'what does it look like', 'any photos', 'any pictures', 'image',
  'visuals', 'preview',
  // Tagalog
  'pakita', 'ipakita', 'litrato', 'larawan', 'patingin',
];

const VISUAL_REGEX = new RegExp(
  '\\b(' + VISUAL_TOKENS.map((t) => t.replace(/ /g, '\\s+')).join('|') + ')\\b',
  'i',
);

export function hasVisualIntent(message: string): boolean {
  if (!message) return false;
  return VISUAL_REGEX.test(message);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/chatbot/visual-intent.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chatbot/visual-intent.ts src/lib/chatbot/visual-intent.test.ts
git commit -m "feat(chatbot): hasVisualIntent predicate"
```

---

### Task 3.3: Implement `resolveSourceImages` (TDD)

**Files:**
- Create: `src/lib/chatbot/source-images.ts`
- Test: `src/lib/chatbot/source-images.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/chatbot/source-images.test.ts
import { describe, expect, it, vi } from 'vitest';
import { resolveSourceImages } from './source-images';

function makeFakeSupabase(handlers: Record<string, (filter: { col: string; val: unknown }) => unknown>) {
  return {
    from: vi.fn((table: string) => {
      const state: { col?: string; val?: unknown; selected?: string } = {};
      const builder = {
        select: vi.fn((cols: string) => { state.selected = cols; return builder; }),
        eq: vi.fn((col: string, val: unknown) => { state.col = col; state.val = val; return builder; }),
        in: vi.fn((col: string, vals: unknown[]) => { state.col = col; state.val = vals; return builder; }),
        maybeSingle: vi.fn(async () => ({ data: handlers[table]?.({ col: state.col!, val: state.val }), error: null })),
      };
      return builder;
    }),
  };
}

describe('resolveSourceImages', () => {
  it('resolves product cover image from a business_item chunk', async () => {
    const supabase = makeFakeSupabase({
      business_items: () => ({
        id: 'bi-1', kind: 'product', title: 'X10 Runner',
        cover_image_url: 'https://example.com/x10.png',
        action_page_id: null,
      }),
    });
    const out = await resolveSourceImages(supabase as never, [
      { business_item_id: 'bi-1', payment_method_id: null,
        document_id: null, faq_id: null, media_asset_id: null,
        content: 'X10 is great', rrf_score: 0.8 },
    ]);
    expect(out).toEqual([
      { sourceKey: 'product:bi-1', imageUrl: 'https://example.com/x10.png',
        rerankerScore: 0.8, altText: 'X10 Runner' },
    ]);
  });

  it('resolves payment QR url from a payment_method chunk', async () => {
    const supabase = makeFakeSupabase({
      payment_methods: () => ({ id: 'pm-1', name: 'GCash · Main',
        details: { qr_image_url: 'https://example.com/qr.png' } }),
    });
    const out = await resolveSourceImages(supabase as never, [
      { payment_method_id: 'pm-1', business_item_id: null,
        document_id: null, faq_id: null, media_asset_id: null,
        content: 'GCash', rrf_score: 0.7 },
    ]);
    expect(out[0]).toMatchObject({
      sourceKey: 'payment:pm-1',
      imageUrl: 'https://example.com/qr.png',
    });
  });

  it('deduplicates same source across multiple chunks, keeping highest score', async () => {
    const supabase = makeFakeSupabase({
      business_items: () => ({
        id: 'bi-1', kind: 'product', title: 'X10',
        cover_image_url: 'https://example.com/x10.png',
        action_page_id: null,
      }),
    });
    const out = await resolveSourceImages(supabase as never, [
      { business_item_id: 'bi-1', payment_method_id: null,
        document_id: null, faq_id: null, media_asset_id: null,
        content: 'X10 part 1', rrf_score: 0.6 },
      { business_item_id: 'bi-1', payment_method_id: null,
        document_id: null, faq_id: null, media_asset_id: null,
        content: 'X10 part 2', rrf_score: 0.9 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].rerankerScore).toBe(0.9);
  });

  it('skips chunks without an image', async () => {
    const supabase = makeFakeSupabase({
      business_items: () => ({ id: 'bi-1', kind: 'product', title: 'X10',
        cover_image_url: null, action_page_id: null }),
    });
    const out = await resolveSourceImages(supabase as never, [
      { business_item_id: 'bi-1', payment_method_id: null,
        document_id: null, faq_id: null, media_asset_id: null,
        content: 'X10', rrf_score: 0.5 },
    ]);
    expect(out).toEqual([]);
  });

  it('skips document and faq chunks', async () => {
    const supabase = makeFakeSupabase({});
    const out = await resolveSourceImages(supabase as never, [
      { document_id: 'd-1', business_item_id: null, payment_method_id: null,
        faq_id: null, media_asset_id: null, content: 'doc', rrf_score: 0.7 },
      { faq_id: 'f-1', document_id: null, business_item_id: null,
        payment_method_id: null, media_asset_id: null, content: 'faq', rrf_score: 0.6 },
    ]);
    expect(out).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/lib/chatbot/source-images.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
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
  /** "product:abc" | "property:p-xyz" | "sales:<action_page_id>" | "payment:m-789" */
  sourceKey: string;
  imageUrl: string;
  altText?: string;
  rerankerScore: number;
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
  // Gather unique source ids per kind so we batch DB calls.
  const businessItemIds = unique(chunks.filter((c) => c.business_item_id).map((c) => c.business_item_id!));
  const paymentMethodIds = unique(chunks.filter((c) => c.payment_method_id).map((c) => c.payment_method_id!));

  const [biRows, pmRows] = await Promise.all([
    businessItemIds.length === 0 ? Promise.resolve([]) : fetchBusinessItems(client, businessItemIds),
    paymentMethodIds.length === 0 ? Promise.resolve([]) : fetchPaymentMethods(client, paymentMethodIds),
  ]);

  const biById = new Map(biRows.map((r) => [r.id, r]));
  const pmById = new Map(pmRows.map((r) => [r.id, r]));

  const best = new Map<string, SourceImage>();
  for (const chunk of chunks) {
    let resolved: SourceImage | null = null;
    if (chunk.business_item_id) {
      resolved = await resolveBusinessItemImage(client, chunk, biById.get(chunk.business_item_id));
    } else if (chunk.payment_method_id) {
      const pm = pmById.get(chunk.payment_method_id);
      const qr = pm?.details?.qr_image_url;
      if (qr) {
        resolved = {
          sourceKey: `payment:${pm.id}`,
          imageUrl: qr,
          altText: pm.name,
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

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

interface BusinessItemRow {
  id: string;
  kind: string;
  title: string;
  cover_image_url: string | null;
  action_page_id: string | null;
}

interface PaymentMethodRow {
  id: string;
  name: string;
  details: { qr_image_url?: string };
}

async function fetchBusinessItems(client: SupabaseClient, ids: string[]): Promise<BusinessItemRow[]> {
  const { data, error } = await client
    .from('business_items')
    .select('id, kind, title, cover_image_url, action_page_id')
    .in('id', ids);
  if (error) throw new Error(`resolveSourceImages: business_items fetch failed: ${error.message}`);
  return (data ?? []) as BusinessItemRow[];
}

async function fetchPaymentMethods(client: SupabaseClient, ids: string[]): Promise<PaymentMethodRow[]> {
  const { data, error } = await client
    .from('payment_methods')
    .select('id, name, details')
    .in('id', ids);
  if (error) throw new Error(`resolveSourceImages: payment_methods fetch failed: ${error.message}`);
  return (data ?? []) as PaymentMethodRow[];
}

async function resolveBusinessItemImage(
  client: SupabaseClient,
  chunk: RetrievedChunk,
  row: BusinessItemRow | undefined,
): Promise<SourceImage | null> {
  if (!row) return null;
  if (row.kind === 'product') {
    if (!row.cover_image_url) return null;
    return {
      sourceKey: `product:${row.id}`,
      imageUrl: row.cover_image_url,
      altText: row.title,
      rerankerScore: chunk.rrf_score,
    };
  }
  if (row.kind === 'property' || row.kind === 'service') {
    // Property / sales: look up the action page config to find the gallery primary.
    if (!row.action_page_id) return null;
    const { data: pageRow } = await client
      .from('action_pages')
      .select('config, kind')
      .eq('id', row.action_page_id)
      .maybeSingle();
    if (!pageRow) return null;

    if (pageRow.kind === 'realestate') {
      const url = pickRealestatePrimaryUrl(pageRow.config as { properties?: { id: string; gallery?: { url: string; primary?: boolean }[] }[] }, row.id);
      if (!url) return null;
      return {
        sourceKey: `property:${row.id}`,
        imageUrl: url,
        altText: row.title,
        rerankerScore: chunk.rrf_score,
      };
    }
    if (pageRow.kind === 'sales') {
      const url = pickSalesPrimaryUrl(pageRow.config as { gallery?: { url: string; primary?: boolean }[] });
      if (!url) return null;
      return {
        sourceKey: `sales:${row.action_page_id}`,
        imageUrl: url,
        altText: row.title,
        rerankerScore: chunk.rrf_score,
      };
    }
  }
  return null;
}

function pickRealestatePrimaryUrl(
  config: { properties?: { id: string; gallery?: { url: string; primary?: boolean }[] }[] },
  businessItemId: string,
): string | null {
  const properties = config.properties ?? [];
  // business_item.id is the property's chunked id; matching by id-suffix is the cleanest
  // way to find the source property without re-deriving the slug. The action-page sync
  // writes business_items with id derived from the property id, so they line up.
  const prop = properties.find((p) => businessItemId.endsWith(p.id) || p.id === businessItemId);
  if (!prop?.gallery || prop.gallery.length === 0) return null;
  const primary = prop.gallery.find((g) => g.primary) ?? prop.gallery[0];
  return primary?.url ?? null;
}

function pickSalesPrimaryUrl(
  config: { gallery?: { url: string; primary?: boolean }[] },
): string | null {
  if (!config.gallery || config.gallery.length === 0) return null;
  const primary = config.gallery.find((g) => g.primary) ?? config.gallery[0];
  return primary?.url ?? null;
}
```

> **Note on `pickRealestatePrimaryUrl`:** verify the actual id relationship at implementation time by reading `src/lib/action-pages/rag/sync.ts` (the function `syncRealestateToBusinessItems`). If property `business_items` rows are created with id `p-${prop.id}`, then `businessItemId.endsWith(p.id)` is correct. If they use a different scheme, store the mapping in a column or look up via a join.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/chatbot/source-images.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chatbot/source-images.ts src/lib/chatbot/source-images.test.ts
git commit -m "feat(chatbot): resolveSourceImages maps chunks to source images"
```

---

### Task 3.4: Implement `firstMentionGate` (TDD)

**Files:**
- Create: `src/lib/chatbot/attach-gate.ts`
- Test: `src/lib/chatbot/attach-gate.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/chatbot/attach-gate.test.ts
import { describe, expect, it } from 'vitest';
import { firstMentionGate } from './attach-gate';
import type { SourceImage } from './source-images';

function img(key: string, score: number): SourceImage {
  return { sourceKey: key, imageUrl: `https://e.com/${key}.png`, rerankerScore: score };
}

describe('firstMentionGate', () => {
  it('lets first-mention items through unconditionally', () => {
    const r = firstMentionGate({
      attachedItemKeys: [],
      candidates: [img('product:a', 0.7), img('product:b', 0.6)],
      customerText: 'tell me about it',
    });
    expect(r.approved.map((c) => c.sourceKey)).toEqual(['product:a', 'product:b']);
    expect(r.newKeys).toEqual(['product:a', 'product:b']);
  });

  it('skips already-attached items without visual intent', () => {
    const r = firstMentionGate({
      attachedItemKeys: ['product:a'],
      candidates: [img('product:a', 0.7)],
      customerText: 'what is the price',
    });
    expect(r.approved).toEqual([]);
    expect(r.newKeys).toEqual([]);
  });

  it('re-attaches already-attached items when visual intent is present', () => {
    const r = firstMentionGate({
      attachedItemKeys: ['product:a'],
      candidates: [img('product:a', 0.7)],
      customerText: 'can you show me again',
    });
    expect(r.approved.map((c) => c.sourceKey)).toEqual(['product:a']);
    expect(r.newKeys).toEqual([]);  // already in attached list, no append
  });

  it('caps approvals at 3 per turn (highest scores win)', () => {
    const r = firstMentionGate({
      attachedItemKeys: [],
      candidates: [
        img('a', 0.5), img('b', 0.9), img('c', 0.7),
        img('d', 0.8), img('e', 0.6),
      ],
      customerText: 'show me',
    });
    expect(r.approved).toHaveLength(3);
    expect(r.approved.map((c) => c.sourceKey)).toEqual(['b', 'd', 'c']);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/lib/chatbot/attach-gate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/chatbot/attach-gate.ts
import { hasVisualIntent } from './visual-intent';
import type { SourceImage } from './source-images';

export interface FirstMentionGateInput {
  attachedItemKeys: string[];
  candidates: SourceImage[];
  customerText: string;
  /** Defaults to 3. Caps how many images go out in a single reply. */
  maxPerTurn?: number;
}

export interface FirstMentionGateResult {
  approved: SourceImage[];
  /** Subset of approved keys not yet in attachedItemKeys — append these after sending. */
  newKeys: string[];
}

/**
 * Decide which source images to actually send this turn.
 *
 * Rules:
 *   - First-mention (key not in attachedItemKeys): unconditional pass.
 *   - Already-attached: pass only when the customer's message shows visual intent.
 *   - Cap at maxPerTurn (default 3), ordered by reranker score descending.
 */
export function firstMentionGate(input: FirstMentionGateInput): FirstMentionGateResult {
  const cap = input.maxPerTurn ?? 3;
  const attached = new Set(input.attachedItemKeys);
  const visualIntent = hasVisualIntent(input.customerText);

  const eligible: SourceImage[] = [];
  for (const c of input.candidates) {
    const seen = attached.has(c.sourceKey);
    if (!seen || visualIntent) eligible.push(c);
  }

  eligible.sort((a, b) => b.rerankerScore - a.rerankerScore);
  const approved = eligible.slice(0, cap);
  const newKeys = approved.filter((c) => !attached.has(c.sourceKey)).map((c) => c.sourceKey);

  return { approved, newKeys };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/chatbot/attach-gate.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chatbot/attach-gate.ts src/lib/chatbot/attach-gate.test.ts
git commit -m "feat(chatbot): firstMentionGate decides source-image sends"
```

---

### Task 3.5: Recommendation senders accept `alreadyAttachedKeys`

**Files:**
- Modify: `src/lib/messenger/outbound.ts`
- Modify: `src/lib/messenger/property-outbound.ts`

Do this first so Task 3.6 can pass the new arg without TypeScript errors.

- [ ] **Step 1: Add `alreadyAttachedKeys` to product sender**

In `src/lib/messenger/outbound.ts`, extend `ProductRecommendationSendInput`:

```ts
export interface ProductRecommendationSendInput {
  // ... existing fields ...
  /** Source keys already shown as images on this thread; skip image step if `product:<product.id>` is in this list. */
  alreadyAttachedKeys?: string[];
}
```

Inside `sendProductRecommendation`, before the image-send block:

```ts
const productSourceKey = `product:${product.id}`;
const alreadyShown = args.alreadyAttachedKeys?.includes(productSourceKey) ?? false;

if (product.cover_image_url && !alreadyShown) {
  // ... existing image send ...
}
```

Wrap the existing `if (product.cover_image_url)` block with the `&& !alreadyShown` condition.

- [ ] **Step 2: Add `alreadyAttachedKeys` to property sender**

In `src/lib/messenger/property-outbound.ts`, extend `PropertyRecommendationSendInput`:

```ts
export interface PropertyRecommendationSendInput {
  // ... existing fields ...
  alreadyAttachedKeys?: string[];
}
```

Inside `sendPropertyRecommendation`:

```ts
const propertySourceKey = `property:${property.id}`;
const alreadyShown = args.alreadyAttachedKeys?.includes(propertySourceKey) ?? false;

if (property.cover_image_url && !alreadyShown) {
  // ... existing image send ...
}
```

- [ ] **Step 3: Run typecheck and the existing recommendation tests**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | grep "messenger/outbound\|messenger/property" | head`
Expected: no errors.

Run: `npx vitest run src/lib/messenger/`
Expected: PASS — existing tests still pass (the new arg is optional).

- [ ] **Step 4: Commit**

```bash
git add src/lib/messenger/outbound.ts src/lib/messenger/property-outbound.ts
git commit -m "feat(messenger): recommendation senders accept alreadyAttachedKeys"
```

---

### Task 3.6: Wire resolver + gate into messenger process route

**Files:**
- Modify: `src/app/api/messenger/process/route.ts`

- [ ] **Step 1: Find the insertion point**

Run: `grep -n "sendSelectedMedia\|productRecommendation\|propertyRecommendation\|attached_item_keys" src/app/api/messenger/process/route.ts | head -10`

The pipeline currently runs `sendSelectedMedia` then the recommendation branches then the text-reply branch. The new resolver + gate insert directly after `sendSelectedMedia`.

- [ ] **Step 2: Load the thread's current `attached_item_keys`**

Find the place where the thread row is loaded (look for `.select('id, psid, last_inbound_at, ...')`). Add `attached_item_keys` to the selected columns. Find where `thread` is typed and add:

```ts
attached_item_keys: string[]
```

- [ ] **Step 3: Add the attach pipeline**

After the `sendSelectedMedia` call and before the recommendation / text-reply branches, insert:

```ts
import { resolveSourceImages } from '@/lib/chatbot/source-images';
import { firstMentionGate } from '@/lib/chatbot/attach-gate';

// Run the source-image attach pipeline. This is separate from the
// existing @asset/#folder media flow — both run, and the worker dedupes
// by URL before sending.
const sourceImageCandidates = await resolveSourceImages(admin, topChunks);
const gateResult = firstMentionGate({
  attachedItemKeys: thread.attached_item_keys ?? [],
  candidates: sourceImageCandidates,
  customerText: inboundText,
});

const sentSourceImageUrls = new Set<string>();
for (const candidate of gateResult.approved) {
  if (sentSourceImageUrls.has(candidate.imageUrl)) continue;
  const sendResult = await sendOutbound({
    admin,
    thread: { id: thread.id, psid: thread.psid, last_inbound_at: thread.last_inbound_at },
    pageToken,
    payload: { kind: 'image', imageUrl: candidate.imageUrl },
    kind: 'bot',
  });
  if (sendResult.sent) {
    sentSourceImageUrls.add(candidate.imageUrl);
    await admin.from('messenger_messages').insert({
      thread_id: thread.id,
      user_id: thread.user_id,
      direction: 'outbound',
      sender: 'bot',
      fb_message_id: sendResult.messageId,
      body: '',
      attachments: {
        kind: 'source_image',
        source_key: candidate.sourceKey,
        image_url: candidate.imageUrl,
        score: candidate.rerankerScore,
      },
    });
    console.log('[messenger.worker] source image attached', {
      threadId: thread.id, sourceKey: candidate.sourceKey, score: candidate.rerankerScore,
    });
  } else {
    console.warn('[messenger.worker] source image send blocked', {
      threadId: thread.id, sourceKey: candidate.sourceKey, reason: sendResult.reason,
    });
  }
}

// Persist new attached keys (FIFO trim to 100).
if (gateResult.newKeys.length > 0) {
  const current = thread.attached_item_keys ?? [];
  const next = [...current, ...gateResult.newKeys];
  const trimmed = next.length > 100 ? next.slice(next.length - 100) : next;
  await admin
    .from('messenger_threads')
    .update({ attached_item_keys: trimmed })
    .eq('id', thread.id);
  // Update local copy so downstream sends see the new state.
  thread.attached_item_keys = trimmed;
}
```

Place this block after `sendSelectedMedia` and before the product-recommendation branch.

- [ ] **Step 4: Pass the gate state to existing recommendation senders**

Find the calls to `sendProductRecommendation` and `sendPropertyRecommendation`. Add a new arg (the field was added in Task 3.5):

```ts
const recResult = await sendProductRecommendation({
  // ... existing args ...
  alreadyAttachedKeys: thread.attached_item_keys ?? [],
});
```

Do the same for the property recommendation call.

- [ ] **Step 5: Run typecheck**

Run: `npx tsc --noEmit --project tsconfig.json 2>&1 | grep "messenger/process/route\|chatbot/source-images\|chatbot/attach-gate" | head`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/messenger/process/route.ts
git commit -m "feat(messenger): wire source-image attach pipeline into worker"
```

---

# Phase 4 — Source Markers & Grounding Rules

### Task 4.1: Add source markers to retrieved chunks in prompt builder (TDD)

**Files:**
- Modify: `src/lib/rag/prompt-builder.ts`
- Modify: `src/lib/rag/prompt-builder.test.ts`

- [ ] **Step 1: Read the current chunk-rendering code**

Run: `grep -n "retrievedChunks\|Knowledge Base\|chunk.content\|heading_path" src/lib/rag/prompt-builder.ts | head -10`

Find where the retrieved chunks are formatted into the prompt. Each chunk currently renders something like:
```
<content>
```
We're adding a one-line prefix marker.

- [ ] **Step 2: Write a failing test**

Add to `src/lib/rag/prompt-builder.test.ts`:

```ts
describe('assembleSystemPrompt — source markers', () => {
  it('prefixes product chunks with [product:Title · id]', () => {
    const prompt = assembleSystemPrompt({
      persona: DEFAULT_CHATBOT_PERSONA,
      instructions: '',
      summary: '',
      leadName: null,
      leadContextBlock: '',
      paymentEnumBlock: '',
      retrievedChunks: [{
        content: 'The X10 uses recycled mesh.',
        headingPath: null,
        score: 0.8,
        source: { kind: 'product', id: 'bi-1', title: 'X10 Runner' },
      }],
    });
    expect(prompt).toMatch(/\[product:X10 Runner · bi-1\]/);
  });

  it('prefixes payment chunks with [payment:Name]', () => {
    const prompt = assembleSystemPrompt({
      persona: DEFAULT_CHATBOT_PERSONA,
      instructions: '',
      summary: '',
      leadName: null,
      leadContextBlock: '',
      paymentEnumBlock: '',
      retrievedChunks: [{
        content: 'GCash to 0917-123-4567',
        headingPath: null,
        score: 0.8,
        source: { kind: 'payment_method', id: 'pm-1', title: 'GCash · Main' },
      }],
    });
    expect(prompt).toMatch(/\[payment:GCash · Main\]/);
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run: `npx vitest run src/lib/rag/prompt-builder.test.ts`
Expected: FAIL — marker not present.

- [ ] **Step 4: Implement the source-marker rendering**

In `src/lib/rag/prompt-builder.ts`:

1. Extend the chunk input type to include source info:

```ts
export interface PromptChunk {
  content: string;
  headingPath: string | null;
  score: number;
  source?: {
    kind: 'product' | 'property' | 'sales' | 'payment_method' | 'document' | 'faq';
    id: string;
    title: string;
  };
}
```

2. In the rendering loop, prefix each chunk with its marker:

```ts
function renderChunkMarker(chunk: PromptChunk): string {
  if (!chunk.source) return '';
  const { kind, id, title } = chunk.source;
  switch (kind) {
    case 'product':       return `[product:${title} · ${id}]`;
    case 'property':      return `[property:${title} · ${id}]`;
    case 'sales':         return `[sales:${title} · ${id}]`;
    case 'payment_method': return `[payment:${title}]`;
    case 'document':      return `[doc:${title}]`;
    case 'faq':           return `[faq:${title}]`;
  }
}

// in the existing chunk loop:
const marker = renderChunkMarker(chunk);
const body = chunk.content.trim();
chunkBlock.push(marker ? `${marker}\n${body}` : body);
```

- [ ] **Step 5: Update the retriever caller to populate `source`**

In `src/lib/rag/retriever.ts` (or wherever retrieved chunks are mapped to `PromptChunk`s), enrich each chunk by looking up its source. Use a single batched join — pseudocode:

```ts
// After retrieval, batch-fetch source titles:
const biIds = chunks.filter((c) => c.business_item_id).map((c) => c.business_item_id!);
const pmIds = chunks.filter((c) => c.payment_method_id).map((c) => c.payment_method_id!);
// ... document_id and faq_id similarly ...

const biMap = await fetchBusinessItemTitles(client, biIds);  // returns Map<id, {kind, title, action_page_id}>
const pmMap = await fetchPaymentMethodTitles(client, pmIds);
// ...

const enriched: PromptChunk[] = chunks.map((c) => ({
  content: c.content,
  headingPath: c.heading_path,
  score: c.rrf_score,
  source: resolveSourceMeta(c, biMap, pmMap, /* docMap, faqMap */),
}));

function resolveSourceMeta(c, biMap, pmMap): PromptChunk['source'] | undefined {
  if (c.business_item_id) {
    const bi = biMap.get(c.business_item_id);
    if (!bi) return undefined;
    if (bi.kind === 'product') return { kind: 'product', id: c.business_item_id, title: bi.title };
    if (bi.kind === 'property') return { kind: 'property', id: c.business_item_id, title: bi.title };
    if (bi.kind === 'service') return { kind: 'sales', id: bi.action_page_id ?? c.business_item_id, title: bi.title };
  }
  if (c.payment_method_id) {
    const pm = pmMap.get(c.payment_method_id);
    if (pm) return { kind: 'payment_method', id: c.payment_method_id, title: pm.name };
  }
  // ... document / faq ...
  return undefined;
}
```

Write the helper functions `fetchBusinessItemTitles`, `fetchPaymentMethodTitles`, etc. as straightforward `select(...).in('id', ids)` calls.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run src/lib/rag/prompt-builder.test.ts src/lib/rag/retriever.test.ts`
Expected: PASS — including the two new marker tests and all existing tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rag/prompt-builder.ts src/lib/rag/prompt-builder.test.ts src/lib/rag/retriever.ts
git commit -m "feat(rag): annotate retrieved chunks with source markers"
```

---

### Task 4.2: Extend grounding rules in `DEFAULT_CHATBOT_PERSONA`

**Files:**
- Modify: `src/lib/rag/prompt-builder.ts`
- Modify: `src/lib/rag/prompt-builder.test.ts`

- [ ] **Step 1: Write a failing test**

Add to `src/lib/rag/prompt-builder.test.ts`:

```ts
describe('DEFAULT_CHATBOT_PERSONA — extended grounding rules', () => {
  it('warns against inventing product / property / payment / order facts', () => {
    const prompt = assembleSystemPrompt({
      persona: DEFAULT_CHATBOT_PERSONA,
      instructions: '',
      summary: '',
      leadName: null,
      leadContextBlock: '',
      paymentEnumBlock: '',
      retrievedChunks: [],
    });
    expect(prompt).toMatch(/Product details.*\[product:/);
    expect(prompt).toMatch(/Property details.*\[property:/);
    expect(prompt).toMatch(/Payment account numbers.*Available Payment Methods/);
    expect(prompt).toMatch(/Customer order.*Customer Records|Customer order.*not present/);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `npx vitest run src/lib/rag/prompt-builder.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the rules to `DEFAULT_CHATBOT_PERSONA`**

In `src/lib/rag/prompt-builder.ts`, find `DEFAULT_CHATBOT_PERSONA` and locate its grounding rules section. Append:

```
- Product details, prices, features, and inventory status come only from chunks marked [product:...]. Do not invent specs.
- Property details (price, location, specs, amenities) come only from chunks marked [property:...]. Do not invent listings or details.
- Sales-offer details (price, headline, features, FAQs, guarantee) come only from chunks marked [sales:...]. Do not invent.
- Payment account numbers, names, and instructions come only from 'Available Payment Methods'. Never invent or paraphrase account numbers.
- Customer order, booking, and submission state comes only from 'Customer Records' (the lead-context block). If asked about a record not present there, say you don't have it on file.
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/rag/prompt-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/rag/prompt-builder.ts src/lib/rag/prompt-builder.test.ts
git commit -m "feat(rag): extend grounding rules with source-specific anti-hallucination clauses"
```

---

## Integration / Smoke Test Pass

After all four phases are committed, run the full suite and exercise the worker end-to-end.

- [ ] **Run the full test suite**

```bash
npx vitest run
```
Expected: green across the board.

- [ ] **Run a typecheck pass**

```bash
npx tsc --noEmit --project tsconfig.json
```
Expected: no new errors introduced.

- [ ] **Manual end-to-end: Journey D ("How do I pay?")**

1. With at least one enabled payment method on a test user, open a thread to a catalog action page that has `payment_method_ids` set.
2. Send the customer message "How do I pay?".
3. Verify in `messenger_messages` rows:
   - An image row with `attachments.kind = 'source_image'` and `source_key = 'payment:<id>'`.
   - A text reply that lists account number(s) verbatim, no invented methods.
4. Send a follow-up "anything else?" — verify no payment image is re-sent.
5. Send "can you show me the QR again?" — verify the payment image is re-sent (visual intent path).

- [ ] **Manual end-to-end: Journey A → B ("Do you have running shoes under 3k?" → "What materials?")**

1. On a catalog page with at least 2 published products, send the price-range query.
2. Verify two image rows appear with `source_key = 'product:<id>'`, followed by a recommendation card.
3. Send the materials follow-up. Verify no images are re-sent (already in `attached_item_keys`).
4. Send "can you send the photo again?" — verify the image is re-sent.

- [ ] **Manual adversarial: "Do you accept Maya?" (Maya is not enabled)**

1. With only GCash + BPI enabled, send the Maya question.
2. Verify the reply does NOT confirm Maya. Closed-world block should make the bot refuse / defer.

---

## Self-Review

**Spec coverage check (against `docs/superpowers/specs/2026-05-23-unified-rag-knowledge-pipeline-design.md`):**

| Spec section | Implementing task(s) |
|---|---|
| Migration 1 (`knowledge_chunks.payment_method_id`) | 1.3 |
| Migration 2 (`messenger_threads.attached_item_keys`) | 3.1 |
| Migration 3 (RPC update) | 1.7 |
| `buildPaymentMethodRagText` | 1.4 |
| Embed-worker `payment_method` branch | 1.6 |
| `syncPaymentMethodToKnowledge` | 1.8 |
| Sync hook in server actions | 1.9 |
| Backfill script | 1.10 |
| `paymentEnumBlock` | 2.1 |
| Prompt-builder injection | 2.2 |
| Active-page resolution + retriever scoping | 2.3 |
| `resolveSourceImages` | 3.3 |
| `firstMentionGate` + `hasVisualIntent` | 3.2, 3.4 |
| Recommendation-sender skip logic | 3.5 |
| Worker wiring | 3.6 |
| Source markers | 4.1 |
| Anti-hallucination clauses | 4.2 |

**Out-of-scope items left untouched (correct, per spec):** per-page chatbot-instruction UI, RAG indexing of orders/submissions, LLM-driven action-page deeplink decision logic, multi-modal embeddings.
