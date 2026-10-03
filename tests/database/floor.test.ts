import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  createServiceClient,
  createTestUserWithRetry,
  deleteTestUser,
  cleanupTestData,
  SEED,
} from './helpers';
import {
  FloorAccessError,
  listStaffRestaurants,
  listRestaurantTables,
  listRestaurantGroups,
  listRestaurantFloorSections,
} from '@/server/floor';

/**
 * M3 staff floor read-access tests.
 *
 * These run against the live dev/test Supabase project using real
 * authenticated callers (see helpers.ts), so the membership-based tenant
 * isolation is exercised end to end rather than mocked. The service-role
 * client is used only to arrange fixtures (grant memberships, cleanup);
 * assertions always go through a caller-scoped client.
 */

const serviceClient = createServiceClient();

const createdUsers: string[] = [];
const createdMemberUserIds: string[] = [];

beforeAll(async () => {
  const { error } = await serviceClient.from('restaurants').select('id').limit(1);
  if (error) {
    throw new Error(`Database connection failed: ${error.message}`);
  }
});

describe('staff floor read access', () => {
  it('returns an empty list for a user with no restaurant memberships', async () => {
    const { client, userId } = await createTestUserWithRetry();
    createdUsers.push(userId);

    const restaurants = await listStaffRestaurants(client, userId);
    expect(restaurants).toEqual([]);
  });

  it('lists only the restaurants the caller belongs to, with the expected shape', async () => {
    const { client, userId } = await createTestUserWithRetry();
    createdUsers.push(userId);
    createdMemberUserIds.push(userId);

    const { error } = await serviceClient.from('restaurant_memberships').insert({
      restaurant_id: SEED.restaurantA,
      user_id: userId,
      role: 'staff',
    });
    expect(error).toBeNull();

    const restaurants = await listStaffRestaurants(client, userId);
    expect(restaurants).toHaveLength(1);
    expect(restaurants[0].id).toBe(SEED.restaurantA);
    expect(typeof restaurants[0].name).toBe('string');
    expect(typeof restaurants[0].slug).toBe('string');
    expect(typeof restaurants[0].timezone).toBe('string');
  });

  it('returns restaurant tables for staff and rejects non-members (tenant isolation)', async () => {
    const { client: staffClient, userId: staffId } = await createTestUserWithRetry();
    const { client: outsiderClient, userId: outsiderId } = await createTestUserWithRetry();
    createdUsers.push(staffId, outsiderId);
    createdMemberUserIds.push(staffId);

    const { error } = await serviceClient.from('restaurant_memberships').insert({
      restaurant_id: SEED.restaurantA,
      user_id: staffId,
      role: 'manager',
    });
    expect(error).toBeNull();

    const tables = await listRestaurantTables(staffClient, staffId, SEED.restaurantA);
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(table.restaurant_id).toBe(SEED.restaurantA);
      expect(typeof table.label).toBe('string');
      expect(table.capacity).toBeGreaterThan(0);
    }

    // Staff of restaurant A must not read restaurant B's tables.
    await expect(
      listRestaurantTables(staffClient, staffId, SEED.restaurantB),
    ).rejects.toBeInstanceOf(FloorAccessError);

    // A user with no membership is rejected outright.
    await expect(
      listRestaurantTables(outsiderClient, outsiderId, SEED.restaurantA),
    ).rejects.toBeInstanceOf(FloorAccessError);
  });

  it('returns table groups with their member table ids and rejects non-members', async () => {
    const { client: staffClient, userId: staffId } = await createTestUserWithRetry();
    createdUsers.push(staffId);
    createdMemberUserIds.push(staffId);

    const { error } = await serviceClient.from('restaurant_memberships').insert({
      restaurant_id: SEED.restaurantA,
      user_id: staffId,
      role: 'staff',
    });
    expect(error).toBeNull();

    const groups = await listRestaurantGroups(staffClient, staffId, SEED.restaurantA);
    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.restaurant_id).toBe(SEED.restaurantA);
      expect(typeof group.name).toBe('string');
      expect(Array.isArray(group.table_ids)).toBe(true);
    }

    await expect(
      listRestaurantGroups(staffClient, staffId, SEED.restaurantB),
    ).rejects.toBeInstanceOf(FloorAccessError);
  });

  it('returns floor sections scoped to the restaurant and rejects non-members', async () => {
    const { client: staffClient, userId: staffId } = await createTestUserWithRetry();
    createdUsers.push(staffId);
    createdMemberUserIds.push(staffId);

    const { error } = await serviceClient.from('restaurant_memberships').insert({
      restaurant_id: SEED.restaurantA,
      user_id: staffId,
      role: 'owner',
    });
    expect(error).toBeNull();

    const sections = await listRestaurantFloorSections(staffClient, staffId, SEED.restaurantA);
    expect(sections.length).toBeGreaterThan(0);
    for (const section of sections) {
      expect(section.restaurant_id).toBe(SEED.restaurantA);
      expect(typeof section.name).toBe('string');
    }

    // Sort order must be respected (deterministic shape).
    const sortOrders = sections.map((s) => s.sort_order ?? 0);
    expect([...sortOrders].sort((a, b) => a - b)).toEqual(sortOrders);

    await expect(
      listRestaurantFloorSections(staffClient, staffId, SEED.restaurantB),
    ).rejects.toBeInstanceOf(FloorAccessError);
  });
});

afterAll(async () => {
  for (const userId of createdMemberUserIds) {
    await cleanupTestData(serviceClient, 'restaurant_memberships', 'user_id', userId);
  }
  for (const userId of createdUsers) {
    await deleteTestUser(userId);
  }
});
