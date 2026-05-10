-- Extend lead_stage_events.source CHECK constraint.
--
-- Pre-existing bug: callers in classify.ts, workflow/executor.ts, and
-- action-pages/submit/route.ts pass 'classifier', 'workflow', and
-- 'action_page_submission' respectively, but the prior constraint only
-- accepted ('ai','user','action_page'), causing those RPC calls to fail
-- the CHECK and silently no-op (the application catches and logs only).
--
-- This migration accepts all values currently passed by callers and adds
-- 'deep_classifier' for the new background re-evaluation layer.

alter table public.lead_stage_events
  drop constraint if exists lead_stage_events_source_check;

alter table public.lead_stage_events
  add constraint lead_stage_events_source_check
  check (
    source in (
      'ai',
      'user',
      'action_page',
      'action_page_submission',
      'classifier',
      'deep_classifier',
      'workflow'
    )
  );
