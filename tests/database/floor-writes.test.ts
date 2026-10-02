import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  createServiceClient,
  createTestUser,
  deleteTestUser,
  cleanupTestData,
  testId,
  SEED,
} from './helpers';
import {
  createTable,
  updateTable,
  deleteTable,
} from '@/server/floor-writes';

/**
 * M4 manager/staff floor write-access tests. Same pattern as the M3 floor
 * tests: real authenticated callers against the dev/test project, service
 * role only for fixture setup and cleanup.
 */

const serviceClient = createServiceClient();

const createdUsers: string[] = [];
const createdMemberUserIds: string[] = [];
const createdTableIds: string[] = [];

// One authenticated user per role for this file. The remote Auth service
// rate-limits anonymous signups, so tests share these clients instead of
// signing up per test; each test still creates uniquely-named data via
// testId(). Never share these across files — files run in parallel.
type TestUser = Awaited<ReturnType<typeof createTestUser>>;
let manager!: TestUser;
let owner!: TestUser;
let staff!: TestUser;
let nonMember!: TestUser;

beforeAll(async () => {
  const { error } = await serviceClient.from('restaurants').select('id').limit(1);
  if (error) {
    throw new Error(`Database connection failed: ${error.message}`);
  }

  manager = await createTestUser();
  createdUsers.push(manager.userId);
  createdMemberUserIds.push(manager.userId);
  await grantRole(manager.userId, 'manager');

  owner = await createTestUser();
  createdUsers.push(owner.userId);
  createdMemberUserIds.push(owner.userId);
  await grantRole(owner.userId, 'owner');

  staff = await createTestUser();
  createdUsers.push(staff.userId);
  createdMemberUserIds.push(staff.userId);
  await grantRole(staff.userId, 'staff');

  nonMember = await createTestUser();
  createdUsers.push(nonMember.userId);
});

async function grantRole(userId: string, role: string) {
  const { error } = await serviceClient.from('restaurant_memberships').insert({
    restaurant_id: SEED.restaurantA,
    user_id: userId,
    role,
  });
  expect(error).toBeNull();
}

describe('table write access', () => {
  it('lets a manager create, update, and delete a table', async () => {
    const { client, userId } = manager;

    const label = testId('m4-table-mgr');
    const created = await createTable(client, userId, SEED.restaurantA, {
      label,
      capacity: 4,
      shape: 'square',
    });
    createdTableIds.push(created.id);
    expect(created.restaurant_id).toBe(SEED.restaurantA);
    expect(created.label).toBe(label);
    expect(created.capacity).toBe(4);
    expect(created.shape).toBe('square');

    const updated = await updateTable(client, userId, SEED.restaurantA, created.id, {
      capacity: 6,
      label: `${label}-big`,
    });
    expect(updated.capacity).toBe(6);
    expect(updated.label).toBe(`${label}-big`);

    await deleteTable(client, userId, SEED.restaurantA, created.id);
    const { data: gone } = await serviceClient
      .from('tables')
      .select('id')
      .eq('id', created.id);
    expect(gone).toEqual([]);
  });

  it('lets an owner write and defaults shape/geometry', async () => {
    const { client, userId } = owner;

    const created = await createTable(client, userId, SEED.restaurantA, {
      label: testId('m4-table-owner'),
      capacity: 2,
    });
    createdTableIds.push(created.id);
    expect(created.shape).toBe('round');
    expect(created.width).toBe(1);
    expect(created.depth).toBe(1);
  });

  it('denies a staff member write access (owner/manager only)', async () => {
    const { client, userId } = staff;

    await expect(
      createTable(client, userId, SEED.restaurantA, { label: 'x', capacity: 2 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      updateTable(client, userId, SEED.restaurantA, SEED.tableT1, { capacity: 8 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      deleteTable(client, userId, SEED.restaurantA, SEED.tableT1),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('denies a non-member any write, including to restaurant B', async () => {
    const { client, userId } = nonMember;

    await expect(
      createTable(client, userId, SEED.restaurantA, { label: 'x', capacity: 2 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    // Manager of A touching B's table is rejected.
    const { client: mgrClient, userId: mgrId } = manager;

    await expect(
      updateTable(mgrClient, mgrId, SEED.restaurantB, SEED.tableB1, { capacity: 8 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects cross-restaurant table references and unknown tables', async () => {
    const { client, userId } = manager;

    // tableB1 belongs to restaurant B, not A.
    await expect(
      updateTable(client, userId, SEED.restaurantA, SEED.tableB1, { capacity: 8 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    await expect(
      deleteTable(client, userId, SEED.restaurantA, SEED.tableB1),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects invalid input and cross-restaurant section_id', async () => {
    const { client, userId } = manager;

    await expect(
      createTable(client, userId, SEED.restaurantA, { label: '', capacity: 2 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createTable(client, userId, SEED.restaurantA, { label: 'x', capacity: 0 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createTable(client, userId, SEED.restaurantA, { label: 'x', capacity: 2, shape: 'oval' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createTable(client, userId, SEED.restaurantA, { label: 'x', capacity: 2, section_id: 'not-a-uuid' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    // A section_id from restaurant B is rejected even though it exists.
    const { data: bSection } = await serviceClient
      .from('floor_sections')
      .select('id')
      .eq('restaurant_id', SEED.restaurantB)
      .limit(1)
      .maybeSingle();
    if (bSection) {
      await expect(
        createTable(client, userId, SEED.restaurantA, {
          label: 'x',
          capacity: 2,
          section_id: bSection.id,
        }),
      ).rejects.toMatchObject({ code: 'VALIDATION' });
    }
  });

  it('update with no fields is a validation error', async () => {
    const { client, userId } = manager;

    await expect(
      updateTable(client, userId, SEED.restaurantA, SEED.tableT2, {}),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

afterAll(async () => {
  for (const tableId of createdTableIds) {
    await cleanupTestData(serviceClient, 'tables', 'id', tableId);
  }
  for (const userId of createdMemberUserIds) {
    await cleanupTestData(serviceClient, 'restaurant_memberships', 'user_id', userId);
  }
  for (const userId of createdUsers) {
    await deleteTestUser(userId);
  }
});
