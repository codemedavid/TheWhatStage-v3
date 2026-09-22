-- Expo push devices: one row per (device, signed-in user).
--
-- The Expo push token identifies a physical app install, not a person, so the
-- token is globally unique and the row MOVES to whichever user last signed in
-- on that device. Without that, signing out and signing in as someone else
-- would keep delivering the previous operator's messages to the same handset.
--
-- Rows are written and read by the Expo app through /api/mobile/push/* (service
-- role); the owner policies below exist so a future direct-from-client read
-- stays tenant-safe, exactly like saved_messages.

create table if not exists public.push_devices (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  token        text not null unique check (char_length(token) between 8 and 512),
  platform     text not null check (platform in ('ios', 'android')),
  device_name  text check (device_name is null or char_length(device_name) <= 120),
  -- Per-device mute. The Me screen toggles this; the sender skips disabled rows
  -- instead of deleting them so the mute survives an app restart.
  enabled      boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

-- The only read the sender makes: enabled tokens for one user.
create index if not exists push_devices_user_enabled_idx
  on public.push_devices (user_id) where enabled;

alter table public.push_devices enable row level security;

drop policy if exists push_devices_owner_all on public.push_devices;
create policy push_devices_owner_all on public.push_devices
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.push_devices to authenticated;
