-- Allow Objection as a first-class stage kind (side-track stage).
alter table public.pipeline_stages
  drop constraint if exists pipeline_stages_kind_check;

alter table public.pipeline_stages
  add constraint pipeline_stages_kind_check
  check (kind in ('entry','qualifying','nurture','decision','won','lost','dormant','objection'));
