CREATE TABLE public.health_check_limits (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  window_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  request_count smallint NOT NULL DEFAULT 0 CHECK (request_count BETWEEN 0 AND 10),
  blocked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
GRANT ALL ON public.health_check_limits TO service_role;
REVOKE ALL ON public.health_check_limits FROM anon, authenticated;
ALTER TABLE public.health_check_limits ENABLE ROW LEVEL SECURITY;
INSERT INTO public.health_check_limits (id) VALUES (1);

CREATE FUNCTION public.check_keep_alive()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
SET statement_timeout = '2s'
SET lock_timeout = '500ms'
AS $$
DECLARE
  state public.health_check_limits%ROWTYPE;
  probe_time timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO STRICT state FROM public.health_check_limits WHERE id = 1 FOR UPDATE;
  probe_time := clock_timestamp();
  IF state.blocked_until IS NOT NULL AND state.blocked_until > probe_time THEN
    RETURN jsonb_build_object('allowed', false, 'retry_after', greatest(1, ceil(extract(epoch FROM state.blocked_until - probe_time))::integer));
  END IF;
  IF state.blocked_until IS NOT NULL OR state.window_started_at + interval '1 hour' <= probe_time THEN
    UPDATE public.health_check_limits SET window_started_at = probe_time, request_count = 1, blocked_until = NULL, updated_at = probe_time WHERE id = 1;
    RETURN jsonb_build_object('allowed', true, 'retry_after', 0);
  END IF;
  IF state.request_count >= 10 THEN
    UPDATE public.health_check_limits SET blocked_until = probe_time + interval '1 hour', updated_at = probe_time WHERE id = 1;
    RETURN jsonb_build_object('allowed', false, 'retry_after', 3600);
  END IF;
  UPDATE public.health_check_limits SET request_count = request_count + 1, updated_at = probe_time WHERE id = 1;
  RETURN jsonb_build_object('allowed', true, 'retry_after', 0);
END;
$$;
REVOKE ALL ON FUNCTION public.check_keep_alive() FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.check_keep_alive() TO anon;
COMMENT ON FUNCTION public.check_keep_alive() IS 'Public health probe: touches only one operational limiter row; never accesses library data.';