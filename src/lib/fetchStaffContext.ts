/**
 * Shared staff-context resolution for GET /api/staff/me (multi-restaurant
 * integration slice).
 *
 * Every client lib used to inline its own "first membership" copy of this
 * logic (single-restaurant MVP — see the nine historical copies; the
 * reservations-client docblock even reserved this promotion: "a shared
 * helper can dedupe these later if authorized"). The RestaurantSwitcher
 * slice (src/lib/auth.ts) stores the active restaurant selection, and
 * this module is the read side: `fetchStaffContext` resolves the
 * membership matching `getSelectedRestaurantId()`, falling back to the
 * first membership when the stored id is missing, invalid, expired, or
 * belongs to a restaurant the user was removed from (plan line 498 —
 * restaurant_memberships is the source of truth; line 990 — single for
 * MVP, multi selectable later).
 *
 * The `request` parameter is each client lib's own request() so error
 * semantics stay per-lib: pages rely on their typed errors
 * (e.g. `err instanceof ReservationApiError && err.status === 401` to
 * redirect to login), and the network/JSON/status handling must not
 * change (no breaking changes).
 */

import { getSelectedRestaurantId } from '@/lib/auth';

/** Restaurant context resolved from GET /api/staff/me. */
export interface StaffContext {
  id: string;
  name: string;
  slug: string;
  role: string;
}

/** Minimal request contract — satisfied by every client lib's request(). */
export type StaffContextRequest = (
  path: string,
) => Promise<Record<string, unknown>>;

/**
 * Selected staff membership from GET /api/staff/me, or null when the
 * payload has no usable membership.
 *
 * Selection rules: stored id that still matches a membership wins;
 * anything else falls back to `restaurants[0]` (the API orders by
 * restaurant name, which is the pre-existing default context).
 */
export async function fetchStaffContext(
  request: StaffContextRequest,
): Promise<StaffContext | null> {
  const body = await request('/api/staff/me');
  const restaurants = Array.isArray(body.restaurants) ? body.restaurants : [];

  const storedId = getSelectedRestaurantId();
  const selected =
    storedId === null
      ? undefined
      : restaurants.find(
          (entry) =>
            typeof entry === 'object' &&
            entry !== null &&
            (entry as { id?: unknown }).id === storedId,
        );
  const chosen = (selected ?? restaurants[0]) as Partial<StaffContext> | undefined;

  if (!chosen || typeof chosen.id !== 'string') {
    return null;
  }
  return {
    id: chosen.id,
    name: typeof chosen.name === 'string' ? chosen.name : '',
    slug: typeof chosen.slug === 'string' ? chosen.slug : '',
    role: typeof chosen.role === 'string' ? chosen.role : '',
  };
}
