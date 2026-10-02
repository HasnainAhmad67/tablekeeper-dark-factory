-- ============================================
-- 007: Guest reservation UPDATE lockdown
-- ============================================
-- Closes the M2 review condition: reservations_update_own previously let a
-- guest rewrite any column of their own reservation (starts_at, ends_at,
-- party_size, status, ...), which desynchronizes the reservation from its
-- reservation_tables assignment and bypasses the booking correctness model.
--
-- After this migration, for a direct authenticated guest UPDATE:
--   1. The row must still belong to the caller (unchanged).
--   2. The post-update status must be 'cancelled'.
--   3. No other column may change (enforced by trigger, which also covers
--      changes bundled with a legitimate cancellation).
-- Staff (owner/manager/staff of the reservation's restaurant) keep the full
-- update workflow. The service role is unaffected: RLS does not apply to it
-- and the trigger passes auth.uid() IS NULL callers through.

-- 1. Tighten the guest policy: only cancellation survives the WITH CHECK.
DROP POLICY reservations_update_own ON public.reservations;
CREATE POLICY reservations_update_own ON public.reservations
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND status = 'cancelled');

-- 2. Column-level scope enforcement for non-staff callers.
CREATE OR REPLACE FUNCTION public.enforce_reservation_guest_update_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Service role / server-side calls (no JWT) are trusted infrastructure.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Staff of the reservation's restaurant keep the full staff workflow.
  IF public.is_staff(OLD.restaurant_id) THEN
    RETURN NEW;
  END IF;

  -- All other authenticated callers may only cancel: every column except
  -- status and updated_at is frozen.
  IF NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.party_size IS DISTINCT FROM OLD.party_size
     OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
     OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Guests may only cancel their reservation; other columns are read-only'
      USING ERRCODE = '42501';
  END IF;

  -- The only permitted status transition is to 'cancelled'.
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'Guests may only change status to cancelled'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_reservation_guest_update_scope
BEFORE UPDATE ON public.reservations
FOR EACH ROW
EXECUTE FUNCTION public.enforce_reservation_guest_update_scope();
