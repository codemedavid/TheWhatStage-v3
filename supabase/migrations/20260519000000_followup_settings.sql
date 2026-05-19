-- =========================================================================
-- Auto Follow-Up Settings: per-user master toggle + per-touchpoint enable/
-- interval stored as JSONB on chatbot_configs. Snapshot of resolved offsets
-- captured on lead_followup_schedules at seed time so in-flight schedules
-- ride out subsequent settings changes.
-- =========================================================================

-- 1. Per-user settings on chatbot_configs.
--    NULL = "use defaults" (preserves current behavior for existing users).
alter table public.chatbot_configs
  add column followup_settings jsonb;

-- 2. Snapshot of resolved offsets per schedule.
--    Shape: [{ "offset_ms": <int>, "slot": <int 0..6> }, ...] (ascending)
--    Existing rows are backfilled with the historical 7-touchpoint default.
alter table public.lead_followup_schedules
  add column offsets_snapshot jsonb not null default '[]'::jsonb;

update public.lead_followup_schedules
   set offsets_snapshot = jsonb_build_array(
     jsonb_build_object('offset_ms', 300000,   'slot', 0),
     jsonb_build_object('offset_ms', 3600000,  'slot', 1),
     jsonb_build_object('offset_ms', 18000000, 'slot', 2),
     jsonb_build_object('offset_ms', 28800000, 'slot', 3),
     jsonb_build_object('offset_ms', 43200000, 'slot', 4),
     jsonb_build_object('offset_ms', 64800000, 'slot', 5),
     jsonb_build_object('offset_ms', 86400000, 'slot', 6)
   )
 where jsonb_array_length(offsets_snapshot) = 0;
