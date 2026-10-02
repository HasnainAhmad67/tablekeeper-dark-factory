-- ============================================
-- 006: Acceptance Tests
-- ============================================
-- M2 acceptance tests are implemented in:
--
--   tests/database/constraints.test.ts
--   tests/database/rls.test.ts
--   tests/database/concurrency.test.ts
--
-- This migration intentionally creates no database function.
-- Database acceptance tests must run from the test runner with:
--   - separate authenticated JWT clients;
--   - service-role access only for setup and cleanup;
--   - real assertions against the hosted test project.
--
-- Do not expose test helpers as authenticated RPC functions.
-- ============================================

DO $migration_note$
BEGIN
  RAISE NOTICE
    'M2 acceptance tests run from tests/database; no test RPC was created.';
END;
$migration_note$;