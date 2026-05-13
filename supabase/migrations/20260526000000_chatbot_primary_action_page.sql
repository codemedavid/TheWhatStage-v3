-- Add primary_action_page_id to chatbot_configs.
-- Soft pointer to a user's chosen "primary goal" action page. When set, the
-- chatbot uses it to gently steer open-ended conversations. Nullable so users
-- can have no goal. ON DELETE SET NULL so deleting the page doesn't break
-- chatbot config rows.

alter table public.chatbot_configs
  add column if not exists primary_action_page_id uuid
    references public.action_pages(id) on delete set null;

create index if not exists chatbot_configs_primary_action_page_idx
  on public.chatbot_configs(primary_action_page_id)
  where primary_action_page_id is not null;
