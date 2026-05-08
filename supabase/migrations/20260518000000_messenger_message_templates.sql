-- =========================================================================
-- Messenger Utility Message Templates
--
-- Per Meta's Messenger Platform "Utility Messages" product, free-form text
-- cannot be sent outside the 24h window. Instead, businesses must pre-register
-- templates with parameter slots ({{1}}, {{2}}, ...) and an optional set of
-- buttons; Meta reviews each template and assigns it an approval status.
-- This migration stores those templates per-user so the dashboard can manage
-- the registration flow before the send-side wiring (Phase 3) ever runs.
--
-- Doc: https://developers.facebook.com/documentation/business-messaging/messenger-platform/send-messages/utility-messages
-- =========================================================================

create table public.messenger_message_templates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,

  -- When set, this template is registered against a specific Page. When null,
  -- it lives at the user level and gets registered per-page on first send.
  page_id     uuid references public.facebook_pages(id) on delete cascade,

  -- Internal identifier (slug-like). Unique per user. Sent to Meta as
  -- `template name` — must be lowercase letters, digits, underscores.
  name         text not null,
  display_name text not null,

  category text not null default 'utility'
    check (category in ('utility')),

  -- BCP-47 language tag with underscore (Meta convention: en_US, fil_PH, ...).
  language text not null default 'en_US',

  -- Template body. Contains {{1}}, {{2}}, ... placeholders.
  body_text      text not null,
  variable_count int  not null default 0,

  -- Optional sample values for the placeholders (Meta requires examples
  -- when the body has variables). Stored as text[] indexed by 1.
  sample_values text[] not null default '{}',

  -- Buttons attached to the template. Max 3 per Meta policy.
  -- Each item: { type: 'url' | 'postback' | 'phone_number',
  --              text: string,
  --              url?: string,        -- for type='url'; may contain {{1}} suffix
  --              payload?: string,    -- for type='postback'
  --              phone_number?: string }
  buttons jsonb not null default '[]'::jsonb,

  -- Optional header (text-only for utility templates currently).
  -- { type: 'text', text: string } | null
  header jsonb,
  footer text,

  -- Meta registration state.
  meta_template_id      text,
  meta_status           text not null default 'draft'
    check (meta_status in ('draft', 'pending', 'approved', 'rejected', 'disabled')),
  meta_rejection_reason text,
  submitted_at          timestamptz,
  approved_at           timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (user_id, name),
  -- Buttons cap is enforced by Meta but we mirror it here so a malformed
  -- client request fails fast at the database boundary.
  check (jsonb_typeof(buttons) = 'array' and jsonb_array_length(buttons) <= 3)
);

create index messenger_message_templates_user_idx
  on public.messenger_message_templates (user_id, created_at desc);

create index messenger_message_templates_page_idx
  on public.messenger_message_templates (page_id)
  where page_id is not null;

create index messenger_message_templates_status_idx
  on public.messenger_message_templates (user_id, meta_status);

-- updated_at maintenance.
create or replace function public.touch_messenger_message_templates()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger messenger_message_templates_touch
  before update on public.messenger_message_templates
  for each row execute function public.touch_messenger_message_templates();

alter table public.messenger_message_templates enable row level security;

create policy "messenger_message_templates_owner_rw"
  on public.messenger_message_templates
  for all
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- -------------------------------------------------------------------------
-- Default template library
--
-- The 28 entries below are the canonical utility templates we want every
-- new user to start with. They mirror Meta's recommended utility shapes
-- (booking, order, account, notification, generic update). Users edit
-- and submit them individually before sending.
-- -------------------------------------------------------------------------
create or replace function public.seed_default_message_templates(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.messenger_message_templates
    (user_id, name, display_name, body_text, variable_count, sample_values, buttons)
  values
    (p_user_id, 'booking_confirmation_buttons',
     'Booking confirmation (with buttons)',
     'Booking confirmation: {{1}}. Use the buttons below to manage your booking.',
     1, array['Your appointment on Dec 15, 2:00 PM']::text[],
     '[{"type":"postback","text":"Manage booking","payload":"manage_booking"},{"type":"postback","text":"Cancel","payload":"cancel_booking"}]'::jsonb),

    (p_user_id, 'order_status_update',
     'Order status update',
     'Your order has been updated. {{1}}. Track your order below.',
     1, array['Your order #12345 has shipped']::text[],
     '[{"type":"postback","text":"Track order","payload":"track_order"}]'::jsonb),

    (p_user_id, 'account_update_details',
     'Account update with details button',
     'Account update: {{1}}. Tap below for more details.',
     1, array['Your subscription renews on Jan 1']::text[],
     '[{"type":"postback","text":"View details","payload":"view_account"}]'::jsonb),

    (p_user_id, 'notification_with_note',
     'Notification with note',
     'Notification: {{1}}. Note: {{2}}. Reply for assistance.',
     2, array['Your appointment is tomorrow','Please arrive 10 minutes early']::text[],
     '[]'::jsonb),

    (p_user_id, 'order_update_details',
     'Order update with details',
     'Order update: {{1}}. Details: {{2}}. Contact us if you need help.',
     2, array['Your order is delayed','New delivery date is Dec 20']::text[],
     '[]'::jsonb),

    (p_user_id, 'quick_reminder',
     'Quick reminder',
     'Quick reminder — {{1}}. Talk soon!',
     1, array['your appointment is at 3 PM today']::text[],
     '[]'::jsonb),

    (p_user_id, 'casual_heads_up',
     'Casual heads-up',
     'Hey, just thought you should know: {{1}}.',
     1, array['your order arrives tomorrow']::text[],
     '[]'::jsonb),

    (p_user_id, 'in_the_loop',
     'In-the-loop update',
     '{{1}} — just keeping you in the loop!',
     1, array['Your request is being processed']::text[],
     '[]'::jsonb),

    (p_user_id, 'quick_update_friendly',
     'Quick friendly update',
     'Hi! Quick update for you — {{1}}. Hope this helps!',
     1, array['your refund has been approved']::text[],
     '[]'::jsonb),

    (p_user_id, 'quick_heads_up_thanks',
     'Quick heads up (thanks)',
     'Just a quick heads up: {{1}}. Thanks!',
     1, array['your invoice is ready']::text[],
     '[]'::jsonb),

    (p_user_id, 'general_help_offer',
     'General update with help offer',
     'Hi there! {{1}}. Let us know if there is anything else we can help with.',
     1, array['Your booking has been confirmed']::text[],
     '[]'::jsonb),

    (p_user_id, 'casual_with_reply_invite',
     'Casual update with reply invite',
     'Hey! Just wanted to let you know — {{1}}. Feel free to reply if you have any questions!',
     1, array['your appointment has been rescheduled']::text[],
     '[]'::jsonb),

    (p_user_id, 'good_day_update',
     'Good day update',
     'Good day! Here is an update for you: {{1}}. Thank you for choosing our services.',
     1, array['Your service request has been completed']::text[],
     '[]'::jsonb),

    (p_user_id, 'valued_customer_update',
     'Valued customer update',
     'Hello! We have an update for you. {{1}}. Thank you for being a valued customer.',
     1, array['Your loyalty points have been credited']::text[],
     '[]'::jsonb),

    (p_user_id, 'important_notice',
     'Important notice',
     'Important notice: {{1}}. Please review this information at your earliest convenience.',
     1, array['Your account requires verification']::text[],
     '[]'::jsonb),

    (p_user_id, 'team_message',
     'Message from team',
     'Message from our team: {{1}}.',
     1, array['Your support ticket has been resolved']::text[],
     '[]'::jsonb),

    (p_user_id, 'team_friendly_reminder',
     'Friendly team reminder',
     'Friendly reminder from our team: {{1}}.',
     1, array['your subscription expires next week']::text[],
     '[]'::jsonb),

    (p_user_id, 'system_notification_optout',
     'System notification with opt-out',
     '{{1}}. This is an automated notification from our system. Reply STOP to opt out.',
     1, array['Your weekly report is ready']::text[],
     '[]'::jsonb),

    (p_user_id, 'support_request_update',
     'Support request update',
     'Update on your support request: {{1}}. Reply to this message if you need further assistance.',
     1, array['We have escalated your issue to engineering']::text[],
     '[]'::jsonb),

    (p_user_id, 'booking_update_changes',
     'Booking update (changes)',
     'Booking update: {{1}}. If you need to make changes, please reply to this message or contact us.',
     1, array['Your booking has been confirmed for Dec 20']::text[],
     '[]'::jsonb),

    (p_user_id, 'payment_notification',
     'Payment notification',
     'Payment notification: {{1}}. View your complete billing history in your account.',
     1, array['Your payment of $99 has been processed']::text[],
     '[]'::jsonb),

    (p_user_id, 'order_notification',
     'Order notification',
     'Order notification: {{1}}. Track your order status in your account at any time.',
     1, array['Your order has been shipped']::text[],
     '[]'::jsonb),

    (p_user_id, 'account_activity_notice',
     'Account activity notice',
     'Notice: {{1}}. This message was sent to keep you informed about your account activity.',
     1, array['A new device signed in to your account']::text[],
     '[]'::jsonb),

    (p_user_id, 'account_update_reply',
     'Account update with reply invite',
     'Important update regarding your account: {{1}}. If you have any questions, please reply to this message.',
     1, array['Your password was changed']::text[],
     '[]'::jsonb),

    (p_user_id, 'request_update_short',
     'Short request update',
     'Update on your request: {{1}}',
     1, array['Approved']::text[],
     '[]'::jsonb),

    (p_user_id, 'support_signed',
     'Support signed message',
     '{{1}} - from Ares Media support team - {{2}}',
     2, array['Thanks for reaching out','We will follow up shortly']::text[],
     '[]'::jsonb),

    (p_user_id, 'support_signed_alt',
     'Support signed message (alt)',
     '{{1}} — Message from Ares Media support team. {{2}}',
     2, array['We received your inquiry','A specialist will contact you within 24 hours']::text[],
     '[]'::jsonb),

    (p_user_id, 'booking_with_action_page',
     'Booking with action page button',
     'Booking confirmation: {{1}}. Tap below to view or manage your booking.',
     1, array['Your appointment is confirmed for Dec 15, 2:00 PM']::text[],
     -- URL is a placeholder; the action-page deeplink is filled in at send time.
     '[{"type":"url","text":"View booking","url":"https://example.com/booking"}]'::jsonb)
  on conflict (user_id, name) do nothing;
end;
$$;

revoke all   on function public.seed_default_message_templates(uuid) from public;
grant execute on function public.seed_default_message_templates(uuid) to authenticated, service_role;

-- Backfill: seed defaults for every existing user that has at least one
-- pipeline stage (rough proxy for "has used the dashboard"). New users get
-- seeded the first time they visit /dashboard/templates.
do $$
declare
  u record;
begin
  for u in
    select distinct user_id from public.pipeline_stages
  loop
    perform public.seed_default_message_templates(u.user_id);
  end loop;
end;
$$;
