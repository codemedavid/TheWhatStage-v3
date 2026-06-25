-- Allow cached_prompt_tokens to be NULL = "provider did not report a cache count"
-- (UNKNOWN), which is distinct from 0 = "reported, no cache hit". The usage-health
-- watchdog (src/lib/billing/usage-alerts.ts) excludes UNKNOWN rows from the
-- cache-hit denominator so an absent provider field can no longer be misread as a
-- cache-hit collapse. recordUsage() now persists NULL (not 0) for the UNKNOWN case.
-- Idempotent: re-running is a no-op once the column is already nullable.
alter table public.llm_usage_events alter column cached_prompt_tokens drop not null;
alter table public.llm_usage_events alter column cached_prompt_tokens drop default;
