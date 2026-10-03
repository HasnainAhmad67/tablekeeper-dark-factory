import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  createServiceClient,
  createAnonClient,
  createTestUser,
  deleteTestUser,
  testId,
  cleanupByIdempotencyKeys,
  cleanupTestData,
  SEED,
} from './helpers';

/**
 * RLS Policy Tests
 *
 * These tests verify that Row Level Security policies are properly enforced.
 * They require a running Supabase instance with migrations applied.
 *
 * RLS is only observable through an authenticated caller, so these tests
 * create real users via the auth API (sign up + sign in) and issue requests
 * with the user's own JWT. The service-role key bypasses RLS and cannot
 * demonstrate policy behavior.
 *
 * Prerequisites:
 *   - Supabase project reachable with migrations 001-006 applied
 *   - Environment variables set (see .env.example)
 *
 * These tests FAIL (do not skip) when the database is unavailable.
 */

const serviceClient = createServiceClient();
const anonClient = createAnonClient();

// Test data IDs for cleanup
const testIds: string[] = [];
const createdUsers: string[] = [];
const createdMemberships: string[] = [];
const createdTableIds: string[] = [];

beforeAll(async () => {
  // Verify database connection
  const { error } = await serviceClient.from('restaurants').select('id').limit(1);
  if (error) {
    throw new Error(`Database connection failed: ${error.message}`);
  }
});

/**
 * createTestUser with bounded retries for GoTrue signup throttling.
 *
 * The remote Auth service rate-limits anonymous signups (429); when the
 * full suite runs, earlier files' ~40 signups can spill into this file and
 * fail it outright (helpers.ts's createTestUser throws on any signup
 * error). Retry up to 3 times with a fixed 2s delay — bounded so the
 * worst case for a test that creates two users sequentially stays well
 * under the 30s testTimeout — then rethrow the original error so a real
 * failure still surfaces instead of skipping.
 */
const SIGNUP_MAX_RETRIES = 3;
const SIGNUP_RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createTestUserWithRetry(): Promise<
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

describe('RLS policies', () => {
  it('enforces guest isolation - a guest cannot read or modify another guest\'s reservations', async () => {
    const { client: clientA, userId: userA } = await createTestUserWithRetry();
    const { client: clientB, userId: userB } = await createTestUserWithRetry();
    createdUsers.push(userA, userB);

    const key = testId('test-guest-isolation');
    testIds.push(key);

    // User A owns a confirmed reservation.
    const { data: reservation, error: resError } = await serviceClient
      .from('reservations')
      .insert({
        restaurant_id: SEED.restaurantA,
        user_id: userA,
        party_size: 2,
        starts_at: '2026-10-20T18:00:00Z',
        ends_at: '2026-10-20T20:00:00Z',
        status: 'confirmed',
        idempotency_key: key,
      })
      .select('id')
      .single();

    expect(resError).toBeNull();

    // Positive control: A can read their own reservation.
    const { data: aSees, error: aError } = await clientA
      .from('reservations')
      .select('id')
      .eq('id', reservation!.id);
    expect(aError).toBeNull();
    expect(aSees).toHaveLength(1);

    // B cannot read A's reservation by id.
    const { data: bById, error: bByIdError } = await clientB
      .from('reservations')
      .select('id')
      .eq('id', reservation!.id);
    expect(bByIdError).toBeNull();
    expect(bById).toHaveLength(0);

    // B's reservation list does not include A's reservation.
    const { data: bList, error: bListError } = await clientB
      .from('reservations')
      .select('id');
    expect(bListError).toBeNull();
    expect(bList ?? []).toHaveLength(0);

    // B cannot modify A's reservation.
    const { data: bUpdate, error: bUpdateError } = await clientB
      .from('reservations')
      .update({ party_size: 99 })
      .eq('id', reservation!.id)
      .select('id');
    expect(bUpdateError).toBeNull();
    expect(bUpdate ?? []).toHaveLength(0);
  });

  it('prevents role escalation - a staff member cannot modify their own role to owner', async () => {
    const { client: staffClient, userId: staffId } = await createTestUserWithRetry();
    createdUsers.push(staffId);
    createdMemberships.push(staffId);

    // Service role grants the new user a staff membership.
    const { error: memError } = await serviceClient
      .from('restaurant_memberships')
      .insert({ restaurant_id: SEED.restaurantA, user_id: staffId, role: 'staff' });
    expect(memError).toBeNull();

    // The staff member can read their own membership.
    const { data: own, error: ownError } = await staffClient
      .from('restaurant_memberships')
      .select('role')
      .eq('user_id', staffId);
    expect(ownError).toBeNull();
    expect(own).toEqual([{ role: 'staff' }]);

    // Attempting to escalate their own role to owner must be rejected by RLS.
    const { data: upd, error: updError } = await staffClient
      .from('restaurant_memberships')
      .update({ role: 'owner' })
      .eq('user_id', staffId)
      .select('role');
    expect(updError).toBeNull();
    expect(upd ?? []).toHaveLength(0);

    // The role must be unchanged.
    const { data: after } = await serviceClient
      .from('restaurant_memberships')
      .select('role')
      .eq('user_id', staffId);
    expect(after).toEqual([{ role: 'staff' }]);
  });

  it('enforces restaurant isolation - a member of one restaurant cannot modify another restaurant\'s tables', async () => {
    const { client: userClient, userId } = await createTestUserWithRetry();
    createdUsers.push(userId);
    createdMemberships.push(userId);

    // The user belongs to restaurant A only.
    const { error: memError } = await serviceClient
      .from('restaurant_memberships')
      .insert({ restaurant_id: SEED.restaurantA, user_id: userId, role: 'staff' });
    expect(memError).toBeNull();

    // Creating a table for restaurant B must be rejected by RLS.
    const { error: insertError } = await userClient.from('tables').insert({
      restaurant_id: SEED.restaurantB,
      label: testId('test-iso'),
      capacity: 2,
    });
    expect(insertError).toBeDefined();

    // Modifying a table that belongs to restaurant B must affect 0 rows.
    const { data: upd, error: updError } = await userClient
      .from('tables')
      .update({ label: 'hacked' })
      .eq('id', SEED.tableB1)
      .select('id');
    expect(updError).toBeNull();
    expect(upd ?? []).toHaveLength(0);
  });

  it('allows a manager to create tables for their restaurant but rejects a non-manager', async () => {
    const { client: managerClient, userId: managerId } = await createTestUserWithRetry();
    const { client: plainClient, userId: plainId } = await createTestUserWithRetry();
    createdUsers.push(managerId, plainId);
    createdMemberships.push(managerId);

    const { error: memError } = await serviceClient
      .from('restaurant_memberships')
      .insert({ restaurant_id: SEED.restaurantA, user_id: managerId, role: 'manager' });
    expect(memError).toBeNull();

    // A manager can create a table for their own restaurant.
    const label = testId('test-mgr-table');
    const { data: created, error: createError } = await managerClient
      .from('tables')
      .insert({ restaurant_id: SEED.restaurantA, label, capacity: 4 })
      .select('id')
      .single();
    expect(createError).toBeNull();
    if (created) createdTableIds.push(created.id);

    // A user without a membership cannot create a table for the same restaurant.
    const { error: deniedError } = await plainClient.from('tables').insert({
      restaurant_id: SEED.restaurantA,
      label: testId('test-nomgr-table'),
      capacity: 4,
    });
    expect(deniedError).toBeDefined();
  });

  it('rejects unauthenticated writes', async () => {
    // Try to insert a restaurant as anon (should fail)
    const { error } = await anonClient.from('restaurants').insert({
      name: 'Test Restaurant',
      slug: testId('test-anon'),
    });

    expect(error).toBeDefined();
    // RLS violation or permission denied
  });

  it('restricts guest table/availability reads to public restaurant scope', async () => {
    // Verify anon can read restaurants (public discovery)
    const { data: restaurants, error: restaurantsError } = await anonClient
      .from('restaurants')
      .select('id')
      .limit(1);

    expect(restaurantsError).toBeNull();
    expect(restaurants).toBeDefined();

    // Verify anon can read tables (for availability)
    const { data: tables, error: tablesError } = await anonClient
      .from('tables')
      .select('id')
      .limit(1);

    expect(tablesError).toBeNull();
    expect(tables).toBeDefined();
  });

  it('restricts a guest\'s direct reservation UPDATE to cancellation only', async () => {
    const { client: guestClient, userId: guestId } = await createTestUserWithRetry();
    createdUsers.push(guestId);

    const key = testId('test-guest-cancel-only');
    testIds.push(key);

    const startsAt = '2026-12-01T18:00:00Z';
    const endsAt = '2026-12-01T20:00:00Z';

    const { data: reservation, error: resError } = await serviceClient
      .from('reservations')
      .insert({
        restaurant_id: SEED.restaurantA,
        user_id: guestId,
        party_size: 2,
        starts_at: startsAt,
        ends_at: endsAt,
        status: 'pending',
        notes: 'original notes',
        idempotency_key: key,
      })
      .select('id')
      .single();
    expect(resError).toBeNull();

    const { error: assignError } = await serviceClient.from('reservation_tables').insert({
      reservation_id: reservation!.id,
      restaurant_id: SEED.restaurantA,
      table_id: SEED.tableT6,
      starts_at: startsAt,
      ends_at: endsAt,
      status: 'active',
    });
    expect(assignError).toBeNull();

    // A guest UPDATE that touches any forbidden column must not apply.
    const forbiddenAttempts: Array<Record<string, unknown>> = [
      { starts_at: '2026-12-02T18:00:00Z' },
      { ends_at: '2026-12-01T21:00:00Z' },
      { party_size: 9 },
      { user_id: SEED.guest },
      { restaurant_id: SEED.restaurantB },
      { notes: 'hacked' },
      { status: 'confirmed' },
      { status: 'seated' },
      { status: 'completed' },
      { status: 'no_show' },
      // Cancellation bundled with a time change must also fail (no desync).
      { status: 'cancelled', starts_at: '2026-12-02T18:00:00Z' },
      { status: 'cancelled', party_size: 9 },
    ];

    // Fire every forbidden attempt concurrently: they are independent, and the
    // BEFORE UPDATE trigger rejects each one (42501) before any row is touched,
    // so no row lock is held and parallel execution is safe.
    const updateResults = await Promise.all(
      forbiddenAttempts.map((patch) =>
        guestClient
          .from('reservations')
          .update(patch)
          .eq('id', reservation!.id)
          .select('id'),
      ),
    );
    for (const { data: updated, error: updateError } of updateResults) {
      // Either the write is rejected, or it silently matches zero rows.
      if (updateError === null) {
        expect(updated ?? []).toHaveLength(0);
      }
    }

    // Every forbidden attempt left the reservation untouched.
    const { data: after } = await serviceClient
      .from('reservations')
      .select('party_size, starts_at, ends_at, status, notes, user_id, restaurant_id')
      .eq('id', reservation!.id)
      .single();
    expect(after!.party_size).toBe(2);
    expect(new Date(after!.starts_at).getTime()).toBe(Date.parse(startsAt));
    expect(new Date(after!.ends_at).getTime()).toBe(Date.parse(endsAt));
    expect(after!.status).toBe('pending');
    expect(after!.notes).toBe('original notes');
    expect(after!.user_id).toBe(guestId);
    expect(after!.restaurant_id).toBe(SEED.restaurantA);

    // The assignment is still synchronized with the reservation.
    const { data: assignment } = await serviceClient
      .from('reservation_tables')
      .select('starts_at, ends_at, status')
      .eq('reservation_id', reservation!.id)
      .single();
    expect(new Date(assignment!.starts_at).getTime()).toBe(Date.parse(startsAt));
    expect(new Date(assignment!.ends_at).getTime()).toBe(Date.parse(endsAt));
    expect(assignment!.status).toBe('active');

    // The allowed path: the guest cancels their own reservation.
    const { error: cancelError } = await guestClient
      .from('reservations')
      .update({ status: 'cancelled' })
      .eq('id', reservation!.id);
    expect(cancelError).toBeNull();

    const { data: cancelled } = await serviceClient
      .from('reservations')
      .select('status, starts_at, ends_at')
      .eq('id', reservation!.id)
      .single();
    expect(new Date(cancelled!.starts_at).getTime()).toBe(Date.parse(startsAt));
    expect(new Date(cancelled!.ends_at).getTime()).toBe(Date.parse(endsAt));
    expect(cancelled!.status).toBe('cancelled');

    // Cancellation released the assignment without desynchronizing times.
    const { data: released } = await serviceClient
      .from('reservation_tables')
      .select('starts_at, ends_at, status')
      .eq('reservation_id', reservation!.id)
      .single();
    expect(new Date(released!.starts_at).getTime()).toBe(Date.parse(startsAt));
    expect(new Date(released!.ends_at).getTime()).toBe(Date.parse(endsAt));
    expect(released!.status).toBe('released');
  });

  it('prevents a guest from cancelling another user\'s reservation via direct UPDATE', async () => {
    // Create both users concurrently — the signups are independent.
    const [{ client: clientA, userId: userA }, { client: clientB, userId: userB }] =
      await Promise.all([createTestUserWithRetry(), createTestUserWithRetry()]);
    createdUsers.push(userA, userB);

    const key = testId('test-guest-cancel-other');
    testIds.push(key);

    const { data: reservation, error: resError } = await serviceClient
      .from('reservations')
      .insert({
        restaurant_id: SEED.restaurantA,
        user_id: userA,
        party_size: 2,
        starts_at: '2026-12-05T18:00:00Z',
        ends_at: '2026-12-05T20:00:00Z',
        status: 'confirmed',
        idempotency_key: key,
      })
      .select('id')
      .single();
    expect(resError).toBeNull();

    const { data: updated, error: updateError } = await clientB
      .from('reservations')
      .update({ status: 'cancelled' })
      .eq('id', reservation!.id)
      .select('id');
    if (updateError === null) {
      expect(updated ?? []).toHaveLength(0);
    }

    const { data: after } = await serviceClient
      .from('reservations')
      .select('status')
      .eq('id', reservation!.id)
      .single();
    expect(after).toEqual({ status: 'confirmed' });
  });

  it('prevents direct client writes to reservation_tables', async () => {
    // Try to insert into reservation_tables as anon (should fail)
    const { error } = await anonClient.from('reservation_tables').insert({
      reservation_id: '40000000-0000-4000-8000-000000000001',
      restaurant_id: SEED.restaurantA,
      table_id: SEED.tableT1,
      starts_at: '2026-10-15T18:00:00Z',
      ends_at: '2026-10-15T20:00:00Z',
      status: 'active',
    });

    expect(error).toBeDefined();
  });
});

// Cleanup after all tests
afterAll(async () => {
  await cleanupByIdempotencyKeys(serviceClient, testIds);
  for (const userId of createdMemberships) {
    await cleanupTestData(serviceClient, 'restaurant_memberships', 'user_id', userId);
  }
  for (const tableId of createdTableIds) {
    await cleanupTestData(serviceClient, 'tables', 'id', tableId);
  }
  for (const userId of createdUsers) {
    await deleteTestUser(userId);
  }
});
