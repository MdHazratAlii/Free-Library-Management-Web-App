DO $$
DECLARE
  result jsonb;
  deadline timestamptz;
  new_deadline timestamptz;
BEGIN
  BEGIN
    UPDATE public.health_check_limits SET request_count = 0, window_started_at = clock_timestamp(), blocked_until = NULL WHERE id = 1;
    FOR i IN 1..10 LOOP
      result := public.check_keep_alive();
      IF result->>'allowed' <> 'true' THEN RAISE EXCEPTION 'Health test failed: allowed quota'; END IF;
    END LOOP;
    result := public.check_keep_alive();
    IF result->>'allowed' <> 'false' OR (result->>'retry_after')::integer <> 3600 THEN RAISE EXCEPTION 'Health test failed: blocking'; END IF;
    SELECT blocked_until INTO deadline FROM public.health_check_limits WHERE id = 1;
    result := public.check_keep_alive();
    SELECT blocked_until INTO new_deadline FROM public.health_check_limits WHERE id = 1;
    IF result->>'allowed' <> 'false' OR deadline <> new_deadline THEN RAISE EXCEPTION 'Health test failed: fixed block expiry'; END IF;
    UPDATE public.health_check_limits SET blocked_until = clock_timestamp() - interval '1 second' WHERE id = 1;
    result := public.check_keep_alive();
    IF result->>'allowed' <> 'true' THEN RAISE EXCEPTION 'Health test failed: auto release'; END IF;
    RAISE EXCEPTION USING ERRCODE = 'ZX001', MESSAGE = 'Health test passed; rollback test counters';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN
    NULL;
  END;
END;
$$;