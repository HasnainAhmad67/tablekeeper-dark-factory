-- ============================================
-- 003: Triggers
-- ============================================
-- Trigger to release table assignments when a reservation is cancelled,
-- completed, or marked as no-show.

-- Function to release reservation table assignments
CREATE OR REPLACE FUNCTION public.release_reservation_tables()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Only release when status transitions to a terminal state
  IF NEW.status IN ('cancelled', 'completed', 'no_show')
     AND (OLD.status IS NULL OR OLD.status NOT IN ('cancelled', 'completed', 'no_show')) THEN
    UPDATE public.reservation_tables
    SET status = 'released'
    WHERE reservation_id = NEW.id
      AND status = 'active';
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger to release assignments on reservation status change
CREATE TRIGGER trg_release_reservation_tables
AFTER UPDATE OF status ON public.reservations
FOR EACH ROW
EXECUTE FUNCTION public.release_reservation_tables();

-- Also handle INSERT with terminal status (edge case)
CREATE TRIGGER trg_release_reservation_tables_insert
AFTER INSERT ON public.reservations
FOR EACH ROW
WHEN (NEW.status IN ('cancelled', 'completed', 'no_show'))
EXECUTE FUNCTION public.release_reservation_tables();

-- ============================================
-- Profile Creation Trigger
-- ============================================
-- Automatically creates a public.profiles row when a new user is inserted
-- into auth.users. SECURITY DEFINER with hardened search_path.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone, preferences)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NULL,
    '{}'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_handle_new_user
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- Restaurant Ownership Trigger
-- ============================================
-- When an authenticated user creates a restaurant, automatically create
-- the initial restaurant_memberships row with role='owner' in the same
-- transaction. SECURITY DEFINER with hardened search_path.
-- Prevents users from assigning another user as the initial owner by
-- always using auth.uid().

CREATE OR REPLACE FUNCTION public.handle_new_restaurant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.restaurant_memberships (restaurant_id, user_id, role)
  VALUES (NEW.id, auth.uid(), 'owner');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_handle_new_restaurant
AFTER INSERT ON public.restaurants
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_restaurant();
