-- Flip `chatbot_configs.auto_classify_enabled` to default true and turn it on
-- for existing rows.
--
-- Background: the column was added in 20260430000500 with default=false back
-- when auto stage classification was opt-in and experimental. Since then the
-- live classifier + deep reclassify pass have been hardened (see
-- 45f3102 "unstick auto stage classifier — bias toward forward movement") and
-- the deep pass was already flipped on by default in 20260527000000.
--
-- With auto_classify_enabled=false (the historical default), the messenger
-- worker short-circuits at loadStageContext: it returns stages=[], which
-- prevents the live classifier from receiving any stage list, AND prevents
-- the deep reclassify pass from firing (gated on stages.length > 0). The net
-- effect is leads silently stranded at "New Lead" no matter how strong the
-- buying signal — the exact symptom users have been reporting.
--
-- This migration brings auto_classify_enabled in line with the deep flag:
-- on by default, on for everyone.

alter table public.chatbot_configs
  alter column auto_classify_enabled set default true;

update public.chatbot_configs
  set auto_classify_enabled = true
  where auto_classify_enabled is false;

comment on column public.chatbot_configs.auto_classify_enabled is
  'When true (default), the messenger worker classifies each inbound message and applies the stage_change returned by the LLM. Required for the auto-pipeline to move leads forward.';
