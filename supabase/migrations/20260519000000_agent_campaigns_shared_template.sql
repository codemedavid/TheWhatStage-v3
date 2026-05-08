-- =========================================================================
-- Agent Campaigns: shared-template send mode
--
-- A campaign can now run in one of two modes:
--   'per_lead_ai'    — original behavior, AI drafts a unique message per lead.
--   'shared_template' — single approved utility template + variable mapping
--                        for the whole audience. Optionally attaches a URL
--                        button that deeplinks to an action page.
-- =========================================================================

alter table public.agent_campaigns
  add column if not exists send_mode text not null default 'per_lead_ai'
    check (send_mode in ('per_lead_ai', 'shared_template')),
  add column if not exists template_id uuid
    references public.messenger_message_templates(id) on delete restrict,
  -- Mapping from template variable index → resolution rule.
  --   { "1": { "kind": "static",     "text": "literal value" },
  --     "2": { "kind": "lead_field", "field": "name" } }
  add column if not exists template_variables jsonb not null default '{}'::jsonb,
  add column if not exists attached_action_page_id uuid
    references public.action_pages(id) on delete set null,
  -- Index of the URL button on the template that should be overridden with
  -- the per-lead deeplink. Only meaningful when attached_action_page_id is
  -- set and the chosen template has a URL button at that index.
  add column if not exists attached_button_index int not null default 0;

-- shared-template campaigns must have a template_id pinned, and only
-- shared-template campaigns may have one.
alter table public.agent_campaigns
  add constraint agent_campaigns_template_consistent
  check (
    (send_mode = 'shared_template' and template_id is not null)
    or (send_mode = 'per_lead_ai'    and template_id is null)
  );
