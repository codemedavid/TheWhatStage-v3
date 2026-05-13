-- Extend lead_stage_events.source to allow 'system-dormant' (used by the daily
-- dormant sweeper that auto-marks 14-day-inactive leads).

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
      'workflow',
      'system-dormant'
    )
  );
