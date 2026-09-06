-- Per-user API keys for the WhatStage MCP server (/api/mcp) and any future
-- non-cookie integrations. Only a sha256 hash of the key is stored; the
-- plaintext is shown once at creation. `key_prefix` is the display stub
-- ("wsk_ab12cd34") so an operator can recognise which key is which.
create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 60),
  key_prefix   text not null,
  key_hash     text not null unique,
  scopes       text[] not null default '{read,send,projects}',
  last_used_at timestamptz,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now()
);

create index api_keys_user_idx on public.api_keys (user_id, created_at desc);

alter table public.api_keys enable row level security;

-- Owner can list/create/revoke their own keys from the dashboard. The MCP
-- route resolves keys with the service-role client (bypasses RLS).
create policy "api_keys_owner_rw" on public.api_keys
  for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());
