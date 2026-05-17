-- Single round-trip step transition for onboarding_state.
-- Replaces a SELECT ai_generations + UPDATE pattern that ran on every
-- "save and continue" — two round-trips collapsed into one, plus the audit
-- append happens server-side via the jsonb || operator so concurrent step
-- saves no longer race-clobber each other.
CREATE OR REPLACE FUNCTION public.onboarding_mark_step(
  p_profile_id uuid,
  p_step text,
  p_skipped boolean DEFAULT false,
  p_at timestamptz DEFAULT now()
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_entry jsonb := jsonb_build_object('step', p_step, 'at', p_at, 'skipped', p_skipped);
BEGIN
  CASE p_step
    WHEN 'business' THEN
      UPDATE public.onboarding_state
        SET business_completed_at = p_at,
            ai_generations = COALESCE(ai_generations, '[]'::jsonb) || v_entry
        WHERE profile_id = p_profile_id;
    WHEN 'knowledge' THEN
      UPDATE public.onboarding_state
        SET knowledge_completed_at = p_at,
            ai_generations = COALESCE(ai_generations, '[]'::jsonb) || v_entry
        WHERE profile_id = p_profile_id;
    WHEN 'faqs' THEN
      UPDATE public.onboarding_state
        SET faqs_completed_at = p_at,
            ai_generations = COALESCE(ai_generations, '[]'::jsonb) || v_entry
        WHERE profile_id = p_profile_id;
    WHEN 'personality' THEN
      UPDATE public.onboarding_state
        SET personality_completed_at = p_at,
            ai_generations = COALESCE(ai_generations, '[]'::jsonb) || v_entry
        WHERE profile_id = p_profile_id;
    WHEN 'goal' THEN
      UPDATE public.onboarding_state
        SET goal_completed_at = p_at,
            ai_generations = COALESCE(ai_generations, '[]'::jsonb) || v_entry
        WHERE profile_id = p_profile_id;
    WHEN 'goal_content' THEN
      UPDATE public.onboarding_state
        SET goal_content_completed_at = p_at,
            ai_generations = COALESCE(ai_generations, '[]'::jsonb) || v_entry
        WHERE profile_id = p_profile_id;
    WHEN 'flow' THEN
      UPDATE public.onboarding_state
        SET flow_completed_at = p_at,
            ai_generations = COALESCE(ai_generations, '[]'::jsonb) || v_entry
        WHERE profile_id = p_profile_id;
    ELSE
      RAISE EXCEPTION 'unknown onboarding step: %', p_step USING ERRCODE = '22023';
  END CASE;
END $$;

REVOKE ALL ON FUNCTION public.onboarding_mark_step(uuid, text, boolean, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.onboarding_mark_step(uuid, text, boolean, timestamptz) TO authenticated, service_role;
