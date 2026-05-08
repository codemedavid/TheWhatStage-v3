-- =========================================================================
-- Payment Methods
--
-- User-scoped payment instructions (GCash, bank transfer, generic) that can
-- be attached to action pages. Each method stores presentation/identification
-- info (name, account number, QR code image, instructions) in a flexible
-- jsonb config so we can evolve fields per kind without future migrations.
--
-- Action pages reference enabled payment methods via `config.payment_method_ids`
-- (jsonb array of uuids); on submit, the chosen method id is stored in
-- `business_orders.meta.payment_method_id` and the order is moved to
-- `payment_status='pending'` whenever the customer uploads a proof image.
-- =========================================================================

create table public.payment_methods (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,

  -- Presentation kind. Drives which fields the editor surfaces and which
  -- icon/format is shown to buyers. Keep `other` for anything we don't
  -- have a first-class shape for yet.
  kind        text not null check (kind in ('gcash', 'bank_transfer', 'other')),

  -- Internal label shown in the dashboard and to buyers when they pick a
  -- method (e.g. "GCash · 0917…", "BPI savings").
  name        text not null check (char_length(name) between 1 and 120),

  -- Optional short instruction shown next to the QR/account info on
  -- checkout (e.g. "Send the exact amount, then upload your receipt").
  instructions text check (instructions is null or char_length(instructions) <= 2000),

  -- Method-specific fields. Conventional keys per kind:
  --   gcash:         { account_name, account_number, qr_image_url }
  --   bank_transfer: { bank_name, account_name, account_number,
  --                    branch?, swift_code?, qr_image_url? }
  --   other:         free-form (account_name, account_number, qr_image_url, …)
  details     jsonb not null default '{}'::jsonb,

  enabled     boolean not null default true,
  position    integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index payment_methods_user_idx
  on public.payment_methods (user_id, position, created_at);

create or replace function public.touch_payment_methods()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger payment_methods_touch
  before update on public.payment_methods
  for each row execute function public.touch_payment_methods();

alter table public.payment_methods enable row level security;

create policy "payment_methods_owner_rw"
  on public.payment_methods
  for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());
