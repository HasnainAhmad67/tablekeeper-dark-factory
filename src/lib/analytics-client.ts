import { isValidTimeZone, localDateKey, formatDateKeyLabel } from '@/lib/booking';

/**
 * Client-side analytics helpers (Analytics dashboard, plan line 944
 * "What May Be a Polished Prototype"; peak-time analytics is tagged
 * [FUTURE] at line 182 and is built here as a prototype slice).
 *
 * Data source: the shipped M5a list endpoint — no new API exists:
 *   GET /api/reservations?restaurant_id=&from=&to=&limit=100 -> { reservations }
 * It 401s without a session and 403s for non-members (handled by
 * callers), and caps at MAX_LIST_LIMIT = 100 rows ordered starts_at ASC —
 * so every metric/CSV here covers at most the first 100 reservations in
 * the fetched window (surfaced as a footnote in the UI; raising the cap
 * would touch frozen reservation logic).
 *
 * One fetch serves the page: the window is max(range, 30) days so the
 * today/week/month cards stay correct for every filter (week = trailing
 * 7 days, month = trailing 30 days, today = calendar day), while the
 * chart, popular-times histogram, and CSV export slice the fetched rows
 * to the selected 7/30/90-day range. All bucketing happens in the
 * restaurant's timezone when known (public GET /api/restaurants/[slug]),
 * falling back to the browser zone — the same precedence StaffOverview
 * and ReservationList use. Every helper is pure with `nowMs` injected so
 * the tests assert exact buckets.
 *
 * Non-2xx responses throw AnalyticsError carrying the HTTP status:
 * 401 -> session redirect, otherwise the plan's Retry error state.
 */

export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

const DAY_MS = 86_400_000;
/** Month card window (trailing days) — also the minimum fetch window. */
export const MONTH_DAYS = 30;

/** Rows consumed from GET /api/reservations (analytics needs these only). */
export interface AnalyticsReservation {
  id: string;
  starts_at: string;
  ends_at: string;
  party_size: number;
  status: string;
  notes: string | null;
}

export interface DailyPoint {
  /** YYYY-MM-DD in the restaurant timezone. */
  date: string;
  /** Axis label ("Oct 3"). */
  label: string;
  count: number;
}

export interface PopularHour {
  /** 0-23 in the restaurant timezone. */
  hour: number;
  count: number;
}

export interface AnalyticsMetrics {
  total: number;
  today: number;
  week: number;
  month: number;
  /** Mean party_size over the range; 0 when the range is empty. */
  avgPartySize: number;
}

/** First membership from GET /api/staff/me (single-restaurant MVP). */
export interface StaffContext {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export class AnalyticsError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'AnalyticsError';
    this.status = status;
  }
}

async function request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new AnalyticsError('Network error — please try again.', 0);
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
    throw new AnalyticsError(message, response.status);
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

/**
 * Restaurant timezone from the shipped public detail route — advisory
 * only, so failures (offline, malformed) degrade to the browser zone
 * instead of failing the dashboard.
 */
export async function fetchRestaurantTimezone(slug: string): Promise<string | null> {
  try {
    const body = await request(`/api/restaurants/${encodeURIComponent(slug)}`);
    const restaurant = body.restaurant as Record<string, unknown> | undefined;
    const timezone = restaurant?.timezone;
    return typeof timezone === 'string' && isValidTimeZone(timezone) ? timezone : null;
  } catch {
    return null;
  }
}

/** Coerce one untrusted reservation row; null when structurally unusable. */
function toReservation(raw: unknown): AnalyticsReservation | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.starts_at !== 'string' ||
    typeof candidate.status !== 'string' ||
    typeof candidate.party_size !== 'number'
  ) {
    return null;
  }
  return {
    id: candidate.id,
    starts_at: candidate.starts_at,
    ends_at: typeof candidate.ends_at === 'string' ? candidate.ends_at : '',
    party_size: candidate.party_size,
    status: candidate.status,
    notes: typeof candidate.notes === 'string' ? candidate.notes : null,
  };
}

/** Fetch window start: max(range, 30) days before nowMs. */
export function fetchWindowStart(range: AnalyticsRange, nowMs: number): number {
  return nowMs - Math.max(range, MONTH_DAYS) * DAY_MS;
}

/** Reservations whose starts_at falls inside the selected range. */
export function filterRowsInRange(
  rows: AnalyticsReservation[],
  range: AnalyticsRange,
  nowMs: number,
): AnalyticsReservation[] {
  const from = nowMs - range * DAY_MS;
  return rows.filter((row) => {
    const ms = Date.parse(row.starts_at);
    return Number.isFinite(ms) && ms >= from && ms <= nowMs;
  });
}

/** One windowed read of the restaurant's reservations (server limit 100). */
export async function fetchAnalyticsReservations(
  restaurantId: string,
  fromMs: number,
  toMs: number,
): Promise<AnalyticsReservation[]> {
  const params = new URLSearchParams({
    restaurant_id: restaurantId,
    from: new Date(fromMs).toISOString(),
    to: new Date(toMs).toISOString(),
    limit: '100',
  });
  const body = await request(`/api/reservations?${params.toString()}`);
  return (Array.isArray(body.reservations) ? body.reservations : [])
    .map(toReservation)
    .filter((row): row is AnalyticsReservation => row !== null);
}

function effectiveZone(timeZone: string): string {
  return isValidTimeZone(timeZone) ? timeZone : 'UTC';
}

/** Calendar date key (YYYY-MM-DD) of a local date key decremented by n days. */
function minusDays(dateKey: string, days: number): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) {
    return null;
  }
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) - days * DAY_MS;
  const shifted = new Date(ms);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Local hour (0-23) of an instant in a timezone; null when unparseable. */
function localHour(instant: string, timeZone: string): number | null {
  const ms = Date.parse(instant);
  if (!Number.isFinite(ms)) {
    return null;
  }
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(ms);
  const hour = Number(formatted);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

/**
 * Card metrics: total in the selected range, plus today (calendar day in
 * the restaurant timezone), trailing-7-day week, trailing-30-day month.
 */
export function computeMetrics(
  rows: AnalyticsReservation[],
  range: AnalyticsRange,
  nowMs: number,
  timeZone: string,
): AnalyticsMetrics {
  const tz = effectiveZone(timeZone);
  const todayKey = localDateKey(nowMs, tz);

  let today = 0;
  let week = 0;
  let month = 0;
  for (const row of rows) {
    const ms = Date.parse(row.starts_at);
    if (!Number.isFinite(ms)) {
      continue;
    }
    if (ms >= nowMs - 7 * DAY_MS && ms <= nowMs) {
      week += 1;
    }
    if (ms >= nowMs - MONTH_DAYS * DAY_MS && ms <= nowMs) {
      month += 1;
    }
    if (todayKey !== null && localDateKey(ms, tz) === todayKey) {
      today += 1;
    }
  }

  const inRange = filterRowsInRange(rows, range, nowMs);
  const partySum = inRange.reduce((sum, row) => sum + row.party_size, 0);

  return {
    total: inRange.length,
    today,
    week,
    month,
    avgPartySize: inRange.length > 0 ? partySum / inRange.length : 0,
  };
}

/**
 * One point per calendar day for the range (ending today), zero-filled so
 * the chart's axis stays continuous.
 */
export function computeDailySeries(
  rows: AnalyticsReservation[],
  range: AnalyticsRange,
  nowMs: number,
  timeZone: string,
): DailyPoint[] {
  const tz = effectiveZone(timeZone);
  const todayKey = localDateKey(nowMs, tz);
  if (!todayKey) {
    return [];
  }

  const counts = new Map<string, number>();
  const from = nowMs - range * DAY_MS;
  for (const row of rows) {
    const ms = Date.parse(row.starts_at);
    if (!Number.isFinite(ms) || ms < from || ms > nowMs) {
      continue;
    }
    const key = localDateKey(ms, tz);
    if (key) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  const points: DailyPoint[] = [];
  for (let offset = range - 1; offset >= 0; offset -= 1) {
    const date = minusDays(todayKey, offset);
    if (!date) {
      continue;
    }
    points.push({
      date,
      label: formatDateKeyLabel(date, tz),
      count: counts.get(date) ?? 0,
    });
  }
  return points;
}

/** Reservations by local hour of day (0-23) for the range, zero-filled. */
export function computePopularTimes(
  rows: AnalyticsReservation[],
  range: AnalyticsRange,
  nowMs: number,
  timeZone: string,
): PopularHour[] {
  const tz = effectiveZone(timeZone);
  const counts = new Array<number>(24).fill(0);
  for (const row of filterRowsInRange(rows, range, nowMs)) {
    const hour = localHour(row.starts_at, tz);
    if (hour !== null) {
      counts[hour] += 1;
    }
  }
  return counts.map((count, hour) => ({ hour, count }));
}

function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) {
    return '""';
  }
  return `"${String(value).replace(/"/g, '""')}"`;
}

/** RFC 4180 CSV of the exportable columns (every cell quoted). */
export function toCsv(rows: AnalyticsReservation[]): string {
  const header = ['id', 'starts_at', 'ends_at', 'party_size', 'status', 'notes'];
  const lines = [header.map(csvCell).join(',')];
  for (const row of rows) {
    lines.push(
      [
        csvCell(row.id),
        csvCell(row.starts_at),
        csvCell(row.ends_at),
        csvCell(row.party_size),
        csvCell(row.status),
        csvCell(row.notes),
      ].join(','),
    );
  }
  return lines.join('\r\n');
}

/** `reservations-<range>d-<YYYY-MM-DD>.csv` (UTC date stamp). */
export function csvFilename(range: AnalyticsRange, nowMs: number): string {
  return `reservations-${range}d-${localDateKey(nowMs, 'UTC') ?? 'export'}.csv`;
}

/** Trigger a browser download of the generated CSV (no server round-trip). */
export function downloadCsv(csv: string, filename: string): void {
  if (typeof document === 'undefined') {
    return;
  }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
