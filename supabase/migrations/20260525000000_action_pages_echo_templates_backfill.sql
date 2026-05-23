-- Templated echo migration: convert existing catalog notification_template.text
-- to the templated equivalent of the legacy buildOrderEcho() output, and set
-- a default echo_payment_proof flag where a payment method is configured.
--
-- Idempotent: skips catalog rows whose text already references {{order.

begin;

with catalog_rows as (
  select id, notification_template
  from public.action_pages
  where kind = 'catalog'
    and (notification_template is null
         or coalesce(notification_template->>'text', '') not like '%{{order.%')
)
update public.action_pages ap
set notification_template = jsonb_build_object(
  'text',
    'Order received!' || E'\n' ||
    '{{order.items_lines}}' || E'\n\n' ||
    'Total: {{order.total}}' ||
    case
      when length(coalesce(ap.notification_template->>'text', '')) > 0
        then E'\n\n' || (ap.notification_template->>'text')
      else ''
    end,
  'echo_payment_proof', coalesce((ap.notification_template->>'echo_payment_proof')::boolean, true)
)
from catalog_rows c
where ap.id = c.id;

-- Ensure echo_payment_proof defaults to true for any catalog/sales row that
-- doesn't have it set explicitly.
update public.action_pages
set notification_template = jsonb_set(
  coalesce(notification_template, '{}'::jsonb),
  '{echo_payment_proof}',
  'true',
  true
)
where kind in ('catalog', 'sales')
  and (notification_template is null or notification_template->'echo_payment_proof' is null);

commit;
