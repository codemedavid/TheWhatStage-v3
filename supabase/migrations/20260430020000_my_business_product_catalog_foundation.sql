-- =========================================================================
-- My Business product catalog foundation.
-- =========================================================================

create table public.business_profiles (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  display_name      text not null check (char_length(display_name) between 1 and 120),
  description       text check (description is null or char_length(description) <= 2000),
  default_currency  text not null default 'PHP' check (default_currency ~ '^[A-Z]{3}$'),
  contact_email     text check (contact_email is null or char_length(contact_email) <= 320),
  contact_phone     text check (contact_phone is null or char_length(contact_phone) <= 40),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id)
);

create table public.business_items (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,
  kind                  text not null check (kind in ('product','property','digital','service')),
  status                text not null default 'draft' check (status in ('draft','published','archived')),
  title                 text not null check (char_length(title) between 1 and 160),
  slug                  text not null check (slug ~ '^[a-z0-9][a-z0-9-]{1,79}$'),
  summary               text check (summary is null or char_length(summary) <= 280),
  description           text check (description is null or char_length(description) <= 8000),
  price_amount          numeric(12,2) check (price_amount is null or price_amount >= 0),
  compare_at_amount     numeric(12,2) check (compare_at_amount is null or compare_at_amount >= 0),
  currency              text not null default 'PHP' check (currency ~ '^[A-Z]{3}$'),
  pricing_model         text not null default 'fixed' check (pricing_model in ('fixed','starts_at','quote','free')),
  sku                   text check (sku is null or char_length(sku) <= 80),
  inventory_status      text not null default 'not_tracked'
                          check (inventory_status in ('in_stock','limited','out_of_stock','preorder','not_tracked')),
  tags                  text[] not null default '{}',
  details               jsonb not null default '{}'::jsonb,
  recommendation_hints  jsonb not null default '{}'::jsonb,
  rag_enabled           boolean not null default true,
  rag_text              text,
  embedding_status      text not null default 'pending' check (embedding_status in ('pending','indexed','stale')),
  version               integer not null default 0 check (version >= 0),
  embedded_at           timestamptz,
  published_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, kind, slug)
);

create table public.business_item_media (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  item_id       uuid not null references public.business_items(id) on delete cascade,
  kind          text not null check (kind in ('image','video','file')),
  storage_path  text not null check (char_length(storage_path) between 1 and 600),
  alt_text      text check (alt_text is null or char_length(alt_text) <= 240),
  position      integer not null default 0 check (position >= 0),
  is_primary    boolean not null default false,
  created_at    timestamptz not null default now()
);

create table public.business_orders (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  action_page_id    uuid references public.action_pages(id) on delete set null,
  lead_id           uuid references public.leads(id) on delete set null,
  psid              text,
  page_id           uuid references public.facebook_pages(id) on delete set null,
  status            text not null default 'new' check (status in ('new','confirmed','cancelled','fulfilled')),
  payment_status    text not null default 'unpaid' check (payment_status in ('unpaid','pending','paid','failed','refunded')),
  currency          text not null check (currency ~ '^[A-Z]{3}$'),
  subtotal_amount   numeric(12,2) not null check (subtotal_amount >= 0),
  customer_name     text check (customer_name is null or char_length(customer_name) <= 160),
  customer_email    text check (customer_email is null or char_length(customer_email) <= 320),
  customer_phone    text check (customer_phone is null or char_length(customer_phone) <= 40),
  customer_notes    text check (customer_notes is null or char_length(customer_notes) <= 2000),
  meta              jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table public.business_order_items (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.business_orders(id) on delete cascade,
  user_id            uuid not null references auth.users(id) on delete cascade,
  business_item_id   uuid references public.business_items(id) on delete set null,
  title_snapshot     text not null check (char_length(title_snapshot) between 1 and 160),
  sku_snapshot       text check (sku_snapshot is null or char_length(sku_snapshot) <= 80),
  quantity           integer not null check (quantity between 1 and 999),
  unit_amount        numeric(12,2) not null check (unit_amount >= 0),
  currency           text not null check (currency ~ '^[A-Z]{3}$'),
  line_total_amount  numeric(12,2) not null check (line_total_amount >= 0),
  created_at         timestamptz not null default now()
);

alter table public.knowledge_chunks
  add column business_item_id uuid references public.business_items(id) on delete cascade;

alter table public.knowledge_chunks
  drop constraint if exists knowledge_chunks_one_source;

alter table public.knowledge_chunks
  add constraint knowledge_chunks_one_source
  check (num_nonnulls(document_id, faq_id, business_item_id) = 1);

alter table public.knowledge_chunks
  add constraint knowledge_chunks_item_chunk_uniq unique (business_item_id, chunk_index);

alter table public.knowledge_embedding_jobs
  add column business_item_id uuid references public.business_items(id) on delete cascade;

alter table public.knowledge_embedding_jobs
  drop constraint if exists knowledge_embedding_jobs_one_source;

alter table public.knowledge_embedding_jobs
  add constraint knowledge_embedding_jobs_one_source
  check (num_nonnulls(document_id, faq_id, business_item_id) = 1);

create unique index knowledge_embedding_jobs_active_item_uniq
  on public.knowledge_embedding_jobs (business_item_id)
  where business_item_id is not null and status in ('queued','running');

create index business_profiles_user_idx on public.business_profiles (user_id);
create index business_items_user_kind_status_idx on public.business_items (user_id, kind, status, updated_at desc);
create index business_items_search_idx on public.business_items using gin (
  to_tsvector('simple'::regconfig,
    coalesce(title,'') || ' ' ||
    coalesce(summary,'') || ' ' ||
    coalesce(description,'') || ' ' ||
    coalesce(rag_text,'')
  )
);
create index business_item_media_item_idx on public.business_item_media (item_id, position);
create index business_orders_user_created_idx on public.business_orders (user_id, created_at desc);
create index business_order_items_order_idx on public.business_order_items (order_id);

create trigger business_profiles_set_updated_at
before update on public.business_profiles
for each row execute function public.set_updated_at();

create trigger business_items_set_updated_at
before update on public.business_items
for each row execute function public.set_updated_at();

create trigger business_orders_set_updated_at
before update on public.business_orders
for each row execute function public.set_updated_at();

alter table public.business_profiles enable row level security;
alter table public.business_items enable row level security;
alter table public.business_item_media enable row level security;
alter table public.business_orders enable row level security;
alter table public.business_order_items enable row level security;

create policy business_profiles_owner_all on public.business_profiles
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy business_items_owner_all on public.business_items
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy business_item_media_owner_all on public.business_item_media
  for all to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.business_items bi
      where bi.id = business_item_media.item_id
        and bi.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.business_items bi
      where bi.id = business_item_media.item_id
        and bi.user_id = auth.uid()
    )
  );

create policy business_orders_owner_all on public.business_orders
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (
      action_page_id is null
      or exists (
        select 1
        from public.action_pages ap
        where ap.id = business_orders.action_page_id
          and ap.user_id = auth.uid()
      )
    )
    and (
      lead_id is null
      or exists (
        select 1
        from public.leads l
        where l.id = business_orders.lead_id
          and l.user_id = auth.uid()
      )
    )
    and (
      page_id is null
      or exists (
        select 1
        from public.facebook_pages fp
        join public.facebook_connections fc on fc.id = fp.connection_id
        where fp.id = business_orders.page_id
          and fc.user_id = auth.uid()
      )
    )
  );

create policy business_order_items_owner_all on public.business_order_items
  for all to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.business_orders bo
      where bo.id = business_order_items.order_id
        and bo.user_id = auth.uid()
    )
    and (
      business_item_id is null
      or exists (
        select 1
        from public.business_items bi
        where bi.id = business_order_items.business_item_id
          and bi.user_id = auth.uid()
      )
    )
  )
  with check (
    user_id = auth.uid()
    and exists (
      select 1
      from public.business_orders bo
      where bo.id = business_order_items.order_id
        and bo.user_id = auth.uid()
    )
    and (
      business_item_id is null
      or exists (
        select 1
        from public.business_items bi
        where bi.id = business_order_items.business_item_id
          and bi.user_id = auth.uid()
      )
    )
  );

grant select, insert, update, delete on public.business_profiles to authenticated;
grant select, insert, update, delete on public.business_items to authenticated;
grant select, insert, update, delete on public.business_item_media to authenticated;
grant select, insert, update, delete on public.business_orders to authenticated;
grant select, insert, update, delete on public.business_order_items to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'business-media',
  'business-media',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop function if exists public.match_knowledge_hybrid(
  uuid, text, vector, int, float, float, int
);

create or replace function public.match_knowledge_hybrid(
  p_user_id      uuid,
  p_query_text   text,
  p_query_embed  vector(1024),
  p_match_limit  int     default 150,
  p_full_text_w  float   default 1.0,
  p_semantic_w   float   default 1.0,
  p_rrf_k        int     default 60
)
returns table (
  id               uuid,
  document_id      uuid,
  faq_id           uuid,
  business_item_id uuid,
  content          text,
  heading_path     text,
  rrf_score        float
)
language sql
stable
security invoker
set search_path = public
as $$
  with eligible as (
    select kc.id
    from public.knowledge_chunks kc
    where auth.uid() is not null
      and p_user_id = auth.uid()
      and kc.user_id = auth.uid()
      and (
        kc.document_id is not null
        or exists (
          select 1
          from public.knowledge_faqs f
          where f.id = kc.faq_id
            and f.is_published
        )
        or exists (
          select 1
          from public.business_items bi
          where bi.id = kc.business_item_id
            and bi.status = 'published'
            and bi.rag_enabled
        )
      )
  ),
  fts as (
    select
      kc.id,
      row_number() over (
        order by ts_rank_cd(
          to_tsvector('simple', kc.content),
          websearch_to_tsquery('simple', p_query_text)
        ) desc
      ) as rank
    from public.knowledge_chunks kc
    join eligible e on e.id = kc.id
    where to_tsvector('simple', kc.content)
          @@ websearch_to_tsquery('simple', p_query_text)
    limit p_match_limit
  ),
  sem as (
    select
      kc.id,
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
  select
    kc.id,
    kc.document_id,
    kc.faq_id,
    kc.business_item_id,
    kc.content,
    kc.heading_path,
    coalesce(p_full_text_w / (p_rrf_k + fts.rank), 0)
      + coalesce(p_semantic_w / (p_rrf_k + sem.rank), 0) as rrf_score
  from fused
  join public.knowledge_chunks kc on kc.id = fused.id
  left join fts on fts.id = kc.id
  left join sem on sem.id = kc.id
  where kc.user_id = auth.uid()
  order by rrf_score desc
  limit p_match_limit;
$$;

revoke all on function public.match_knowledge_hybrid(
  uuid, text, vector, int, float, float, int
) from public;

grant execute on function public.match_knowledge_hybrid(
  uuid, text, vector, int, float, float, int
) to authenticated;

drop function if exists public.match_knowledge_hybrid_service(
  uuid, text, vector, int, float, float, int
);

create or replace function public.match_knowledge_hybrid_service(
  p_user_id      uuid,
  p_query_text   text,
  p_query_embed  vector(1024),
  p_match_limit  int     default 150,
  p_full_text_w  float   default 1.0,
  p_semantic_w   float   default 1.0,
  p_rrf_k        int     default 60
)
returns table (
  id               uuid,
  document_id      uuid,
  faq_id           uuid,
  business_item_id uuid,
  content          text,
  heading_path     text,
  rrf_score        float
)
language sql
stable
security definer
set search_path = public
as $$
  with eligible as (
    select kc.id
    from public.knowledge_chunks kc
    where kc.user_id = p_user_id
      and (
        kc.document_id is not null
        or exists (
          select 1
          from public.knowledge_faqs f
          where f.id = kc.faq_id
            and f.is_published
        )
        or exists (
          select 1
          from public.business_items bi
          where bi.id = kc.business_item_id
            and bi.status = 'published'
            and bi.rag_enabled
        )
      )
  ),
  fts as (
    select
      kc.id,
      row_number() over (
        order by ts_rank_cd(
          to_tsvector('simple', kc.content),
          websearch_to_tsquery('simple', p_query_text)
        ) desc
      ) as rank
    from public.knowledge_chunks kc
    join eligible e on e.id = kc.id
    where to_tsvector('simple', kc.content)
          @@ websearch_to_tsquery('simple', p_query_text)
    limit p_match_limit
  ),
  sem as (
    select
      kc.id,
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
  select
    kc.id,
    kc.document_id,
    kc.faq_id,
    kc.business_item_id,
    kc.content,
    kc.heading_path,
    coalesce(p_full_text_w / (p_rrf_k + fts.rank), 0)
      + coalesce(p_semantic_w / (p_rrf_k + sem.rank), 0) as rrf_score
  from fused
  join public.knowledge_chunks kc on kc.id = fused.id
  left join fts on fts.id = kc.id
  left join sem on sem.id = kc.id
  where kc.user_id = p_user_id
  order by rrf_score desc
  limit p_match_limit;
$$;

revoke all on function public.match_knowledge_hybrid_service(
  uuid, text, vector, int, float, float, int
) from public;

grant execute on function public.match_knowledge_hybrid_service(
  uuid, text, vector, int, float, float, int
) to service_role;

create or replace function public.apply_knowledge_ingest(
  p_kind           text,
  p_source_id      uuid,
  p_user_id        uuid,
  p_source_version integer,
  p_rows           jsonb default '[]'::jsonb,
  p_delete_indexes integer[] default '{}'::integer[]
)
returns table (
  applied         boolean,
  current_version integer
)
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_current_version integer;
begin
  if p_kind = 'document' then
    select d.version
      into v_current_version
    from public.knowledge_documents d
    where d.id = p_source_id
      and d.user_id = p_user_id;
  elsif p_kind = 'faq' then
    select f.version
      into v_current_version
    from public.knowledge_faqs f
    where f.id = p_source_id
      and f.user_id = p_user_id;
  elsif p_kind = 'business_item' then
    select bi.version
      into v_current_version
    from public.business_items bi
    where bi.id = p_source_id
      and bi.user_id = p_user_id
      and bi.status = 'published'
      and bi.rag_enabled
      and nullif(trim(coalesce(bi.rag_text, '')), '') is not null;
  else
    raise exception 'unknown RAG source kind: %', p_kind;
  end if;

  if v_current_version is null then
    raise exception 'RAG source not found: % %', p_kind, p_source_id;
  end if;

  if v_current_version <> p_source_version then
    applied := false;
    current_version := v_current_version;
    return next;
    return;
  end if;

  if jsonb_array_length(p_rows) > 0 then
    if p_kind = 'document' then
      insert into public.knowledge_chunks (
        document_id,
        faq_id,
        business_item_id,
        user_id,
        chunk_index,
        content,
        heading_path,
        source_offset,
        token_count,
        content_hash,
        is_atomic,
        embedding
      )
      select
        p_source_id,
        null::uuid,
        null::uuid,
        p_user_id,
        r.chunk_index,
        r.content,
        r.heading_path,
        nullif(r.source_offset, '')::int4range,
        r.token_count,
        r.content_hash,
        r.is_atomic,
        r.embedding::text::vector
      from jsonb_to_recordset(p_rows) as r(
        chunk_index integer,
        content text,
        heading_path text,
        source_offset text,
        token_count integer,
        content_hash text,
        is_atomic boolean,
        embedding jsonb
      )
      on conflict (document_id, chunk_index) do update
        set content = excluded.content,
            heading_path = excluded.heading_path,
            source_offset = excluded.source_offset,
            token_count = excluded.token_count,
            content_hash = excluded.content_hash,
            is_atomic = excluded.is_atomic,
            embedding = excluded.embedding,
            updated_at = now();
    elsif p_kind = 'faq' then
      insert into public.knowledge_chunks (
        document_id,
        faq_id,
        business_item_id,
        user_id,
        chunk_index,
        content,
        heading_path,
        source_offset,
        token_count,
        content_hash,
        is_atomic,
        embedding
      )
      select
        null::uuid,
        p_source_id,
        null::uuid,
        p_user_id,
        r.chunk_index,
        r.content,
        r.heading_path,
        nullif(r.source_offset, '')::int4range,
        r.token_count,
        r.content_hash,
        r.is_atomic,
        r.embedding::text::vector
      from jsonb_to_recordset(p_rows) as r(
        chunk_index integer,
        content text,
        heading_path text,
        source_offset text,
        token_count integer,
        content_hash text,
        is_atomic boolean,
        embedding jsonb
      )
      on conflict (faq_id, chunk_index) do update
        set content = excluded.content,
            heading_path = excluded.heading_path,
            source_offset = excluded.source_offset,
            token_count = excluded.token_count,
            content_hash = excluded.content_hash,
            is_atomic = excluded.is_atomic,
            embedding = excluded.embedding,
            updated_at = now();
    else
      insert into public.knowledge_chunks (
        document_id,
        faq_id,
        business_item_id,
        user_id,
        chunk_index,
        content,
        heading_path,
        source_offset,
        token_count,
        content_hash,
        is_atomic,
        embedding
      )
      select
        null::uuid,
        null::uuid,
        p_source_id,
        p_user_id,
        r.chunk_index,
        r.content,
        r.heading_path,
        nullif(r.source_offset, '')::int4range,
        r.token_count,
        r.content_hash,
        r.is_atomic,
        r.embedding::text::vector
      from jsonb_to_recordset(p_rows) as r(
        chunk_index integer,
        content text,
        heading_path text,
        source_offset text,
        token_count integer,
        content_hash text,
        is_atomic boolean,
        embedding jsonb
      )
      on conflict (business_item_id, chunk_index) do update
        set content = excluded.content,
            heading_path = excluded.heading_path,
            source_offset = excluded.source_offset,
            token_count = excluded.token_count,
            content_hash = excluded.content_hash,
            is_atomic = excluded.is_atomic,
            embedding = excluded.embedding,
            updated_at = now();
    end if;
  end if;

  if coalesce(array_length(p_delete_indexes, 1), 0) > 0 then
    if p_kind = 'document' then
      delete from public.knowledge_chunks kc
      where kc.document_id = p_source_id
        and kc.user_id = p_user_id
        and kc.chunk_index = any(p_delete_indexes);
    elsif p_kind = 'faq' then
      delete from public.knowledge_chunks kc
      where kc.faq_id = p_source_id
        and kc.user_id = p_user_id
        and kc.chunk_index = any(p_delete_indexes);
    else
      delete from public.knowledge_chunks kc
      where kc.business_item_id = p_source_id
        and kc.user_id = p_user_id
        and kc.chunk_index = any(p_delete_indexes);
    end if;
  end if;

  applied := true;
  current_version := v_current_version;
  return next;
end;
$$;

revoke all on function public.apply_knowledge_ingest(
  text, uuid, uuid, integer, jsonb, integer[]
) from public;

grant execute on function public.apply_knowledge_ingest(
  text, uuid, uuid, integer, jsonb, integer[]
) to service_role;

create or replace function public.create_catalog_order(
  p_order jsonb,
  p_lines jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
begin
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'catalog order requires at least one line item';
  end if;

  insert into public.business_orders (
    user_id,
    action_page_id,
    lead_id,
    psid,
    page_id,
    status,
    payment_status,
    currency,
    subtotal_amount,
    customer_name,
    customer_email,
    customer_phone,
    customer_notes,
    meta
  )
  values (
    (p_order ->> 'user_id')::uuid,
    nullif(p_order ->> 'action_page_id', '')::uuid,
    nullif(p_order ->> 'lead_id', '')::uuid,
    p_order ->> 'psid',
    nullif(p_order ->> 'page_id', '')::uuid,
    coalesce(p_order ->> 'status', 'new'),
    coalesce(p_order ->> 'payment_status', 'unpaid'),
    p_order ->> 'currency',
    (p_order ->> 'subtotal_amount')::numeric,
    p_order ->> 'customer_name',
    p_order ->> 'customer_email',
    p_order ->> 'customer_phone',
    p_order ->> 'customer_notes',
    coalesce(p_order -> 'meta', '{}'::jsonb)
  )
  returning id into v_order_id;

  insert into public.business_order_items (
    order_id,
    user_id,
    business_item_id,
    title_snapshot,
    sku_snapshot,
    quantity,
    unit_amount,
    currency,
    line_total_amount
  )
  select
    v_order_id,
    (line ->> 'user_id')::uuid,
    nullif(line ->> 'business_item_id', '')::uuid,
    line ->> 'title_snapshot',
    line ->> 'sku_snapshot',
    (line ->> 'quantity')::integer,
    (line ->> 'unit_amount')::numeric,
    line ->> 'currency',
    (line ->> 'line_total_amount')::numeric
  from jsonb_array_elements(p_lines) as line;

  return v_order_id;
end;
$$;

revoke all on function public.create_catalog_order(jsonb, jsonb) from public;
grant execute on function public.create_catalog_order(jsonb, jsonb) to service_role;
