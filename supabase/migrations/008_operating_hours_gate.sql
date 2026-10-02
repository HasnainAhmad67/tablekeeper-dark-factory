-- ============================================
-- 008: Operating-hours gate
-- ============================================
-- Adds a search_path-safe helper that decides whether an absolute reservation
-- window fits inside a restaurant's local operating hours, and re-creates
-- create_reservation (exact signature from 004 — no overload) to enforce it.
--
-- Semantics (mirrored by src/server/hours.ts):
--   * day_of_week: 0=Sunday .. 6=Saturday (EXTRACT(DOW))
--   * a missing operating_hours row for the local day means closed
--   * the entire half-open [starts_at, ends_at) must fit inside the local
--     [opens_at, closes_at); exact open/close boundaries are allowed
--   * overnight / cross-local-midnight windows are unsupported -> closed
--   * an invalid or missing restaurant timezone fails closed
--   * idempotency replay (step 5) returns BEFORE this check, so existing
--     reservations are never re-validated or modified
--
-- Migrations 001-007 are unchanged; no operating_hours schema changes.

-- ============================================
-- Helper: operating-hours fit check
-- ============================================

CREATE OR REPLACE FUNCTION public.is_within_operating_hours(
  p_restaurant_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_timezone text;
  v_local_start timestamp;
  v_local_end timestamp;
  v_opens time;
  v_closes time;
  v_is_closed boolean;
BEGIN
  SELECT timezone INTO v_timezone
  FROM public.restaurants
  WHERE id = p_restaurant_id;

  -- Missing restaurant or missing timezone -> fail closed.
  IF v_timezone IS NULL OR btrim(v_timezone) = '' THEN
    RETURN false;
  END IF;

  BEGIN
    -- timestamptz AT TIME ZONE zone -> local wall-clock timestamp.
    v_local_start := p_starts_at AT TIME ZONE v_timezone;
    v_local_end := p_ends_at AT TIME ZONE v_timezone;
  EXCEPTION WHEN OTHERS THEN
    -- Invalid timezone name (or conversion failure) -> fail closed.
    RETURN false;
  END;

  IF v_local_start IS NULL OR v_local_end IS NULL THEN
    RETURN false;
  END IF;

  -- Overnight windows are unsupported: both endpoints must share one
  -- local calendar date (the same rule as the TS side).
  IF v_local_start::date <> v_local_end::date THEN
    RETURN false;
  END IF;

  SELECT opens_at, closes_at, COALESCE(is_closed, false)
  INTO v_opens, v_closes, v_is_closed
  FROM public.operating_hours
  WHERE restaurant_id = p_restaurant_id
    AND day_of_week = EXTRACT(DOW FROM v_local_start)::int;

  IF NOT FOUND THEN
    -- A missing day row means closed.
    RETURN false;
  END IF;

  IF v_is_closed THEN
    RETURN false;
  END IF;

  -- Entire half-open window must fit; exact boundaries are allowed.
  RETURN v_local_start::time >= v_opens AND v_local_end::time <= v_closes;
END;
$$;

-- The helper is only invoked from within the SECURITY DEFINER booking RPC
-- (executed as its owner) and from the service role (cross-check tests).
-- Revoke it from PUBLIC and anon so clients cannot probe hours directly.
REVOKE EXECUTE ON FUNCTION public.is_within_operating_hours(uuid, timestamptz, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.is_within_operating_hours(uuid, timestamptz, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.is_within_operating_hours(uuid, timestamptz, timestamptz) TO service_role;

-- ============================================
-- Booking Function (re-created with the hours gate)
-- ============================================
-- Signature identical to 004_functions.sql; everything else is preserved
-- verbatim except the inserted step 6b.

CREATE OR REPLACE FUNCTION public.create_reservation(
  p_restaurant_id uuid,
  p_table_ids uuid[],
  p_party_size integer,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_idempotency_key text,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_reservation_id uuid;
  v_total_capacity integer;
  v_table_id uuid;
  v_existing_reservation_id uuid;
BEGIN
  -- 1. Validate auth.uid()
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- 2. Validate interval validity (ends_at > starts_at)
  IF p_ends_at <= p_starts_at THEN
    RAISE EXCEPTION 'ends_at must be after starts_at' USING ERRCODE = '22023';
  END IF;

  -- 3. Validate party_size
  IF p_party_size IS NULL OR p_party_size <= 0 THEN
    RAISE EXCEPTION 'party_size must be a positive integer' USING ERRCODE = '22023';
  END IF;

  -- 4. Validate idempotency key
  IF p_idempotency_key IS NULL OR p_idempotency_key = '' THEN
    RAISE EXCEPTION 'idempotency_key is required' USING ERRCODE = '22023';
  END IF;

  -- 5. Check for existing reservation with same idempotency key (idempotency)
  SELECT id INTO v_existing_reservation_id
  FROM public.reservations
  WHERE idempotency_key = p_idempotency_key;

  IF v_existing_reservation_id IS NOT NULL THEN
    -- Return existing reservation ID (idempotent behavior)
    -- This replay returns BEFORE the hours check: existing reservations are
    -- never re-validated against hours (008 gate).
    RETURN v_existing_reservation_id;
  END IF;

  -- 6. Validate restaurant exists
  IF NOT EXISTS (SELECT 1 FROM public.restaurants WHERE id = p_restaurant_id) THEN
    RAISE EXCEPTION 'Restaurant not found' USING ERRCODE = '22023';
  END IF;

  -- 6b. Operating-hours gate (008): placed after idempotency replay (5) and
  -- restaurant existence (6), before any inserts. Maps to HTTP 400 at the API
  -- layer like the other 22023 validation errors.
  IF NOT public.is_within_operating_hours(p_restaurant_id, p_starts_at, p_ends_at) THEN
    RAISE EXCEPTION 'Requested time is outside operating hours' USING ERRCODE = '22023';
  END IF;

  -- 7. Validate table_ids is not empty
  IF p_table_ids IS NULL OR array_length(p_table_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one table must be specified' USING ERRCODE = '22023';
  END IF;

  -- 8. Validate all tables belong to the restaurant and calculate total capacity
  SELECT COALESCE(SUM(capacity), 0) INTO v_total_capacity
  FROM public.tables
  WHERE id = ANY(p_table_ids)
    AND restaurant_id = p_restaurant_id;

  -- Check if any table doesn't belong to the restaurant
  IF EXISTS (
    SELECT 1 FROM public.tables
    WHERE id = ANY(p_table_ids)
      AND restaurant_id != p_restaurant_id
  ) THEN
    RAISE EXCEPTION 'One or more tables do not belong to the specified restaurant' USING ERRCODE = '22023';
  END IF;

  -- Check if all tables exist
  IF (SELECT COUNT(*) FROM public.tables WHERE id = ANY(p_table_ids)) != array_length(p_table_ids, 1) THEN
    RAISE EXCEPTION 'One or more tables not found' USING ERRCODE = '22023';
  END IF;

  -- 9. Validate capacity
  IF v_total_capacity < p_party_size THEN
    RAISE EXCEPTION 'Insufficient table capacity: % seats available, % required', v_total_capacity, p_party_size USING ERRCODE = '22023';
  END IF;

  -- 10. Create reservation
  INSERT INTO public.reservations (restaurant_id, user_id, party_size, starts_at, ends_at, status, idempotency_key, notes)
  VALUES (p_restaurant_id, v_user_id, p_party_size, p_starts_at, p_ends_at, 'confirmed', p_idempotency_key, p_notes)
  RETURNING id INTO v_reservation_id;

  -- 11. Create table assignments
  FOREACH v_table_id IN ARRAY p_table_ids LOOP
    INSERT INTO public.reservation_tables (reservation_id, restaurant_id, table_id, starts_at, ends_at, status)
    VALUES (v_reservation_id, p_restaurant_id, v_table_id, p_starts_at, p_ends_at, 'active');
  END LOOP;

  RETURN v_reservation_id;

EXCEPTION
  WHEN exclusion_violation THEN
    -- Map exclusion constraint violation to a conflict error
    -- The API layer should map this to HTTP 409
    RAISE EXCEPTION 'Table conflict: one or more tables are already reserved for the specified time' USING ERRCODE = '23P01';
  WHEN unique_violation THEN
    -- Narrow handler: only handle idempotency_key conflicts.
    -- Other unique violations (e.g., PK collisions) are re-raised.
    IF SQLERRM LIKE '%idempotency_key%' THEN
      SELECT id INTO v_existing_reservation_id
      FROM public.reservations
      WHERE idempotency_key = p_idempotency_key;
      IF v_existing_reservation_id IS NOT NULL THEN
        RETURN v_existing_reservation_id;
      END IF;
    END IF;
    RAISE;
END;
$$;

-- Re-assert 004's grants (CREATE OR REPLACE preserves them; restated so this
-- migration is self-contained).
REVOKE EXECUTE ON FUNCTION public.create_reservation(uuid, uuid[], integer, timestamptz, timestamptz, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_reservation(uuid, uuid[], integer, timestamptz, timestamptz, text, text) FROM anon;

-- Grant execute to authenticated only
GRANT EXECUTE ON FUNCTION public.create_reservation(uuid, uuid[], integer, timestamptz, timestamptz, text, text) TO authenticated;
