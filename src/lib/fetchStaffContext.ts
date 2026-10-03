/**
 * Shared staff-context resolution for GET /api/staff/me (multi-restaurant
 * integration).
 *
 * Every client lib used to inline its own "first membership" copy of this
 * logic (single-restaurant MVP — nine historical copies; the
 * reservations-client docblock reserved this promotion: "a shared helper
 * can dedupe these later if authorized"). The RestaurantSwitcher slice
 * (src/lib/auth.ts) stores the active restaurant selection, and this
 * module is the read side: `fetchStaffContext` resolves the membership
 * matching `getSelectedRestaurantId()`, falling back to the first
 * membership when the stored id is missing, invalid, expired, or belongs
 * to a restaurant the user was removed from (plan line 498 —
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

/** Coerce one untrusted membership entry; null when structurally unusable. */
function toStaffContext(entry: unknown): StaffContext | null {
  if (typeof entry !== 'object' || entry === null) {
    return null;
  }
  const candidate = entry as Partial<StaffContext>;
  if (typeof candidate.id !== 'string') {
    return null;
  }
  return {
    id: candidate.id,
    name: typeof candidate.name === 'string' ? candidate.name : '',
    slug: typeof candidate.slug === 'string' ? candidate.slug : '',
    role: typeof candidate.role === 'string' ? candidate.role : '',
  };
}

/**
 * Every staff membership from GET /api/staff/me, in the API's order
 * (restaurant name). Provided for list consumers (the RestaurantSwitcher
 * reads the same payload today and can dedupe onto this helper later) and
 * as the single coercion point the selection path builds on.
 */
export async function fetchAllStaffContext(
  request: StaffContextRequest,
): Promise<StaffContext[]> {
  const body = await request('/api/staff/me');
  const restaurants = Array.isArray(body.restaurants) ? body.restaurants : [];
  const memberships: StaffContext[] = [];
  for (const entry of restaurants) {
    const membership = toStaffContext(entry);
    if (membership !== null) {
      memberships.push(membership);
    }
  }
  return memberships;
}

/**
 * Selected staff membership from GET /api/staff/me, or null when the
 * payload has no usable membership.
 *
 * Selection rules: stored id that still matches a membership wins;
 * anything else falls back to the first membership (the API orders by
 * restaurant name — the pre-existing default context).
 */
export async function fetchStaffContext(
  request: StaffContextRequest,
): Promise<StaffContext | null> {
  const memberships = await fetchAllStaffContext(request);

  const storedId = getSelectedRestaurantId();
  const selected =
    storedId === null
      ? undefined
      : memberships.find((membership) => membership.id === storedId);

  return selected ?? memberships[0] ?? null;
}
