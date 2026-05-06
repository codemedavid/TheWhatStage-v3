-- =========================================================================
-- Workflow engine — Step 6: Cart-abandoned trigger (Messenger only)
--
-- WhatsApp is explicitly out of scope. Cart abandonment flows run over
-- Messenger using the existing outbound coordinator and channel policy.
--
-- Tables:
--   carts      — shopping cart lifecycle (active → abandoned → converted)
--   cart_items — line items
-- =========================================================================

-- -------------------------------------------------------------------------
-- carts
-- -------------------------------------------------------------------------
create table public.carts (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null,
  lead_id         uuid        references public.leads(id) on delete set null,
  -- messenger thread this cart is associated with (nullable — some carts
  -- originate outside a Messenger conversation)
  thread_id       uuid        references public.messenger_threads(id) on delete set null,
  status          text        not null default 'active'
                  check (status in ('active','abandoned','converted')),
  total_amount    numeric(10,2),
  currency        text        not null default 'USD',
  -- origin surface: 'messenger_bot' | 'action_page' | 'web' | ...
  source          text,
  abandoned_at    timestamptz,
  converted_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index carts_user_status_idx  on public.carts (user_id, status);
create index carts_abandoned_at_idx on public.carts (abandoned_at) where status = 'abandoned';
create index carts_lead_id_idx      on public.carts (lead_id) where lead_id is not null;

create trigger carts_set_updated_at
before update on public.carts
for each row execute function public.set_updated_at();

-- -------------------------------------------------------------------------
-- cart_items
-- -------------------------------------------------------------------------
create table public.cart_items (
  id          uuid          primary key default gen_random_uuid(),
  cart_id     uuid          not null references public.carts(id) on delete cascade,
  -- nullable: product may be deleted after cart is created
  product_id  uuid,
  name        text          not null,
  quantity    int           not null default 1 check (quantity > 0),
  unit_price  numeric(10,2) not null,
  image_url   text,
  created_at  timestamptz   not null default now()
);

create index cart_items_cart_id_idx on public.cart_items (cart_id);

-- =========================================================================
-- RLS
-- =========================================================================

alter table public.carts      enable row level security;
alter table public.cart_items enable row level security;

-- carts --------------------------------------------------------------------
create policy carts_owner_all on public.carts
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy carts_admin_all on public.carts
  for all to authenticated
  using (public.current_role() in ('admin','superadmin'))
  with check (public.current_role() in ('admin','superadmin'));

-- cart_items (via cart ownership) ------------------------------------------
create policy cart_items_owner_all on public.cart_items
  for all to authenticated
  using (
    exists (
      select 1 from public.carts c
      where c.id = cart_items.cart_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.carts c
      where c.id = cart_items.cart_id
        and c.user_id = auth.uid()
    )
  );

create policy cart_items_admin_all on public.cart_items
  for all to authenticated
  using (public.current_role() in ('admin','superadmin'))
  with check (public.current_role() in ('admin','superadmin'));
