-- OAuth 2.1 authorization server backing the MCP endpoint (/api/mcp).
-- MCP clients (claude.ai, Claude Desktop, Cursor, ...) register themselves
-- dynamically, send the operator through WhatStage's login + consent page,
-- and receive opaque bearer tokens. Only sha256 hashes of codes and tokens
-- are stored. All three tables are service-role only except that a signed-in
-- user may list and revoke their own grants from Settings.

create table public.oauth_clients (
  id                          text primary key,
  client_secret_hash          text,
  token_endpoint_auth_method  text not null default 'none',
  client_name                 text,
  client_uri                  text,
  logo_uri                    text,
  redirect_uris               text[] not null,
  created_at                  timestamptz not null default now()
);

create table public.oauth_authorization_codes (
  code_hash              text primary key,
  client_id              text not null references public.oauth_clients(id) on delete cascade,
  user_id                uuid not null references auth.users(id) on delete cascade,
  redirect_uri           text not null,
  scopes                 text[] not null,
  code_challenge         text not null,
  code_challenge_method  text not null default 'S256',
  resource               text,
  expires_at             timestamptz not null,
  created_at             timestamptz not null default now()
);

create table public.oauth_tokens (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  client_id           text not null references public.oauth_clients(id) on delete cascade,
  access_token_hash   text not null unique,
  refresh_token_hash  text unique,
  scopes              text[] not null,
  access_expires_at   timestamptz not null,
  refresh_expires_at  timestamptz,
  last_used_at        timestamptz,
  revoked_at          timestamptz,
  created_at          timestamptz not null default now()
);

create index oauth_tokens_user_idx on public.oauth_tokens (user_id, client_id, created_at desc);
create index oauth_codes_expiry_idx on public.oauth_authorization_codes (expires_at);

alter table public.oauth_clients enable row level security;
alter table public.oauth_authorization_codes enable row level security;
alter table public.oauth_tokens enable row level security;

-- Owners may see and revoke their own connected apps from the dashboard.
create policy "oauth_tokens_owner_select" on public.oauth_tokens
  for select using (user_id = auth.uid());
create policy "oauth_tokens_owner_update" on public.oauth_tokens
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Client names are needed to label a grant in the UI.
create policy "oauth_clients_read" on public.oauth_clients
  for select using (auth.role() = 'authenticated');
