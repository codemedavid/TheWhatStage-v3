-- Saved messages become full Messenger layouts, not just "text + one action
-- page button".
--
-- A saved message now picks one of four layouts:
--   text     — a plain bubble (unchanged behaviour)
--   buttons  — button template: body text plus 1-3 buttons
--   card     — generic template, one card: image, title, subtitle, buttons
--   carousel — the same generic template with up to 10 swipeable cards
--
-- Buttons are JSONB rather than columns because each action carries a
-- different target (a URL, an action page, a phone number, a bot reply) and a
-- message holds several of them. Shapes are validated in
-- src/lib/saved-messages/template.ts, which the editor and the send path share;
-- the checks below only guard the invariants the DB can cheaply enforce.
--
-- The old single-button columns (action_page_id / cta_label) are backfilled
-- into `buttons` and dropped — two representations of "this message has a
-- button" would inevitably drift apart.

alter table public.saved_messages
  add column if not exists layout text not null default 'text',
  add column if not exists buttons jsonb not null default '[]'::jsonb,
  add column if not exists cards jsonb not null default '[]'::jsonb;

-- Backfill before the constraints land: an existing action-page saved message
-- becomes a one-button 'buttons' layout that sends identically.
update public.saved_messages
set
  layout = 'buttons',
  buttons = jsonb_build_array(
    jsonb_build_object(
      'type', 'action_page',
      'label', coalesce(nullif(btrim(cta_label), ''), 'Open'),
      'action_page_id', action_page_id::text
    )
  )
where action_page_id is not null
  and layout = 'text';

alter table public.saved_messages
  drop constraint if exists saved_messages_layout_check;
alter table public.saved_messages
  add constraint saved_messages_layout_check
  check (layout in ('text', 'buttons', 'card', 'carousel'));

-- Meta caps a button template at 3 buttons and a carousel at 10 cards. A
-- 'buttons' layout with no buttons, or a card layout with no cards, is not a
-- sendable message — it is a half-finished edit that must not reach a lead.
alter table public.saved_messages
  drop constraint if exists saved_messages_buttons_check;
alter table public.saved_messages
  add constraint saved_messages_buttons_check
  check (
    jsonb_typeof(buttons) = 'array'
    and jsonb_array_length(buttons) <= 3
    and (layout <> 'buttons' or jsonb_array_length(buttons) between 1 and 3)
  );

alter table public.saved_messages
  drop constraint if exists saved_messages_cards_check;
alter table public.saved_messages
  add constraint saved_messages_cards_check
  check (
    jsonb_typeof(cards) = 'array'
    and (layout <> 'card' or jsonb_array_length(cards) = 1)
    and (layout <> 'carousel' or jsonb_array_length(cards) between 1 and 10)
    and (layout in ('card', 'carousel') or jsonb_array_length(cards) = 0)
  );

-- A card layout carries its text inside the cards, so `body` is only a preview
-- label there. Relax the old 1-2000 length check to allow it to be empty.
alter table public.saved_messages
  drop constraint if exists saved_messages_body_check;
alter table public.saved_messages
  add constraint saved_messages_body_check
  check (
    char_length(body) <= 2000
    and (layout in ('card', 'carousel') or char_length(btrim(body)) >= 1)
  );

-- The superseded single-button columns and everything that hung off them.
drop index if exists public.saved_messages_action_page_idx;
alter table public.saved_messages
  drop constraint if exists saved_messages_cta_label_check,
  drop constraint if exists saved_messages_cta_requires_page_check;
alter table public.saved_messages
  drop column if exists action_page_id,
  drop column if exists cta_label;
