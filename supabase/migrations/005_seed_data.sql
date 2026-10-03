-- ============================================
-- 005: Seed Data
-- ============================================
-- Disposable hackathon test fixtures for tablekeeper-m2-dev.
-- Do not run against a project containing real user data.
--
-- Test password:
-- LocalDevOnly!
--
-- Use only on the disposable hackathon development project.
-- ============================================

BEGIN;

-- ============================================
-- Test Users
-- ============================================

INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  role,
  aud,
  created_at,
  updated_at
)
VALUES
(
  '11111111-1111-1111-1111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'owner@example.com',
  crypt('LocalDevOnly!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Owner User"}'::jsonb,
  false,
  'authenticated',
  'authenticated',
  now(),
  now()
),
(
  '22222222-2222-2222-2222-222222222222',
  '00000000-0000-0000-0000-000000000000',
  'manager@example.com',
  crypt('LocalDevOnly!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Manager User"}'::jsonb,
  false,
  'authenticated',
  'authenticated',
  now(),
  now()
),
(
  '33333333-3333-3333-3333-333333333333',
  '00000000-0000-0000-0000-000000000000',
  'staff@example.com',
  crypt('LocalDevOnly!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Staff User"}'::jsonb,
  false,
  'authenticated',
  'authenticated',
  now(),
  now()
),
(
  '44444444-4444-4444-4444-444444444444',
  '00000000-0000-0000-0000-000000000000',
  'guest@example.com',
  crypt('LocalDevOnly!', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"full_name":"Guest User"}'::jsonb,
  false,
  'authenticated',
  'authenticated',
  now(),
  now()
)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Profiles
-- ============================================

INSERT INTO public.profiles (
  id,
  full_name,
  phone,
  preferences
)
VALUES
(
  '11111111-1111-1111-1111-111111111111',
  'Owner User',
  '555-0100',
  '{}'::jsonb
),
(
  '22222222-2222-2222-2222-222222222222',
  'Manager User',
  '555-0101',
  '{}'::jsonb
),
(
  '33333333-3333-3333-3333-333333333333',
  'Staff User',
  '555-0102',
  '{}'::jsonb
),
(
  '44444444-4444-4444-4444-444444444444',
  'Guest User',
  '555-0103',
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Restaurants
-- ============================================

-- SQL Editor has no authenticated JWT, so auth.uid() is NULL.
-- Disable the live ownership trigger while inserting explicit seed memberships.
ALTER TABLE public.restaurants
  DISABLE TRIGGER trg_handle_new_restaurant;

INSERT INTO public.restaurants (
  id,
  name,
  slug,
  timezone,
  description,
  address,
  phone,
  email,
  cuisine,
  price_range
)
VALUES
(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'The Test Kitchen',
  'test-kitchen',
  'America/New_York',
  'A test restaurant for development and testing',
  '123 Test Street, Test City, TS 12345',
  '555-1000',
  'test-kitchen@example.com',
  'American',
  2
),
(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'The Second Test Bistro',
  'second-test-bistro',
  'America/Chicago',
  'A second test restaurant for multi-tenant testing',
  '456 Test Avenue, Test Town, TS 67890',
  '555-2000',
  'second-bistro@example.com',
  'French',
  3
),
-- Fictional demo restaurants for the public discovery grid (no real
-- identities, addresses, or phone numbers — 555 demo convention).
(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'Casa Verde',
  'casa-verde',
  'America/New_York',
  'A fictional demo restaurant for development and testing of Italian discovery',
  '101 Demo Plaza, Test Village, TS 10101',
  '555-3101',
  'casa-verde@example.com',
  'Italian',
  2
),
(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'Sora Sushi House',
  'sora-sushi-house',
  'America/Los_Angeles',
  'A fictional demo restaurant for development and testing of Japanese discovery',
  '202 Demo Boulevard, Test Village, TS 20202',
  '555-3102',
  'sora-sushi-house@example.com',
  'Japanese',
  3
),
(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'The Garden Table',
  'garden-table',
  'America/Denver',
  'A fictional demo restaurant for development and testing of garden dining discovery',
  '303 Demo Lane, Test Village, TS 30303',
  '555-3103',
  'garden-table@example.com',
  'Contemporary / Garden dining',
  3
),
(
  'ffffffff-ffff-ffff-ffff-ffffffffffff',
  'Ember & Oak',
  'ember-and-oak',
  'America/Chicago',
  'A fictional demo restaurant for development and testing of steakhouse discovery',
  '404 Demo Court, Test Village, TS 40404',
  '555-3104',
  'ember-and-oak@example.com',
  'Steakhouse / Modern grill',
  4
)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Restaurant Memberships
-- ============================================

INSERT INTO public.restaurant_memberships (
  restaurant_id,
  user_id,
  role
)
VALUES
(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '11111111-1111-1111-1111-111111111111',
  'owner'
),
(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '22222222-2222-2222-2222-222222222222',
  'manager'
),
(
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '33333333-3333-3333-3333-333333333333',
  'staff'
),
(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '11111111-1111-1111-1111-111111111111',
  'owner'
),
(
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  '22222222-2222-2222-2222-222222222222',
  'manager'
)
ON CONFLICT (restaurant_id, user_id) DO NOTHING;

-- Re-enable the trigger for normal authenticated application requests.
ALTER TABLE public.restaurants
  ENABLE TRIGGER trg_handle_new_restaurant;

-- ============================================
-- Floor Sections
-- ============================================

INSERT INTO public.floor_sections (
  id,
  restaurant_id,
  name,
  color,
  sort_order
)
VALUES
(
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Main Dining',
  '#3b82f6',
  0
),
(
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Patio',
  '#10b981',
  1
),
(
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'Main Dining',
  '#3b82f6',
  0
)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Tables
-- ============================================

INSERT INTO public.tables (
  id,
  restaurant_id,
  label,
  capacity,
  section_id,
  position_x,
  position_y,
  width,
  depth,
  shape
)
VALUES
(
  '10000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'T1',
  2,
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  0,
  0,
  1,
  1,
  'round'
),
(
  '10000000-0000-4000-8000-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'T2',
  4,
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  2,
  0,
  1,
  1,
  'square'
),
(
  '10000000-0000-4000-8000-000000000003',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'T3',
  6,
  'cccccccc-cccc-cccc-cccc-cccccccccccc',
  4,
  0,
  1,
  1,
  'rect'
),
(
  '10000000-0000-4000-8000-000000000004',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'T4',
  2,
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  0,
  3,
  1,
  1,
  'round'
),
(
  '10000000-0000-4000-8000-000000000005',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'T5',
  4,
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  2,
  3,
  1,
  1,
  'square'
),
(
  '10000000-0000-4000-8000-000000000006',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'T6',
  8,
  'dddddddd-dddd-dddd-dddd-dddddddddddd',
  4,
  3,
  1,
  1,
  'booth'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.tables (
  id,
  restaurant_id,
  label,
  capacity,
  section_id,
  position_x,
  position_y,
  width,
  depth,
  shape
)
VALUES
(
  '20000000-0000-4000-8000-000000000001',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'B1',
  2,
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  0,
  0,
  1,
  1,
  'round'
),
(
  '20000000-0000-4000-8000-000000000002',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'B2',
  4,
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  2,
  0,
  1,
  1,
  'square'
),
(
  '20000000-0000-4000-8000-000000000003',
  'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  'B3',
  6,
  'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  4,
  0,
  1,
  1,
  'rect'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table Groups
-- ============================================

INSERT INTO public.table_groups (
  id,
  restaurant_id,
  name,
  description
)
VALUES
(
  '30000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Group A',
  'Tables T1 and T2 combined'
),
(
  '30000000-0000-4000-8000-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  'Group B',
  'Tables T4 and T5 combined'
)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table Group Members
-- ============================================

INSERT INTO public.table_group_members (
  group_id,
  table_id
)
VALUES
(
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001'
),
(
  '30000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002'
),
(
  '30000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000004'
),
(
  '30000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000005'
)
ON CONFLICT (group_id, table_id) DO NOTHING;

-- ============================================
-- Operating Hours
-- ============================================

INSERT INTO public.operating_hours (
  restaurant_id,
  day_of_week,
  opens_at,
  closes_at,
  is_closed
)
VALUES
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 0, '11:00', '22:00', false),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 1, '11:00', '22:00', false),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 2, '11:00', '22:00', false),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 3, '11:00', '22:00', false),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 4, '11:00', '22:00', false),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 5, '11:00', '23:00', false),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 6, '11:00', '23:00', false),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 0, '10:00', '21:00', false),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1, '10:00', '21:00', false),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 2, '10:00', '21:00', false),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 3, '10:00', '21:00', false),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 4, '10:00', '21:00', false),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 5, '10:00', '22:00', false),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 6, '10:00', '22:00', false)
ON CONFLICT (restaurant_id, day_of_week) DO NOTHING;

-- ============================================
-- Sample Reservations
-- ============================================

INSERT INTO public.reservations (
  id,
  restaurant_id,
  user_id,
  party_size,
  starts_at,
  ends_at,
  status,
  idempotency_key
)
VALUES
(
  '40000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '44444444-4444-4444-4444-444444444444',
  2,
  '2026-10-15 18:00:00+00',
  '2026-10-15 20:00:00+00',
  'confirmed',
  'seed-reservation-001'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.reservation_tables (
  reservation_id,
  restaurant_id,
  table_id,
  starts_at,
  ends_at,
  status
)
VALUES
(
  '40000000-0000-4000-8000-000000000001',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '10000000-0000-4000-8000-000000000001',
  '2026-10-15 18:00:00+00',
  '2026-10-15 20:00:00+00',
  'active'
)
ON CONFLICT (reservation_id, table_id) DO NOTHING;

INSERT INTO public.reservations (
  id,
  restaurant_id,
  user_id,
  party_size,
  starts_at,
  ends_at,
  status,
  idempotency_key
)
VALUES
(
  '40000000-0000-4000-8000-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '44444444-4444-4444-4444-444444444444',
  4,
  '2026-10-10 18:00:00+00',
  '2026-10-10 20:00:00+00',
  'completed',
  'seed-reservation-002'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.reservation_tables (
  reservation_id,
  restaurant_id,
  table_id,
  starts_at,
  ends_at,
  status
)
VALUES
(
  '40000000-0000-4000-8000-000000000002',
  'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  '10000000-0000-4000-8000-000000000002',
  '2026-10-10 18:00:00+00',
  '2026-10-10 20:00:00+00',
  'released'
)
ON CONFLICT (reservation_id, table_id) DO NOTHING;

COMMIT;