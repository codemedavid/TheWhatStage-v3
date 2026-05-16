-- supabase/migrations/20260516000000_order_payments.sql

create table public.order_payments (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users(id) on delete cascade,
  submission_id        uuid not null references public.action_page_submissions(id) on delete cascade,
  business_order_id    uuid references public.business_orders(id) on delete set null,
  action_page_id       uuid not null references public.action_pages(id) on delete cascade,
  payment_method_id    uuid not null references public.payment_methods(id) on delete restrict,

  method_kind          text not null,
  method_name          text not null,

  proof_url            text not null,
  proof_file_id        text,
  amount               numeric(12,2) check (amount is null or amount >= 0),
  currency             text check (currency is null or currency ~ '^[A-Z]{3}$'),
  note                 text check (note is null or char_length(note) <= 2000),

  status               text not null default 'submitted'
                         check (status in ('submitted','verified','rejected')),
  verified_at          timestamptz,
  verified_by          uuid references auth.users(id) on delete set null,
  rejection_reason     text check (rejection_reason is null or char_length(rejection_reason) <= 500),

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index order_payments_submission_uniq on public.order_payments (submission_id);
create index        order_payments_user_idx        on public.order_payments (user_id, created_at desc);
create index        order_payments_status_idx      on public.order_payments (user_id, status, created_at desc);
create index        order_payments_order_idx       on public.order_payments (business_order_id)
  where business_order_id is not null;

alter table public.order_payments enable row level security;

create policy "order_payments owner select"
  on public.order_payments for select
  using (auth.uid() = user_id);

create policy "order_payments owner update"
  on public.order_payments for update
  using (auth.uid() = user_id);

create or replace function public._order_payments_sync_business_order()
returns trigger language plpgsql as $$
begin
  if new.business_order_id is null then return new; end if;
  if (tg_op = 'INSERT') or (new.status is distinct from old.status) then
    update public.business_orders
       set payment_status = case new.status
                              when 'verified' then 'paid'
                              when 'rejected' then 'failed'
                              else 'pending'
                            end,
           updated_at     = now()
     where id = new.business_order_id;
  end if;
  return new;
end;
$$;

create trigger order_payments_sync_business_order
after insert or update of status on public.order_payments
for each row execute function public._order_payments_sync_business_order();

create or replace function public._order_payments_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

create trigger order_payments_touch_updated_at
before update on public.order_payments
for each row execute function public._order_payments_touch_updated_at();
