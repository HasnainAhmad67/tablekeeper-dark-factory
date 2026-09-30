# Plan: Composable Floor — Premium 3D-First Restaurant Operations & Reservation Platform

## Goal

Upgrade Composable Floor from a basic reservation system into a premium, modern, 3D-first restaurant operations and reservation platform. The system lets guests discover restaurants, search availability, understand table combinations visually through an interactive 3D floor, and make reliable reservations. Staff manage tables, groups, reservations, seating, and the live floor through a polished operations dashboard. The database remains the single source of truth for reservation correctness; the 3D layer is presentation-only.

---

## Architecture Diagram

```arch
{
  "kind": "layered",
  "title": "Composable Floor Architecture",
  "layers": [
    {
      "id": "browser",
      "title": "Browser",
      "items": [
        { "id": "customer_ui", "label": "Customer UI" },
        { "id": "staff_ui", "label": "Staff UI" },
        { "id": "floor_3d", "label": "3D Floor (R3F)" },
        { "id": "floor_2d", "label": "2D Floor (Canvas)" },
        { "id": "design_system", "label": "Design System" },
        { "id": "query_client", "label": "TanStack Query" }
      ]
    },
    {
      "id": "api",
      "title": "API",
      "items": [
        { "id": "restaurant_api", "label": "Restaurant API" },
        { "id": "availability_api", "label": "Availability API" },
        { "id": "reservation_api", "label": "Reservation API" },
        { "id": "staff_api", "label": "Staff API" },
        { "id": "table_api", "label": "Table/Group API" },
        { "id": "auth_api", "label": "Auth API" }
      ]
    },
    {
      "id": "domain",
      "title": "Domain",
      "items": [
        { "id": "availability_engine", "label": "Availability Engine" },
        { "id": "reservation_service", "label": "Reservation Service" },
        { "id": "conflict_detector", "label": "Conflict Detector" },
        { "id": "status_machine", "label": "Status Machine" },
        { "id": "timezone_service", "label": "Timezone Service" }
      ]
    },
    {
      "id": "database",
      "title": "Database",
      "items": [
        { "id": "postgres", "label": "PostgreSQL" },
        { "id": "rls", "label": "RLS Policies" },
        { "id": "constraints", "label": "Exclusion Constraints" },
        { "id": "triggers", "label": "Triggers" },
        { "id": "realtime", "label": "Realtime (Optional)" }
      ]
    }
  ],
  "flows": [
    { "from": "customer_ui", "to": "restaurant_api", "label": "HTTPS/JSON" },
    { "from": "customer_ui", "to": "availability_api", "label": "HTTPS/JSON" },
    { "from": "staff_ui", "to": "staff_api", "label": "HTTPS/JSON" },
    { "from": "floor_3d", "to": "availability_api", "label": "HTTPS/JSON" },
    { "from": "floor_2d", "to": "availability_api", "label": "HTTPS/JSON" },
    { "from": "restaurant_api", "to": "availability_engine", "label": "function" },
    { "from": "availability_api", "to": "availability_engine", "label": "function" },
    { "from": "reservation_api", "to": "reservation_service", "label": "function" },
    { "from": "staff_api", "to": "reservation_service", "label": "function" },
    { "from": "table_api", "to": "postgres", "label": "SQL" },
    { "from": "availability_engine", "to": "postgres", "label": "SQL" },
    { "from": "reservation_service", "to": "postgres", "label": "SQL" },
    { "from": "postgres", "to": "realtime", "label": "WAL" },
    { "from": "realtime", "to": "staff_ui", "label": "WebSocket" }
  ]
}
```

---

## A. Executive Summary

Composable Floor is a premium, 3D-first restaurant operations and reservation platform. It solves the core problem that ordinary CRUD reservation systems ignore: **tables are physical objects that can be combined, and double-booking is a database-level guarantee, not an application hope.**

The platform has two surfaces:

1. **Customer-facing:** Restaurant discovery, visual availability search, interactive 3D floor preview, table/group selection, booking, and reservation management.
2. **Staff-facing:** Live 3D floor map, 2D top-down view, reservation timeline, seating workflow, table/group management, floor editor, and analytics.

The **key differentiator** is a functional interactive 3D restaurant floor — not decorative 3D, but a real operational tool where table states (available, held, occupied, selected) are visually clear, table groups are visually joined, and the same normalized data drives both 3D and 2D views.

The **core correctness invariant** is: *A reservation must never overlap with another reservation that uses the same physical table, either directly or through any valid table-group combination.* This is enforced by PostgreSQL exclusion constraints, advisory locks, and an atomic booking RPC — not by application code alone.

This plan is implementation-ready. Every section provides exact contracts, file paths, schemas, and acceptance criteria.

---

## B. Product Positioning

### vs. Ordinary CRUD Reservation Systems

| Dimension | Ordinary Systems | Composable Floor |
|-----------|-----------------|------------------|
| Table model | Fixed tables, no grouping | Dynamic table groups with visual joining |
| Availability | List of free tables | Visual 3D floor with real-time states |
| Double-booking prevention | Application-level check (race-prone) | Database exclusion constraint (impossible) |
| Staff experience | Table grid / list | Interactive 3D floor + 2D top-down + timeline |
| Customer experience | Form-based booking | Visual floor selection with 3D preview |
| Conflict explanation | "Table not available" | Exact conflict details with visual highlight |

### Target Market

- **Primary:** Mid-to-upscale restaurants (50–300 seats) that need flexible table arrangements.
- **Secondary:** Restaurant groups managing multiple locations.
- **Tertiary:** Event venues with configurable floor layouts.

### Brand Personality

Premium, modern, structured, professional. Not a generic dashboard template. The design system uses a sophisticated dark-first palette with light-theme support, generous whitespace, subtle motion, and clear information hierarchy.

---

## C. Recommended Stack

| Layer | Technology | Why | Alternatives | Risk | MVP? |
|-------|-----------|-----|-------------|------|------|
| Framework | Next.js 15 (App Router) | SSR, API routes, Vercel deployment, React ecosystem | Remix, SvelteKit | Low | Required |
| Language | TypeScript (strict) | Type safety, domain modeling | JavaScript | Low | Required |
| Styling | Tailwind CSS 4 + CSS variables | Rapid UI, design tokens, theming | CSS Modules, Styled Components | Low | Required |
| 3D Rendering | React Three Fiber + Drei | Declarative 3D in React, helpers | Plain Three.js, Babylon | Medium | Optional (Differentiator) |
| Server State | TanStack Query | Caching, optimistic updates, background refetch | SWR, Apollo | Low | Required |
| Client State | Zustand | Lightweight, 3D selection/camera state | Redux, Jotai | Low | Required |
| Validation | Zod | Schema validation shared client/server | Yup, Valibot | Low | Required |
| Backend | Supabase (PostgreSQL, Auth, RLS) | Managed, scalable, real-time | Firebase, PlanetScale | Low | Required |
| Auth | Supabase Auth (GoTrue) | Email/password (required) + OAuth (optional) | Auth0, Clerk | Low | Required |
| Database | PostgreSQL 15+ | Exclusion constraints, ranges, JSONB | MySQL, CockroachDB | Low | Required |
| Testing | Vitest + Playwright | Unit/integration + E2E | Jest, Cypress | Low | Required |
| Deployment | Vercel | Tight Next.js integration, preview deploys | Netlify, AWS | Low | Required |
| CI/CD | GitHub Actions | Standard, free for public repos | GitLab CI, CircleCI | Low | Required |
| Monitoring | Vercel Analytics + Sentry | Performance + error tracking | Datadog, LogRocket | Low | Future |
| Real-time | Supabase Realtime | WebSocket subscriptions | Socket.io, Pusher | Medium | Optional |

### Stack Decisions Requiring Justification

**React Three Fiber over plain Three.js:** R3F integrates 3D into React's component model, making it possible to use hooks for state, declarative scene graphs, and React DevTools for debugging. The learning curve is justified by the productivity gain for a React team.

**Zustand over Redux:** The client state needs are modest (3D selection, camera position, UI preferences). Zustand's minimal API and TypeScript-first design reduce boilerplate.

**Tailwind CSS over CSS Modules:** Design tokens are first-class in Tailwind 4 via CSS variables. The utility-first approach accelerates responsive design and maintains consistency.

---

## D. MVP Scope

The MVP delivers a **complete, reliable reservation system** with a **polished 2D floor view** and a **functional 3D floor preview**. It proves the core value proposition without overcommitting to advanced features.

### In MVP

1. **Restaurant discovery** — list and detail pages. **[REQUIRED]**
2. **Table and group management** — CRUD for managers. **[REQUIRED]**
3. **Availability search** — algorithm + API. **[REQUIRED]**
4. **Reservation booking** — with concurrency control, holds, cancellation. **[REQUIRED]**
5. **Staff dashboard** — 2D floor view, reservation list, seating workflow. **[REQUIRED]**
6. **Authentication** — email/password (required) + Google OAuth (optional, configured-only). **[REQUIRED]**
7. **Database correctness** — exclusion constraints, RLS, triggers, advisory locks. **[REQUIRED]**
8. **Design system foundation** — tokens, components, dark/light themes. **[REQUIRED]**
9. **3D floor preview** — basic 3D rendering with table states (available/occupied/selected). **[OPTIONAL]**
10. **Accessibility** — WCAG 2.2 AA, keyboard navigation, screen reader support. **[REQUIRED]**
11. **WebGL fallback** — 2D canvas when WebGL unavailable. **[REQUIRED]**
12. **Core testing** — unit, integration, E2E, concurrency. **[REQUIRED]**

### Not in MVP

- Smart table recommendations **[FUTURE]**
- Waitlist **[FUTURE]**
- QR check-in **[FUTURE]**
- Email confirmations (stub only) **[FUTURE]**
- Demand heatmap **[FUTURE]**
- Peak-time analytics **[FUTURE]**
- Floor editor (drag-and-compose) **[FUTURE]**
- Saved floor layouts **[FUTURE]**
- Multi-restaurant per user **[FUTURE]**
- Theming per restaurant **[FUTURE]**
- Audit log (basic only) **[FUTURE]**
- Feature flags **[FUTURE]**
- Demo mode **[FUTURE]**
- Offline fallback **[FUTURE]**

---

## E. Differentiator Scope

These features create the "impressive" factor and are achievable after MVP:

1. **Interactive 3D floor map** — full camera control (orbit, pan, zoom, reset), table groups visually joined, hover tooltips, click selection, keyboard navigation. **[OPTIONAL]**
2. **Table-group composer** — visual drag-and-drop interface for creating and editing table groups. **[FUTURE]**
3. **Live floor updates** — Supabase Realtime pushes reservation changes to the 3D/2D floor in real time. **[OPTIONAL]**
4. **Premium design system** — complete component library, dark/light themes, motion guidelines, reduced-motion support. **[FUTURE]**
5. **Top-down 2D mode** — SVG/Canvas floor view synchronized with 3D. **[OPTIONAL]**
6. **Mobile-friendly 3D** — simplified floor view for small screens. **[FUTURE]**
7. **Loading, empty, error, retry states** — for all data-driven screens. **[REQUIRED]**
8. **Legend and visual indicators** — clear table status colors + icons + text labels. **[REQUIRED]**
9. **Reservation hold with expiry** — temporary holds during booking flow. **[OPTIONAL]**
10. **Explainable conflicts** — exact details when a table is unavailable. **[OPTIONAL]**

---

## F. Future Scope

These are explicitly planned but not committed:

| Feature | Description | Priority |
|---------|-------------|----------|
| Smart table recommendation | ML-based best-fit ranking | Medium |
| Best-fit table-combination ranking | Algorithmic optimization | High |
| Waitlist | Guest queue with automatic promotion | High |
| QR check-in | Guest self check-in via QR code | Medium |
| Email confirmations | SendGrid/Resend integration | High |
| Staff live updates | Real-time collaboration | High |
| Demand heatmap | Visual demand patterns | Low |
| Peak-time analytics | Revenue/turnover insights | Medium |
| Table utilization analytics | Efficiency metrics | Medium |
| Floor editor | Drag-and-compose layout editor | High |
| Saved floor layouts | Multiple layout presets | Medium |
| Customer preferences | Dietary, seating preferences | Low |
| Accessibility preferences | Persistent a11y settings | Medium |
| Multi-restaurant support | Multi-tenant architecture | High |
| Theming/branding per restaurant | White-label support | Low |
| Audit log | Complete change history | Medium |
| Feature flags | Gradual rollout | Medium |
| Demo mode | Presentation-friendly demo data | High |
| Offline/read-only staff fallback | Service worker + local cache | Low |

---

## G. Screen Map

### Customer Screens

| # | Screen | Route | Role | Primary Goal | API Dependencies | Loading | Empty | Error | Responsive | A11y | DoD |
|---|--------|-------|------|-------------|------------------|---------|-------|-------|-----------|------|-----|
| 1 | Landing | `/` | Public | Discover restaurants | `GET /api/restaurants` | Skeleton cards | "No restaurants yet" | Retry button | Stack on mobile | Semantic HTML, skip link | Restaurants load, search works |
| 2 | Restaurant Discovery | `/restaurants` | Public | Browse/search restaurants | `GET /api/restaurants` | Skeleton grid | "No matches" | Retry | Grid 2/3/4 cols | Keyboard search filter | Filter by name/cuisine |
| 3 | Restaurant Detail | `/restaurants/[slug]` | Public | View restaurant info | `GET /api/restaurants/[slug]` | Skeleton | N/A | Retry | Stack on mobile | Alt text, headings | Info, hours, photos, book CTA |
| 4 | 3D Floor Preview | `/restaurants/[slug]/floor` | Public | Visual floor preview | `GET /api/restaurants/[slug]/floor` | 3D loader | "No floor layout" | 2D fallback | Full-width 3D | Keyboard nav, ARIA table list | 3D renders, states visible |
| 5 | Availability Search | `/restaurants/[slug]/book` | Guest | Find available tables | `GET /api/availability` | Spinner | "No availability" | Retry + message | Stack on mobile | Form labels, live results | Results sorted by fit |
| 6 | Table/Group Selection | `/restaurants/[slug]/select` | Guest | Choose table/group | `GET /api/availability` | Spinner | "None available" | Retry | 3D + list toggle | Radio group, keyboard | Selection confirmed |
| 7 | Reservation Summary | `/restaurants/[slug]/confirm` | Guest | Review and confirm | `POST /api/reservations` | Spinner | N/A | Inline error | Stack on mobile | Focus management | Booking succeeds |
| 8 | Login | `/login` | Public | Authenticate | `POST /api/auth/login` | Spinner | N/A | Inline error | Centered card | Form labels, error alert | Session created |
| 9 | Signup | `/signup` | Public | Create account | `POST /api/auth/signup` | Spinner | N/A | Inline error | Centered card | Form labels, error alert | Account created |
| 10 | Booking Confirmation | `/reservations/[id]/confirmed` | Guest | Confirmation details | `GET /api/reservations/[id]` | Skeleton | N/A | Retry | Centered card | Success alert | Details + add-to-calendar |
| 11 | My Reservations | `/reservations` | Guest | List own reservations | `GET /api/reservations` | Skeleton list | "No reservations" | Retry | Stack on mobile | List semantics | Status badges, actions |
| 12 | Reservation Detail | `/reservations/[id]` | Guest | View details | `GET /api/reservations/[id]` | Skeleton | N/A | Retry | Stack on mobile | Headings, labels | Full details, cancel button |
| 13 | Modify/Cancel | `/reservations/[id]/manage` | Guest | Cancel reservation | `PATCH /api/reservations/[id]` | Spinner | N/A | Inline error | Centered card | Confirm dialog | Cancellation succeeds |
| 14 | Notifications | `/notifications` | Guest | View notifications | `GET /api/notifications` | Skeleton | "No notifications" | Retry | Stack on mobile | List semantics | Mark-as-read works |
| 15 | Help & Rules | `/help` | Public | Booking rules | Static | N/A | N/A | N/A | Stack on mobile | Semantic HTML | Content complete |

### Staff Screens

| # | Screen | Route | Role | Primary Goal | API Dependencies | Loading | Empty | Error | Responsive | A11y | DoD |
|---|--------|-------|------|-------------|------------------|---------|-------|-------|-----------|------|-----|
| 16 | Staff Login | `/staff/login` | Public | Staff auth | `POST /api/auth/login` | Spinner | N/A | Inline error | Centered card | Form labels | Staff session |
| 17 | Staff Dashboard | `/staff` | Staff | Overview | `GET /api/staff/overview` | Skeleton | "No data" | Retry | Grid on desktop | Headings | KPIs, today's stats |
| 18 | Live 3D Floor | `/staff/floor` | Staff | Real-time floor | `GET /api/floor` + Realtime | 3D loader | "No layout" | 2D fallback | Full-width 3D | Keyboard, ARIA list | States update live |
| 19 | 2D Floor Map | `/staff/floor-2d` | Staff | Top-down view | `GET /api/floor` | Canvas loader | "No layout" | Retry | Full-width | ARIA table list | Sync with 3D |
| 20 | Reservation Timeline | `/staff/timeline` | Staff | Schedule view | `GET /api/staff/reservations` | Skeleton | "No reservations" | Retry | Horizontal scroll | Table semantics | Drag to reschedule |
| 21 | Reservation Detail | `/staff/reservations/[id]` | Staff | Manage reservation | `GET/PATCH /api/reservations/[id]` | Skeleton | N/A | Retry | Stack on mobile | Form labels | Status actions work |
| 22 | Seating Workflow | `/staff/seating` | Staff | Seat guests | `PATCH /api/reservations/[id]` | Spinner | N/A | Inline error | Centered card | Confirm dialog | Seated status |
| 23 | Waitlist | `/staff/waitlist` | Staff | Guest queue | `GET/POST /api/waitlist` | Skeleton | "No guests" | Retry | Stack on mobile | List semantics | Promote guest |
| 24 | No-Show/Complete | `/staff/reservations/[id]/complete` | Staff | Finish reservation | `PATCH /api/reservations/[id]` | Spinner | N/A | Inline error | Centered card | Confirm dialog | Completed |
| 25 | Table Management | `/staff/tables` | Manager | CRUD tables | `GET/POST/PATCH/DELETE /api/tables` | Skeleton | "No tables" | Retry | Table/grid | Form labels | CRUD works |
| 26 | Table-Group Builder | `/staff/groups` | Manager | CRUD groups | `GET/POST/PATCH/DELETE /api/groups` | Skeleton | "No groups" | Retry | List + builder | Form labels | CRUD works |
| 27 | Floor Editor | `/staff/editor` | Manager | Drag-and-compose | `GET/POST /api/floor/layout` | Canvas loader | "No layout" | Retry | Full-width | Keyboard move | Layout saved |
| 28 | Operating Hours | `/staff/hours` | Manager | Set hours | `GET/PUT /api/restaurants/[slug]/hours` | Skeleton | N/A | Retry | Form | Form labels | Hours saved |
| 29 | Restaurant Settings | `/staff/settings` | Manager | Restaurant config | `GET/PUT /api/restaurants/[slug]` | Skeleton | N/A | Retry | Form | Form labels | Settings saved |
| 30 | Staff Management | `/staff/team` | Owner | Manage staff | `GET/POST/PATCH /api/staff/members` | Skeleton | "No staff" | Retry | Table | Form labels | Roles assigned |

### Showcase Screens

| # | Screen | Route | Role | Primary Goal | API Dependencies | Loading | Empty | Error | Responsive | A11y | DoD |
|---|--------|-------|------|-------------|------------------|---------|-------|-------|-----------|------|-----|
| 31 | Conflict Demo | `/demo/conflict` | Public | Show conflict prevention | `POST /api/reservations` | Spinner | N/A | N/A | Centered | Live region | 409 shown visually |
| 32 | Concurrency Demo | `/demo/concurrency` | Public | Show atomic booking | `POST /api/reservations` | Spinner | N/A | N/A | Centered | Live region | One winner shown |
| 33 | Architecture | `/showcase/architecture` | Public | System overview | Static | N/A | N/A | N/A | Stack on mobile | Diagram | Diagram + explanation |
| 34 | Accessibility Settings | `/settings/accessibility` | Guest | A11y preferences | `GET/PUT /api/preferences` | Skeleton | N/A | Retry | Form | Form labels | Preferences saved |
| 35 | Demo Mode | `/demo` | Public | Presentation demo | `GET /api/demo/data` | Spinner | N/A | Retry | Full-screen | Skip link | Demo runs smoothly |
| 36 | System Health | `/showcase/health` | Public | Test results | `GET /api/health` | Skeleton | N/A | Retry | Dashboard | Table semantics | All checks green |

---

## H. Data Model Summary

### Entity-Relationship Overview

```
restaurants 1───* restaurant_profiles
restaurants 1───* restaurant_memberships
restaurants 1───* tables
restaurants 1───* table_groups
table_groups *───* tables (via table_group_members)
restaurants 1───* floor_sections
restaurants 1───* operating_hours
restaurants 1───* reservations
users 1───* reservations (guest who booked)
reservations 1───* reservation_tables
reservations 1───* reservation_holds
users 1───* audit_events
users 1───* notifications
```

### Complete Schema

```sql
-- ============================================
-- Core Entities
-- ============================================

CREATE TABLE restaurants (
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

CREATE TABLE profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name     text,
  phone         text,
  preferences   jsonb DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE restaurant_memberships (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role          text NOT NULL DEFAULT 'staff'
                CHECK (role IN ('owner', 'manager', 'staff')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, user_id)
);

CREATE TABLE tables (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  label         text NOT NULL,
  capacity      int NOT NULL CHECK (capacity > 0),
  section_id    uuid REFERENCES floor_sections(id) ON DELETE SET NULL,
  position_x    float DEFAULT 0,
  position_y    float DEFAULT 0,
  width         float DEFAULT 1,
  depth         float DEFAULT 1,
  shape         text DEFAULT 'round' CHECK (shape IN ('round', 'square', 'rect', 'booth')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE table_groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE table_group_members (
  group_id  uuid NOT NULL REFERENCES table_groups(id) ON DELETE CASCADE,
  table_id  uuid NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, table_id)
);

CREATE TABLE floor_sections (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  color         text DEFAULT '#3b82f6',
  sort_order    int DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE operating_hours (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  day_of_week   int NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opens_at      time NOT NULL,
  closes_at     time NOT NULL,
  is_closed     boolean DEFAULT false,
  CHECK (closes_at > opens_at),
  UNIQUE (restaurant_id, day_of_week)
);

-- ============================================
-- Reservations
-- ============================================

CREATE TABLE reservations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
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

CREATE TABLE reservation_tables (
  reservation_id uuid NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  table_id       uuid NOT NULL REFERENCES tables(id) ON DELETE CASCADE,
  starts_at      timestamptz NOT NULL,
  ends_at        timestamptz NOT NULL,
  PRIMARY KEY (reservation_id, table_id),
  EXCLUDE USING gist (
    table_id WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  )
);

CREATE TABLE reservation_holds (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  table_ids      uuid[] NOT NULL,
  session_id    text NOT NULL,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- Audit & Notifications
-- ============================================

CREATE TABLE audit_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid REFERENCES restaurants(id) ON DELETE SET NULL,
  user_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action        text NOT NULL,
  entity_type   text NOT NULL,
  entity_id     uuid,
  details       jsonb DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  restaurant_id uuid REFERENCES restaurants(id) ON DELETE CASCADE,
  type          text NOT NULL,
  title         text NOT NULL,
  message       text NOT NULL,
  read          boolean DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- Indexes
-- ============================================

CREATE INDEX idx_tables_restaurant ON tables(restaurant_id);
CREATE INDEX idx_tables_section ON tables(section_id);
CREATE INDEX idx_table_groups_restaurant ON table_groups(restaurant_id);
CREATE INDEX idx_table_group_members_group ON table_group_members(group_id);
CREATE INDEX idx_table_group_members_table ON table_group_members(table_id);
CREATE INDEX idx_operating_hours_restaurant ON operating_hours(restaurant_id);
CREATE INDEX idx_reservations_restaurant ON reservations(restaurant_id);
CREATE INDEX idx_reservations_user ON reservations(user_id);
CREATE INDEX idx_reservations_time ON reservations(restaurant_id, starts_at, ends_at);
CREATE INDEX idx_reservations_status ON reservations(restaurant_id, status);
CREATE INDEX idx_reservation_tables_table ON reservation_tables(table_id);
CREATE INDEX idx_reservation_tables_time ON reservation_tables(table_id, starts_at, ends_at);
CREATE INDEX idx_reservation_holds_expiry ON reservation_holds(expires_at);
CREATE INDEX idx_audit_events_restaurant ON audit_events(restaurant_id);
CREATE INDEX idx_notifications_user ON notifications(user_id);
```

### Schema Design Notes

- **`reservation_tables`** is the correctness-critical table. The `EXCLUDE USING gist` constraint makes double-booking physically impossible at the database level.
- **`reservation_holds`** supports the booking flow — tables are held temporarily while the user completes the booking form. A cron job or trigger cleans up expired holds.
- **`restaurant_memberships`** enables multi-restaurant support. A user can belong to multiple restaurants with different roles.
- **`floor_sections`** allows the floor to be divided into named areas (Patio, Main Dining, Bar, etc.).
- **`tables.position_x`, `position_y`, `width`, `depth`, `shape`** provide the geometric data needed for both 2D and 3D rendering.
- **`idempotency_key`** on reservations enables safe retries — if the same key is submitted twice, the second request returns the original reservation.

---

## I. Security Model

### Authentication Flow

1. User signs up / logs in via Supabase Auth (**email/password required**; Google OAuth optional and configured-only).
2. Supabase issues a JWT with `sub` (user ID) claim.
3. The JWT is stored in an HTTP-only cookie (via `@supabase/ssr`).
4. Every API request includes the cookie; Supabase validates the JWT.
5. RLS policies use `auth.uid()` to identify the user.

### Authentication Requirements

| Method | MVP Status | Notes |
|--------|-----------|-------|
| Email/Password | **REQUIRED** | Core auth for all users |
| Google OAuth | **OPTIONAL** | Enabled only when `SUPABASE_AUTH_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_GOOGLE_CLIENT_SECRET` are configured. Labeled "pending" in UI when not configured. |
| Other OAuth | **FUTURE** | Facebook, Apple, etc. |

### Role Hierarchy

| Role | Permissions |
|------|-------------|
| **Guest** | Book reservations, view own reservations, cancel own reservations |
| **Staff** | View restaurant floor, manage seating, view all restaurant reservations |
| **Manager** | Everything Staff can do + manage tables, groups, hours, settings |
| **Owner** | Everything Manager can do + manage staff, view analytics, delete data |

### RLS Policies (Summary)

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| restaurants | All authenticated | Owner only | Owner/Manager | Owner only |
| profiles | Own profile; staff see restaurant profiles | System (trigger) | Own full_name; Manager can update role | Owner only |
| restaurant_memberships | Own memberships; Manager sees restaurant members | Owner only | Owner only | Owner only |
| tables | All authenticated | Manager/Owner | Manager/Owner | Manager/Owner |
| table_groups | All authenticated | Manager/Owner | Manager/Owner | Manager/Owner |
| reservations | Own (guest); restaurant (staff) | Authenticated | Own cancel; staff update | Owner only |
| reservation_tables | Same as reservations | System only | Not allowed | Not allowed |
| reservation_holds | System only | System only | System only | System only |
| audit_events | Owner/Manager | System only | Not allowed | Not allowed |
| notifications | Own only | System only | Own (mark read) | Not allowed |

### Secret Handling

| Variable | Client | Server | Description |
|----------|--------|--------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Yes | Public anon key (safe for client) |
| `SUPABASE_SERVICE_ROLE_KEY` | **No** | Yes | Secret — server-only, never exposed |
| `SUPABASE_AUTH_GOOGLE_CLIENT_ID` | No | Yes | Google OAuth client ID (optional) |
| `SUPABASE_AUTH_GOOGLE_CLIENT_SECRET` | **No** | Yes | Google OAuth secret (optional, server-only) |

### Security Measures

- All inputs validated with Zod schemas.
- SQL injection prevented by parameterized queries (Supabase client).
- CSRF protected by SameSite cookies.
- Rate limiting via Supabase Edge Functions or Vercel WAF.
- Error messages sanitized — no stack traces or internal details leaked.
- Role-escalation prevented by RLS — users cannot modify their own role.

### Cross-Platform Security Scan

All security checks use a cross-platform npm script (`npm run security:scan`) that works on Windows, macOS, Linux, and CI. The script is a Node.js-based scan — no Unix-only `grep` or `bash` dependencies.

```json
// package.json
{
  "scripts": {
    "security:scan": "node scripts/security-scan.js"
  }
}
```

The scan checks for:
- Hardcoded secrets in source files (API keys, tokens, passwords)
- Missing `SUPABASE_SERVICE_ROLE_KEY` in `.env` (server-side)
- Exposure of `SUPABASE_SERVICE_ROLE_KEY` to client bundles
- Missing RLS policies on tables
- Unvalidated user inputs in API routes

---

## J. 3D Architecture

### Rendering Pipeline

```
API Response (normalized JSON)
        │
        ▼
Shared UI State (Zustand store)
        │
        ├──► 3D Floor (React Three Fiber)
        │      ├── Floor mesh (ground plane)
        │      ├── Table meshes (cylinder/box per table)
        │      ├── Group overlays (lines connecting grouped tables)
        │      ├── State indicators (color + icon per table)
        │      └── Camera controller (orbit, pan, zoom)
        │
        └──► 2D Floor (SVG/Canvas)
               ├── Floor rect (ground)
               ├── Table shapes (circle/rect per table)
               ├── Group overlays (dashed borders)
               └── State indicators (color + icon)
```

### Data Flow Principle

**The 3D layer NEVER makes booking decisions.** It only:
1. Renders the current state from the normalized API response.
2. Sends user intentions (table selections) to the API.
3. Reflects API responses back into the visual representation.

All booking logic, conflict detection, and state transitions happen in the domain layer and database.

### WebGL Detection and Fallback

```typescript
// src/lib/webgl.ts
export function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')));
  } catch {
    return false;
  }
}
```

When WebGL is unavailable:
- The 3D canvas is replaced with the 2D canvas view.
- A non-blocking notice informs the user: "3D view requires WebGL. Showing 2D view."
- All functionality remains available through the 2D view and the accessible table list.

### 3D/2D Synchronization

Both views read from the same Zustand store:

```typescript
// src/stores/floorStore.ts
interface FloorState {
  tables: TableState[];
  groups: GroupState[];
  selectedTableIds: string[];
  hoveredTableId: string | null;
  cameraPosition: [number, number, number];
  // Actions
  selectTable: (id: string) => void;
  hoverTable: (id: string | null) => void;
  setCameraPosition: (pos: [number, number, number]) => void;
}
```

When a user clicks a table in 3D, `selectTable` updates the store, and the 2D view reflects the selection instantly. Vice versa.

### 3D Interaction Matrix

| Interaction | Customer | Staff | Keyboard | Touch |
|-------------|----------|-------|----------|-------|
| Click table | Select | Select | Enter/Space | Tap |
| Hover table | Tooltip | Tooltip | Focus | N/A |
| Orbit camera | Yes | Yes | Arrow keys | N/A |
| Pan camera | Yes | Yes | Shift+Arrow | N/A |
| Zoom camera | Yes | Yes | +/- | Pinch |
| Reset camera | Yes | Yes | R | Button |
| Toggle 2D/3D | Yes | Yes | V | Button |

### Performance Considerations

- **Instanced meshes** for tables (one draw call for all tables of the same shape).
- **Level of detail** — reduce geometry complexity on mobile.
- **Frustum culling** — Three.js does this automatically.
- **Lazy loading** — 3D components load only when the floor view is active.
- **Reduced motion** — disable camera animations when `prefers-reduced-motion` is set.

### Reduced-Motion Behavior

```typescript
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
// Disable camera auto-rotation, smooth transitions, and particle effects
```

---

## K. Complete Milestone Roadmap

### M0: Product Decisions and Master Architecture
- **Goal:** Finalize all product and technical decisions.
- **Dependencies:** None.
- **Owner:** Planner
- **Deliverables:** This plan, architecture diagram, all open decisions resolved.
- **Acceptance:** Plan published to room, all sections complete, all open decisions documented with recommendations.
- **Tests:** N/A
- **DoD:** Hasnain approves the plan and open decisions.

### M1: Repository Foundation and Design System
- **Goal:** Next.js project, TypeScript config, Tailwind, design tokens, CI pipeline.
- **Dependencies:** M0.
- **Owner:** Implementer
- **Files:** `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`, `.github/workflows/ci.yml`, `src/app/globals.css`, `src/lib/design-tokens.ts`
- **Deliverables:** Working Next.js app, design system foundation, CI passing.
- **Acceptance:** `npm run typecheck` passes, `npm test` passes, CI green on PR.
- **Tests:** Smoke test (app loads, Tailwind compiles).
- **DoD:** App deploys to Vercel preview, CI operational.

### M2: Supabase Schema, Migrations, RLS, and Seed Data
- **Goal:** Complete database with all tables, constraints, RLS, triggers.
- **Dependencies:** M1.
- **Owner:** Implementer
- **Files:** `supabase/migrations/001_initial_schema.sql`, `002_rls_policies.sql`, `003_triggers.sql`, `004_functions.sql`, `005_seed_data.sql`, `supabase/seed.sql`, `supabase/config.toml`
- **Deliverables:** Full schema applied, RLS enforced, exclusion constraint active, seed data loaded.
- **Acceptance:** `supabase db push` succeeds, RLS blocks unauthorized access, exclusion constraint prevents overlapping inserts.
- **Tests:** Database constraint tests, RLS integration tests.
- **DoD:** All migrations applied, security tests pass.

### M3: Restaurant, Table, Group, and Floor-Layout Management
- **Goal:** CRUD APIs and UI for restaurants, tables, groups, floor sections.
- **Dependencies:** M2.
- **Owner:** Implementer
- **Files:** `src/app/api/restaurants/`, `src/app/api/tables/`, `src/app/api/groups/`, `src/app/api/floor/`, `src/app/staff/tables/`, `src/app/staff/groups/`, `src/app/staff/editor/`
- **Deliverables:** Staff can create and manage tables, groups, and floor sections via UI.
- **Acceptance:** All CRUD endpoints work, RLS prevents unauthorized access, UI functional.
- **Tests:** API integration tests, E2E tests for CRUD flows.
- **DoD:** Staff can configure tables, groups, and floor layout through the UI.

### M4: Availability Domain and API
- **Goal:** Availability search algorithm and API.
- **Dependencies:** M2.
- **Owner:** Implementer
- **Files:** `src/domain/availability.ts`, `src/domain/conflict.ts`, `src/domain/timezone.ts`, `src/app/api/restaurants/[slug]/availability/`
- **Deliverables:** Availability API returns correct table combinations.
- **Acceptance:** API returns available combinations sorted by best fit, excludes conflicting tables.
- **Tests:** Unit tests for algorithm, integration tests for API.
- **DoD:** Availability search returns correct results for all test cases.

### M5: Reservation Transaction, Holds, Cancellation, and Conflicts
- **Goal:** Booking flow with concurrency control, holds, cancellation.
- **Dependencies:** M4.
- **Owner:** Implementer
- **Files:** `src/domain/reservation.ts`, `src/domain/status-machine.ts`, `src/app/api/reservations/`, `src/app/api/holds/`, `supabase/migrations/006_booking_rpc.sql`
- **Deliverables:** Guests can book and cancel reservations, double-booking prevented.
- **Acceptance:** Booking succeeds when tables available, returns 409 when conflict, cancellation frees tables.
- **Tests:** Unit tests, integration tests, concurrency tests.
- **DoD:** Booking flow works end-to-end, concurrency tests pass.

### M6: Customer Booking Experience
- **Goal:** Complete customer-facing UI for discovery, search, booking, management.
- **Dependencies:** M3, M4, M5.
- **Owner:** Implementer
- **Files:** `src/app/restaurants/`, `src/app/reservations/`, `src/app/login/`, `src/app/signup/`, `src/components/booking/`
- **Deliverables:** All customer screens functional, responsive, accessible.
- **Acceptance:** All customer user flows work, WCAG 2.2 AA compliant.
- **Tests:** E2E tests for all critical customer flows.
- **DoD:** Customer booking flow complete end-to-end.

### M7: Staff Operations Dashboard
- **Goal:** Staff dashboard with 2D floor, timeline, seating workflow.
- **Dependencies:** M3, M5.
- **Owner:** Implementer
- **Files:** `src/app/staff/`, `src/components/staff/`, `src/stores/floorStore.ts`
- **Deliverables:** Staff can manage floor, reservations, seating via dashboard.
- **Acceptance:** All staff workflows functional, real-time updates work.
- **Tests:** E2E tests for staff flows.
- **DoD:** Staff dashboard operational.

### M8: 3D Floor Map and Table-Group Composer
- **Goal:** Interactive 3D floor with camera control, table groups, WebGL fallback.
- **Dependencies:** M7.
- **Owner:** Implementer
- **Files:** `src/components/three/Floor3D.tsx`, `src/components/three/Table3D.tsx`, `src/components/three/GroupOverlay.tsx`, `src/components/three/CameraController.tsx`, `src/components/floor/Floor2D.tsx`, `src/lib/webgl.ts`
- **Deliverables:** 3D floor renders, camera control works, 2D fallback works, groups visually joined.
- **Acceptance:** 3D floor renders with table states, camera orbit/pan/zoom works, 2D fallback works, keyboard navigation works.
- **Tests:** 3D component tests, 2D fallback tests, keyboard accessibility tests.
- **DoD:** 3D floor fully functional with fallback.

### M9: Accessibility, Mobile Fallback, Performance, and Security
- **Goal:** WCAG 2.2 AA compliance, mobile optimization, performance audit, security audit.
- **Dependencies:** M8.
- **Owner:** Test Author
- **Files:** `tests/accessibility/`, `tests/performance/`, `tests/security/`, `playwright.config.ts`
- **Deliverables:** Full test suite passing, accessibility audit clean, performance targets met.
- **Acceptance:** All tests pass, 0 critical a11y violations, Lighthouse score > 90.
- **Tests:** Full test pyramid (Section L).
- **DoD:** All quality gates green.

### M10: E2E Testing, Demo Mode, Deployment, and Documentation
- **Goal:** E2E tests, demo mode, production deployment, documentation.
- **Dependencies:** M9.
- **Owner:** Integrator
- **Files:** `tests/e2e/`, `src/app/demo/`, `README.md`, `DEPLOYMENT.md`, `DEMO.md`
- **Deliverables:** E2E tests passing, demo mode functional, production deployed, documentation complete.
- **Acceptance:** E2E tests pass, demo runs smoothly, production live.
- **Tests:** Playwright E2E suite.
- **DoD:** Production live, demo successful, documentation complete.

---

## L. Team Task Matrix

### Hasnain Ahmad (Team Lead)
- Approve plan and open decisions (M0)
- Coordinate team and resolve blockers
- Final sign-off on each milestone
- Presentation/slide ownership

### Planner (Team HJ Planner OpenCode)
- [x] Write comprehensive project plan
- [x] Define database schema
- [x] Design availability algorithm
- [x] Design concurrency control strategy
- [x] Define RLS policies
- [x] Design 3D architecture
- [x] Create milestone roadmap
- [x] Define team task matrix
- [x] Review and finalize open decisions with Hasnain
- [x] Publish plan to room plan surface

### Implementer
- [ ] Set up Next.js project with TypeScript, Tailwind, Supabase (M1)
- [ ] Create Supabase migrations: schema, RLS, triggers (M2)
- [ ] Implement restaurant/table/group/floor CRUD APIs (M3)
- [ ] Implement availability search algorithm and API (M4)
- [ ] Implement reservation creation with concurrency control (M5)
- [ ] Implement reservation cancellation and holds (M5)
- [ ] Implement Supabase Auth integration (M6)
- [ ] Build all customer-facing screens (M6)
- [ ] Build staff dashboard with 2D floor (M7)
- [ ] Build 3D floor map with R3F (M8)
- [ ] Implement WebGL fallback (M8)
- [ ] Implement real-time staff updates (M7)

### Test Author
- [ ] Write unit tests for `availability.ts` (M4)
- [ ] Write unit tests for `conflict.ts` (M2)
- [ ] Write unit tests for `reservation.ts` status transitions (M5)
- [ ] Write unit tests for `timezone.ts` (M4)
- [ ] Write integration tests for all API endpoints (M3-M6)
- [ ] Write database tests for constraints and triggers (M2)
- [ ] Write concurrency tests (parallel booking scenarios) (M5, M9)
- [ ] Write security/RLS tests (M2, M9)
- [ ] Write E2E tests for customer flows (M6, M10)
- [ ] Write E2E tests for staff flows (M7, M10)
- [ ] Write accessibility tests (M9)
- [ ] Write 3D selection tests (M8)
- [ ] Write 2D fallback tests (M8)
- [ ] Write keyboard accessibility tests (M9)
- [ ] Write reduced-motion tests (M9)
- [ ] Write responsive/mobile tests (M9)
- [ ] Set up Playwright configuration (M9)

### Reviewer
- [ ] Review database schema for correctness and completeness (M2)
- [ ] Review RLS policies for security gaps (M2)
- [ ] Review concurrency control implementation (M5)
- [ ] Review availability algorithm for edge cases (M4)
- [ ] Review API contracts for consistency (M3-M6)
- [ ] Review 3D architecture for performance risks (M8)
- [ ] Review frontend for accessibility and responsiveness (M9)
- [ ] Review test coverage and quality (M9)

### Integrator
- [ ] Set up Vercel project and deployment pipeline (M1)
- [ ] Set up Supabase projects (dev, staging, production) (M2)
- [ ] Configure environment variables across environments (M2)
- [ ] Set up CI/CD GitHub Actions workflows (M1)
- [ ] Coordinate parallel work integration (M3-M8)
- [ ] Manage production deployment (M10)
- [ ] Set up monitoring and alerting (M10)
- [ ] Write deployment and operations documentation (M10)

### Frontend Contributor
- [ ] Build responsive layout and navigation components (M6)
- [ ] Build restaurant listing and detail pages (M6)
- [ ] Build availability search and booking flow UI (M6)
- [ ] Build "My Reservations" page (M6)
- [ ] Build authentication screens (login, signup) (M6)
- [ ] Ensure WCAG 2.2 AA accessibility compliance (M9)
- [ ] Optimize performance (lazy loading, code splitting) (M9)

### 3D UI Contributor
- [ ] Set up React Three Fiber project structure (M8)
- [ ] Build Floor3D scene with ground plane and lighting (M8)
- [ ] Build Table3D components with state colors (M8)
- [ ] Build GroupOverlay for visual table joining (M8)
- [ ] Build CameraController (orbit, pan, zoom, reset) (M8)
- [ ] Build interaction handlers (click, hover, keyboard) (M8)
- [ ] Build WebGL detection and fallback (M8)
- [ ] Build 2D Floor Canvas view (M7)
- [ ] Implement 3D/2D synchronization via Zustand (M7)
- [ ] Optimize 3D performance (instancing, LOD) (M9)

### Presentation/Slide Owner
- [ ] Create presentation slides (M10)
- [ ] Prepare demo script (M10)
- [ ] Record demo video (M10)

### Demo-Video Owner
- [ ] Record customer booking flow (M10)
- [ ] Record staff operations flow (M10)
- [ ] Record 3D floor interaction (M10)
- [ ] Record conflict/concurrency demonstration (M10)
- [ ] Edit and produce final demo video (M10)

---

## M. Demo and Presentation Plan

### Three Strongest Differentiators

1. **Interactive 3D Floor Map** — Not decorative. A functional operational tool where table states are visually clear, groups are joined, and the same data drives 2D and 3D views.
2. **Database-Level Double-Booking Prevention** — PostgreSQL exclusion constraints make double-booking physically impossible, not just unlikely.
3. **Premium Design System** — A cohesive, modern, accessible design language that looks professional, not like a generic template.

### Three Features That Create Demo Impact

1. **3D Floor with Live States** — Watch tables change color in real time as reservations are created.
2. **Concurrency Demonstration** — Two browsers booking the same table simultaneously; one wins, one gets a clear 409 error.
3. **Table-Group Visual Joining** — See tables visually connected when they form a group, with capacity badges.

### Three Features That Create Real Product Value

1. **Reliable Booking** — Guests trust the system because it never double-books.
2. **Visual Availability** — Guests can see exactly what's available, not just a list.
3. **Staff Efficiency** — Staff manage the floor visually, not through spreadsheets.

### What Must Be Fully Functional

- Booking flow (search → select → confirm)
- Double-booking prevention
- Staff seating workflow
- 3D floor with table states
- 2D fallback
- Keyboard accessibility

### What May Be a Polished Prototype

- Floor editor (drag-and-compose)
- Analytics dashboard
- Table-group composer

### What Must Be Labelled as Planned

- Smart recommendations
- Waitlist
- QR check-in
- Multi-restaurant
- Demand heatmap

### 3–5 Minute Winning Demo Script

1. **0:00–0:30** — Open on the 3D floor. Show tables in various states (available, occupied, selected). Orbit the camera.
2. **0:30–1:30** — Book a party of 6. Search availability. Select a table group (4+2). Confirm booking. Watch the floor update.
3. **1:30–2:30** — Open a second browser. Try to book the same table. Show the 409 conflict error. Explain the database exclusion constraint.
4. **2:30–3:30** — Switch to staff view. Seat the party. Mark as seated. Watch the floor update in real time.
5. **3:30–4:30** — Cancel the reservation. Watch the table become available again. Show the audit trail.
6. **4:30–5:00** — Summarize: "This is Composable Floor. Database-correct, visually clear, operationally powerful."

### Presentation Story

1. **Problem:** "Restaurant reservation systems treat tables as fixed units. When a party of 6 arrives but only tables of 4 and 2 exist, the host must manually combine tables — and most systems can't handle this without double-booking."
2. **Solution:** "Composable Floor models table groups as first-class entities and enforces correctness at the database level."
3. **Demo:** Live demonstration of the 3D floor, booking flow, and concurrency safety.
4. **Impact:** "Guests get a visual, reliable booking experience. Staff get a real-time operational tool. Owners get confidence that double-booking is impossible."

### Risk Plan: Visual Ambition Does Not Damage Reliability

| Risk | Mitigation |
|------|-----------|
| 3D performance on mobile | Simplified geometry, instanced meshes, 2D fallback |
| WebGL unavailable | Automatic 2D fallback with full functionality |
| 3D/2D desync | Single Zustand store drives both views |
| Scope creep | MVP is 2D-first; 3D is differentiator, not blocker |
| Demo failure | Demo mode with pre-seeded data; 2D fallback for demo |

---

## N. Open Decisions Requiring Hasnain's Approval

| # | Decision | Options | Recommendation | Reason |
|---|----------|---------|----------------|--------|
| 1 | Cancellation policy | Free, penalty, no-show fee | Free cancellation up to 2 hours before | Standard for MVP; no payment processing |
| 2 | Reservation duration | Fixed (2h), variable, per-restaurant | Per-restaurant configurable, default 2h | Flexibility without complexity |
| 3 | Walk-in support | Yes, No | No for MVP | Reservation-only keeps scope manageable |
| 4 | Multi-restaurant | Single, Multi-tenant | Single for MVP, schema supports multi | Schema has `restaurant_memberships`; UI can be added later |
| 5 | Real-time updates | Supabase Realtime, Polling | **Polling is the required fallback.** Realtime is optional for correctness. | Realtime adds complexity; polling is simpler and sufficient for MVP. Realtime can be added as an enhancement. |
| 6 | OAuth providers | Google, Facebook, Apple | **Google OAuth is optional/configured-only.** Email/password is required. | Email/password covers all users; Google OAuth is a convenience, not a requirement. |
| 7 | Database backup retention | 7 days, 30 days | 30 days (Supabase Pro) | Point-in-time recovery is valuable |
| 8 | 3D complexity in MVP | Full 3D, Basic 3D, 2D only | Basic 3D (states + selection) | Proves 3D value without overcommitting |
| 9 | Email confirmations | Stub, SendGrid, Resend | Stub for MVP, Resend for production | Resend is simple and cost-effective |
| 10 | Floor editor in MVP | Yes, No | No — differentiator scope | Drag-and-compose is complex; add after core is solid |
| 11 | Paid services for MVP | Yes, No | **No paid service is required for the MVP.** | Supabase free tier, Vercel free tier, and GitHub Actions free tier are sufficient for MVP development and initial deployment. |

---

## O. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation | Earliest Observation |
|------|-----------|--------|------------|---------------------|
| 3D performance on low-end devices | Medium | High | Instanced meshes, LOD, 2D fallback | M8 benchmark |
| WebGL unavailable on target devices | Medium | Medium | Automatic 2D fallback | M8 testing |
| RLS policy complexity leads to bugs | Medium | High | Thorough integration tests, policy review | M2 review |
| Timezone edge cases (DST, overnight) | Medium | Medium | Comprehensive timezone tests, IANA names | M4 testing |
| Advisory lock contention under load | Low | Medium | Lock per restaurant, not per table | M5 load test |
| Exclusion constraint performance | Low | Medium | GiST index is efficient; benchmark | M2 benchmark |
| Scope creep from feature requests | High | High | Strict MVP scope, future scope documented | Ongoing |
| Team coordination overhead | Medium | Medium | Clear ownership, non-overlapping files | Ongoing |
| Supabase free tier limits | Low | Medium | Monitor usage, upgrade before limits | M2 monitoring |
| 3D/2D synchronization bugs | Medium | High | Single store drives both views | M8 testing |

---

## P. Change Log Compared with the Previous Plan

| Section | Previous Plan | This Plan | Reason for Change |
|---------|--------------|-----------|-------------------|
| Product scope | Basic reservation system | Premium 3D-first platform | Owner's upgrade request |
| 3D | Not present | Full 3D architecture (Section J) | Core differentiator |
| Design system | Not present | Complete design system (Section B, D) | Premium positioning |
| Screens | 8 screens | 36 screens (Section G) | Full product coverage |
| Data model | 8 tables | 14 tables (Section H) | Added holds, audit, notifications, sections, memberships |
| Security | Basic RLS | Complete security model (Section I) | Production readiness |
| Team | 5 roles | 10 roles (Section L) | Specialized 3D, presentation, demo roles |
| Demo | Basic script | Full demo plan (Section M) | Presentation readiness |
| Advanced features | Not evaluated | MVP/Differentiator/Future (Sections D, E, F) | Realistic scope management |
| Competitive strategy | Not present | Full strategy (Section M) | Differentiation |
| Milestones | M0–M9 | M0–M10 (Section K) | Added 3D, accessibility, demo milestones |
| Architecture | Basic Next.js + Supabase | Layered architecture with 3D (Section J) | 3D is core, not optional |
| Accessibility | WCAG 2.1 AA | WCAG 2.2 AA | Updated standard |
| Open decisions | 7 decisions | 11 decisions (Section N) | Added 3D, email, floor editor, paid services decisions |
| Git status rule | Must be empty | Report and reject only unexpected changes | Owner correction v3.1 |
| Security scan | Unix-only grep | Cross-platform npm script | Owner correction v3.1 |
| Auth | Email/password + OAuth | Email/password required, OAuth optional | Owner correction v3.1 |
| Concurrency test | Informal | Precise N>=2 parallel test definition | Owner correction v3.1 |
| RLS tests | Informal | Explicit acceptance tests | Owner correction v3.1 |
| Realtime | Required | Optional; polling is required fallback | Owner correction v3.1 |
| Paid services | Not addressed | Confirmed none required for MVP | Owner correction v3.1 |
| Requirement markers | Not present | All marked required/optional/future | Owner correction v3.1 |
| Approved Baseline | Not present | Final section added | Owner correction v3.1 |

---

## Verification Commands

Every completed task must pass:

```bash
npm run typecheck
npm test
npm run security:scan
git status --short
```

### Git Status Rule

Report `git status --short` output. **Reject only unexpected changes outside the task scope.** Expected changes are those files listed in the task's file scope. Any untracked or modified files outside that scope are rejected.

### Critical Acceptance Criteria

1. **Exactly one winner for concurrent same-table booking:** N >= 2 parallel `POST /api/reservations` requests for the same physical table and identical half-open `[start, end)` interval → exactly 1 returns 201, all others return 409. No orphan reservation or assignment rows remain after the test.

2. **No conflicting reservation rows:** After any booking, `SELECT * FROM reservation_tables` shows no overlapping `tstzrange` for the same `table_id`.

3. **Cancellation frees tables:** After `PATCH /api/reservations/[id]` with `status: cancelled`, the tables are immediately available for new bookings.

4. **3D and 2D selection remain consistent:** Selecting a table in 3D updates the 2D view and vice versa.

5. **Keyboard users can complete booking:** Full booking flow completable with keyboard only (Tab, Enter, Space, Escape).

6. **App remains usable without WebGL:** With WebGL disabled, the 2D floor view provides full functionality.

7. **RLS: Guest isolation:** A guest cannot read or modify another guest's reservations. Test: User A creates a reservation; User B's `GET /api/reservations` does not include it.

8. **RLS: Role escalation prevention:** A user cannot modify their own role in `restaurant_memberships`. Test: Attempt to update own role from 'staff' to 'owner' → rejected by RLS.

9. **RLS: Restaurant isolation:** A user belonging to Restaurant A cannot read or modify Restaurant B's data. Test: User with membership in Restaurant A queries Restaurant B's tables → returns empty or 403.

10. **RLS: Manager/Owner permissions:** A manager can create/update/delete tables and groups for their restaurant. Test: Manager creates a table → succeeds; Non-manager attempts same → rejected.

11. **RLS: Unauthenticated write rejection:** An unauthenticated request to `POST /api/reservations` returns 401. Test: No auth cookie → 401 Unauthorized.

12. **Email/password authentication works:** User can sign up and log in with email and password. Test: `POST /api/auth/signup` → 201; `POST /api/auth/login` → 200 with valid credentials, 401 with invalid.

13. **Google OAuth is optional:** When `SUPABASE_AUTH_GOOGLE_CLIENT_ID` is not configured, the login page shows "Google sign-in pending" and email/password works normally. Test: No OAuth env vars → email/password login succeeds; Google button shows "pending" label.

14. **Polling fallback works without Realtime:** Staff dashboard updates reservation states via polling when Realtime is not configured. Test: Disable Realtime → polling fetches updates within 5 seconds.

15. **No paid service required:** MVP runs entirely on free tiers (Supabase free, Vercel free, GitHub Actions free). Test: Deploy with free-tier credentials → all features functional.

---

## Approved Baseline

| Field | Value |
|-------|-------|
| **Plan Version** | 3.1 |
| **MVP Scope** | Complete reservation system with 2D floor view, email/password auth, database-level double-booking prevention, RLS security, accessibility (WCAG 2.2 AA), and core testing. 3D floor preview is optional/differentiator. |
| **Required Technologies** | Next.js 15, TypeScript (strict), Tailwind CSS 4, Supabase (PostgreSQL, Auth, RLS), Zod, TanStack Query, Zustand, Vitest, Playwright |
| **Required Acceptance Gates** | `npm run typecheck` passes; `npm test` passes; `npm run security:scan` passes; `git status --short` reported with no unexpected changes; all 15 critical acceptance criteria pass |
| **Open Decisions** | 11 decisions documented in Section N (cancellation policy, reservation duration, walk-in support, multi-restaurant, real-time strategy, OAuth providers, backup retention, 3D complexity, email confirmations, floor editor, paid services) |
| **First Implementation Task** | M1: Repository Foundation and Design System — Set up Next.js project with TypeScript, Tailwind, Supabase client, CI pipeline, and design tokens. Owner: Implementer. |

---

*Plan version: 3.1 — Composable Floor Premium 3D-First Platform*
*Last updated: 2026-09-30*
*Author: Team HJ Planner OpenCode*
*Status: Approved Baseline*
