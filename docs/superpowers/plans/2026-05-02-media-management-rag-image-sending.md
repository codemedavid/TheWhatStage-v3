# Media Management RAG Image Sending Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dashboard media manager with folder/image descriptions, index media for retrieval, allow knowledge documents to reference media with `#folder-slug` and `@asset-slug`, and automatically send up to 4 matching images in Messenger replies.

**Architecture:** Media folders and assets become first-class user-owned records backed by a private Supabase Storage bucket. Media assets are embedded into `knowledge_chunks` as atomic chunks, but normal text-answer retrieval remains limited to documents, FAQs, and business items; a separate media selector uses explicit references plus semantic media search to choose attachments. The Messenger worker sends text first, then selected images with retry-safe idempotency.

**Tech Stack:** Next.js 16 App Router, React 19 Server Actions/forms, Supabase Postgres/RLS/Storage, pgvector, Vitest, Facebook Messenger Send API.

---

## File Structure

- Create `supabase/migrations/20260502090000_media_management.sql` for media tables, storage bucket, RLS, `knowledge_chunks.media_asset_id`, `knowledge_embedding_jobs.media_asset_id`, media retrieval RPCs, and Messenger idempotency columns.
- Create `src/lib/media/schemas.ts` for Zod schemas shared by Server Actions.
- Create `src/lib/media/slug.ts` and `src/lib/media/slug.test.ts` for deterministic folder/image slug creation.
- Create `src/lib/media/rag-text.ts` and `src/lib/media/rag-text.test.ts` for media chunk text and explicit-reference extraction.
- Create `src/lib/media/selector.ts` and `src/lib/media/selector.test.ts` for `selectMediaForReply`.
- Create `src/app/(app)/dashboard/media/_lib/queries.ts` for media dashboard reads.
- Create `src/app/(app)/dashboard/media/actions.ts` for folder/image mutations and embedding enqueue.
- Create `src/app/(app)/dashboard/media/upload/route.ts` for multipart image upload.
- Create `src/app/(app)/dashboard/media/_components/MediaManager.client.tsx` for folder list, upload form, and image edit UI.
- Create `src/app/(app)/dashboard/media/page.tsx` for the server page shell.
- Modify `src/app/(app)/_components/sidebar.tsx` to add Media navigation.
- Modify `src/lib/rag/types.ts`, `src/lib/rag/parsers/index.ts`, `src/lib/rag/ingest.ts`, `src/lib/rag/queue.ts`, `src/lib/rag/worker/embed-job.ts`, and tests for the `media_asset` source kind.
- Modify `src/lib/chatbot/answer.ts` so it returns selected media assets with text answers.
- Modify `src/lib/facebook/messenger.ts` to add `sendMessengerImage`.
- Modify `src/app/api/messenger/process/route.ts` to send selected media after the text reply.
- Modify `src/app/api/chatbot/test/route.ts` to emit selected media metadata for dashboard test chat verification.

---

### Task 1: Database, Storage, and RPC Foundation

**Files:**
- Create: `supabase/migrations/20260502090000_media_management.sql`

- [ ] **Step 1: Write the migration**

Create the migration with this structure:

```sql
-- Media manager: folders, image assets, RAG chunks, and Messenger image idempotency.

create table public.media_folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  description text check (description is null or char_length(description) <= 2000),
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  folder_id uuid not null references public.media_folders(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,119}$'),
  description text check (description is null or char_length(description) <= 4000),
  storage_path text not null check (char_length(storage_path) between 1 and 700),
  mime_type text not null check (mime_type in ('image/jpeg','image/png','image/webp','image/gif')),
  byte_size integer not null check (byte_size > 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  position integer not null default 0,
  is_archived boolean not null default false,
  embedding_status text not null default 'pending' check (embedding_status in ('pending','indexed','stale')),
  version integer not null default 0 check (version >= 0),
  embedded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, slug)
);

create index media_folders_user_position_idx on public.media_folders (user_id, position, created_at);
create index media_assets_user_folder_position_idx on public.media_assets (user_id, folder_id, position, created_at);
create index media_assets_user_active_idx on public.media_assets (user_id, updated_at desc) where not is_archived;
create index media_assets_search_idx on public.media_assets using gin (
  to_tsvector('simple'::regconfig, coalesce(name,'') || ' ' || coalesce(slug,'') || ' ' || coalesce(description,''))
);

create trigger media_folders_set_updated_at
before update on public.media_folders
for each row execute function public.set_updated_at();

create trigger media_assets_set_updated_at
before update on public.media_assets
for each row execute function public.set_updated_at();

alter table public.media_folders enable row level security;
alter table public.media_assets enable row level security;

create policy media_folders_owner_all on public.media_folders
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy media_assets_owner_all on public.media_assets
  for all to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.media_folders mf
      where mf.id = media_assets.folder_id
        and mf.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.media_folders mf
      where mf.id = media_assets.folder_id
        and mf.user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.media_folders to authenticated;
grant select, insert, update, delete on public.media_assets to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'media-assets',
  'media-assets',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "media_assets_owner_read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'media-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "media_assets_owner_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'media-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "media_assets_owner_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'media-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "media_assets_owner_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'media-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

alter table public.knowledge_chunks
  add column if not exists media_asset_id uuid references public.media_assets(id) on delete cascade;

alter table public.knowledge_chunks
  drop constraint if exists knowledge_chunks_one_source;

alter table public.knowledge_chunks
  add constraint knowledge_chunks_one_source
  check (num_nonnulls(document_id, faq_id, business_item_id, media_asset_id) = 1);

alter table public.knowledge_chunks
  add constraint knowledge_chunks_media_asset_chunk_uniq unique (media_asset_id, chunk_index);

alter table public.knowledge_embedding_jobs
  add column if not exists media_asset_id uuid references public.media_assets(id) on delete cascade;

alter table public.knowledge_embedding_jobs
  drop constraint if exists knowledge_embedding_jobs_one_source;

alter table public.knowledge_embedding_jobs
  add constraint knowledge_embedding_jobs_one_source
  check (num_nonnulls(document_id, faq_id, business_item_id, media_asset_id) = 1);

create unique index knowledge_embedding_jobs_active_media_asset_uniq
  on public.knowledge_embedding_jobs (media_asset_id)
  where media_asset_id is not null and status in ('queued','running');

alter table public.messenger_messages
  add column if not exists media_asset_id uuid references public.media_assets(id) on delete set null;

alter table public.messenger_jobs
  add column if not exists outbound_media jsonb not null default '[]'::jsonb;
```

Then extend `apply_knowledge_ingest`, `match_knowledge_hybrid`, and `match_knowledge_hybrid_service` in the same migration:

```sql
-- Keep text-answer retrieval excluding media_asset_id. Media is selected by match_media_assets.
-- In both match_knowledge_hybrid functions, return media_asset_id as null and keep eligible sources
-- limited to documents, published FAQs, and published RAG-enabled business items.

create or replace function public.match_media_assets(
  p_user_id uuid,
  p_query_text text,
  p_query_embed vector(1024),
  p_match_limit int default 40,
  p_full_text_w float default 1.0,
  p_semantic_w float default 1.0,
  p_rrf_k int default 60
)
returns table (
  media_asset_id uuid,
  chunk_id uuid,
  rrf_score float
)
language sql
stable
security invoker
set search_path = public
as $$
  with eligible as (
    select kc.id
    from public.knowledge_chunks kc
    join public.media_assets ma on ma.id = kc.media_asset_id
    where auth.uid() is not null
      and p_user_id = auth.uid()
      and kc.user_id = auth.uid()
      and not ma.is_archived
  ),
  fts as (
    select kc.id,
           row_number() over (
             order by ts_rank_cd(to_tsvector('simple', kc.content), websearch_to_tsquery('simple', p_query_text)) desc
           ) as rank
    from public.knowledge_chunks kc
    join eligible e on e.id = kc.id
    where to_tsvector('simple', kc.content) @@ websearch_to_tsquery('simple', p_query_text)
    limit p_match_limit
  ),
  sem as (
    select kc.id,
           row_number() over (order by kc.embedding <=> p_query_embed) as rank
    from public.knowledge_chunks kc
    join eligible e on e.id = kc.id
    order by kc.embedding <=> p_query_embed
    limit p_match_limit
  ),
  fused as (
    select id from fts
    union
    select id from sem
  )
  select kc.media_asset_id,
         kc.id as chunk_id,
         coalesce(p_full_text_w / (p_rrf_k + fts.rank), 0)
           + coalesce(p_semantic_w / (p_rrf_k + sem.rank), 0) as rrf_score
  from fused
  join public.knowledge_chunks kc on kc.id = fused.id
  left join fts on fts.id = kc.id
  left join sem on sem.id = kc.id
  where kc.user_id = auth.uid()
    and kc.media_asset_id is not null
  order by rrf_score desc
  limit p_match_limit;
$$;

grant execute on function public.match_media_assets(uuid, text, vector, int, float, float, int) to authenticated;

create or replace function public.match_media_assets_service(
  p_user_id uuid,
  p_query_text text,
  p_query_embed vector(1024),
  p_match_limit int default 40,
  p_full_text_w float default 1.0,
  p_semantic_w float default 1.0,
  p_rrf_k int default 60
)
returns table (
  media_asset_id uuid,
  chunk_id uuid,
  rrf_score float
)
language sql
stable
security definer
set search_path = public
as $$
  with eligible as (
    select kc.id
    from public.knowledge_chunks kc
    join public.media_assets ma on ma.id = kc.media_asset_id
    where kc.user_id = p_user_id
      and not ma.is_archived
  ),
  fts as (
    select kc.id,
           row_number() over (
             order by ts_rank_cd(to_tsvector('simple', kc.content), websearch_to_tsquery('simple', p_query_text)) desc
           ) as rank
    from public.knowledge_chunks kc
    join eligible e on e.id = kc.id
    where to_tsvector('simple', kc.content) @@ websearch_to_tsquery('simple', p_query_text)
    limit p_match_limit
  ),
  sem as (
    select kc.id,
           row_number() over (order by kc.embedding <=> p_query_embed) as rank
    from public.knowledge_chunks kc
    join eligible e on e.id = kc.id
    order by kc.embedding <=> p_query_embed
    limit p_match_limit
  ),
  fused as (
    select id from fts
    union
    select id from sem
  )
  select kc.media_asset_id,
         kc.id as chunk_id,
         coalesce(p_full_text_w / (p_rrf_k + fts.rank), 0)
           + coalesce(p_semantic_w / (p_rrf_k + sem.rank), 0) as rrf_score
  from fused
  join public.knowledge_chunks kc on kc.id = fused.id
  left join fts on fts.id = kc.id
  left join sem on sem.id = kc.id
  where kc.user_id = p_user_id
    and kc.media_asset_id is not null
  order by rrf_score desc
  limit p_match_limit;
$$;

grant execute on function public.match_media_assets_service(uuid, text, vector, int, float, float, int) to service_role;
```

- [ ] **Step 2: Run a SQL sanity check**

Run:

```bash
npx supabase db lint --local
```

Expected: no syntax errors in the new migration. If the local Supabase CLI is not installed, run:

```bash
npm run lint
```

Expected: existing lint output should not mention the migration because SQL lint is unavailable.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260502090000_media_management.sql
git commit -m "feat(db): add media manager schema"
```

---

### Task 2: Media Domain Utilities

**Files:**
- Create: `src/lib/media/slug.ts`
- Create: `src/lib/media/slug.test.ts`
- Create: `src/lib/media/schemas.ts`
- Create: `src/lib/media/rag-text.ts`
- Create: `src/lib/media/rag-text.test.ts`

- [ ] **Step 1: Write failing tests for slugs and media RAG text**

Create `src/lib/media/slug.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { makeSlug } from './slug'

describe('makeSlug', () => {
  it('normalizes names into lowercase dash slugs', () => {
    expect(makeSlug('New Review Customer Ryan!')).toBe('new-review-customer-ryan')
  })

  it('uses fallback when input has no safe characters', () => {
    expect(makeSlug('***', 'image')).toBe('image')
  })

  it('caps length without leaving trailing dashes', () => {
    expect(makeSlug('A '.repeat(90), 'item', 12)).toBe('a-a-a-a-a-a')
  })
})
```

Create `src/lib/media/rag-text.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildMediaRagText, extractMediaRefs } from './rag-text'

describe('buildMediaRagText', () => {
  it('includes folder and image descriptions with reference tokens', () => {
    expect(
      buildMediaRagText({
        folderName: 'Reviews',
        folderSlug: 'image-review',
        folderDescription: 'Customer proof and testimonials.',
        assetName: 'Ryan Engineer Review',
        assetSlug: 'new-review-customer-ryan',
        assetDescription: 'Review from engineer Ryan about build quality.',
      }),
    ).toContain('Folder slug: #image-review')
    expect(
      buildMediaRagText({
        folderName: 'Reviews',
        folderSlug: 'image-review',
        folderDescription: 'Customer proof and testimonials.',
        assetName: 'Ryan Engineer Review',
        assetSlug: 'new-review-customer-ryan',
        assetDescription: 'Review from engineer Ryan about build quality.',
      }),
    ).toContain('Image slug: @new-review-customer-ryan')
  })
})

describe('extractMediaRefs', () => {
  it('extracts unique folder and asset refs in first-seen order', () => {
    expect(extractMediaRefs('Use #image-review and @ryan-review. Then #image-review again.')).toEqual({
      folderSlugs: ['image-review'],
      assetSlugs: ['ryan-review'],
    })
  })

  it('ignores email addresses and invalid tokens', () => {
    expect(extractMediaRefs('Email test@example.com and use #valid-folder.')).toEqual({
      folderSlugs: ['valid-folder'],
      assetSlugs: [],
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run src/lib/media/slug.test.ts src/lib/media/rag-text.test.ts
```

Expected: fails because modules do not exist.

- [ ] **Step 3: Implement utilities and schemas**

Create `src/lib/media/slug.ts`:

```ts
export function makeSlug(input: string, fallback = 'item', maxLength = 80): string {
  const normalized = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, maxLength)
    .replace(/-+$/g, '')

  return normalized || fallback
}
```

Create `src/lib/media/rag-text.ts`:

```ts
export interface BuildMediaRagTextInput {
  folderName: string
  folderSlug: string
  folderDescription: string | null
  assetName: string
  assetSlug: string
  assetDescription: string | null
}

export interface MediaRefs {
  folderSlugs: string[]
  assetSlugs: string[]
}

function uniquePush(values: string[], value: string) {
  if (!values.includes(value)) values.push(value)
}

export function buildMediaRagText(input: BuildMediaRagTextInput): string {
  return [
    `# ${input.assetName.trim() || input.assetSlug}`,
    '',
    `Media folder: ${input.folderName.trim() || input.folderSlug}`,
    `Folder slug: #${input.folderSlug}`,
    `Folder description: ${(input.folderDescription ?? '').trim() || '(none)'}`,
    '',
    `Image slug: @${input.assetSlug}`,
    `Image description: ${(input.assetDescription ?? '').trim() || '(none)'}`,
  ].join('\n')
}

export function extractMediaRefs(text: string): MediaRefs {
  const folderSlugs: string[] = []
  const assetSlugs: string[] = []
  const tokenRe = /(^|[\s([{>])([#@])([a-z0-9][a-z0-9-]{1,119})(?=$|[\s.,;:!?()[\]{}<>"'])/g
  for (const match of text.matchAll(tokenRe)) {
    const prefix = match[1] ?? ''
    const marker = match[2]
    const slug = match[3]
    if (marker === '@' && /\w$/.test(prefix)) continue
    if (marker === '#') uniquePush(folderSlugs, slug)
    else uniquePush(assetSlugs, slug)
  }
  return { folderSlugs, assetSlugs }
}
```

Create `src/lib/media/schemas.ts`:

```ts
import { z } from 'zod'

export const MediaSlugSchema = z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,119}$/)

export const CreateMediaFolderInput = z.object({
  name: z.string().trim().min(1).max(80),
  slug: MediaSlugSchema.optional(),
  description: z.string().trim().max(2000).nullable().default(null),
})

export const UpdateMediaFolderInput = CreateMediaFolderInput.extend({
  id: z.string().uuid(),
})

export const UpdateMediaAssetInput = z.object({
  id: z.string().uuid(),
  folderId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  slug: MediaSlugSchema,
  description: z.string().trim().max(4000).nullable().default(null),
  isArchived: z.boolean().default(false),
})

export type CreateMediaFolderInput = z.infer<typeof CreateMediaFolderInput>
export type UpdateMediaFolderInput = z.infer<typeof UpdateMediaFolderInput>
export type UpdateMediaAssetInput = z.infer<typeof UpdateMediaAssetInput>
```

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run src/lib/media/slug.test.ts src/lib/media/rag-text.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media/slug.ts src/lib/media/slug.test.ts src/lib/media/schemas.ts src/lib/media/rag-text.ts src/lib/media/rag-text.test.ts
git commit -m "feat(media): add media metadata utilities"
```

---

### Task 3: Extend RAG Ingest for Media Assets

**Files:**
- Modify: `src/lib/rag/types.ts`
- Modify: `src/lib/rag/parsers/index.ts`
- Modify: `src/lib/rag/ingest.ts`
- Modify: `src/lib/rag/queue.ts`
- Modify: `src/lib/rag/worker/embed-job.ts`
- Modify: `src/lib/rag/worker/embed-job.test.ts`

- [ ] **Step 1: Write failing worker tests**

Add a test to `src/lib/rag/worker/embed-job.test.ts`:

```ts
it('embeds a fresh media asset and marks the asset indexed', async () => {
  const { client, updates, upserts } = fakeClient();
  const mediaFetchers: SourceFetchers = {
    ...fetchers,
    fetchMediaAsset: async () => ({
      name: 'Ryan Engineer Review',
      version: 3,
      isArchived: false,
      ragText: '# Ryan Engineer Review\n\nMedia folder: Reviews\nFolder slug: #image-review\nImage slug: @new-review-customer-ryan',
    }),
  };
  const job: EmbedJobRow = {
    id: 'j-media',
    document_id: null,
    faq_id: null,
    business_item_id: null,
    media_asset_id: 'ma1',
    user_id: 'u1',
    attempts: 0,
    source_version: 3,
  };

  await runJob(client as unknown as SupabaseLike, job, mediaFetchers, embedder);

  expect(upserts).toHaveLength(1);
  const row = upserts[0].rows[0] as TestRecord;
  expect(row.media_asset_id).toBe('ma1');
  expect(row.document_id).toBeNull();
  expect(row.faq_id).toBeNull();
  expect(row.business_item_id).toBeNull();
  expect(updates.find((u) => u.table === 'media_assets')?.patch.embedding_status).toBe('indexed');
});
```

Update every existing `EmbedJobRow` test fixture to include `media_asset_id: null`.

- [ ] **Step 2: Run the failing test**

Run:

```bash
npx vitest run src/lib/rag/worker/embed-job.test.ts
```

Expected: fails because `media_asset_id` and `fetchMediaAsset` are not supported.

- [ ] **Step 3: Update source types and parser**

In `src/lib/rag/types.ts`:

```ts
export type SourceKind = 'document' | 'faq' | 'business_item' | 'media_asset';
```

In `src/lib/rag/parsers/index.ts`, add:

```ts
export type ParseInput =
  | { kind: 'document'; title: string; contentJson: unknown }
  | { kind: 'faq'; question: string; answer: string }
  | { kind: 'business_item'; title: string; ragText: string }
  | { kind: 'media_asset'; title: string; ragText: string };

function parseTextSource(input: { title: string; ragText: string; kind: 'business_item' | 'media_asset' }): ParsedSource {
  const title = input.title.trim() || 'Untitled';
  const body = (input.ragText ?? '').replace(/\r\n?/g, '\n').trim();
  const markdown = `# ${title}\n\n${body}`.trim();
  return { kind: input.kind, title, markdown, atomic: true };
}

export function parse(input: ParseInput): ParsedSource {
  switch (input.kind) {
    case 'document':
      return parseTiptap(input);
    case 'faq':
      return parseFaq(input);
    case 'business_item':
      return parseTextSource(input);
    case 'media_asset':
      return parseTextSource(input);
  }
}
```

- [ ] **Step 4: Update ingest source columns**

In `src/lib/rag/ingest.ts`, change source column typing:

```ts
function sourceColumns(kind: SourceKind): {
  sourceCol: 'document_id' | 'faq_id' | 'business_item_id' | 'media_asset_id';
  nullCols: Array<'document_id' | 'faq_id' | 'business_item_id' | 'media_asset_id'>;
} {
  switch (kind) {
    case 'document':
      return { sourceCol: 'document_id', nullCols: ['faq_id', 'business_item_id', 'media_asset_id'] };
    case 'faq':
      return { sourceCol: 'faq_id', nullCols: ['document_id', 'business_item_id', 'media_asset_id'] };
    case 'business_item':
      return { sourceCol: 'business_item_id', nullCols: ['document_id', 'faq_id', 'media_asset_id'] };
    case 'media_asset':
      return { sourceCol: 'media_asset_id', nullCols: ['document_id', 'faq_id', 'business_item_id'] };
  }
}
```

Update row creation so all null columns are assigned:

```ts
const rows = toEmbed.map((c, i) => ({
  [sourceCol]: source.sourceId,
  [nullCols[0]]: null,
  [nullCols[1]]: null,
  [nullCols[2]]: null,
  user_id: source.userId,
  chunk_index: c.chunkIndex,
  content: c.content,
  heading_path: c.headingPath,
  source_offset: c.sourceOffset ? `[${c.sourceOffset.start},${c.sourceOffset.end})` : null,
  token_count: c.tokenCount,
  content_hash: c.contentHash,
  is_atomic: c.isAtomic,
  embedding: vectors[i],
}));
```

- [ ] **Step 5: Update queue and worker**

In `src/lib/rag/queue.ts`, include `media_asset`:

```ts
function sourceMeta(kind: SourceKind): {
  sourceCol: 'document_id' | 'faq_id' | 'business_item_id' | 'media_asset_id';
  sourceTable: 'knowledge_documents' | 'knowledge_faqs' | 'business_items' | 'media_assets';
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
  }
}
```

In `src/lib/rag/worker/embed-job.ts`, add `media_asset_id` to `EmbedJobRow`, `claimJobs` selects, and `sourceTable`. Add fetcher support:

```ts
fetchMediaAsset?: (id: string) => Promise<{
  name: string;
  ragText: string;
  version?: number;
  isArchived?: boolean;
}>;
```

In `buildParseInput`, add:

```ts
if (job.media_asset_id) {
  if (!fetchers.fetchMediaAsset) throw new Error(`job ${job.id} requires fetchMediaAsset`);
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
```

Update disabled cleanup to delete `knowledge_chunks.media_asset_id` and mark `media_assets.embedding_status = 'pending'`.

- [ ] **Step 6: Run RAG tests**

Run:

```bash
npx vitest run src/lib/rag/worker/embed-job.test.ts src/lib/rag/parsers/tiptap.test.ts src/lib/rag/retriever.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/rag/types.ts src/lib/rag/parsers/index.ts src/lib/rag/ingest.ts src/lib/rag/queue.ts src/lib/rag/worker/embed-job.ts src/lib/rag/worker/embed-job.test.ts
git commit -m "feat(rag): index media assets"
```

---

### Task 4: Media Selection Helper

**Files:**
- Create: `src/lib/media/selector.ts`
- Create: `src/lib/media/selector.test.ts`

- [ ] **Step 1: Write failing selector tests**

Create `src/lib/media/selector.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { selectMediaForReply, type MediaSelectorClient } from './selector'

const embedder = { embed: async () => Array(1024).fill(0) }

function client(): MediaSelectorClient {
  const assets = [
    { id: 'a1', folder_id: 'f1', name: 'Ryan Review', slug: 'new-review-customer-ryan', description: 'Engineer review', storage_path: 'u/f/a1.jpg', mime_type: 'image/jpeg' },
    { id: 'a2', folder_id: 'f1', name: 'General Review', slug: 'general-review', description: 'Customer review', storage_path: 'u/f/a2.jpg', mime_type: 'image/jpeg' },
    { id: 'a3', folder_id: 'f2', name: 'Sample Build', slug: 'sample-build', description: 'Build sample', storage_path: 'u/f/a3.jpg', mime_type: 'image/jpeg' },
  ]
  const folders = [
    { id: 'f1', slug: 'image-review', name: 'Reviews', description: 'Review images' },
    { id: 'f2', slug: 'samples', name: 'Samples', description: 'Sample images' },
  ]

  return {
    from(table: string) {
      const state: { inCol?: string; inVals?: string[]; eqCol?: string; eqVal?: unknown } = {}
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          state.eqCol = col
          state.eqVal = val
          return builder
        },
        in: (col: string, vals: string[]) => {
          state.inCol = col
          state.inVals = vals
          return Promise.resolve({
            data:
              table === 'media_assets'
                ? assets.filter((a) => state.inCol === 'slug' ? vals.includes(a.slug) : vals.includes(a.id))
                : folders.filter((f) => vals.includes(f.slug)),
            error: null,
          })
        },
        limit: () => Promise.resolve({ data: assets, error: null }),
      }
      return builder
    },
    rpc: async () => ({ data: [{ media_asset_id: 'a2', rrf_score: 0.9 }], error: null }),
  }
}

describe('selectMediaForReply', () => {
  it('prioritizes explicit asset references before semantic matches', async () => {
    const result = await selectMediaForReply({
      client: client(),
      embedder,
      userId: 'u1',
      customerMessage: 'send Ryan review',
      retrievedChunks: [{ id: 'c1', content: 'Use @new-review-customer-ryan and #image-review.', document_id: 'd1', faq_id: null, business_item_id: null, heading_path: null }],
      rpcName: 'match_media_assets_service',
      limit: 4,
    })

    expect(result.map((r) => r.slug)).toEqual(['new-review-customer-ryan', 'general-review'])
  })

  it('caps results at the requested limit', async () => {
    const result = await selectMediaForReply({
      client: client(),
      embedder,
      userId: 'u1',
      customerMessage: 'reviews',
      retrievedChunks: [{ id: 'c1', content: '#image-review', document_id: 'd1', faq_id: null, business_item_id: null, heading_path: null }],
      rpcName: 'match_media_assets_service',
      limit: 1,
    })

    expect(result).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run failing test**

Run:

```bash
npx vitest run src/lib/media/selector.test.ts
```

Expected: fails because `selector.ts` does not exist.

- [ ] **Step 3: Implement selector**

Create `src/lib/media/selector.ts`:

```ts
import type { Embedder } from '@/lib/rag/hf-client'
import type { RetrievedChunk } from '@/lib/rag/retriever'
import { extractMediaRefs } from './rag-text'

export interface MediaSelectorClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from: (table: string) => any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc?: (fn: string, args?: Record<string, unknown>) => any
}

export interface SelectedMediaAsset {
  id: string
  folderId: string
  name: string
  slug: string
  description: string | null
  storagePath: string
  mimeType: string
  matchReason: 'asset_ref' | 'folder_ref' | 'semantic'
}

interface MediaAssetRow {
  id: string
  folder_id: string
  name: string
  slug: string
  description: string | null
  storage_path: string
  mime_type: string
}

function toSelected(row: MediaAssetRow, matchReason: SelectedMediaAsset['matchReason']): SelectedMediaAsset {
  return {
    id: row.id,
    folderId: row.folder_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    matchReason,
  }
}

function addUnique(out: SelectedMediaAsset[], row: MediaAssetRow, reason: SelectedMediaAsset['matchReason'], limit: number) {
  if (out.length >= limit) return
  if (out.some((item) => item.id === row.id)) return
  out.push(toSelected(row, reason))
}

export async function selectMediaForReply(args: {
  client: MediaSelectorClient
  embedder: Pick<Embedder, 'embed'>
  userId: string
  customerMessage: string
  retrievedChunks: RetrievedChunk[]
  rpcName?: 'match_media_assets' | 'match_media_assets_service'
  limit?: number
}): Promise<SelectedMediaAsset[]> {
  const limit = args.limit ?? 4
  if (limit <= 0) return []

  const refText = args.retrievedChunks.map((chunk) => chunk.content).join('\n')
  const refs = extractMediaRefs(refText)
  const selected: SelectedMediaAsset[] = []

  if (refs.assetSlugs.length) {
    const { data, error } = await args.client
      .from('media_assets')
      .select('id, folder_id, name, slug, description, storage_path, mime_type')
      .eq('user_id', args.userId)
      .eq('is_archived', false)
      .in('slug', refs.assetSlugs)
    if (error) throw new Error(`load media asset refs failed: ${error.message ?? error}`)
    const bySlug = new Map((data ?? []).map((row: MediaAssetRow) => [row.slug, row]))
    for (const slug of refs.assetSlugs) {
      const row = bySlug.get(slug)
      if (row) addUnique(selected, row, 'asset_ref', limit)
    }
  }

  if (selected.length < limit && refs.folderSlugs.length) {
    const { data: folders, error: folderErr } = await args.client
      .from('media_folders')
      .select('id, slug')
      .eq('user_id', args.userId)
      .in('slug', refs.folderSlugs)
    if (folderErr) throw new Error(`load media folder refs failed: ${folderErr.message ?? folderErr}`)
    const folderIds = (folders ?? []).map((f: { id: string }) => f.id)
    if (folderIds.length) {
      const { data, error } = await args.client
        .from('media_assets')
        .select('id, folder_id, name, slug, description, storage_path, mime_type')
        .eq('user_id', args.userId)
        .eq('is_archived', false)
        .in('folder_id', folderIds)
      if (error) throw new Error(`load folder media failed: ${error.message ?? error}`)
      for (const row of (data ?? []) as MediaAssetRow[]) addUnique(selected, row, 'folder_ref', limit)
    }
  }

  if (selected.length < limit && args.client.rpc) {
    const qvec = await args.embedder.embed(
      [args.customerMessage, refText].filter((part) => part.trim()).join('\n\n'),
    )
    const { data, error } = await args.client.rpc(args.rpcName ?? 'match_media_assets', {
      p_user_id: args.userId,
      p_query_text: args.customerMessage,
      p_query_embed: qvec,
      p_match_limit: 40,
    })
    if (error) throw new Error(`match media assets failed: ${error.message ?? error}`)
    const ids = Array.from(new Set((data ?? []).map((r: { media_asset_id: string }) => r.media_asset_id).filter(Boolean)))
    if (ids.length) {
      const { data: rows, error: rowsErr } = await args.client
        .from('media_assets')
        .select('id, folder_id, name, slug, description, storage_path, mime_type')
        .eq('user_id', args.userId)
        .eq('is_archived', false)
        .in('id', ids)
      if (rowsErr) throw new Error(`load semantic media failed: ${rowsErr.message ?? rowsErr}`)
      const byId = new Map((rows ?? []).map((row: MediaAssetRow) => [row.id, row]))
      for (const id of ids) {
        const row = byId.get(id)
        if (row) addUnique(selected, row, 'semantic', limit)
      }
    }
  }

  return selected.slice(0, limit)
}
```

- [ ] **Step 4: Run selector test**

Run:

```bash
npx vitest run src/lib/media/selector.test.ts
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/media/selector.ts src/lib/media/selector.test.ts
git commit -m "feat(media): select reply attachments"
```

---

### Task 5: Media Dashboard Reads, Mutations, and Uploads

**Files:**
- Create: `src/app/(app)/dashboard/media/_lib/queries.ts`
- Create: `src/app/(app)/dashboard/media/actions.ts`
- Create: `src/app/(app)/dashboard/media/upload/route.ts`

- [ ] **Step 1: Add dashboard query helpers**

Create `src/app/(app)/dashboard/media/_lib/queries.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export interface MediaFolderRow {
  id: string
  name: string
  slug: string
  description: string | null
  position: number
  created_at: string
  updated_at: string
  asset_count: number
}

export interface MediaAssetRow {
  id: string
  folder_id: string
  name: string
  slug: string
  description: string | null
  storage_path: string
  mime_type: string
  byte_size: number
  is_archived: boolean
  embedding_status: 'pending' | 'indexed' | 'stale'
  updated_at: string
  signed_url: string | null
}

export async function fetchMediaFolders(supabase: SupabaseClient, userId: string): Promise<MediaFolderRow[]> {
  const { data, error } = await supabase
    .from('media_folders')
    .select('id, name, slug, description, position, created_at, updated_at, media_assets(id)')
    .eq('user_id', userId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    position: row.position,
    created_at: row.created_at,
    updated_at: row.updated_at,
    asset_count: Array.isArray(row.media_assets) ? row.media_assets.length : 0,
  }))
}

export async function fetchMediaAssets(
  supabase: SupabaseClient,
  userId: string,
  folderId: string | null,
): Promise<MediaAssetRow[]> {
  let query = supabase
    .from('media_assets')
    .select('id, folder_id, name, slug, description, storage_path, mime_type, byte_size, is_archived, embedding_status, updated_at')
    .eq('user_id', userId)
    .eq('is_archived', false)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (folderId) query = query.eq('folder_id', folderId)
  const { data, error } = await query
  if (error) throw error
  const rows = (data ?? []) as Omit<MediaAssetRow, 'signed_url'>[]
  return Promise.all(
    rows.map(async (row) => {
      const { data: signed } = await supabase.storage
        .from('media-assets')
        .createSignedUrl(row.storage_path, 3600)
      return { ...row, signed_url: signed?.signedUrl ?? null }
    }),
  )
}
```

- [ ] **Step 2: Add actions**

Create `src/app/(app)/dashboard/media/actions.ts`:

```ts
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
```

- [ ] **Step 3: Add upload route**

Create `src/app/(app)/dashboard/media/upload/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { enqueueEmbedJob } from '@/lib/rag'
import { makeSlug } from '@/lib/media/slug'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const form = await req.formData()
  const folderId = String(form.get('folderId') ?? '')
  const sharedDescription = String(form.get('sharedDescription') ?? '').trim()
  const files = form.getAll('files').filter((entry): entry is File => entry instanceof File)
  if (!folderId) return NextResponse.json({ error: 'folderId is required' }, { status: 400 })
  if (files.length === 0) return NextResponse.json({ error: 'No images selected' }, { status: 400 })

  const { data: folder, error: folderErr } = await supabase
    .from('media_folders')
    .select('id, name, slug, description')
    .eq('id', folderId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (folderErr || !folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 })

  const created: string[] = []
  try {
    for (const file of files) {
      if (!ALLOWED.has(file.type)) {
        return NextResponse.json({ error: `${file.name} is not a supported image` }, { status: 400 })
      }
      const assetName = file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Image'
      const assetSlug = `${makeSlug(assetName, 'image', 90)}-${Date.now().toString(36)}`
      const { data: inserted, error: insertErr } = await supabase
        .from('media_assets')
        .insert({
          user_id: user.id,
          folder_id: folder.id,
          name: assetName,
          slug: assetSlug,
          description: sharedDescription || null,
          storage_path: 'pending',
          mime_type: file.type,
          byte_size: file.size,
          version: Date.now(),
        })
        .select('id, version')
        .single()
      if (insertErr || !inserted) throw insertErr ?? new Error('Media insert failed')

      const safeName = file.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/^-+|-+$/g, '')
      const path = `${user.id}/${folder.id}/${inserted.id}-${safeName || 'image'}`
      const { error: uploadErr } = await supabase.storage.from('media-assets').upload(path, file, {
        cacheControl: '31536000',
        upsert: false,
        contentType: file.type,
      })
      if (uploadErr) throw uploadErr
      created.push(path)

      const { error: updateErr } = await supabase
        .from('media_assets')
        .update({ storage_path: path, embedding_status: 'stale' })
        .eq('id', inserted.id)
      if (updateErr) throw updateErr
      await enqueueEmbedJob(supabase, {
        kind: 'media_asset',
        sourceId: inserted.id,
        userId: user.id,
        sourceVersion: inserted.version,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    for (const path of created) await supabase.storage.from('media-assets').remove([path])
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Upload failed' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run type check through build**

Run:

```bash
npm run build
```

Expected: build completes. If TypeScript reports an error in the new media route or actions, correct that file before continuing.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(app)/dashboard/media'
git commit -m "feat(media): add media mutations and upload route"
```

---

### Task 6: Media Dashboard UI

**Files:**
- Create: `src/app/(app)/dashboard/media/page.tsx`
- Create: `src/app/(app)/dashboard/media/_components/MediaManager.client.tsx`
- Modify: `src/app/(app)/_components/sidebar.tsx`

- [ ] **Step 1: Add page shell**

Create `src/app/(app)/dashboard/media/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { fetchMediaAssets, fetchMediaFolders } from './_lib/queries'
import { MediaManager } from './_components/MediaManager.client'

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<{ folder?: string }>
}) {
  const sp = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const folders = await fetchMediaFolders(supabase, user.id)
  const selectedFolderId = sp.folder && folders.some((f) => f.id === sp.folder)
    ? sp.folder
    : folders[0]?.id ?? null
  const assets = await fetchMediaAssets(supabase, user.id, selectedFolderId)

  return (
    <div className="space-y-5">
      <header className="border-b border-[#E5E7EB] pb-5">
        <h1 className="text-[22px] font-semibold tracking-tight text-[#111827]">Media</h1>
        <p className="mt-1 text-[13.5px] text-[#6B7280]">
          Organize reusable images for chatbot replies. Use folder refs like #image-review and image refs like @new-review-customer-ryan in knowledge documents.
        </p>
      </header>
      <MediaManager folders={folders} assets={assets} selectedFolderId={selectedFolderId} />
    </div>
  )
}
```

- [ ] **Step 2: Add client manager**

Create `src/app/(app)/dashboard/media/_components/MediaManager.client.tsx`:

```tsx
'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createMediaFolder, updateMediaAsset, updateMediaFolder } from '../actions'
import type { MediaAssetRow, MediaFolderRow } from '../_lib/queries'

export function MediaManager({
  folders,
  assets,
  selectedFolderId,
}: {
  folders: MediaFolderRow[]
  assets: MediaAssetRow[]
  selectedFolderId: string | null
}) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const selectedFolder = folders.find((f) => f.id === selectedFolderId) ?? null

  async function upload(formData: FormData) {
    setUploading(true)
    setUploadError(null)
    try {
      const res = await fetch('/dashboard/media/upload', { method: 'POST', body: formData })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'Upload failed')
      if (fileRef.current) fileRef.current.value = ''
      router.refresh()
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
      <aside className="rounded-xl border border-[#E5E7EB] bg-white">
        <div className="border-b border-[#F3F4F6] px-4 py-3">
          <h2 className="text-[14px] font-semibold text-[#111827]">Folders</h2>
        </div>
        <div className="divide-y divide-[#F3F4F6]">
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              onClick={() => router.push(`/dashboard/media?folder=${folder.id}`)}
              className={`block w-full px-4 py-3 text-left ${folder.id === selectedFolderId ? 'bg-[#F9FAFB]' : 'bg-white hover:bg-[#F9FAFB]'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13.5px] font-medium text-[#111827]">{folder.name}</span>
                <span className="text-[12px] text-[#9CA3AF]">{folder.asset_count}</span>
              </div>
              <div className="mt-0.5 truncate font-mono text-[11.5px] text-[#047857]">#{folder.slug}</div>
            </button>
          ))}
        </div>
        <form action={createMediaFolder} className="space-y-2 border-t border-[#F3F4F6] p-4">
          <input name="name" required placeholder="Folder name" className="h-9 w-full rounded-md border border-[#E5E7EB] px-3 text-[13px]" />
          <textarea name="description" placeholder="Description" rows={3} className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-[13px]" />
          <button className="rounded-md bg-[#059669] px-3 py-2 text-[13px] font-semibold text-white">Create folder</button>
        </form>
      </aside>

      <main className="rounded-xl border border-[#E5E7EB] bg-white">
        <div className="border-b border-[#F3F4F6] px-5 py-4">
          <h2 className="text-[15px] font-semibold text-[#111827]">{selectedFolder?.name ?? 'No folder selected'}</h2>
          {selectedFolder ? <p className="mt-1 font-mono text-[12px] text-[#047857]">#{selectedFolder.slug}</p> : null}
        </div>

        {selectedFolder ? (
          <div className="space-y-5 p-5">
            <form action={updateMediaFolder} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <input type="hidden" name="id" value={selectedFolder.id} />
              <input name="name" defaultValue={selectedFolder.name} className="h-9 rounded-md border border-[#E5E7EB] px-3 text-[13px]" />
              <input name="slug" defaultValue={selectedFolder.slug} className="h-9 rounded-md border border-[#E5E7EB] px-3 font-mono text-[13px]" />
              <button className="rounded-md border border-[#D1D5DB] px-3 text-[13px] font-medium">Save folder</button>
              <textarea name="description" defaultValue={selectedFolder.description ?? ''} rows={2} className="md:col-span-3 rounded-md border border-[#E5E7EB] px-3 py-2 text-[13px]" />
            </form>

            <form action={(fd) => void upload(fd)} className="rounded-lg border border-dashed border-[#D1D5DB] p-4">
              <input type="hidden" name="folderId" value={selectedFolder.id} />
              <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
                <input ref={fileRef} name="files" type="file" multiple accept="image/*" className="text-[13px]" />
                <input name="sharedDescription" placeholder="Shared description for this batch" className="h-9 rounded-md border border-[#E5E7EB] px-3 text-[13px]" />
                <button disabled={uploading} className="rounded-md bg-[#059669] px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-60">
                  {uploading ? 'Uploading...' : 'Upload images'}
                </button>
              </div>
              {uploadError ? <p className="mt-2 text-[12px] text-[#B91C1C]">{uploadError}</p> : null}
            </form>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {assets.map((asset) => (
                <article key={asset.id} className="overflow-hidden rounded-lg border border-[#E5E7EB]">
                  {asset.signed_url ? <img src={asset.signed_url} alt="" className="aspect-[4/3] w-full object-cover" /> : <div className="aspect-[4/3] bg-[#F3F4F6]" />}
                  <form action={(fd) => startTransition(() => void updateMediaAsset(fd))} className="space-y-2 p-3">
                    <input type="hidden" name="id" value={asset.id} />
                    <input type="hidden" name="folderId" value={asset.folder_id} />
                    <input name="name" defaultValue={asset.name} className="h-8 w-full rounded-md border border-[#E5E7EB] px-2 text-[12.5px]" />
                    <input name="slug" defaultValue={asset.slug} className="h-8 w-full rounded-md border border-[#E5E7EB] px-2 font-mono text-[12px]" />
                    <textarea name="description" defaultValue={asset.description ?? ''} rows={3} className="w-full rounded-md border border-[#E5E7EB] px-2 py-1.5 text-[12.5px]" />
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-[#047857]">@{asset.slug}</span>
                      <button disabled={isPending} className="rounded-md border border-[#D1D5DB] px-2.5 py-1.5 text-[12px] font-medium">Save</button>
                    </div>
                  </form>
                </article>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-8 text-center text-[13px] text-[#6B7280]">Create a folder to start uploading reusable images.</div>
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 3: Add sidebar nav**

In `src/app/(app)/_components/sidebar.tsx`, add `media` to `IconName`, add `{ href: '/dashboard/media', label: 'Media', icon: 'media' }` after Knowledge, and add this icon path:

```tsx
media: (
  <>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="8" cy="10" r="1.5" />
    <path d="M21 16l-5-5-4 4-2-2-5 5" />
  </>
),
```

- [ ] **Step 4: Run lint/build**

Run:

```bash
npm run lint
npm run build
```

Expected: no new lint/type errors from media UI files.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(app)/dashboard/media' 'src/app/(app)/_components/sidebar.tsx'
git commit -m "feat(media): add dashboard manager"
```

---

### Task 7: Chatbot Answer Media Selection

**Files:**
- Modify: `src/lib/chatbot/answer.ts`
- Modify: `src/app/api/chatbot/test/route.ts`
- Modify: `src/app/api/cron/embed-jobs/route.ts`

- [ ] **Step 1: Extend answer result**

In `src/lib/chatbot/answer.ts`, import selector:

```ts
import { selectMediaForReply, type SelectedMediaAsset } from '@/lib/media/selector'
```

Change result type:

```ts
export interface AnswerResult {
  text: string
  sourceTitles: string[]
  media: SelectedMediaAsset[]
}
```

After `built` is created, select media:

```ts
const contextChunks = [...built.contextChunks]
const mediaPromise = selectMediaForReply({
  client: supabase,
  embedder,
  userId,
  customerMessage: message,
  retrievedChunks: contextChunks,
  rpcName: options.rpcName === 'match_knowledge_hybrid_service' ? 'match_media_assets_service' : 'match_media_assets',
  limit: 4,
}).catch((err) => {
  console.warn('[chatbot.media] selection failed', err)
  return []
})
```

If `buildPrompt` does not currently return `contextChunks`, modify `src/lib/rag/prompt-builder.ts` so `BuiltPrompt` includes:

```ts
contextChunks: RetrievedChunk[]
```

and return the ranked chunks without scores:

```ts
contextChunks: ranked.map(({ score: _score, ...chunk }) => chunk),
```

Return:

```ts
const [sourceTitles, media] = await Promise.all([
  resolveSourceTitles(supabase, userId, built.contextChunkIds),
  mediaPromise,
])
return { text: text.trim(), sourceTitles, media }
```

- [ ] **Step 2: Update test chat stream**

In `src/app/api/chatbot/test/route.ts`, after `built` is available, run `selectMediaForReply` and emit:

```ts
const mediaPromise = selectMediaForReply({
  client: supabase,
  embedder,
  userId,
  customerMessage: message,
  retrievedChunks: built.contextChunks,
  limit: 4,
})
  .then((media) => {
    if (media.length > 0) send({ type: 'media', media })
  })
  .catch((err) => console.warn('[chat.test.media] selection failed', err))
```

Await `mediaPromise` before `send({ type: 'done' })`.

- [ ] **Step 3: Update embed job route fetchers**

In `src/app/api/cron/embed-jobs/route.ts`, add `media_asset_id` to selects and provide `fetchMediaAsset`:

```ts
fetchMediaAsset: async (id: string) => {
  const { data, error } = await admin
    .from('media_assets')
    .select('name, slug, description, version, is_archived, media_folders!inner(name, slug, description)')
    .eq('id', id)
    .single()
  if (error || !data) throw new Error(`media asset ${id} missing`)
  const folder = Array.isArray(data.media_folders) ? data.media_folders[0] : data.media_folders
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
  }
}
```

- [ ] **Step 4: Run targeted tests/build**

Run:

```bash
npx vitest run src/lib/rag/prompt-builder.test.ts src/lib/media/selector.test.ts
npm run build
```

Expected: tests pass and build has no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chatbot/answer.ts src/lib/rag/prompt-builder.ts src/lib/rag/prompt-builder.test.ts src/app/api/chatbot/test/route.ts src/app/api/cron/embed-jobs/route.ts
git commit -m "feat(chatbot): select media for replies"
```

---

### Task 8: Messenger Image Sending

**Files:**
- Modify: `src/lib/facebook/messenger.ts`
- Modify: `src/app/api/messenger/process/route.ts`

- [ ] **Step 1: Add Send API helper**

In `src/lib/facebook/messenger.ts`, add:

```ts
export async function sendMessengerImage(args: {
  pageAccessToken: string
  recipientPsid: string
  imageUrl: string
}): Promise<{ message_id: string }> {
  const url = new URL(`${GRAPH}/me/messages`)
  url.searchParams.set('access_token', args.pageAccessToken)
  return postJson<{ message_id: string }>(url.toString(), {
    recipient: { id: args.recipientPsid },
    messaging_type: 'RESPONSE',
    message: {
      attachment: {
        type: 'image',
        payload: {
          url: args.imageUrl,
          is_reusable: true,
        },
      },
    },
  })
}
```

- [ ] **Step 2: Update job type and imports**

In `src/app/api/messenger/process/route.ts`, import `sendMessengerImage` and `SelectedMediaAsset`.

Change `JobRow`:

```ts
interface JobRow {
  id: string
  thread_id: string
  inbound_msg_id: string
  user_id: string
  attempts: number
  outbound_text_fb_id: string | null
  outbound_button_fb_id: string | null
  outbound_media: Array<{ media_asset_id: string; fb_message_id: string }>
}
```

Normalize claim rows:

```ts
return ((data ?? []) as JobRow[]).map((row) => ({
  ...row,
  outbound_media: Array.isArray(row.outbound_media) ? row.outbound_media : [],
}))
```

- [ ] **Step 3: Send media after text reply**

After text message persistence, add:

```ts
const selectedMedia = r.media ?? []
await sendSelectedMedia(admin, {
  job,
  thread,
  pageToken,
  selectedMedia,
})
```

For the fallback `answer()` path, keep the full answer result:

```ts
let selectedMedia: Awaited<ReturnType<typeof answer>>['media'] = []
...
const r = await answer(admin, thread.user_id, message, history, {
  rpcName: 'match_knowledge_hybrid_service',
})
reply = r.text.trim()
selectedMedia = r.media
```

Add helper near `markDone`:

```ts
async function sendSelectedMedia(
  admin: AdminClient,
  args: {
    job: JobRow
    thread: ThreadRow
    pageToken: string
    selectedMedia: SelectedMediaAsset[]
  },
): Promise<void> {
  const sent = [...args.job.outbound_media]
  const sentIds = new Set(sent.map((m) => m.media_asset_id))

  for (const asset of args.selectedMedia.slice(0, 4)) {
    if (sentIds.has(asset.id)) continue
    try {
      const { data: signed, error: signErr } = await admin.storage
        .from('media-assets')
        .createSignedUrl(asset.storagePath, 60 * 60)
      if (signErr || !signed?.signedUrl) throw signErr ?? new Error('signed URL missing')

      const fb = await sendMessengerImage({
        pageAccessToken: args.pageToken,
        recipientPsid: args.thread.psid,
        imageUrl: signed.signedUrl,
      })
      sent.push({ media_asset_id: asset.id, fb_message_id: fb.message_id })
      sentIds.add(asset.id)
      await admin.from('messenger_jobs').update({ outbound_media: sent }).eq('id', args.job.id)

      const { error: insertErr } = await admin.from('messenger_messages').insert({
        thread_id: args.thread.id,
        user_id: args.thread.user_id,
        direction: 'outbound',
        sender: 'bot',
        fb_message_id: fb.message_id,
        media_asset_id: asset.id,
        body: `[image] ${asset.name}`,
        attachments: [{ type: 'image', media_asset_id: asset.id, storage_path: asset.storagePath }],
      })
      if (insertErr && (insertErr as { code?: string }).code !== '23505') throw insertErr
    } catch (e) {
      console.error('[messenger.worker] media send failed', {
        assetId: asset.id,
        err: e instanceof Error ? e.message : String(e),
      })
    }
  }
}
```

- [ ] **Step 4: Update `claim_messenger_jobs` migration output**

In `supabase/migrations/20260502090000_media_management.sql`, replace the existing `claim_messenger_jobs` function from `20260501000000_messenger_concurrent_claim.sql` with the same function plus `outbound_media`. The return table must include:

```sql
returns table (
  id                    uuid,
  thread_id             uuid,
  inbound_msg_id        uuid,
  user_id               uuid,
  attempts              integer,
  outbound_text_fb_id   text,
  outbound_button_fb_id text,
  outbound_media        jsonb
)
```

The `picked` CTE must select:

```sql
j.outbound_media
```

The final `returning` list must end with:

```sql
j.outbound_text_fb_id,
j.outbound_button_fb_id,
j.outbound_media;
```

- [ ] **Step 5: Run build**

Run:

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/facebook/messenger.ts src/app/api/messenger/process/route.ts supabase/migrations/20260502090000_media_management.sql
git commit -m "feat(messenger): send matched media images"
```

---

### Task 9: Final Verification

**Files:**
- No new files unless fixes are required.

- [ ] **Step 1: Run full automated checks**

Run:

```bash
npm run lint
npm run test
npm run build
```

Expected: all pass.

- [ ] **Step 2: Run local app**

Run:

```bash
npm run dev
```

Expected: Next starts and prints a local URL.

- [ ] **Step 3: Manual media flow**

In the browser:

1. Open `/dashboard/media`.
2. Create folder `Reviews` with slug `image-review`.
3. Upload 5 images with shared description `Customer review screenshots and proof images`.
4. Edit one image slug to `new-review-customer-ryan`.
5. Set its description to `Review from engineer Ryan about build quality`.
6. Confirm the image card shows `@new-review-customer-ryan`.

- [ ] **Step 4: Manual knowledge and chatbot flow**

In `/dashboard/knowledge`, create or edit a document with this saved content:

```text
If a customer asks for samples or reviews, answer briefly and send images from #image-review.
If they ask for Ryan's engineer review, include @new-review-customer-ryan.
```

Run the embedding worker once:

```bash
npm run rag:work:once
```

Expected: pending/stale document and media jobs become indexed.

- [ ] **Step 5: Manual Messenger verification**

Ask a connected Messenger page:

```text
Can you send me customer reviews?
```

Expected:

- Bot sends a text reply.
- Bot sends no more than 4 images.
- Images come from `#image-review`.

Ask:

```text
Do you have a review from an engineer?
```

Expected:

- Bot sends a text reply.
- `@new-review-customer-ryan` is included or ranked first among sent images.

- [ ] **Step 6: Confirm final status**

```bash
git status --short supabase/migrations/20260502090000_media_management.sql src/lib/media src/lib/rag src/lib/chatbot src/lib/facebook src/app/api/chatbot src/app/api/messenger 'src/app/(app)/dashboard/media' 'src/app/(app)/_components/sidebar.tsx'
```

Expected: no uncommitted media-related files remain after the task commits. Existing unrelated worktree changes may still appear outside these paths.
