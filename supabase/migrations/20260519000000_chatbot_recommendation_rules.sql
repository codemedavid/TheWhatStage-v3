-- =========================================================================
-- Per-user recommendation rules used by the messenger AI when deciding
-- whether (and how) to recommend a product on a catalog action page.
--
-- Shape:
--   {
--     "default_confidence_threshold": 0.55,
--     "per_action_page": {
--       "<action_page_id>": {
--         "rules": "ask budget and use case before recommending",
--         "required_slots": ["budget", "use_case"],
--         "confidence_threshold": 0.6
--       }
--     }
--   }
--
-- Empty object means "no recommendation gating configured" — the
-- recommend_product tool stays unavailable and the bot answers normally.
-- =========================================================================

alter table public.chatbot_configs
  add column recommendation_rules jsonb not null default '{}'::jsonb;

alter table public.chatbot_configs
  add constraint chatbot_configs_recommendation_rules_object
  check (jsonb_typeof(recommendation_rules) = 'object');
