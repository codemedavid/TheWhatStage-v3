-- =========================================================================
-- carts: add visitor identity columns for action-page catalog carts
--
-- These nullable columns let the existing carts/cart_items tables also
-- represent a public catalog visitor's draft cart, keyed on
-- (action_page_id, psid). Owner-side RLS, abandoned-cart workflow, and
-- dashboard reads keep working because user_id is still populated (from
-- the action page's owner).
-- =========================================================================

alter table public.carts
  add column action_page_id uuid references public.action_pages(id) on delete cascade,
  add column psid           text;

-- Only one active cart per (action_page_id, psid). Partial index is safe
-- for existing rows (action_page_id is null there).
create unique index carts_active_visitor_idx
  on public.carts (action_page_id, psid)
  where status = 'active'
    and action_page_id is not null
    and psid is not null;

-- Fast lookup for the visitor GET route.
create index carts_action_page_psid_idx
  on public.carts (action_page_id, psid)
  where action_page_id is not null;
