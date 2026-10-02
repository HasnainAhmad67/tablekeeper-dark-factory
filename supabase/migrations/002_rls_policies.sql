-- ============================================
-- 002: RLS Policies
-- ============================================
-- Row Level Security policies for all tables.
-- Requirements:
--   1. Guest isolation
--   2. Role escalation prevention
--   3. Restaurant isolation
--   4. Manager/owner permissions
--   5. Unauthenticated write rejection
--   6. Guest table/availability reads restricted to selected/public restaurant scope
--   7. No direct unsafe client writes to reservation_tables

-- ============================================
-- Helper Functions (SECURITY DEFINER)
-- ============================================

-- Check if the current user is staff (owner/manager/staff) of a restaurant
CREATE OR REPLACE FUNCTION public.is_staff(restaurant_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_memberships
    WHERE restaurant_id = $1 AND user_id = auth.uid()
  );
$$;

-- Check if the current user is manager or owner of a restaurant
CREATE OR REPLACE FUNCTION public.is_manager_or_owner(restaurant_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_memberships
    WHERE restaurant_id = $1 AND user_id = auth.uid() AND role IN ('owner', 'manager')
  );
$$;

-- Check if the current user is owner of a restaurant
CREATE OR REPLACE FUNCTION public.is_owner(restaurant_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.restaurant_memberships
    WHERE restaurant_id = $1 AND user_id = auth.uid() AND role = 'owner'
  );
$$;

-- ============================================
-- Enable RLS on all tables
-- ============================================

ALTER TABLE public.restaurants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.floor_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservation_tables ENABLE ROW LEVEL SECURITY;

-- ============================================
-- Restaurants Policies
-- ============================================

-- All authenticated users can view restaurants (for discovery)
CREATE POLICY restaurants_select_authenticated ON public.restaurants
  FOR SELECT TO authenticated
  USING (true);

-- Authenticated users can create restaurants (they become owner via membership)
CREATE POLICY restaurants_insert_authenticated ON public.restaurants
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Only owner/manager can update restaurants
CREATE POLICY restaurants_update_manager ON public.restaurants
  FOR UPDATE TO authenticated
  USING (public.is_manager_or_owner(id))
  WITH CHECK (public.is_manager_or_owner(id));

-- Only owner can delete restaurants
CREATE POLICY restaurants_delete_owner ON public.restaurants
  FOR DELETE TO authenticated
  USING (public.is_owner(id));

-- ============================================
-- Profiles Policies
-- ============================================

-- Users can view their own profile
CREATE POLICY profiles_select_own ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- Staff can view profiles of users in their restaurants
CREATE POLICY profiles_select_staff ON public.profiles
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.restaurant_memberships rm
      WHERE rm.user_id = profiles.id
      AND rm.restaurant_id IN (
        SELECT restaurant_id FROM public.restaurant_memberships WHERE user_id = auth.uid()
      )
    )
  );

-- Only system (trigger) can insert profiles
-- No INSERT policy for authenticated users

-- Users can update their own profile
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- No DELETE policy for authenticated users

-- ============================================
-- Restaurant Memberships Policies
-- ============================================

-- Users can view their own memberships
CREATE POLICY memberships_select_own ON public.restaurant_memberships
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Manager/owner can view all members of their restaurants
CREATE POLICY memberships_select_manager ON public.restaurant_memberships
  FOR SELECT TO authenticated
  USING (public.is_manager_or_owner(restaurant_id));

-- Only owner can insert memberships (role escalation prevention)
CREATE POLICY memberships_insert_owner ON public.restaurant_memberships
  FOR INSERT TO authenticated
  WITH CHECK (public.is_owner(restaurant_id));

-- Only owner can update memberships (role escalation prevention)
CREATE POLICY memberships_update_owner ON public.restaurant_memberships
  FOR UPDATE TO authenticated
  USING (public.is_owner(restaurant_id))
  WITH CHECK (public.is_owner(restaurant_id));

-- Only owner can delete memberships
CREATE POLICY memberships_delete_owner ON public.restaurant_memberships
  FOR DELETE TO authenticated
  USING (public.is_owner(restaurant_id));

-- ============================================
-- Floor Sections Policies
-- ============================================

-- All authenticated users can view floor sections
CREATE POLICY floor_sections_select_authenticated ON public.floor_sections
  FOR SELECT TO authenticated
  USING (true);

-- Manager/owner can insert floor sections
CREATE POLICY floor_sections_insert_manager ON public.floor_sections
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager_or_owner(restaurant_id));

-- Manager/owner can update floor sections
CREATE POLICY floor_sections_update_manager ON public.floor_sections
  FOR UPDATE TO authenticated
  USING (public.is_manager_or_owner(restaurant_id))
  WITH CHECK (public.is_manager_or_owner(restaurant_id));

-- Manager/owner can delete floor sections
CREATE POLICY floor_sections_delete_manager ON public.floor_sections
  FOR DELETE TO authenticated
  USING (public.is_manager_or_owner(restaurant_id));

-- ============================================
-- Tables Policies
-- ============================================

-- All authenticated users can view tables (for availability)
CREATE POLICY tables_select_authenticated ON public.tables
  FOR SELECT TO authenticated
  USING (true);

-- Manager/owner can insert tables
CREATE POLICY tables_insert_manager ON public.tables
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager_or_owner(restaurant_id));

-- Manager/owner can update tables
CREATE POLICY tables_update_manager ON public.tables
  FOR UPDATE TO authenticated
  USING (public.is_manager_or_owner(restaurant_id))
  WITH CHECK (public.is_manager_or_owner(restaurant_id));

-- Manager/owner can delete tables
CREATE POLICY tables_delete_manager ON public.tables
  FOR DELETE TO authenticated
  USING (public.is_manager_or_owner(restaurant_id));

-- ============================================
-- Table Groups Policies
-- ============================================

-- All authenticated users can view table groups
CREATE POLICY table_groups_select_authenticated ON public.table_groups
  FOR SELECT TO authenticated
  USING (true);

-- Manager/owner can insert table groups
CREATE POLICY table_groups_insert_manager ON public.table_groups
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager_or_owner(restaurant_id));

-- Manager/owner can update table groups
CREATE POLICY table_groups_update_manager ON public.table_groups
  FOR UPDATE TO authenticated
  USING (public.is_manager_or_owner(restaurant_id))
  WITH CHECK (public.is_manager_or_owner(restaurant_id));

-- Manager/owner can delete table groups
CREATE POLICY table_groups_delete_manager ON public.table_groups
  FOR DELETE TO authenticated
  USING (public.is_manager_or_owner(restaurant_id));

-- ============================================
-- Table Group Members Policies
-- ============================================

-- All authenticated users can view table group members
CREATE POLICY table_group_members_select_authenticated ON public.table_group_members
  FOR SELECT TO authenticated
  USING (true);

-- Manager/owner can insert table group members
CREATE POLICY table_group_members_insert_manager ON public.table_group_members
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.table_groups tg
      WHERE tg.id = table_group_members.group_id
      AND public.is_manager_or_owner(tg.restaurant_id)
    )
  );

-- Manager/owner can update table group members
CREATE POLICY table_group_members_update_manager ON public.table_group_members
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.table_groups tg
      WHERE tg.id = table_group_members.group_id
      AND public.is_manager_or_owner(tg.restaurant_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.table_groups tg
      WHERE tg.id = table_group_members.group_id
      AND public.is_manager_or_owner(tg.restaurant_id)
    )
  );

-- Manager/owner can delete table group members
CREATE POLICY table_group_members_delete_manager ON public.table_group_members
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.table_groups tg
      WHERE tg.id = table_group_members.group_id
      AND public.is_manager_or_owner(tg.restaurant_id)
    )
  );

-- ============================================
-- Operating Hours Policies
-- ============================================

-- All authenticated users can view operating hours
CREATE POLICY operating_hours_select_authenticated ON public.operating_hours
  FOR SELECT TO authenticated
  USING (true);

-- Manager/owner can insert operating hours
CREATE POLICY operating_hours_insert_manager ON public.operating_hours
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager_or_owner(restaurant_id));

-- Manager/owner can update operating hours
CREATE POLICY operating_hours_update_manager ON public.operating_hours
  FOR UPDATE TO authenticated
  USING (public.is_manager_or_owner(restaurant_id))
  WITH CHECK (public.is_manager_or_owner(restaurant_id));

-- Manager/owner can delete operating hours
CREATE POLICY operating_hours_delete_manager ON public.operating_hours
  FOR DELETE TO authenticated
  USING (public.is_manager_or_owner(restaurant_id));

-- ============================================
-- Reservations Policies
-- ============================================

-- Guests can view their own reservations
CREATE POLICY reservations_select_own ON public.reservations
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Staff can view all reservations for their restaurants
CREATE POLICY reservations_select_staff ON public.reservations
  FOR SELECT TO authenticated
  USING (public.is_staff(restaurant_id));

-- Authenticated users can insert reservations (via RPC)
CREATE POLICY reservations_insert_authenticated ON public.reservations
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Guests can update their own reservations (cancel)
CREATE POLICY reservations_update_own ON public.reservations
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Staff can update reservations for their restaurants
CREATE POLICY reservations_update_staff ON public.reservations
  FOR UPDATE TO authenticated
  USING (public.is_staff(restaurant_id))
  WITH CHECK (public.is_staff(restaurant_id));

-- No DELETE policy for authenticated users (soft delete via status)

-- ============================================
-- Reservation Tables Policies
-- ============================================

-- Guests can view reservation tables for their own reservations
CREATE POLICY reservation_tables_select_own ON public.reservation_tables
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.reservations r
      WHERE r.id = reservation_tables.reservation_id
      AND r.user_id = auth.uid()
    )
  );

-- Staff can view reservation tables for their restaurants
CREATE POLICY reservation_tables_select_staff ON public.reservation_tables
  FOR SELECT TO authenticated
  USING (public.is_staff(restaurant_id));

-- No INSERT policy for authenticated users (system only via RPC)
-- No UPDATE policy for authenticated users
-- No DELETE policy for authenticated users
