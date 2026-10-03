/**
 * Client helpers for the staff reservation surfaces (M7 Phase 3).
 *
 * Thin fetch wrappers over the existing M5a routes (plan screen 21's
 * `GET/PATCH /api/reservations/[id]` and the list endpoint the timeline
 * screen 20 describes — the shipped route is `GET /api/reservations` with
 * `?restaurant_id&status&from&to&limit`):
 *   GET   /api/reservations?...              -> { reservations }
 *   GET   /api/reservations/[id]             -> { reservation }
 *   PATCH /api/reservations/[id] (cancelled) -> { reservation }
 *   GET   /api/restaurants/[id]              -> { restaurant } (brief: name/timezone)
 *   GET   /api/staff/me                      -> { restaurants }
 *
 * Every non-2xx response throws ReservationApiError carrying the HTTP
 * status so callers can classify: 401 -> session redirect, 403 -> forbidden,
 * 404 -> not found, 422 -> invalid filter values (surfaced inline).
 *
 * Filter semantics mirror the server (validateListQuery/listReservations):
 * `from`/`to` are ISO 8601 timestamps where `from` bounds starts_at >= from
 * and `to` bounds ends_at <= to — so a date-only pick is widened to the
 * whole local day (start through 23:59:59.999) before it is sent.
 */

import { fetchStaffContext as fetchStaffContextShared } from '@/lib/fetchStaffContext';

/** Statuses offered by the staff list filter (plan screen 21 actions). */
export const RESERVATION_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'seated', label: 'Seated' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
] as const;

export interface StaffReservation {
  id: string;
  restaurant_id: string;
  user_id: string | null;
  party_size: number;
  starts_at: string;
  ends_at: string;
  status: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  reservation_tables?: { table_id: string; status: 'active' | 'released' }[] | null;
}

export interface RestaurantBrief {
  name: string;
  timezone: string;
}

/** Staff membership from GET /api/staff/me — selected restaurant, else first. */
export interface StaffContext {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface ReservationFilters {
  /** '' means "all statuses" (status param omitted). */
  status: string;
  /** Date-only values 'YYYY-MM-DD' from <input type="date">; '' = unset. */
  fromDate: string;
  toDate: string;
}

export const INITIAL_FILTERS: ReservationFilters = {
  status: '',
  fromDate: '',
  toDate: '',
};

export class ReservationApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ReservationApiError';
    this.status = status;
  }
}

async function request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new ReservationApiError('Network error — please try again.', 0);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // Non-JSON body; status handling below still applies.
  }

  if (!response.ok) {
    const message =
      typeof body.error === 'string' ? body.error : `Request failed (${response.status})`;
    throw new ReservationApiError(message, response.status);
  }
  return body;
}

/** Local-day start as an ISO 8601 timestamp; null when the key is invalid. */
export function dayStartIso(dateKey: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return null;
  }
  const date = new Date(`${dateKey}T00:00:00`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Local-day end (23:59:59.999) as an ISO 8601 timestamp; null when invalid. */
export function dayEndIso(dateKey: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
    return null;
  }
  const date = new Date(`${dateKey}T23:59:59.999`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/**
 * Build the filtered list URL. The limit sits at the server maximum (100):
 * this screen has no pagination in this phase, so the cap is the honest
 * ceiling on what a busy service day can show.
 */
export function listReservationsPath(
  restaurantId: string,
  filters: ReservationFilters,
): string {
  const params = new URLSearchParams();
  params.set('restaurant_id', restaurantId);
  if (filters.status !== '') {
    params.set('status', filters.status);
  }
  const from = dayStartIso(filters.fromDate);
  if (from !== null) {
    params.set('from', from);
  }
  const to = dayEndIso(filters.toDate);
  if (to !== null) {
    params.set('to', to);
  }
  params.set('limit', '100');
  return `/api/reservations?${params.toString()}`;
}

/**
 * Selected staff membership (stored restaurant id from the Restaurant
 * Switcher, falling back to the first membership), or null. Shares the
 * resolution with the other client libs via lib/fetchStaffContext; the
 * request stays local so ReservationApiError statuses are preserved.
 */
export async function fetchStaffContext(): Promise<StaffContext | null> {
  return fetchStaffContextShared(request);
}

export async function fetchReservations(
  restaurantId: string,
  filters: ReservationFilters,
): Promise<StaffReservation[]> {
  const body = await request(listReservationsPath(restaurantId, filters));
  return Array.isArray(body.reservations) ? (body.reservations as StaffReservation[]) : [];
}

export async function fetchReservation(id: string): Promise<StaffReservation> {
  const body = await request(`/api/reservations/${encodeURIComponent(id)}`);
  const reservation = body.reservation as StaffReservation | undefined;
  if (!reservation) {
    throw new ReservationApiError('Reservation not found', 404);
  }
  return reservation;
}

/** Cancel via the M5a PATCH contract: { status: "cancelled" } only. */
export async function cancelReservation(id: string): Promise<StaffReservation> {
  const body = await request(`/api/reservations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  const reservation = body.reservation as StaffReservation | undefined;
  if (!reservation) {
    throw new ReservationApiError('Internal error', 500);
  }
  return reservation;
}

/** Public restaurant brief (name + timezone) for time labels; null when hidden. */
export async function fetchRestaurantBrief(
  restaurantId: string,
): Promise<RestaurantBrief | null> {
  const body = await request(`/api/restaurants/${encodeURIComponent(restaurantId)}`);
  const restaurant = body.restaurant as Partial<RestaurantBrief> | undefined;
  if (!restaurant?.name || !restaurant.timezone) {
    return null;
  }
  return { name: restaurant.name, timezone: restaurant.timezone };
}
