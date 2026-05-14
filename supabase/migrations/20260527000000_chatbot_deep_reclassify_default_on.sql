-- Flip `chatbot_configs.deep_reclassify_enabled` to default true and turn it
-- on for existing rows.
--
-- Background: the flag was added in 20260525000100 with default=false because
-- the deep pass was experimental. Since then we've fixed brittle gating in
-- `deep-reclassify.ts` (verbatim-signals requirement dropped, English-only
-- backward-regex dropped, move-type mismatch now trusts the structural
-- classifier). The deep pass is now safe enough to run by default, and the
-- whole reason it exists — catching leads the live classifier missed — was
-- effectively unreachable for every customer because the flag was never
-- exposed in the UI and defaulted off.

alter table public.chatbot_configs
  alter column deep_reclassify_enabled set default true;

update public.chatbot_configs
  set deep_reclassify_enabled = true
  where deep_reclassify_enabled is false;

comment on column public.chatbot_configs.deep_reclassify_enabled is
  'When true (default), the messenger worker fires a deeper stage re-evaluation pass on a sparse cadence (3rd inbound, then every 5 inbound thereafter) to catch leads the live classifier missed.';
