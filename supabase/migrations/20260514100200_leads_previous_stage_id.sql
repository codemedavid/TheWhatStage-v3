alter table public.leads
  add column if not exists previous_stage_id uuid null
    references public.pipeline_stages(id) on delete set null;

create index if not exists leads_user_previous_stage_idx
  on public.leads (user_id, previous_stage_id)
  where previous_stage_id is not null;
