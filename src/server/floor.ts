import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Restaurant staff floor read access (M3).
 *
 * Row Level Security lets any authenticated user read restaurant/table/group
 * rows (public discovery, see 002_rls_policies.sql). Tenant isolation for the
 * staff surface is therefore enforced here: every restaurant-scoped read
 * requires a restaurant_memberships row for the caller before any data is
 * returned. Callers use a client that carries the caller's own JWT — never
 * the service role — so RLS and constraints still apply.
 */

export class FloorAccessError extends Error {
  readonly code: 'FORBIDDEN';

  constructor(message = 'Not a member of this restaurant') {
    super(message);
    this.name = 'FloorAccessError';
    this.code = 'FORBIDDEN';
  }
}

async function requireMembership(
  client: SupabaseClient,
  userId: string,
  restaurantId: string,
): Promise<void> {
  const { data, error } = await client
    .from('restaurant_memberships')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('user_id', userId)
    .limit(1);

  if (error) {
    throw new Error(`Membership check failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new FloorAccessError();
  }
}

/** Restaurants where the caller holds any staff role (owner/manager/staff). */
export async function listStaffRestaurants(client: SupabaseClient, userId: string) {
  const { data: memberships, error } = await client
    .from('restaurant_memberships')
    .select('restaurant_id')
    .eq('user_id', userId);

  if (error) {
    throw new Error(`Failed to load memberships: ${error.message}`);
  }

  const restaurantIds = (memberships ?? []).map((m) => m.restaurant_id);
  if (restaurantIds.length === 0) {
    return [];
  }

  const { data: restaurants, error: restaurantsError } = await client
    .from('restaurants')
    .select('id, name, slug, timezone, description, cuisine, price_range')
    .in('id', restaurantIds)
    .order('name');

  if (restaurantsError) {
    throw new Error(`Failed to load restaurants: ${restaurantsError.message}`);
  }

  return restaurants ?? [];
}

/** Tables for a restaurant the caller belongs to. */
export async function listRestaurantTables(
  client: SupabaseClient,
  userId: string,
  restaurantId: string,
) {
  await requireMembership(client, userId, restaurantId);

  const { data, error } = await client
    .from('tables')
    .select(
      'id, restaurant_id, label, capacity, section_id, position_x, position_y, width, depth, shape',
    )
    .eq('restaurant_id', restaurantId)
    .order('label');

  if (error) {
    throw new Error(`Failed to load tables: ${error.message}`);
  }

  return data ?? [];
}

/** Table groups and their member tables for a restaurant the caller belongs to. */
export async function listRestaurantGroups(
  client: SupabaseClient,
  userId: string,
  restaurantId: string,
) {
  await requireMembership(client, userId, restaurantId);

  const { data: groups, error } = await client
    .from('table_groups')
    .select('id, restaurant_id, name, description')
    .eq('restaurant_id', restaurantId)
    .order('name');

  if (error) {
    throw new Error(`Failed to load table groups: ${error.message}`);
  }

  const groupIds = (groups ?? []).map((g) => g.id);
  if (groupIds.length === 0) {
    return [];
  }

  const { data: members, error: membersError } = await client
    .from('table_group_members')
    .select('group_id, table_id')
    .in('group_id', groupIds);

  if (membersError) {
    throw new Error(`Failed to load table group members: ${membersError.message}`);
  }

  return (groups ?? []).map((group) => ({
    ...group,
    table_ids: (members ?? [])
      .filter((member) => member.group_id === group.id)
      .map((member) => member.table_id)
      .sort(),
  }));
}

/** Floor sections for a restaurant the caller belongs to. */
export async function listRestaurantFloorSections(
  client: SupabaseClient,
  userId: string,
  restaurantId: string,
) {
  await requireMembership(client, userId, restaurantId);

  const { data, error } = await client
    .from('floor_sections')
    .select('id, restaurant_id, name, color, sort_order')
    .eq('restaurant_id', restaurantId)
    .order('sort_order');

  if (error) {
    throw new Error(`Failed to load floor sections: ${error.message}`);
  }

  return data ?? [];
}
