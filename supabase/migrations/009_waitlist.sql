-- ============================================
-- 009: Waitlist
-- ============================================
-- Plan screen 23 ("Waitlist"): the walk-in queue table and its policies.
-- Migrations 001-008 are unchanged; this adds one table only.
--
-- Semantics (mirrored by src/server/waitlist.ts and src/lib/waitlist-client):
--   * status: waiting | seated | cancelled | no_show (same CHECK style
--     as reservations.status in 001)
--   * position: 1-based queue index scoped to the restaurant. The server
--     reindexes every row to 1..N on each move; gaps may remain after
--     deletes until the next move. There is deliberately NO uniqueness
--     constraint: concurrent moves reindex without transient conflicts
--     and the client's sortWaitlist tie-breaks equal positions by
--     created_at (first-come first-served).
--   * party_size >= 1; phone/notes are nullable ('' trims to null)
--   * RLS: any member of the restaurant reads the queue (is_staff);
--     owner/manager CRUD — matching the app-level checks in
--     src/server/waitlist.ts (clean 403s), with RLS as the backstop.
--
-- Plan labels waitlist "Not in MVP — must be labelled as planned"; this
-- migration ships it as an explicitly authorised slice (no notifications
-- or other tables are added).

CREATE TABLE public.waitlist (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (btrim(name) <> ''),
  party_size    integer NOT NULL CHECK (party_size > 0),
  phone         text,
  notes         text,
  status        text NOT NULL DEFAULT 'waiting'
                CHECK (status IN ('waiting', 'seated', 'cancelled', 'no_show')),
  position      integer NOT NULL CHECK (position > 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Ordered queue scans: GET /api/waitlist?restaurant_id= ... ORDER BY position.
CREATE INDEX idx_waitlist_restaurant_position ON public.waitlist (restaurant_id, position);

-- ============================================
-- Row Level Security
-- ============================================

ALTER TABLE public.waitlist ENABLE ROW LEVEL SECURITY;

-- Any member of the restaurant (owner/manager/staff) can read the queue.
CREATE POLICY waitlist_select_member ON public.waitlist
  FOR SELECT TO authenticated
  USING (public.is_staff(restaurant_id));

-- Manager/owner can add parties to the queue.
CREATE POLICY waitlist_insert_manager ON public.waitlist
  FOR INSERT TO authenticated
  WITH CHECK (public.is_manager_or_owner(restaurant_id));

-- Manager/owner can change status and move positions.
CREATE POLICY waitlist_update_manager ON public.waitlist
  FOR UPDATE TO authenticated
  USING (public.is_manager_or_owner(restaurant_id))
  WITH CHECK (public.is_manager_or_owner(restaurant_id));

-- Manager/owner can remove queue entries.
CREATE POLICY waitlist_delete_manager ON public.waitlist
  FOR DELETE TO authenticated
  USING (public.is_manager_or_owner(restaurant_id));
