-- Fix: onboarding_enqueue_generation was comparing the enum column
-- generation_jobs.kind against a text parameter without a cast, raising
-- Postgres 42883 ("operator does not exist: onboarding_generation_kind = text")
-- on every call. The runtime fell back to upsertRunning, defeating the
-- atomic-enqueue guarantee this RPC was added to provide.
--
-- Cast p_kind to the enum in every place it touches the column or is written
-- to it.
CREATE OR REPLACE FUNCTION public.onboarding_enqueue_generation(
  p_profile_id uuid,
  p_kind text,
  p_input_hash text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_started timestamptz;
  v_hash text;
  v_kind public.onboarding_generation_kind;
BEGIN
  v_kind := p_kind::public.onboarding_generation_kind;

  SELECT status, started_at, input_hash
    INTO v_status, v_started, v_hash
    FROM public.generation_jobs
    WHERE profile_id = p_profile_id AND kind = v_kind
    FOR UPDATE;

  IF FOUND AND v_status = 'done' AND v_hash = p_input_hash THEN
    RETURN 'already_done';
  END IF;

  IF FOUND AND v_status = 'running' AND v_started > now() - interval '90 seconds' THEN
    RETURN 'in_progress';
  END IF;

  INSERT INTO public.generation_jobs (
    profile_id, kind, status, input_hash, result, error, started_at, finished_at
  ) VALUES (
    p_profile_id, v_kind, 'running', p_input_hash, NULL, NULL, now(), NULL
  )
  ON CONFLICT (profile_id, kind) DO UPDATE
    SET status = 'running',
        input_hash = EXCLUDED.input_hash,
        result = NULL,
        error = NULL,
        started_at = now(),
        finished_at = NULL,
        updated_at = now();
  RETURN 'enqueued';
END $$;

REVOKE ALL ON FUNCTION public.onboarding_enqueue_generation(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.onboarding_enqueue_generation(uuid, text, text) TO service_role;
