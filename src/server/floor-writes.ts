import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Restaurant-scoped manager/owner write access for floor resources (M4).
 *
 * RLS already enforces is_manager_or_owner(restaurant_id) on tables,
 * table_groups, table_group_members, and floor_sections. These functions
 * add the same checks server-side (so failures are a clean 403 rather
 * than a policy error), validate input at the boundary, and validate
 * tenant scope for every referenced id — in particular section_id, which
 * the schema does not constrain to the same restaurant.
 */

export class FloorWriteError extends Error {
  readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION';

  constructor(code: 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION', message: string) {
    super(message);
    this.name = 'FloorWriteError';
    this.code = code;
  }
}

const TABLE_SHAPES = ['round', 'square', 'rect', 'booth'] as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TableInput {
  label: unknown;
  capacity: unknown;
  section_id?: unknown;
  position_x?: unknown;
  position_y?: unknown;
  width?: unknown;
  depth?: unknown;
  shape?: unknown;
}

/** Throws unless the caller holds owner or manager on the restaurant. */
async function requireManagerOrOwner(
  client: SupabaseClient,
  userId: string,
  restaurantId: string,
): Promise<void> {
  const { data, error } = await client
    .from('restaurant_memberships')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('user_id', userId)
    .in('role', ['owner', 'manager'])
    .limit(1);

  if (error) {
    throw new Error(`Membership check failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new FloorWriteError(
      'FORBIDDEN',
      'Owner or manager role required for this restaurant',
    );
  }
}

function validateTableInput(input: TableInput): {
  label: string;
  capacity: number;
  section_id: string | null;
  position_x: number;
  position_y: number;
  width: number;
  depth: number;
  shape: (typeof TABLE_SHAPES)[number];
} {
  if (typeof input.label !== 'string' || input.label.trim().length === 0) {
    throw new FloorWriteError('VALIDATION', 'label must be a non-empty string');
  }
  if (
    typeof input.capacity !== 'number' ||
    !Number.isInteger(input.capacity) ||
    input.capacity <= 0
  ) {
    throw new FloorWriteError('VALIDATION', 'capacity must be a positive integer');
  }
  if (
    input.section_id !== undefined &&
    input.section_id !== null &&
    (typeof input.section_id !== 'string' || !UUID_RE.test(input.section_id))
  ) {
    throw new FloorWriteError('VALIDATION', 'section_id must be a string uuid or null');
  }
  if (input.shape !== undefined && !TABLE_SHAPES.includes(input.shape as never)) {
    throw new FloorWriteError('VALIDATION', `shape must be one of: ${TABLE_SHAPES.join(', ')}`);
  }
  for (const key of ['position_x', 'position_y', 'width', 'depth'] as const) {
    if (input[key] !== undefined && typeof input[key] !== 'number') {
      throw new FloorWriteError('VALIDATION', `${key} must be a number`);
    }
  }

  return {
    label: input.label.trim(),
    capacity: input.capacity,
    section_id: (input.section_id as string | null | undefined) ?? null,
    position_x: (input.position_x as number | undefined) ?? 0,
    position_y: (input.position_y as number | undefined) ?? 0,
    width: (input.width as number | undefined) ?? 1,
    depth: (input.depth as number | undefined) ?? 1,
    shape: (input.shape as (typeof TABLE_SHAPES)[number] | undefined) ?? 'round',
  };
}

async function assertSectionInRestaurant(
  client: SupabaseClient,
  sectionId: string,
  restaurantId: string,
): Promise<void> {
  const { data, error } = await client
    .from('floor_sections')
    .select('id')
    .eq('id', sectionId)
    .eq('restaurant_id', restaurantId)
    .limit(1);

  if (error) {
    throw new Error(`Section check failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new FloorWriteError(
      'VALIDATION',
      'section_id does not belong to this restaurant',
    );
  }
}

const TABLE_COLUMNS =
  'id, restaurant_id, label, capacity, section_id, position_x, position_y, width, depth, shape, created_at, updated_at';

/** Create a table in a restaurant the caller manages. */
export async function createTable(
  client: SupabaseClient,
  userId: string,
  restaurantId: string,
  input: TableInput,
) {
  await requireManagerOrOwner(client, userId, restaurantId);
  const values = validateTableInput(input);
  if (values.section_id) {
    await assertSectionInRestaurant(client, values.section_id, restaurantId);
  }

  const { data, error } = await client
    .from('tables')
    .insert({ ...values, restaurant_id: restaurantId })
    .select(TABLE_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to create table: ${error.message}`);
  }
  return data;
}

async function findTableInRestaurant(
  client: SupabaseClient,
  restaurantId: string,
  tableId: string,
) {
  const { data, error } = await client
    .from('tables')
    .select('id')
    .eq('id', tableId)
    .eq('restaurant_id', restaurantId)
    .limit(1);

  if (error) {
    throw new Error(`Table lookup failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new FloorWriteError('NOT_FOUND', 'Table not found in this restaurant');
  }
}

/** Patch a table in a restaurant the caller manages. */
export async function updateTable(
  client: SupabaseClient,
  userId: string,
  restaurantId: string,
  tableId: string,
  input: Partial<TableInput>,
) {
  await requireManagerOrOwner(client, userId, restaurantId);
  await findTableInRestaurant(client, restaurantId, tableId);

  const patch: Record<string, unknown> = {};
  if (input.label !== undefined) {
    if (typeof input.label !== 'string' || input.label.trim().length === 0) {
      throw new FloorWriteError('VALIDATION', 'label must be a non-empty string');
    }
    patch.label = input.label.trim();
  }
  if (input.capacity !== undefined) {
    if (
      typeof input.capacity !== 'number' ||
      !Number.isInteger(input.capacity) ||
      input.capacity <= 0
    ) {
      throw new FloorWriteError('VALIDATION', 'capacity must be a positive integer');
    }
    patch.capacity = input.capacity;
  }
  if (input.section_id !== undefined) {
    if (input.section_id !== null && (typeof input.section_id !== 'string' || !UUID_RE.test(input.section_id))) {
      throw new FloorWriteError('VALIDATION', 'section_id must be a string uuid or null');
    }
    if (typeof input.section_id === 'string') {
      await assertSectionInRestaurant(client, input.section_id, restaurantId);
    }
    patch.section_id = input.section_id;
  }
  if (input.shape !== undefined) {
    if (!TABLE_SHAPES.includes(input.shape as never)) {
      throw new FloorWriteError(
        'VALIDATION',
        `shape must be one of: ${TABLE_SHAPES.join(', ')}`,
      );
    }
    patch.shape = input.shape;
  }
  for (const key of ['position_x', 'position_y', 'width', 'depth'] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'number') {
        throw new FloorWriteError('VALIDATION', `${key} must be a number`);
      }
      patch[key] = input[key];
    }
  }
  if (Object.keys(patch).length === 0) {
    throw new FloorWriteError('VALIDATION', 'No updatable fields provided');
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await client
    .from('tables')
    .update(patch)
    .eq('id', tableId)
    .eq('restaurant_id', restaurantId)
    .select(TABLE_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to update table: ${error.message}`);
  }
  return data;
}

/** Delete a table in a restaurant the caller manages. */
export async function deleteTable(
  client: SupabaseClient,
  userId: string,
  restaurantId: string,
  tableId: string,
) {
  await requireManagerOrOwner(client, userId, restaurantId);
  await findTableInRestaurant(client, restaurantId, tableId);

  const { error } = await client
    .from('tables')
    .delete()
    .eq('id', tableId)
    .eq('restaurant_id', restaurantId);

  if (error) {
    throw new Error(`Failed to delete table: ${error.message}`);
  }
}

export interface GroupInput {
  name?: unknown;
  description?: unknown;
  table_ids?: unknown;
}

const GROUP_COLUMNS =
  'id, restaurant_id, name, description, created_at, updated_at';

function assertObjectInput(input: unknown): asserts input is Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new FloorWriteError('VALIDATION', 'Body must be a JSON object');
  }
}

function validateGroupName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new FloorWriteError('VALIDATION', 'name must be a non-empty string');
  }
  return value.trim();
}

function validateDescription(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new FloorWriteError('VALIDATION', 'description must be a string or null');
  }
  return value;
}

function validateTableIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new FloorWriteError('VALIDATION', 'table_ids must be an array of uuids');
  }
  const ids = [...new Set(value)];
  for (const id of ids) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      throw new FloorWriteError('VALIDATION', 'every table_id must be a uuid string');
    }
  }
  return ids;
}

/**
 * Tenant check for member table ids.
 *
 * table_group_members has no composite foreign key tying table_id to the
 * group's restaurant, so every member id is verified here to belong to
 * restaurantId before any write.
 */
async function assertTablesInRestaurant(
  client: SupabaseClient,
  tableIds: string[],
  restaurantId: string,
): Promise<void> {
  if (tableIds.length === 0) {
    return;
  }
  const { data, error } = await client
    .from('tables')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .in('id', tableIds);

  if (error) {
    throw new Error(`Table lookup failed: ${error.message}`);
  }
  const found = new Set((data ?? []).map((row) => row.id));
  if (tableIds.some((id) => !found.has(id))) {
    throw new FloorWriteError(
      'VALIDATION',
      'every table_id must belong to this restaurant',
    );
  }
}

async function findGroupInRestaurant(
  client: SupabaseClient,
  restaurantId: string,
  groupId: string,
) {
  const { data, error } = await client
    .from('table_groups')
    .select('id')
    .eq('id', groupId)
    .eq('restaurant_id', restaurantId)
    .limit(1);

  if (error) {
    throw new Error(`Group lookup failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new FloorWriteError('NOT_FOUND', 'Group not found in this restaurant');
  }
}

async function replaceGroupMembers(
  client: SupabaseClient,
  groupId: string,
  tableIds: string[],
): Promise<void> {
  const { error: deleteError } = await client
    .from('table_group_members')
    .delete()
    .eq('group_id', groupId);

  if (deleteError) {
    throw new Error(`Failed to replace group members: ${deleteError.message}`);
  }

  if (tableIds.length > 0) {
    const { error: insertError } = await client
      .from('table_group_members')
      .insert(tableIds.map((tableId) => ({ group_id: groupId, table_id: tableId })));

    if (insertError) {
      throw new Error(`Failed to add group members: ${insertError.message}`);
    }
  }
}

async function listGroupMemberIds(
  client: SupabaseClient,
  groupId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from('table_group_members')
    .select('table_id')
    .eq('group_id', groupId);

  if (error) {
    throw new Error(`Failed to load group members: ${error.message}`);
  }
  return (data ?? []).map((row) => row.table_id).sort();
}

/** Create a table group in a restaurant the caller manages. */
export async function createGroup(
  client: SupabaseClient,
  userId: string,
  restaurantId: string,
  input: GroupInput,
) {
  assertObjectInput(input);
  await requireManagerOrOwner(client, userId, restaurantId);

  const name = validateGroupName(input.name);
  const description =
    input.description === undefined ? null : validateDescription(input.description);
  const tableIds =
    input.table_ids === undefined ? [] : validateTableIds(input.table_ids);
  await assertTablesInRestaurant(client, tableIds, restaurantId);

  const { data, error } = await client
    .from('table_groups')
    .insert({ restaurant_id: restaurantId, name, description })
    .select(GROUP_COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to create group: ${error.message}`);
  }

  if (tableIds.length > 0) {
    await replaceGroupMembers(client, data.id, tableIds);
  }

  return { ...data, table_ids: [...tableIds].sort() };
}

/** Patch a table group (and optionally its member tables) in a restaurant the caller manages. */
export async function updateGroup(
  client: SupabaseClient,
  userId: string,
  restaurantId: string,
  groupId: string,
  input: GroupInput,
) {
  assertObjectInput(input);
  await requireManagerOrOwner(client, userId, restaurantId);
  await findGroupInRestaurant(client, restaurantId, groupId);

  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    patch.name = validateGroupName(input.name);
  }
  if (input.description !== undefined) {
    patch.description = validateDescription(input.description);
  }
  const hasTableIds = input.table_ids !== undefined;

  if (Object.keys(patch).length === 0 && !hasTableIds) {
    throw new FloorWriteError('VALIDATION', 'No updatable fields provided');
  }

  const tableIds = hasTableIds ? validateTableIds(input.table_ids) : null;
  if (tableIds) {
    await assertTablesInRestaurant(client, tableIds, restaurantId);
  }

  if (Object.keys(patch).length > 0) {
    patch.updated_at = new Date().toISOString();
    const { error } = await client
      .from('table_groups')
      .update(patch)
      .eq('id', groupId)
      .eq('restaurant_id', restaurantId);

    if (error) {
      throw new Error(`Failed to update group: ${error.message}`);
    }
  }

  if (tableIds) {
    await replaceGroupMembers(client, groupId, tableIds);
  }

  const { data, error } = await client
    .from('table_groups')
    .select(GROUP_COLUMNS)
    .eq('id', groupId)
    .eq('restaurant_id', restaurantId)
    .single();

  if (error) {
    throw new Error(`Failed to load group: ${error.message}`);
  }

  const memberIds = tableIds ?? (await listGroupMemberIds(client, groupId));
  return { ...data, table_ids: memberIds };
}

/** Delete a table group in a restaurant the caller manages. */
export async function deleteGroup(
  client: SupabaseClient,
  userId: string,
  restaurantId: string,
  groupId: string,
) {
  await requireManagerOrOwner(client, userId, restaurantId);
  await findGroupInRestaurant(client, restaurantId, groupId);

  // Remove members explicitly first rather than relying on the FK cascade,
  // so the caller's own RLS policies authorize every row touched.
  const { error: memberError } = await client
    .from('table_group_members')
    .delete()
    .eq('group_id', groupId);

  if (memberError) {
    throw new Error(`Failed to remove group members: ${memberError.message}`);
  }

  const { error } = await client
    .from('table_groups')
    .delete()
    .eq('id', groupId)
    .eq('restaurant_id', restaurantId);

  if (error) {
    throw new Error(`Failed to delete group: ${error.message}`);
  }
}
