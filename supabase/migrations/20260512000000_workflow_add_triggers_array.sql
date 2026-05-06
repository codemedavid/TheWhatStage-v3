-- =========================================================================
-- Workflow engine — add triggers array column
--
-- The editor supports multiple triggers per workflow. Previously only the
-- first trigger was persisted in the singular `trigger` column. This adds
-- a `triggers` JSONB array column and back-fills it from `trigger` for
-- existing rows so the dispatcher can match any trigger in the array.
-- =========================================================================

alter table public.workflows
  add column if not exists triggers jsonb not null default '[]';

-- Back-fill: wrap the existing singular trigger in an array.
update public.workflows
   set triggers = jsonb_build_array(trigger)
 where jsonb_array_length(triggers) = 0
   and trigger != '{}';
