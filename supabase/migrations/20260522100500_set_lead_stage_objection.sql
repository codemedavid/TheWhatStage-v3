-- Extend set_lead_stage RPC to manage leads.previous_stage_id based on kind='objection'.
create or replace function public.set_lead_stage(
  p_lead_id           uuid,
  p_to_stage_id       uuid,
  p_source            text,
  p_reason            text    default null,
  p_idempotency_key   text    default null,
  p_expected_version  int     default null,
  p_confidence        text    default null,
  p_thread_id         uuid    default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lead         record;
  v_stage_user   uuid;
  v_from_stage   uuid;
  v_from_kind    text;
  v_to_kind      text;
  v_event_id     uuid;
  v_new_prev     uuid;
begin
  select id, user_id, stage_id, version, previous_stage_id
    into v_lead
    from public.leads
   where id = p_lead_id
     for update;

  if not found then
    raise exception 'Lead % not found', p_lead_id;
  end if;

  if p_expected_version is not null and v_lead.version != p_expected_version then
    return false;
  end if;

  select user_id, kind into v_stage_user, v_to_kind
    from public.pipeline_stages
   where id = p_to_stage_id;

  if not found then
    raise exception 'Stage % not found', p_to_stage_id;
  end if;

  if v_stage_user != v_lead.user_id then
    raise exception 'Stage % does not belong to the lead''s user', p_to_stage_id;
  end if;

  v_from_stage := v_lead.stage_id;

  select kind into v_from_kind
    from public.pipeline_stages
   where id = v_from_stage;

  if v_to_kind = 'objection' and coalesce(v_from_kind, '') <> 'objection' then
    v_new_prev := v_from_stage;
  elsif coalesce(v_from_kind, '') = 'objection' and v_to_kind <> 'objection' then
    v_new_prev := null;
  else
    v_new_prev := v_lead.previous_stage_id;
  end if;

  v_event_id := gen_random_uuid();

  insert into public.lead_stage_events
    (id, lead_id, user_id, from_stage_id, to_stage_id,
     source, reason, confidence, thread_id, idempotency_key)
  values
    (v_event_id, p_lead_id, v_lead.user_id, v_from_stage, p_to_stage_id,
     p_source, p_reason, p_confidence, p_thread_id, p_idempotency_key)
  on conflict (idempotency_key)
    where idempotency_key is not null
    do nothing;

  update public.leads
     set stage_id          = p_to_stage_id,
         previous_stage_id = v_new_prev,
         version           = version + 1,
         entered_stage_at  = case when stage_id <> p_to_stage_id then now() else entered_stage_at end,
         updated_at        = now()
   where id = p_lead_id;

  return true;
end;
$$;

revoke all on function public.set_lead_stage(uuid,uuid,text,text,text,int,text,uuid) from public;
grant execute on function public.set_lead_stage(uuid,uuid,text,text,text,int,text,uuid) to service_role;
