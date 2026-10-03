import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  createServiceClient,
  createTestUser,
  createTestUserWithRetry,
  deleteTestUser,
  cleanupTestData,
  testId,
  SEED,
} from './helpers';
import { createGroup, updateGroup, deleteGroup } from '@/server/floor-writes';

/**
 * Group write-access tests (M3 group CRUD). Same pattern as the M4 table
 * write tests: real authenticated callers against the dev/test project,
 * service role only for fixture setup and cleanup. Seeded groups
 * (SEED.groupA / SEED.groupB, both in restaurant A) are only ever used for
 * operations that are rejected before any write.
 */

const serviceClient = createServiceClient();

const createdUsers: string[] = [];
const createdMemberUserIds: string[] = [];
const createdGroupIds: string[] = [];

/** Fixture: the seed data has no group in restaurant B, so create one. */
let groupInRestaurantB = '';

// One authenticated user per role for this file. The remote Auth service
// rate-limits anonymous signups, so tests share these clients instead of
// signing up per test; each test still creates uniquely-named data via
// testId(). Never share these across files — files run in parallel.
type TestUser = Awaited<ReturnType<typeof createTestUser>>;
let manager!: TestUser;
let owner!: TestUser;
let staff!: TestUser;
let nonMember!: TestUser;

/**
 * Remote-setup resilience for this file's hooks (mirrors rls.test.ts).
 *
 * The hooks share a throttled host with the parallel test files: the
 * connection probe and fixture insert return errors instead of throwing.
 * Both get three retries, 2s apart, before the hook fails for real — a transient
 * slow round-trip no longer aborts the file (previously the 30s hookTimeout
 * turned it into 8 skipped tests; hookTimeout is now 60s in vitest.config).
 * The file's four GoTrue signups go through the centralized
 * helpers.createTestUserWithRetry (same 3×2s bounds).
 */
const SETUP_MAX_RETRIES = 3;
const SETUP_RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run a hook step, retrying on a thrown/returned failure up to 3 times. */
async function retrySetup<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SETUP_MAX_RETRIES + 1; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt > SETUP_MAX_RETRIES) {
        break;
      }
      console.warn(
        `${label} failed (attempt ${attempt}/${SETUP_MAX_RETRIES + 1}), ` +
          `retrying in ${SETUP_RETRY_DELAY_MS}ms:`,
        err instanceof Error ? err.message : err,
      );
      await sleep(SETUP_RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

beforeAll(async () => {
  await retrySetup('database connection probe', async () => {
    const { error } = await serviceClient.from('restaurants').select('id').limit(1);
    if (error) {
      throw new Error(`Database connection failed: ${error.message}`);
    }
  });

  // The group name is generated once so retries after a lost response do
  // not pile up distinct rows.
  const groupName = testId('group-b');
  const fixtureId = await retrySetup('fixture group setup', async () => {
    const { data, error } = await serviceClient
      .from('table_groups')
      .insert({ restaurant_id: SEED.restaurantB, name: groupName })
      .select('id')
      .single();
    if (error || !data) {
      throw new Error(`Fixture group setup failed: ${error?.message}`);
    }
    return data.id;
  });
  groupInRestaurantB = fixtureId;
  createdGroupIds.push(fixtureId);

  manager = await createTestUserWithRetry();
  createdUsers.push(manager.userId);
  createdMemberUserIds.push(manager.userId);
  await grantRole(manager.userId, 'manager');

  owner = await createTestUserWithRetry();
  createdUsers.push(owner.userId);
  createdMemberUserIds.push(owner.userId);
  await grantRole(owner.userId, 'owner');

  staff = await createTestUserWithRetry();
  createdUsers.push(staff.userId);
  createdMemberUserIds.push(staff.userId);
  await grantRole(staff.userId, 'staff');

  nonMember = await createTestUserWithRetry();
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

describe('group write access', () => {
  it('lets a manager create, update, and delete a group', async () => {
    const { client, userId } = manager;

    const name = testId('group-mgr');
    const created = await createGroup(client, userId, SEED.restaurantA, {
      name,
      description: 'window side',
      table_ids: [SEED.tableT1, SEED.tableT2],
    });
    createdGroupIds.push(created.id);
    expect(created.restaurant_id).toBe(SEED.restaurantA);
    expect(created.name).toBe(name);
    expect(created.description).toBe('window side');
    expect([...created.table_ids].sort()).toEqual(
      [SEED.tableT1, SEED.tableT2].sort(),
    );

    // Member rows persisted for the new group.
    const { data: members } = await serviceClient
      .from('table_group_members')
      .select('table_id')
      .eq('group_id', created.id);
    expect((members ?? []).map((m) => m.table_id).sort()).toEqual(
      [SEED.tableT1, SEED.tableT2].sort(),
    );

    // Update name and replace membership in one call.
    const updated = await updateGroup(client, userId, SEED.restaurantA, created.id, {
      name: `${name}-v2`,
      table_ids: [SEED.tableT3],
    });
    expect(updated.name).toBe(`${name}-v2`);
    expect(updated.table_ids).toEqual([SEED.tableT3]);

    await deleteGroup(client, userId, SEED.restaurantA, created.id);
    const { data: gone } = await serviceClient
      .from('table_groups')
      .select('id')
      .eq('id', created.id);
    expect(gone).toEqual([]);
    const { data: orphans } = await serviceClient
      .from('table_group_members')
      .select('table_id')
      .eq('group_id', created.id);
    expect(orphans).toEqual([]);
  });

  it('lets an owner create a group with no members; description defaults to null', async () => {
    const { client, userId } = owner;

    const created = await createGroup(client, userId, SEED.restaurantA, {
      name: testId('group-owner'),
    });
    createdGroupIds.push(created.id);
    expect(created.restaurant_id).toBe(SEED.restaurantA);
    expect(created.description).toBeNull();
    expect(created.table_ids).toEqual([]);

    await deleteGroup(client, userId, SEED.restaurantA, created.id);
  });

  it('denies a staff member write access (owner/manager only)', async () => {
    const { client, userId } = staff;

    await expect(
      createGroup(client, userId, SEED.restaurantA, { name: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      updateGroup(client, userId, SEED.restaurantA, SEED.groupA, { name: 'y' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await expect(
      deleteGroup(client, userId, SEED.restaurantA, SEED.groupA),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('denies a non-member any write', async () => {
    const { client, userId } = nonMember;

    await expect(
      createGroup(client, userId, SEED.restaurantA, { name: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      updateGroup(client, userId, SEED.restaurantA, SEED.groupA, { name: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      deleteGroup(client, userId, SEED.restaurantA, SEED.groupA),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('denies a manager of restaurant A any write to restaurant B', async () => {
    const { client: mgrClient, userId: mgrId } = manager;

    await expect(
      createGroup(mgrClient, mgrId, SEED.restaurantB, { name: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      updateGroup(mgrClient, mgrId, SEED.restaurantB, groupInRestaurantB, { name: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      deleteGroup(mgrClient, mgrId, SEED.restaurantB, groupInRestaurantB),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects cross-restaurant group and table references and unknown ids', async () => {
    const { client, userId } = manager;

    // A group in restaurant B addressed under restaurant A.
    await expect(
      updateGroup(client, userId, SEED.restaurantA, groupInRestaurantB, { name: 'x' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      deleteGroup(client, userId, SEED.restaurantA, groupInRestaurantB),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Unknown group id.
    await expect(
      updateGroup(
        client,
        userId,
        SEED.restaurantA,
        '99999999-9999-4999-8999-999999999999',
        { name: 'x' },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    // Member table from restaurant B, alone and mixed with a valid table.
    await expect(
      createGroup(client, userId, SEED.restaurantA, {
        name: 'x',
        table_ids: [SEED.tableB1],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createGroup(client, userId, SEED.restaurantA, {
        name: 'x',
        table_ids: [SEED.tableT1, SEED.tableB1],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });

    // Well-formed uuid that does not exist must not become a member.
    await expect(
      updateGroup(client, userId, SEED.restaurantA, SEED.groupA, {
        table_ids: ['99999999-9999-4999-8999-999999999999'],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('rejects invalid input', async () => {
    const { client, userId } = manager;

    await expect(
      createGroup(client, userId, SEED.restaurantA, { name: '' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createGroup(client, userId, SEED.restaurantA, { name: 42 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createGroup(client, userId, SEED.restaurantA, { name: 'x', description: 123 }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createGroup(client, userId, SEED.restaurantA, { name: 'x', table_ids: 'not-an-array' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createGroup(client, userId, SEED.restaurantA, { name: 'x', table_ids: ['not-a-uuid'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      createGroup(client, userId, SEED.restaurantA, null as never),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(
      updateGroup(client, userId, SEED.restaurantA, SEED.groupA, { name: '   ' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('update with no fields is a validation error', async () => {
    const { client, userId } = manager;

    await expect(
      updateGroup(client, userId, SEED.restaurantA, SEED.groupA, {}),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

afterAll(async () => {
  for (const groupId of createdGroupIds) {
    await cleanupTestData(serviceClient, 'table_group_members', 'group_id', groupId);
    await cleanupTestData(serviceClient, 'table_groups', 'id', groupId);
  }
  for (const userId of createdMemberUserIds) {
    await cleanupTestData(serviceClient, 'restaurant_memberships', 'user_id', userId);
  }
  for (const userId of createdUsers) {
    await deleteTestUser(userId);
  }
});
