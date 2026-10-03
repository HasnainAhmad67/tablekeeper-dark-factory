/**
 * Active-restaurant session context for the multi-restaurant switcher.
 *
 * Plan: restaurant_memberships already "enables multi-restaurant support
 * — a user can belong to multiple restaurants with different roles"
 * (line 498), Section N decision 4 (line 990) kept the MVP single with
 * "UI can be added later", and line 185 lists multi-restaurant per user
 * as [FUTURE] (line 952 requires it to be labelled as planned) — this
 * slice is the authorized UI, so the schema decision (existing
 * memberships table) and "first membership is default" both hold.
 *
 * Context model: every fetchStaffContext copy resolves the staff context
 * from GET /api/staff/me and keeps the FIRST membership (ordered by
 * restaurant name — see src/lib/staff.ts getStaffIdentity). This module
 * persists WHICH membership is active so RestaurantSwitcher can show the
 * current selection after a reload, and so a future fetchStaffContext
 * (not in this slice's file list) can read it back and order the
 * context accordingly.
 *
 * Storage: localStorage under one key — the working restaurant sticks
 * across reloads and tabs for the signed-in device, which matches a
 * staff tablet's shift-long session. Writes and reads are guarded:
 * SSR has no window (no-op/null) and private modes can throw on
 * access, which degrades to "no stored choice" instead of crashing.
 * There is no cross-tab event and no membership validation here — the
 * caller checks the id against the fetched membership list before
 * trusting it (see RestaurantSwitcher).
 */

/** localStorage key holding the active restaurant id (uuid). */
export const RESTAURANT_STORAGE_KEY = 'tablekeeper.currentRestaurantId';

/** Persist `restaurantId` as the active restaurant context. */
export function switchRestaurant(restaurantId: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    window.localStorage.setItem(RESTAURANT_STORAGE_KEY, restaurantId);
  } catch {
    // Storage unavailable (private mode/quota): the selection simply
    // does not survive the reload; the default first membership applies.
  }
}

/** The stored active restaurant id, or null when unset/unavailable. */
export function getSelectedRestaurantId(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage.getItem(RESTAURANT_STORAGE_KEY);
  } catch {
    return null;
  }
}
