-- ============================================
-- 001: Initial Schema
-- ============================================
-- Core entities for the Composable Floor reservation platform.
-- All intervals are half-open [starts_at, ends_at) using tstzrange.

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- Core Entities
-- ============================================

CREATE TABLE public.restaurants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  slug        text UNIQUE NOT NULL,
  timezone    text NOT NULL DEFAULT 'America/New_York',
  description text,
  address     text,
  phone       text,
  email       text,
  website     text,
  cuisine     text,
  price_range int CHECK (price_range BETWEEN 1 AND 4),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     text,
  phone         text,
  preferences   jsonb DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.restaurant_memberships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'staff'
                CHECK (role IN ('owner', 'manager', 'staff')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, user_id)
);

CREATE TABLE public.floor_sections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  color         text DEFAULT '#3b82f6',
  sort_order    int DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.tables (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  label         text NOT NULL,
  capacity      int NOT NULL CHECK (capacity > 0),
  section_id    uuid REFERENCES public.floor_sections(id) ON DELETE SET NULL,
  position_x    float DEFAULT 0,
  position_y    float DEFAULT 0,
  width         float DEFAULT 1,
  depth         float DEFAULT 1,
  shape         text DEFAULT 'round' CHECK (shape IN ('round', 'square', 'rect', 'booth')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.table_groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.table_group_members (
  group_id  uuid NOT NULL REFERENCES public.table_groups(id) ON DELETE CASCADE,
  table_id  uuid NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, table_id)
);

-- NOTE: Overnight operating hours (e.g., 22:00-02:00) are intentionally
-- NOT supported in M2. The CHECK (closes_at > opens_at) constraint enforces
-- same-day hours only. This is a deferred decision pending Plan v3.1 requirements.
CREATE TABLE public.operating_hours (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  day_of_week   int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opens_at      time NOT NULL,
  closes_at     time NOT NULL,
  is_closed     boolean DEFAULT false,
  CHECK (closes_at > opens_at),
  UNIQUE (restaurant_id, day_of_week)
);

CREATE TABLE public.reservations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  party_size    int NOT NULL CHECK (party_size > 0),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show')),
  notes         text,
  idempotency_key text UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

-- Unique constraints for composite foreign keys (cross-restaurant consistency)
ALTER TABLE public.reservations ADD CONSTRAINT reservations_id_restaurant_id_key UNIQUE (id, restaurant_id);
ALTER TABLE public.tables ADD CONSTRAINT tables_id_restaurant_id_key UNIQUE (id, restaurant_id);

CREATE TABLE public.reservation_tables (
  reservation_id uuid NOT NULL,
  restaurant_id  uuid NOT NULL,
  table_id       uuid NOT NULL,
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released')),
  PRIMARY KEY (reservation_id, table_id),
  -- Composite foreign keys for cross-restaurant consistency
  CONSTRAINT reservation_tables_reservation_fk
    FOREIGN KEY (reservation_id, restaurant_id)
    REFERENCES public.reservations (id, restaurant_id)
    ON DELETE CASCADE,
  CONSTRAINT reservation_tables_table_fk
    FOREIGN KEY (table_id, restaurant_id)
    REFERENCES public.tables (id, restaurant_id)
    ON DELETE CASCADE,
  -- Exclusion constraint: no overlapping active assignments for the same table
  -- Only applies to active assignments (released assignments don't conflict)
  EXCLUDE USING gist (
    table_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status = 'active')
);

-- ============================================
-- Indexes
-- ============================================

CREATE INDEX idx_tables_restaurant ON public.tables(restaurant_id);
CREATE INDEX idx_tables_section ON public.tables(section_id);
CREATE INDEX idx_table_groups_restaurant ON public.table_groups(restaurant_id);
CREATE INDEX idx_table_group_members_group ON public.table_group_members(group_id);
CREATE INDEX idx_table_group_members_table ON public.table_group_members(table_id);
CREATE INDEX idx_operating_hours_restaurant ON public.operating_hours(restaurant_id);
CREATE INDEX idx_reservations_restaurant ON public.reservations(restaurant_id);
CREATE INDEX idx_reservations_user ON public.reservations(user_id);
CREATE INDEX idx_reservations_time ON public.reservations(restaurant_id, starts_at, ends_at);
CREATE INDEX idx_reservations_status ON public.reservations(restaurant_id, status);
CREATE INDEX idx_reservation_tables_table ON public.reservation_tables(table_id);
CREATE INDEX idx_reservation_tables_time ON public.reservation_tables(table_id, starts_at, ends_at);
