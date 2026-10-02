-- ============================================
-- 004: Functions
-- ============================================
-- Secure booking RPC function with full validation.
-- SECURITY DEFINER with SET search_path = '' and fully qualified names.

-- ============================================
-- Booking Function
-- ============================================

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
    RETURN v_existing_reservation_id;
  END IF;

  -- 6. Validate restaurant exists
  IF NOT EXISTS (SELECT 1 FROM public.restaurants WHERE id = p_restaurant_id) THEN
    RAISE EXCEPTION 'Restaurant not found' USING ERRCODE = '22023';
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

-- Revoke execute from public and anon
REVOKE EXECUTE ON FUNCTION public.create_reservation(uuid, uuid[], integer, timestamptz, timestamptz, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_reservation(uuid, uuid[], integer, timestamptz, timestamptz, text, text) FROM anon;

-- Grant execute to authenticated only
GRANT EXECUTE ON FUNCTION public.create_reservation(uuid, uuid[], integer, timestamptz, timestamptz, text, text) TO authenticated;

-- ============================================
-- Cancel Reservation Function
-- ============================================

CREATE OR REPLACE FUNCTION public.cancel_reservation(
  p_reservation_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_reservation_user_id uuid;
  v_reservation_status text;
  v_is_staff boolean;
BEGIN
  -- Validate auth.uid()
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Get reservation details
  SELECT user_id, status INTO v_reservation_user_id, v_reservation_status
  FROM public.reservations
  WHERE id = p_reservation_id;

  IF v_reservation_user_id IS NULL THEN
    RAISE EXCEPTION 'Reservation not found' USING ERRCODE = '22023';
  END IF;

  -- Idempotent: already in terminal state — safe no-op
  IF v_reservation_status IN ('cancelled', 'completed', 'no_show') THEN
    RETURN true;
  END IF;

  -- Check if user is staff of the restaurant
  SELECT public.is_staff(restaurant_id) INTO v_is_staff
  FROM public.reservations
  WHERE id = p_reservation_id;

  -- Only the reservation owner or staff can cancel
  IF v_reservation_user_id != v_user_id AND NOT v_is_staff THEN
    RAISE EXCEPTION 'Not authorized to cancel this reservation' USING ERRCODE = '42501';
  END IF;

  -- Update reservation status
  UPDATE public.reservations
  SET status = 'cancelled', updated_at = now()
  WHERE id = p_reservation_id;

  RETURN true;
END;
$$;

-- Revoke execute from public and anon
REVOKE EXECUTE ON FUNCTION public.cancel_reservation(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cancel_reservation(uuid) FROM anon;

-- Grant execute to authenticated only
GRANT EXECUTE ON FUNCTION public.cancel_reservation(uuid) TO authenticated;
