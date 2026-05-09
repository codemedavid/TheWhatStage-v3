-- =========================================================================
-- Template categories: purpose-based grouping for messenger templates.
-- System rows (user_id IS NULL) are shared across all users and immutable
-- to clients. User rows are scoped to their owner.
-- =========================================================================

create table public.template_categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete cascade,
  slug        text not null,
  label       text not null,
  is_system   boolean not null default false,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check ((user_id is null) = is_system)
);

create unique index template_categories_system_slug_uniq
  on public.template_categories (slug)
  where user_id is null;

create unique index template_categories_user_slug_uniq
  on public.template_categories (user_id, slug)
  where user_id is not null;

create or replace function public.touch_template_categories()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger template_categories_touch
  before update on public.template_categories
  for each row execute function public.touch_template_categories();

alter table public.template_categories enable row level security;

create policy "template_categories_read"
  on public.template_categories for select
  using (user_id is null or user_id = auth.uid());

create policy "template_categories_user_write"
  on public.template_categories for insert
  with check (user_id = auth.uid() and is_system = false);

create policy "template_categories_user_update"
  on public.template_categories for update
  using (user_id = auth.uid() and is_system = false)
  with check (user_id = auth.uid() and is_system = false);

create policy "template_categories_user_delete"
  on public.template_categories for delete
  using (user_id = auth.uid() and is_system = false);

-- Join table.
create table public.messenger_template_categories (
  template_id uuid not null references public.messenger_message_templates(id) on delete cascade,
  category_id uuid not null references public.template_categories(id) on delete cascade,
  primary key (template_id, category_id)
);

create index messenger_template_categories_category_idx
  on public.messenger_template_categories (category_id);

alter table public.messenger_template_categories enable row level security;

-- Read/write gated through ownership of the parent template.
create policy "messenger_template_categories_owner_rw"
  on public.messenger_template_categories for all
  using (
    exists (
      select 1 from public.messenger_message_templates t
      where t.id = template_id and t.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.messenger_message_templates t
      where t.id = template_id and t.user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------------ system catalog
insert into public.template_categories (user_id, slug, label, is_system, sort_order) values
  (null, 'booking',       'Booking',       true, 10),
  (null, 'offers',        'Offers',        true, 20),
  (null, 'reminders',     'Reminders',     true, 30),
  (null, 'support',       'Support',       true, 40),
  (null, 'notifications', 'Notifications', true, 50),
  (null, 'general',       'General',       true, 60)
on conflict do nothing;

-- ------------------------------------------------------------------ default tag mapping
-- Map each of the 28 seeded template names to its default category slug(s).
-- Backfill applies to every existing user; the seeder function below applies
-- the same mapping for new users.
create or replace function public.apply_default_template_category_tags(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.messenger_template_categories (template_id, category_id)
  select t.id, c.id
  from public.messenger_message_templates t
  join (values
    ('booking_confirmation_buttons',  'booking'),
    ('booking_update_changes',        'booking'),
    ('booking_with_action_page',      'booking'),
    ('quick_reminder',                'reminders'),
    ('team_friendly_reminder',        'reminders'),
    ('casual_heads_up',               'reminders'),
    ('quick_heads_up_thanks',         'reminders'),
    ('support_request_update',        'support'),
    ('support_signed',                'support'),
    ('support_signed_alt',            'support'),
    ('team_message',                  'support'),
    ('order_status_update',           'notifications'),
    ('order_update_details',          'notifications'),
    ('order_notification',            'notifications'),
    ('payment_notification',          'notifications'),
    ('account_update_details',        'notifications'),
    ('account_update_reply',          'notifications'),
    ('account_activity_notice',       'notifications'),
    ('important_notice',              'notifications'),
    ('system_notification_optout',    'notifications'),
    ('notification_with_note',        'general'),
    ('in_the_loop',                   'general'),
    ('quick_update_friendly',         'general'),
    ('casual_with_reply_invite',      'general'),
    ('good_day_update',               'general'),
    ('valued_customer_update',        'general'),
    ('general_help_offer',            'general'),
    ('request_update_short',          'general')
  ) as m(name, slug) on m.name = t.name
  join public.template_categories c
    on c.slug = m.slug and c.user_id is null
  where t.user_id = p_user_id
  on conflict do nothing;
end;
$$;

revoke all   on function public.apply_default_template_category_tags(uuid) from public;
grant execute on function public.apply_default_template_category_tags(uuid) to authenticated, service_role;

-- Backfill every existing user so they immediately get default tags.
do $$
declare u record;
begin
  for u in select distinct user_id from public.messenger_message_templates loop
    perform public.apply_default_template_category_tags(u.user_id);
  end loop;
end;
$$;

-- ------------------------------------------------------------------ extend seeder
-- Re-create seed_default_message_templates so that after inserting the 28
-- defaults it also applies the default category tags. Body of the original
-- function is preserved verbatim and an extra call is appended.
create or replace function public.seed_default_message_templates(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
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
     '[{"type":"url","text":"View booking","url":"https://example.com/booking"}]'::jsonb)
  on conflict (user_id, name) do nothing;

  -- Apply default category tags after seeding rows.
  perform public.apply_default_template_category_tags(p_user_id);
end;
$$;
