import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { createServiceClient, testId, cleanupByIdempotencyKeys, SEED } from './helpers';

/**
 * Database Constraint Tests
 *
 * These tests verify that database constraints are properly enforced.
 * They require a running Supabase instance with migrations applied.
 *
 * Prerequisites:
 *   - Supabase CLI or Docker available
 *   - supabase db reset completed
 *   - Environment variables set (see .env.example)
 *
 * These tests FAIL (do not skip) when the database is unavailable.
 */

const client = createServiceClient();

// Test data IDs for cleanup
const testIds: string[] = [];

beforeAll(async () => {
  // Verify database connection
  const { error } = await client.from('restaurants').select('id').limit(1);
  if (error) {
    throw new Error(`Database connection failed: ${error.message}`);
  }
});

describe('database constraints', () => {
  it('enforces ends_at > starts_at on reservations', async () => {
    const id = testId('test-invalid-interval');
    testIds.push(id);

    const { error } = await client.from('reservations').insert({
      restaurant_id: SEED.restaurantA,
      user_id: SEED.guest,
      party_size: 2,
      starts_at: '2026-10-15T20:00:00Z',
      ends_at: '2026-10-15T18:00:00Z', // Before starts_at
      status: 'confirmed',
      idempotency_key: id,
    });

    expect(error).toBeDefined();
    expect(error?.code).toBe('23514'); // check_violation
  });

  it('enforces exclusion constraint on overlapping active assignments', async () => {
    // Two reservations are required: the primary key is (reservation_id, table_id),
    // so overlapping rows for the same table must belong to different reservations.
    const key1 = testId('test-exclusion-1-1');
    const key2 = testId('test-exclusion-1-2');
    testIds.push(key1, key2);

    const { data: res1, error: res1Error } = await client
      .from('reservations')
      .insert({
        restaurant_id: SEED.restaurantA,
        user_id: SEED.guest,
        party_size: 2,
        starts_at: '2026-11-15T18:00:00Z',
        ends_at: '2026-11-15T20:00:00Z',
        status: 'confirmed',
        idempotency_key: key1,
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
        starts_at: '2026-11-15T18:00:00Z',
        ends_at: '2026-11-15T20:00:00Z',
        status: 'confirmed',
        idempotency_key: key2,
      })
      .select('id')
      .single();

    expect(res2Error).toBeNull();

    // First active assignment succeeds.
    const { error: assign1Error } = await client.from('reservation_tables').insert({
      reservation_id: res1!.id,
      restaurant_id: SEED.restaurantA,
      table_id: SEED.tableT1,
      starts_at: '2026-11-15T18:00:00Z',
      ends_at: '2026-11-15T20:00:00Z',
      status: 'active',
    });

    expect(assign1Error).toBeNull();

    // Overlapping active assignment for the same table (different reservation) fails.
    const { error: assign2Error } = await client.from('reservation_tables').insert({
      reservation_id: res2!.id,
      restaurant_id: SEED.restaurantA,
      table_id: SEED.tableT1,
      starts_at: '2026-11-15T19:00:00Z', // Overlaps
      ends_at: '2026-11-15T21:00:00Z',
      status: 'active',
    });

    expect(assign2Error).toBeDefined();
    expect(assign2Error?.code).toBe('23P01'); // exclusion_violation
  });

  it('allows released assignments to overlap but still rejects overlapping active assignments', async () => {
    const key1 = testId('test-released-1');
    const key2 = testId('test-released-2');
    const key3 = testId('test-released-3');
    testIds.push(key1, key2, key3);

    // Three separate reservations for the same table and interval.
    const { data: res1, error: res1Error } = await client
      .from('reservations')
      .insert({
        restaurant_id: SEED.restaurantA,
        user_id: SEED.guest,
        party_size: 2,
        starts_at: '2026-11-16T18:00:00Z',
        ends_at: '2026-11-16T20:00:00Z',
        status: 'confirmed',
        idempotency_key: key1,
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
        starts_at: '2026-11-16T18:00:00Z',
        ends_at: '2026-11-16T20:00:00Z',
        status: 'confirmed',
        idempotency_key: key2,
      })
      .select('id')
      .single();
    expect(res2Error).toBeNull();

    const { data: res3, error: res3Error } = await client
      .from('reservations')
      .insert({
        restaurant_id: SEED.restaurantA,
        user_id: SEED.guest,
        party_size: 2,
        starts_at: '2026-11-16T18:00:00Z',
        ends_at: '2026-11-16T20:00:00Z',
        status: 'confirmed',
        idempotency_key: key3,
      })
      .select('id')
      .single();
    expect(res3Error).toBeNull();

    // First active assignment succeeds.
    const { error: assign1Error } = await client.from('reservation_tables').insert({
      reservation_id: res1!.id,
      restaurant_id: SEED.restaurantA,
      table_id: SEED.tableT2,
      starts_at: '2026-11-16T18:00:00Z',
      ends_at: '2026-11-16T20:00:00Z',
      status: 'active',
    });
    expect(assign1Error).toBeNull();

    // A released assignment overlapping the active one succeeds (released is exempt).
    const { error: assign2Error } = await client.from('reservation_tables').insert({
      reservation_id: res2!.id,
      restaurant_id: SEED.restaurantA,
      table_id: SEED.tableT2,
      starts_at: '2026-11-16T19:00:00Z',
      ends_at: '2026-11-16T21:00:00Z',
      status: 'released',
    });
    expect(assign2Error).toBeNull();

    // A second active assignment overlapping the first active one is still rejected.
    const { error: assign3Error } = await client.from('reservation_tables').insert({
      reservation_id: res3!.id,
      restaurant_id: SEED.restaurantA,
      table_id: SEED.tableT2,
      starts_at: '2026-11-16T18:00:00Z',
      ends_at: '2026-11-16T20:00:00Z',
      status: 'active',
    });
    expect(assign3Error).toBeDefined();
    expect(assign3Error?.code).toBe('23P01');
  });

  it('enforces cross-restaurant consistency via composite foreign keys', async () => {
    const reservationId = testId('test-cross-restaurant');
    testIds.push(reservationId);

    const { data: reservation, error: resError } = await client
      .from('reservations')
      .insert({
        restaurant_id: SEED.restaurantA,
        user_id: SEED.guest,
        party_size: 2,
        starts_at: '2026-10-17T18:00:00Z',
        ends_at: '2026-10-17T20:00:00Z',
        status: 'confirmed',
        idempotency_key: reservationId,
      })
      .select('id')
      .single();

    expect(resError).toBeNull();

    // Try to assign a table from a different restaurant (should fail)
    const { error: assignError } = await client.from('reservation_tables').insert({
      reservation_id: reservation!.id,
      restaurant_id: SEED.restaurantB, // Wrong restaurant
      table_id: SEED.tableB1,
      starts_at: '2026-10-17T18:00:00Z',
      ends_at: '2026-10-17T20:00:00Z',
      status: 'active',
    });

    expect(assignError).toBeDefined();
    expect(assignError?.code).toBe('23503'); // foreign_key_violation
  });

  it('enforces capacity > 0 on tables', async () => {
    const id = testId('test-capacity');
    testIds.push(id);

    const { error } = await client.from('tables').insert({
      restaurant_id: SEED.restaurantA,
      label: id,
      capacity: 0, // Invalid
    });

    expect(error).toBeDefined();
    expect(error?.code).toBe('23514'); // check_violation
  });

  it('enforces party_size > 0 on reservations', async () => {
    const id = testId('test-party-size');
    testIds.push(id);

    const { error } = await client.from('reservations').insert({
      restaurant_id: SEED.restaurantA,
      user_id: SEED.guest,
      party_size: 0, // Invalid
      starts_at: '2026-10-15T18:00:00Z',
      ends_at: '2026-10-15T20:00:00Z',
      status: 'confirmed',
      idempotency_key: id,
    });

    expect(error).toBeDefined();
    expect(error?.code).toBe('23514'); // check_violation
  });

  it('enforces valid status values on reservation_tables', async () => {
    const reservationId = testId('test-status');
    testIds.push(reservationId);

    const { data: reservation, error: resError } = await client
      .from('reservations')
      .insert({
        restaurant_id: SEED.restaurantA,
        user_id: SEED.guest,
        party_size: 2,
        starts_at: '2026-10-18T18:00:00Z',
        ends_at: '2026-10-18T20:00:00Z',
        status: 'confirmed',
        idempotency_key: reservationId,
      })
      .select('id')
      .single();

    expect(resError).toBeNull();

    const { error } = await client.from('reservation_tables').insert({
      reservation_id: reservation!.id,
      restaurant_id: SEED.restaurantA,
      table_id: SEED.tableT3,
      starts_at: '2026-10-18T18:00:00Z',
      ends_at: '2026-10-18T20:00:00Z',
      status: 'invalid_status', // Invalid
    });

    expect(error).toBeDefined();
    expect(error?.code).toBe('23514'); // check_violation
  });
});

// Cleanup after all tests
afterAll(async () => {
  await cleanupByIdempotencyKeys(client, testIds);
});
