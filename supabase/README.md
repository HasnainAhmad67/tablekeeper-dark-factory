# Supabase Local Development

This directory contains the Supabase local development configuration and database migrations for the Composable Floor project.

## Local-Only Test Fixtures

**IMPORTANT: All seed data in this project is for LOCAL DEVELOPMENT AND TESTING ONLY.**

### Seed Passwords (LOCAL-ONLY)

The following test accounts are created by `005_seed_data.sql`:

| Email | Password | Role |
|-------|----------|------|
| `owner@example.com` | `LocalOwner123!` | Owner |
| `manager@example.com` | `LocalManager123!` | Manager |
| `staff@example.com` | `LocalStaff123!` | Staff |
| `guest@example.com` | `LocalGuest123!` | Guest |

**These passwords are local-only test values. They must never be used in production environments.**

### Seed Restaurants

1. **The Test Kitchen** (`test-kitchen`) - American cuisine, price range 2
2. **The Second Test Bistro** (`second-test-bistro`) - French cuisine, price range 3

## Environment Variables

Required environment variables (see `.env.example`):

- `NEXT_PUBLIC_SUPABASE_URL` - Supabase project URL (public)
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` - Supabase publishable/anon key (public)
- `SUPABASE_SECRET_KEY` - Supabase secret key (server-only)

## Migrations

Migrations are applied in order:

1. `001_initial_schema.sql` - Core schema (tables, constraints, indexes)
2. `002_rls_policies.sql` - RLS policies for all tables
3. `003_triggers.sql` - Trigger to release assignments on reservation status change
4. `004_functions.sql` - Secure booking RPC function
5. `005_seed_data.sql` - Local-only seed data
6. `006_acceptance_tests.sql` - Database acceptance tests

## Local Development Setup

### Prerequisites

- [Supabase CLI](https://supabase.com/docs/guides/local-development)
- [Docker](https://www.docker.com/)

### Setup Commands

```bash
# Start Supabase local development
supabase start

# Reset database and apply all migrations
supabase db reset

# Run tests
npm test
```

## Database Schema

### Core Tables

- `restaurants` - Restaurant entities
- `profiles` - User profiles (linked to auth.users)
- `restaurant_memberships` - User-restaurant relationships with roles
- `floor_sections` - Named areas within a restaurant
- `tables` - Physical tables with capacity and position
- `table_groups` - Groups of tables that can be combined
- `table_group_members` - Many-to-many relationship between groups and tables
- `operating_hours` - Restaurant operating hours by day of week
- `reservations` - Reservation records
- `reservation_tables` - Table assignments for reservations

### Key Constraints

- **Exclusion constraint**: Prevents overlapping active table assignments using `tstzrange`
- **Composite foreign keys**: Enforce cross-restaurant consistency
- **Check constraints**: Validate data integrity (e.g., `ends_at > starts_at`)

### RLS Policies

All tables have Row Level Security enabled with policies for:
- Guest isolation
- Role escalation prevention
- Restaurant isolation
- Manager/owner permissions
- Unauthenticated write rejection

## Testing

### Database Tests

Database acceptance tests are in `006_acceptance_tests.sql` and can be run via:

```sql
SELECT * FROM public.run_m2_acceptance_tests();
```

### Application Tests

Application tests are in `tests/database/` and can be run via:

```bash
npm test
```

## Security Notes

- All SECURITY DEFINER functions use `SET search_path = ''` and fully qualified object names
- The booking function validates auth.uid(), restaurant ownership, table ownership, capacity, interval validity, and idempotency
- RLS policies prevent unauthorized access at the database level
- Seed data contains no production credentials
