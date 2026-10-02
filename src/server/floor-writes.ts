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
