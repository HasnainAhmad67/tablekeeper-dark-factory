import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  createServiceClient,
  createTestUserWithRetry,
  deleteTestUser,
  testId,
  cleanupByIdempotencyKeys,
  SEED,
} from './helpers';

/**
 * Concurrency Acceptance Test
 *
 * Verifies the core safety invariant: N >= 2 parallel booking requests for the
 * same physical table and identical half-open [start, end) interval produce
 * exactly one confirmed reservation. All other requests fail with a conflict
 * (SQLSTATE 23P01) and leave no orphan reservation or assignment rows.
 *
 * The booking path exercised here is the `create_reservation` RPC — the same
 * atomic, exclusion-constrained path the POST /api/reservations route calls.
 * It requires an authenticated caller, so these tests create a real user via
 * the auth API rather than using the service-role key (whose auth.uid() is
 * NULL and is rejected by the RPC).
 *
 * Prerequisites:
 *   - Supabase project reachable with migrations 001-006 applied
 *   - Environment variables set (see .env.example)
 *
 * These tests FAIL (do not skip) when the database is unavailable.
 */

const client = createServiceClient();

// Test data IDs for cleanup
const testIds: string[] = [];
const createdUsers: string[] = [];

beforeAll(async () => {
  // Verify database connection
  const { error } = await client.from('restaurants').select('id').limit(1);
  if (error) {
    throw new Error(`Database connection failed: ${error.message}`);
  }
});

describe('concurrency acceptance', () => {
  it('allows exactly one of N parallel booking requests for the same table to succeed', async () => {
    const { client: userClient, userId } = await createTestUserWithRetry();
    createdUsers.push(userId);

    const N = 3;
    const keys = Array.from({ length: N }, (_, i) => testId(`test-concurrent-${i}`));
    testIds.push(...keys);

    // Fire N identical booking requests for the same table and interval,
    // each with a distinct idempotency key, as concurrently as possible.
    const results = await Promise.all(
      keys.map((key) =>
        userClient.rpc('create_reservation', {
          p_restaurant_id: SEED.restaurantA,
          p_table_ids: [SEED.tableT1],
          p_party_size: 2,
          p_starts_at: '2026-10-25T18:00:00Z',
          p_ends_at: '2026-10-25T20:00:00Z',
          p_idempotency_key: key,
        }),
      ),
    );

    // supabase-js rpc() RESOLVES even when the database returns an error, so
    // success must be detected by the absence of `error`, not by promise state.
    const successes = results.filter((r) => r.error === null && r.data);
    const conflicts = results.filter((r) => r.error?.code === '23P01');

    expect(successes.length).toBe(1);
    expect(conflicts.length).toBe(N - 1);

    // Exactly one reservation row survives for the N idempotency keys.
    const { data: reservations, error: resError } = await client
      .from('reservations')
      .select('id')
      .in('idempotency_key', keys);
    expect(resError).toBeNull();
    expect(reservations).toHaveLength(1);

    // The winner has exactly one active assignment; no orphans remain.
    const winnerId = reservations![0].id;
    const { data: assignments, error: assignError } = await client
      .from('reservation_tables')
      .select('reservation_id')
      .eq('reservation_id', winnerId)
      .eq('status', 'active');
    expect(assignError).toBeNull();
    expect(assignments).toHaveLength(1);
  });

  it('repeated attempts with the same idempotency key return the same reservation without duplicating bookings', async () => {
    const { client: userClient, userId } = await createTestUserWithRetry();
    createdUsers.push(userId);

    const key = testId('test-idempotent');
    testIds.push(key);

    // Unique, non-conflicting interval for this run. The DATE is derived
    // from the current timestamp (successive days never collide with seed
    // data or with rows left behind by earlier runs), while the TIME-OF-DAY
    // is pinned to 17:00-19:00 UTC — the same canonical valid window the
    // hours-gate suite uses. Restaurant A (America/New_York, seed migration
    // 005) seats 11:00-22:00 local on every weekday (23:00 Fri/Sat), and
    // this window lands at 12:00-14:00 EST / 13:00-15:00 EDT — inside
    // operating hours regardless of when the suite runs or the DST state.
    // The previous form (start = now + 30 days at the current time-of-day)
    // failed with SQLSTATE 22023 whenever the run fell outside that band,
    // e.g. a 15:02 UTC start = 10:02 local, before opening. T2 belongs to
    // restaurant A.
    const startMs = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days out
    const startsAt = new Date(startMs);
    startsAt.setUTCHours(17, 0, 0, 0);
    const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
    const startsAtIso = startsAt.toISOString();
    const endsAtIso = endsAt.toISOString();

    const payload = {
      p_restaurant_id: SEED.restaurantA,
      p_table_ids: [SEED.tableT2],
      p_party_size: 2,
      p_starts_at: startsAtIso,
      p_ends_at: endsAtIso,
      p_idempotency_key: key,
    };

    const first = await userClient.rpc('create_reservation', payload);
    expect(first.error).toBeNull();
    expect(first.data).toBeTruthy();

    // A retry with the same key must return the original reservation, not a new one.
    const second = await userClient.rpc('create_reservation', payload);
    expect(second.error).toBeNull();
    expect(second.data).toBe(first.data);

    const { data: reservations, error: resError } = await client
      .from('reservations')
      .select('id')
      .eq('idempotency_key', key);
    expect(resError).toBeNull();
    expect(reservations).toHaveLength(1);

    const { data: assignments, error: assignError } = await client
      .from('reservation_tables')
      .select('reservation_id')
      .eq('reservation_id', first.data);
    expect(assignError).toBeNull();
    expect(assignments).toHaveLength(1);
  });

  it('leaves no orphan assignment for the losing reservation on conflict', async () => {
    const idempotencyKey = testId('test-orphan-assignment');
    testIds.push(idempotencyKey);

    // Two reservations for the same table and interval.
    const { data: res1, error: res1Error } = await client
      .from('reservations')
      .insert({
        restaurant_id: SEED.restaurantA,
        user_id: SEED.guest,
        party_size: 2,
        starts_at: '2026-10-28T18:00:00Z',
        ends_at: '2026-10-28T20:00:00Z',
        status: 'confirmed',
        idempotency_key: `${idempotencyKey}-1`,
      })
      .select('id')
      .single();

    expect(res1Error).toBeNull();

    const { data: res2, error: res2Error } = await client
      .from('reservations')
      .insert({
        restaurant_id: SEED.restaurantA,
        user_id: SEED.guest,
        party_size: 2,
        starts_at: '2026-10-28T18:00:00Z',
        ends_at: '2026-10-28T20:00:00Z',
        status: 'confirmed',
        idempotency_key: `${idempotencyKey}-2`,
      })
      .select('id')
      .single();

    expect(res2Error).toBeNull();

    // First reservation holds the table.
    const { error: assign1Error } = await client.from('reservation_tables').insert({
      reservation_id: res1!.id,
      restaurant_id: SEED.restaurantA,
      table_id: SEED.tableT1,
      starts_at: '2026-10-28T18:00:00Z',
      ends_at: '2026-10-28T20:00:00Z',
      status: 'active',
    });
    expect(assign1Error).toBeNull();

    // Second reservation's overlapping assignment must be rejected.
    const { error: assign2Error } = await client.from('reservation_tables').insert({
      reservation_id: res2!.id,
      restaurant_id: SEED.restaurantA,
      table_id: SEED.tableT1,
      starts_at: '2026-10-28T18:00:00Z',
      ends_at: '2026-10-28T20:00:00Z',
      status: 'active',
    });
    expect(assign2Error).toBeDefined();

    // The losing reservation must have no assignment rows.
    const { data: assignments, error: fetchError } = await client
      .from('reservation_tables')
      .select('reservation_id')
      .eq('reservation_id', res2!.id);

    expect(fetchError).toBeNull();
    expect(assignments).toHaveLength(0);
  });

  it('results in exactly one active assignment for a confirmed reservation', async () => {
    const idempotencyKey = testId('test-single-active');
    testIds.push(idempotencyKey);

    const { data: reservation, error: resError } = await client
      .from('reservations')
      .insert({
        restaurant_id: SEED.restaurantA,
        user_id: SEED.guest,
        party_size: 2,
        starts_at: '2026-10-29T18:00:00Z',
        ends_at: '2026-10-29T20:00:00Z',
        status: 'confirmed',
        idempotency_key: idempotencyKey,
      })
      .select('id')
      .single();

    expect(resError).toBeNull();

    const { error: assignError } = await client.from('reservation_tables').insert({
      reservation_id: reservation!.id,
      restaurant_id: SEED.restaurantA,
      table_id: SEED.tableT1,
      starts_at: '2026-10-29T18:00:00Z',
      ends_at: '2026-10-29T20:00:00Z',
      status: 'active',
    });
    expect(assignError).toBeNull();

    const { data: assignments, error: fetchError } = await client
      .from('reservation_tables')
      .select('reservation_id')
      .eq('reservation_id', reservation!.id)
      .eq('status', 'active');

    expect(fetchError).toBeNull();
    expect(assignments).toHaveLength(1);
  });
});

// Cleanup after all tests
afterAll(async () => {
  await cleanupByIdempotencyKeys(client, testIds);
  for (const userId of createdUsers) {
    await deleteTestUser(userId);
  }
});
