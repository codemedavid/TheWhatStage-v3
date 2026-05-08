-- =========================================================================
-- Link business_items back to the action page that owns them.
-- Used by the realestate/sales RAG sync to archive removed items.
-- =========================================================================

alter table public.business_items
  add column action_page_id uuid references public.action_pages(id) on delete set null;

create index business_items_action_page_idx on public.business_items (action_page_id)
  where action_page_id is not null;
