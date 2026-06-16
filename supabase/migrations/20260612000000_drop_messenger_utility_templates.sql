-- =========================================================================
-- Drop the orphaned, parallel utility-templates table.
--
-- The LIVE templates system is public.messenger_message_templates
-- (created 20260518000000_messenger_message_templates.sql). The table
-- public.messenger_utility_templates (created in
-- 20260510000000_workflow_step0_audit_fixes.sql) used a divergent category
-- vocabulary ('appointment','order','account') and status enum, and had
-- only TWO callers — the API routes
--   src/app/api/workflow/utility-templates/route.ts
--   src/app/api/workflow/utility-templates/[id]/route.ts
-- both of which are deleted in this change. A repo-wide grep confirms zero
-- other references, and no foreign key points INTO this table.
--
-- Idempotent (IF EXISTS) and safe to re-run. CASCADE only reaches objects
-- OWNED by this table (its own indexes + RLS policies); nothing else
-- references it.
-- =========================================================================

drop table if exists public.messenger_utility_templates cascade;
