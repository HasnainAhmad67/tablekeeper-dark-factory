import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Database test helper for M2 acceptance tests.
 *
 * Provides a configured Supabase client for database-level tests.
 * Tests will FAIL (not skip) when the database is unavailable.
 *
 * Required environment variables:
 *   - NEXT_PUBLIC_SUPABASE_URL
 *   - SUPABASE_SECRET_KEY (for service-role operations)
 *   - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (for anon-key operations)
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function isDatabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY && SUPABASE_PUBLISHABLE_KEY);
}

export function requireDatabase(): {
  url: string;
  serviceRoleKey: string;
  publishableKey: string;
} {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      'Database tests require the following environment variables:\n' +
        '  - NEXT_PUBLIC_SUPABASE_URL\n' +
        '  - SUPABASE_SECRET_KEY\n' +
        '  - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\n' +
        '\n' +
        'These tests do NOT skip when the database is unavailable. ' +
        'Run `supabase start` and ensure your .env file is configured.',
    );
  }
  return {
    url: SUPABASE_URL,
    serviceRoleKey: SUPABASE_SECRET_KEY,
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
  };
}

export function createServiceClient(): SupabaseClient {
  const { url, serviceRoleKey } = requireDatabase();
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function createAnonClient(): SupabaseClient {
  const { url, publishableKey } = requireDatabase();
  return createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Deterministic seed fixtures from migration 005.
 *
 * Tests MUST use these valid UUIDs (not placeholder strings) because the
 * hosted schema stores ids as Postgres `uuid` columns, which reject malformed
 * values with SQLSTATE 22P02.
 */
export const SEED = {
  restaurantA: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  restaurantB: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  // Tables for restaurant A
  tableT1: '10000000-0000-4000-8000-000000000001',
  tableT2: '10000000-0000-4000-8000-000000000002',
  tableT3: '10000000-0000-4000-8000-000000000003',
  tableT4: '10000000-0000-4000-8000-000000000004',
  tableT5: '10000000-0000-4000-8000-000000000005',
  tableT6: '10000000-0000-4000-8000-000000000006',
  // Tables for restaurant B
  tableB1: '20000000-0000-4000-8000-000000000001',
  tableB2: '20000000-0000-4000-8000-000000000002',
  tableB3: '20000000-0000-4000-8000-000000000003',
  // Table groups
  groupA: '30000000-0000-4000-8000-000000000001',
  groupB: '30000000-0000-4000-8000-000000000002',
  // Seed users (NOTE: these cannot sign in — see createTestUser)
  owner: '11111111-1111-1111-1111-111111111111',
  manager: '22222222-2222-2222-2222-222222222222',
  staff: '33333333-3333-3333-3333-333333333333',
  guest: '44444444-4444-4444-4444-444444444444',
} as const;

/**
 * Generate a unique identifier for test data isolation.
 */
export function testId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Clean up test data by exact match.
 *
 * Uses `.eq` / `.in` (never `.like`) because several columns are Postgres
 * `uuid` types, and the LIKE operator (`~~`) does not exist for uuid —
 * using it raises "operator does not exist: uuid ~~ unknown".
 */
export async function cleanupTestData(
  client: SupabaseClient,
  table: string,
  column: string,
  value: string | string[],
): Promise<void> {
  const { error } = Array.isArray(value)
    ? await client.from(table).delete().in(column, value)
    : await client.from(table).delete().eq(column, value);
  if (error) {
    console.warn(`Warning: failed to clean up ${table}: ${error.message}`);
  }
}

/**
 * Delete every reservation (and its assignment rows) whose idempotency key
 * starts with one of the given keys. Tests frequently append suffixes to a
 * base key (e.g. "-1", "-2"), so matching is by prefix, not exact equality.
 * Assignments are removed explicitly first so cleanup does not rely on
 * cascade behavior.
 */
export async function cleanupByIdempotencyKeys(
  client: SupabaseClient,
  keys: string[],
): Promise<void> {
  const { data } = await client
    .from('reservations')
    .select('id')
    .or(keys.map((k) => `idempotency_key.like.${k}%`).join(','));
  const ids = (data ?? []).map((r) => r.id);
  if (ids.length === 0) return;
  await cleanupTestData(client, 'reservation_tables', 'reservation_id', ids);
  await cleanupTestData(client, 'reservations', 'id', ids);
}

/**
 * Create a real authenticated test user via the auth API (sign up + sign in).
 *
 * The seed users inserted by migration 005 cannot sign in: GoTrue fails with
 * "Database error querying schema" when it queries those SQL-inserted rows.
 * Fresh users created through the auth API work correctly, so tests that
 * need an authenticated caller create their own user instead.
 *
 * Returns an authenticated client whose requests carry the user's JWT.
 */
export async function createTestUser(): Promise<{
  client: SupabaseClient;
  userId: string;
  email: string;
}> {
  const { url, publishableKey } = requireDatabase();
  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const email = `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = `Test-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
  const { error: signUpError } = await client.auth.signUp({ email, password });
  if (signUpError) {
    throw new Error(`Failed to create test user: ${signUpError.message}`);
  }
  const { data, error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) {
    throw new Error(`Failed to sign in test user: ${signInError.message}`);
  }
  return { client, userId: data.user!.id, email };
}

const SIGNUP_MAX_RETRIES = 3;
const SIGNUP_RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * createTestUser with bounded retries for GoTrue signup throttling.
 *
 * The remote Auth service rate-limits anonymous signups (429): a full-suite
 * run makes ~40 signups, and rapid consecutive runs spill into the next
 * run's signups. Retry up to 3 times with a fixed 2s delay — bounded so the
 * worst case for a test that creates two users sequentially stays well
 * under the 30s testTimeout — then rethrow the original error so a real
 * failure still surfaces instead of skipping. Centralized here so suites
 * stop duplicating the loop inline (rls, group-writes, and hours-api each
 * carried a copy); suites that want no retry keep calling createTestUser.
 */
export async function createTestUserWithRetry(): Promise<
  Awaited<ReturnType<typeof createTestUser>>
> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SIGNUP_MAX_RETRIES + 1; attempt++) {
    try {
      return await createTestUser();
    } catch (err) {
      lastError = err;
      if (attempt > SIGNUP_MAX_RETRIES) {
        break;
      }
      console.warn(
        `createTestUser failed (attempt ${attempt}/${SIGNUP_MAX_RETRIES + 1}), ` +
          `retrying in ${SIGNUP_RETRY_DELAY_MS}ms:`,
        err instanceof Error ? err.message : err,
      );
      await sleep(SIGNUP_RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

/**
 * Delete a test user via the GoTrue admin API (service role).
 * Best-effort: a failure only warns so it never masks a real test result.
 */
export async function deleteTestUser(userId: string): Promise<void> {
  const { url, serviceRoleKey } = requireDatabase();
  const res = await fetch(`${url}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  });
  if (!res.ok) {
    console.warn(`Warning: failed to delete auth user ${userId}: ${res.status}`);
  }
}
