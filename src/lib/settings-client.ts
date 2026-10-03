import { isValidTimeZone } from '@/lib/booking';

/**
 * Client-side restaurant-settings helpers (M10 Phase 1, plan screen 29
 * "Restaurant Settings").
 *
 * Read half uses the shipped public detail route (M6 Phase 1):
 *   GET /api/restaurants/[slug-or-id] -> { restaurant: { name, slug, timezone, ... } }
 *
 * Write half follows the plan's contract — `PUT /api/restaurants/[slug]`
 * with { name, timezone } — but no update method exists on that route
 * yet (only tables/hours/groups/reservations ship writes), so this module
 * defines the client side a backend must implement: slug and every other
 * column stay untouched, name and timezone are the editable settings.
 * Until the PUT lands a save fails with its HTTP status and the form
 * surfaces the error inline; nothing here invents local persistence.
 *
 * Authorization: membership roles are ('owner', 'manager', 'staff')
 * (001_initial_schema) — canEditSettings mirrors the manager/owner write
 * gate, and callers also classify 403s into read-only (staff role) so the
 * UI matches what the API will enforce. Every non-2xx response throws
 * SettingsApiError carrying the HTTP status: 401 -> session redirect,
 * 403 -> read-only, otherwise inline.
 *
 * Timezone validation reuses booking's isValidTimeZone (Intl round-trip),
 * the same rule the availability/booking surfaces apply.
 */

export interface SettingsFormValues {
  name: string;
  timezone: string;
}

export interface SettingsFieldErrors {
  name?: string;
  timezone?: string;
}

/** Editable settings as read from GET /api/restaurants/[slug]. */
export interface RestaurantSettings {
  name: string;
  slug: string;
  timezone: string;
}

/** First membership from GET /api/staff/me (single-restaurant MVP). */
export interface StaffContext {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export const SETTINGS_READ_ONLY_MESSAGE =
  'You have read-only access to restaurant settings — only owners and managers can make changes.';

export class SettingsApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'SettingsApiError';
    this.status = status;
  }
}

export function settingsPath(slug: string): string {
  return `/api/restaurants/${encodeURIComponent(slug)}`;
}

/** Manager/owner write gate (membership roles: owner | manager | staff). */
export function canEditSettings(role: string): boolean {
  return role === 'owner' || role === 'manager';
}

async function request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new SettingsApiError('Network error — please try again.', 0);
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
    throw new SettingsApiError(message, response.status);
  }
  return body;
}

/** First staff membership (single-restaurant MVP context), or null. */
export async function fetchStaffContext(): Promise<StaffContext | null> {
  const body = await request('/api/staff/me');
  const first = (Array.isArray(body.restaurants) ? body.restaurants : [])[0] as
    | Partial<StaffContext>
    | undefined;
  if (!first || typeof first.id !== 'string') {
    return null;
  }
  return {
    id: first.id,
    name: typeof first.name === 'string' ? first.name : '',
    slug: typeof first.slug === 'string' ? first.slug : '',
    role: typeof first.role === 'string' ? first.role : '',
  };
}

/** Coerce the editable settings out of an untrusted detail response. */
function toSettings(raw: unknown): RestaurantSettings | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.name !== 'string' ||
    typeof candidate.slug !== 'string' ||
    typeof candidate.timezone !== 'string'
  ) {
    return null;
  }
  return { name: candidate.name, slug: candidate.slug, timezone: candidate.timezone };
}

export async function fetchRestaurantSettings(slug: string): Promise<RestaurantSettings> {
  const body = await request(settingsPath(slug));
  const settings = toSettings(body.restaurant);
  if (!settings) {
    throw new SettingsApiError('Malformed restaurant response', 0);
  }
  return settings;
}

/** PUT the editable settings; slug is carried by the path, never the body. */
export async function updateRestaurantSettings(
  slug: string,
  values: SettingsFormValues,
): Promise<RestaurantSettings> {
  const body = await request(settingsPath(slug), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(toSettingsPayload(values)),
  });
  const settings = toSettings(body.restaurant);
  if (!settings) {
    throw new SettingsApiError('Malformed restaurant response', 0);
  }
  return settings;
}

/** Server's settings rules mirrored client-side (inline Field errors). */
export function validateSettingsForm(values: SettingsFormValues): SettingsFieldErrors {
  const errors: SettingsFieldErrors = {};
  if (values.name.trim().length === 0) {
    errors.name = 'Enter a name.';
  }
  if (!isValidTimeZone(values.timezone.trim())) {
    errors.timezone = 'Enter a valid time zone (for example, America/New_York).';
  }
  return errors;
}

export function toSettingsPayload(values: SettingsFormValues): { name: string; timezone: string } {
  return {
    name: values.name.trim(),
    timezone: values.timezone.trim(),
  };
}
