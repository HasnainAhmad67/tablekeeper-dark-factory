import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  cleanupByIdempotencyKeys,
  cleanupTestData,
  createServiceClient,
  createTestUser,
  deleteTestUser,
  SEED,
  testId,
} from './helpers';
import { computeAvailability, type AvailabilityParams, type TableRecord } from '@/server/availability';
import { evaluateOperatingHours, type OperatingHoursRecord } from '@/server/hours';

/**
 * Operating-hours gate acceptance tests (008_operating_hours_gate.sql).
 *
 * Covers the RPC enforcement in `create_reservation` (rejection outside
 * hours, acceptance inside hours, exact closing boundary, idempotency replay
 * returning before the hours check, and no rows after rejection), the
 * availability closed-path with real seed rows, and a TS/SQL semantic
 * cross-check of public.is_within_operating_hours against evaluateOperatingHours.
 *
 * Seeded hours for restaurant A (005_seed_data.sql, America/New_York):
 * day_of_week 0-4 (Sun-Thu) 11:00-22:00, 5-6 (Fri-Sat) 11:00-23:00.
 *
 * Weekday anchors used below (2027-01-01 is a Friday):
 *   Jan 2 Sat, Jan 3 Sun, Jan 4 Mon, Jan 5 Tue, Jan 6 Wed.
 *
 * Prerequisites: migrations 001-008 applied. These tests FAIL (never skip)
 * when the database or the 008 helper is unavailable.
 */

const client = createServiceClient();

// Unique idempotency keys used by this suite, cleaned up after the run.
const keys: string[] = [];
const TEMP_RESTAURANT_ID = '99999999-9999-4999-8999-999999999999';

let userClient!: SupabaseClient;
let userId: string | undefined;
let timeZone!: string;
let hoursRows!: OperatingHoursRecord[];
let tables!: TableRecord[];

async function book(input: { tableId: string; startsAt: string; endsAt: string; key: string }) {
  return userClient.rpc('create_reservation', {
    p_restaurant_id: SEED.restaurantA,
    p_table_ids: [input.tableId],
    p_party_size: 2,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_idempotency_key: input.key,
  });
}

beforeAll(async () => {
  const { error: connectionError } = await client.from('restaurants').select('id').limit(1);
  if (connectionError) {
    throw new Error(`Database connection failed: ${connectionError.message}`);
  }

  // Prerequisite: migration 008 must be applied — fail loudly with an
  // actionable message instead of letting every gate assertion fail obscurely.
  const probe = await client.rpc('is_within_operating_hours', {
    p_restaurant_id: SEED.restaurantA,
    p_starts_at: '2027-01-05T17:00:00Z',
    p_ends_at: '2027-01-05T19:00:00Z',
  });
  if (probe.error || typeof probe.data !== 'boolean') {
    throw new Error(
      'Migration supabase/migrations/008_operating_hours_gate.sql is not applied ' +
        '(or public.is_within_operating_hours is not executable by the service role): ' +
        `${probe.error?.code ?? 'no result'} ${probe.error?.message ?? ''}`.trim() +
        '\nApply it (supabase db push), then re-run these tests.',
    );
  }

  const created = await createTestUser();
  userClient = created.client;
  userId = created.userId;

  const [restaurantResult, hoursResult, tablesResult] = await Promise.all([
    client.from('restaurants').select('timezone').eq('id', SEED.restaurantA).single(),
    client
      .from('operating_hours')
      .select('day_of_week, opens_at, closes_at, is_closed')
      .eq('restaurant_id', SEED.restaurantA),
    client.from('tables').select('id, label, capacity').eq('restaurant_id', SEED.restaurantA),
  ]);
  if (restaurantResult.error || !restaurantResult.data) {
    throw new Error(`Failed to load restaurant timezone: ${restaurantResult.error?.message}`);
  }
  if (hoursResult.error || !hoursResult.data || hoursResult.data.length !== 7) {
    throw new Error(
      `Failed to load 7 operating_hours rows for restaurant A: ${hoursResult.error?.message}` +
        ` (got ${hoursResult.data?.length ?? 'none'})`,
    );
  }
  if (tablesResult.error) {
    throw new Error(`Failed to load tables: ${tablesResult.error.message}`);
  }
  timeZone = restaurantResult.data.timezone;
  hoursRows = hoursResult.data as OperatingHoursRecord[];
  tables = tablesResult.data as TableRecord[];
});

afterAll(async () => {
  if (keys.length > 0) {
    await cleanupByIdempotencyKeys(client, keys);
  }
  await cleanupTestData(client, 'restaurants', 'id', TEMP_RESTAURANT_ID);
  if (userId) {
    await deleteTestUser(userId);
  }
});

describe('create_reservation operating-hours gate (RPC)', () => {
  it('rejects a booking outside operating hours and inserts no rows', async () => {
    const key = testId('hours-outside');
    keys.push(key);
    // Tue 2027-01-05, 02:00-04:00 local — before the 11:00 open.
    const { data, error } = await book({
      tableId: SEED.tableT1,
      startsAt: '2027-01-05T07:00:00Z',
      endsAt: '2027-01-05T09:00:00Z',
      key,
    });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.code).toBe('22023');
    expect(error!.message).toMatch(/outside operating hours/);

    // No reservation row and no assignment row were inserted.
    const { data: reservations } = await client
      .from('reservations')
      .select('id')
      .eq('idempotency_key', key);
    expect(reservations).toHaveLength(0);
    const { data: assignments } = await client
      .from('reservation_tables')
      .select('reservation_id')
      .eq('restaurant_id', SEED.restaurantA)
      .eq('table_id', SEED.tableT1)
      .eq('starts_at', '2027-01-05T07:00:00Z');
    expect(assignments).toHaveLength(0);
  });

  it('accepts a booking inside operating hours', async () => {
    const key = testId('hours-inside');
    keys.push(key);
    // Tue 2027-01-05, 12:00-14:00 local — comfortably inside 11:00-22:00.
    const { data, error } = await book({
      tableId: SEED.tableT1,
      startsAt: '2027-01-05T17:00:00Z',
      endsAt: '2027-01-05T19:00:00Z',
      key,
    });
    expect(error).toBeNull();
    expect(typeof data).toBe('string');

    const { data: rows } = await client
      .from('reservations')
      .select('id, status')
      .eq('idempotency_key', key);
    expect(rows).toHaveLength(1);
    expect(rows![0].status).toBe('confirmed');
  });

  it('accepts a window ending exactly at the closing time (Saturday, day_of_week 6)', async () => {
    const key = testId('hours-sat-close');
    keys.push(key);
    // Sat 2027-01-02, 21:00-23:00 local: Saturdays (day 6) close at 23:00,
    // and the end boundary is exact. A Sunday would already be closed (22:00).
    const { data, error } = await book({
      tableId: SEED.tableT2,
      startsAt: '2027-01-03T02:00:00Z',
      endsAt: '2027-01-03T04:00:00Z',
      key,
    });
    expect(error).toBeNull();
    expect(typeof data).toBe('string');
  });

  it('rejects the same wall window after Sunday closing (day_of_week 0 closes 22:00)', async () => {
    const key = testId('hours-sun-after');
    keys.push(key);
    // Sun 2027-01-03, 21:00-23:00 local — past Sunday's 22:00 close. This is
    // the same wall window as the Saturday case, so only a correct 0=Sunday
    // mapping distinguishes the two outcomes.
    const { data, error } = await book({
      tableId: SEED.tableT2,
      startsAt: '2027-01-04T02:00:00Z',
      endsAt: '2027-01-04T04:00:00Z',
      key,
    });
    expect(data).toBeNull();
    expect(error?.code).toBe('22023');
    expect(error?.message).toMatch(/outside operating hours/);

    const { data: reservations } = await client
      .from('reservations')
      .select('id')
      .eq('idempotency_key', key);
    expect(reservations).toHaveLength(0);
  });

  it('replays an existing reservation before the hours check', async () => {
    const key = testId('hours-replay');
    keys.push(key);
    // First call: Wed 2027-01-06, 12:00-14:00 local — inside hours.
    const first = await book({
      tableId: SEED.tableT3,
      startsAt: '2027-01-06T17:00:00Z',
      endsAt: '2027-01-06T19:00:00Z',
      key,
    });
    expect(first.error).toBeNull();
    expect(typeof first.data).toBe('string');

    // Replay with the same key but an OUT-OF-HOURS window: the idempotency
    // lookup (step 5) runs before the hours gate (step 6b), so the original
    // id returns unchanged instead of a 22023 rejection.
    const replay = await book({
      tableId: SEED.tableT3,
      startsAt: '2027-01-05T07:00:00Z',
      endsAt: '2027-01-05T09:00:00Z',
      key,
    });
    expect(replay.error).toBeNull();
    expect(replay.data).toBe(first.data);

    const { data: rows } = await client
      .from('reservations')
      .select('id, starts_at, ends_at')
      .eq('idempotency_key', key);
    expect(rows).toHaveLength(1);
    // The stored window is still the original one — nothing was rewritten.
    expect(new Date(rows![0].starts_at).toISOString()).toBe('2027-01-06T17:00:00.000Z');
    expect(new Date(rows![0].ends_at).toISOString()).toBe('2027-01-06T19:00:00.000Z');
  });
});

describe('availability closed-path (real seed hours)', () => {
  const closedParams: AvailabilityParams = {
    restaurantId: SEED.restaurantA,
    startsAt: '2027-01-05T07:00:00Z',
    endsAt: '2027-01-05T09:00:00Z',
    partySize: 2,
  };

  it('returns no options for a window outside the seeded hours', () => {
    const decision = evaluateOperatingHours({
      startsAt: closedParams.startsAt,
      endsAt: closedParams.endsAt,
      timeZone,
      hours: hoursRows,
    });
    expect(decision.open).toBe(false);

    const options = computeAvailability({
      params: closedParams,
      tables,
      groups: [],
      members: [],
      assignments: [],
      hours: { timeZone, hours: hoursRows },
    });
    expect(options).toEqual([]);
  });

  it('returns options for the same tables when the window is inside hours', () => {
    const openParams: AvailabilityParams = {
      restaurantId: SEED.restaurantA,
      startsAt: '2027-01-05T17:00:00Z',
      endsAt: '2027-01-05T19:00:00Z',
      partySize: 2,
    };
    const options = computeAvailability({
      params: openParams,
      tables,
      groups: [],
      members: [],
      assignments: [],
      hours: { timeZone, hours: hoursRows },
    });
    expect(options.length).toBeGreaterThan(0);
  });
});

describe('TS/SQL semantic cross-check', () => {
  const cases: Array<{
    name: string;
    startsAt: string;
    endsAt: string;
    expected: boolean;
  }> = [
    {
      name: 'inside hours (Tuesday midday)',
      startsAt: '2027-01-05T17:00:00Z',
      endsAt: '2027-01-05T19:00:00Z',
      expected: true,
    },
    {
      name: 'before open (Tuesday early)',
      startsAt: '2027-01-05T07:00:00Z',
      endsAt: '2027-01-05T09:00:00Z',
      expected: false,
    },
    {
      name: 'exact Saturday close (day_of_week 6)',
      startsAt: '2027-01-03T02:00:00Z',
      endsAt: '2027-01-03T04:00:00Z',
      expected: true,
    },
    {
      name: 'after Sunday close (day_of_week 0)',
      startsAt: '2027-01-04T02:00:00Z',
      endsAt: '2027-01-04T04:00:00Z',
      expected: false,
    },
    {
      name: 'cross-local-midnight window',
      startsAt: '2027-01-06T03:00:00Z',
      endsAt: '2027-01-06T05:00:00Z',
      expected: false,
    },
    {
      name: 'spring-forward day inside hours (2027-03-14)',
      startsAt: '2027-03-14T15:00:00Z',
      endsAt: '2027-03-14T20:00:00Z',
      expected: true,
    },
    {
      name: 'fall-back fold window before opening (2027-11-07)',
      startsAt: '2027-11-07T05:30:00Z',
      endsAt: '2027-11-07T07:00:00Z',
      expected: false,
    },
  ];

  it.each(cases)('agrees on "$name" ($startsAt -> $endsAt)', async ({ startsAt, endsAt, expected }) => {
    const ts = evaluateOperatingHours({ startsAt, endsAt, timeZone, hours: hoursRows });
    expect(ts.open).toBe(expected);

    const { data, error } = await client.rpc('is_within_operating_hours', {
      p_restaurant_id: SEED.restaurantA,
      p_starts_at: startsAt,
      p_ends_at: endsAt,
    });
    expect(error).toBeNull();
    expect(data).toBe(expected);
  });

  it('fails closed in SQL for an invalid restaurant timezone', async () => {
    await client.from('restaurants').delete().eq('id', TEMP_RESTAURANT_ID);
    // Insert through the authenticated fixture user (createTestUser in
    // beforeAll), not the service role: trg_handle_new_restaurant (003) fires
    // after insert and creates the initial owner membership with auth.uid(),
    // which is NULL under the service role and violates
    // restaurant_memberships.user_id NOT NULL. The membership then carries the
    // fixture user's real id and cascades away with the restaurant on delete.
    const { error: insertError } = await userClient.from('restaurants').insert({
      id: TEMP_RESTAURANT_ID,
      name: 'Invalid timezone probe',
      slug: testId('tz-probe'),
      timezone: 'Not/AZone',
    });
    expect(insertError).toBeNull();

    const { data, error } = await client.rpc('is_within_operating_hours', {
      p_restaurant_id: TEMP_RESTAURANT_ID,
      p_starts_at: '2027-01-05T17:00:00Z',
      p_ends_at: '2027-01-05T19:00:00Z',
    });
    expect(error).toBeNull();
    expect(data).toBe(false);

    await client.from('restaurants').delete().eq('id', TEMP_RESTAURANT_ID);
  });
});
