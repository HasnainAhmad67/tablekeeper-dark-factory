/**
 * Client-side operating-hours helpers (M7 Phase 4, plan screen 28
 * "Operating Hours").
 *
 * Thin fetch wrappers over the new hours route plus the form's validation
 * mirror of the server boundary rules:
 *   GET    /api/restaurants/[restaurantId]/hours -> { hours }
 *   PUT    /api/restaurants/[restaurantId]/hours -> { hours } (saved rows)
 *   GET    /api/staff/me               -> { restaurants }
 *
 * Every non-2xx response throws HoursApiError carrying the HTTP status, so
 * callers can implement the plan's states without re-parsing bodies:
 * 401 -> session redirect, 403 -> read-only (Manager/Owner write gate).
 *
 * Times are handled as 'HH:MM' strings throughout: the API normalizes the
 * database `time` type ('HH:MM:SS') to 'HH:MM' on the way out, and native
 * <input type="time"> values are always 'HH:MM'.
 */

export interface OperatingHour {
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  is_closed: boolean;
}

/** Day-of-week lookup in the form's Sun-Sat display order. */
export interface DayOption {
  value: number;
  short: string;
  name: string;
}

export const DAYS_OF_WEEK: readonly DayOption[] = [
  { value: 0, short: 'sun', name: 'Sunday' },
  { value: 1, short: 'mon', name: 'Monday' },
  { value: 2, short: 'tue', name: 'Tuesday' },
  { value: 3, short: 'wed', name: 'Wednesday' },
  { value: 4, short: 'thu', name: 'Thursday' },
  { value: 5, short: 'fri', name: 'Friday' },
  { value: 6, short: 'sat', name: 'Saturday' },
];

/** First membership from GET /api/staff/me (single-restaurant MVP). */
export interface StaffContext {
  id: string;
  name: string;
  slug: string;
  role: string;
}

/** Validation errors keyed by `${dayShort}-opens` / `${dayShort}-closes`. */
export type HoursFieldErrors = Record<string, string>;

export class HoursApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'HoursApiError';
    this.status = status;
  }
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export function isValidTime(value: string): boolean {
  return TIME_PATTERN.test(value);
}

/** Normalize 'HH:MM:SS' (database `time`) to 'HH:MM'; invalid input -> ''. */
export function normalizeTime(value: string): string {
  if (!isValidTime(value)) {
    return '';
  }
  return value.slice(0, 5);
}

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

async function request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new HoursApiError('Network error — please try again.', 0);
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
    throw new HoursApiError(message, response.status);
  }
  return body;
}

export function hoursPath(restaurantId: string): string {
  return `/api/restaurants/${encodeURIComponent(restaurantId)}/hours`;
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

/** Current hours, normalized to 'HH:MM' and sorted Sunday first. */
export async function fetchHours(restaurantId: string): Promise<OperatingHour[]> {
  const body = await request(hoursPath(restaurantId));
  return normalizeHours(body.hours);
}

/** Persist hours (upsert) and return the saved rows. */
export async function saveHours(
  restaurantId: string,
  hours: OperatingHour[],
): Promise<OperatingHour[]> {
  const body = await request(hoursPath(restaurantId), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hours }),
  });
  return normalizeHours(body.hours);
}

/** Coerce an untrusted API payload into sorted, well-formed rows. */
export function normalizeHours(raw: unknown): OperatingHour[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const rows: OperatingHour[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }
    const candidate = entry as Record<string, unknown>;
    if (
      typeof candidate.day_of_week !== 'number' ||
      !Number.isInteger(candidate.day_of_week) ||
      candidate.day_of_week < 0 ||
      candidate.day_of_week > 6 ||
      typeof candidate.opens_at !== 'string' ||
      typeof candidate.closes_at !== 'string'
    ) {
      continue;
    }
    rows.push({
      day_of_week: candidate.day_of_week,
      opens_at: normalizeTime(candidate.opens_at),
      closes_at: normalizeTime(candidate.closes_at),
      is_closed: candidate.is_closed === true,
    });
  }
  return rows.sort((a, b) => a.day_of_week - b.day_of_week);
}

/**
 * Form defaults for a restaurant with no hours rows yet. A missing
 * operating_hours row means closed for that day (migration 008), so the
 * safe default is every day closed with placeholder times that satisfy the
 * closes_at > opens_at rule (the schema has no overnight hours).
 */
export function defaultHours(): OperatingHour[] {
  return DAYS_OF_WEEK.map((day) => ({
    day_of_week: day.value,
    opens_at: '11:00',
    closes_at: '22:00',
    is_closed: true,
  }));
}

/**
 * Client mirror of the server's hours validation: valid 'HH:MM' times and
 * closes_at > opens_at on every day (the schema CHECK applies regardless of
 * is_closed). Errors are keyed for Field's inline role="alert" wiring.
 */
export function validateHoursForm(hours: OperatingHour[]): HoursFieldErrors {
  const errors: HoursFieldErrors = {};

  for (const hour of hours) {
    const day = DAYS_OF_WEEK[hour.day_of_week];
    if (!day) {
      continue;
    }
    const opensKey = `${day.short}-opens`;
    const closesKey = `${day.short}-closes`;
    const opensValid = isValidTime(hour.opens_at);
    const closesValid = isValidTime(hour.closes_at);

    if (!opensValid) {
      errors[opensKey] = 'Enter an opening time.';
    }
    if (!closesValid) {
      errors[closesKey] = 'Enter a closing time.';
    }
    if (opensValid && closesValid && toMinutes(hour.closes_at) <= toMinutes(hour.opens_at)) {
      errors[closesKey] =
        'Closing time must be later than opening time — overnight hours are not supported.';
    }
  }

  return errors;
}
