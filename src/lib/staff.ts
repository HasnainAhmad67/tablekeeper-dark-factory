import type { SupabaseClient } from '@supabase/supabase-js';

import { localDateKey } from '@/lib/booking';

/**
 * Staff identity and dashboard helpers (M7 Phase 1).
 *
 * getStaffIdentity mirrors src/server/floor.ts's listStaffRestaurants —
 * same two-query membership → restaurants flow, same `name` ordering (so the
 * MVP "first membership" decision means the first restaurant by name) — but
 * also returns the caller's membership role, which the staff identity
 * contract ({ id, name, slug, role }) requires. floor.ts is frozen M4 code
 * and was not modified. It runs on the caller's cookie client, so RLS
 * (memberships_select_own) scopes the membership rows to auth.uid() a
 * second time behind the explicit user_id filter.
 *
 * The KPI helpers are pure and client-safe. The overview fetches a wide
 * ±OVERVIEW_WINDOW_HOURS window through the existing
 * `GET /api/reservations?restaurant_id&from&to` contract and counts the
 * rows whose restaurant-local start date equals today in the restaurant's
 * timezone (Intl-based via booking.ts, so DST is handled by the runtime tz
 * database). Known cap: the list endpoint clamps `limit` to 100 rows, so an
 * extremely busy window would surface as a capped count.
 */

export interface StaffRestaurant {
  id: string;
  name: string;
  slug: string;
  role: string;
}

/** Restaurants (with the caller's role) the given user is a member of. */
export async function getStaffIdentity(
  client: SupabaseClient,
  userId: string,
): Promise<StaffRestaurant[]> {
  const { data: memberships, error } = await client
    .from('restaurant_memberships')
    .select('restaurant_id, role')
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
    .select('id, name, slug')
    .in('id', restaurantIds)
    .order('name');

  if (restaurantsError) {
    throw new Error(`Failed to load restaurants: ${restaurantsError.message}`);
  }

  const roleByRestaurant = new Map<string, string>();
  for (const membership of memberships ?? []) {
    roleByRestaurant.set(membership.restaurant_id, membership.role);
  }

  return (restaurants ?? []).map((restaurant) => ({
    id: restaurant.id,
    name: restaurant.name,
    slug: restaurant.slug,
    role: roleByRestaurant.get(restaurant.id) ?? 'staff',
  }));
}

/** Half-width of the overview's reservation query window, in hours. */
export const OVERVIEW_WINDOW_HOURS = 48;

/** ISO `from`/`to` bounds centred on `now` for the overview query. */
export function overviewWindow(now: number): { from: string; to: string } {
  const spanMs = OVERVIEW_WINDOW_HOURS * 60 * 60 * 1000;
  return {
    from: new Date(now - spanMs).toISOString(),
    to: new Date(now + spanMs).toISOString(),
  };
}

/**
 * Count rows starting on `now`'s calendar day in `timeZone`.
 *
 * `dateKey` is the local day being counted (for the KPI's date label);
 * both are null/0 when the timezone or instant is unusable.
 */
export function localDayCount(
  rows: ReadonlyArray<{ starts_at: string }>,
  now: number,
  timeZone: string,
): { count: number; dateKey: string | null } {
  const dateKey = localDateKey(now, timeZone);
  if (dateKey === null) {
    return { count: 0, dateKey: null };
  }

  let count = 0;
  for (const row of rows) {
    if (localDateKey(row.starts_at, timeZone) === dateKey) {
      count += 1;
    }
  }
  return { count, dateKey };
}
