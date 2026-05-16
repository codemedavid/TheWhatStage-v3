-- Atomic conditional enqueue for onboarding generation jobs.
--
-- Closes the lazy-enqueue race: two tabs that both saw status='done' could
-- previously each call upsertRunning and clobber a just-finished result back
-- to status='running'. This RPC takes a row-level lock and decides:
--   * already_done   — same hash, already complete → no-op
--   * in_progress    — running and started < 90s ago → keep waiting
--   * enqueued       — missing / failed / stale-running / hash-mismatch → take ownership
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
BEGIN
  SELECT status, started_at, input_hash
    INTO v_status, v_started, v_hash
    FROM public.generation_jobs
    WHERE profile_id = p_profile_id AND kind = p_kind
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
    p_profile_id, p_kind, 'running', p_input_hash, NULL, NULL, now(), NULL
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
