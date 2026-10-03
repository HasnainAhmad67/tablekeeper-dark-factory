/**
 * Client-side booking helpers: timezone-safe slot generation and display
 * formatting, implemented with the platform's Intl API only (no date
 * libraries — the approved baseline ships none).
 *
 * Semantics mirror src/server/hours.ts and 008_operating_hours_gate.sql so
 * generated slots are exactly the windows the server will accept:
 *   - day_of_week: 0=Sunday .. 6=Saturday (EXTRACT(DOW), JS getDay)
 *   - a missing operating_hours row or is_closed=true means closed
 *   - the whole [slot, slot + duration) must fit inside [opens, closes],
 *     with exact open/close boundaries allowed
 *   - cross-local-midnight windows are unsupported (fail closed)
 *   - invalid timezones, clock values, and DST spring-forward wall times
 *     (non-existent local times) fail closed and are skipped
 *
 * Wall-clock → instant conversion is the inverse of the server's
 * localWallParts: two offset passes plus a wall-clock verification, so DST
 * transitions are handled by the runtime tz database rather than by fixed
 * offset arithmetic.
 */

/** Fixed reservation length (plan decision: duration = 2 hours). */
export const RESERVATION_DURATION_MINUTES = 120;
/** Search window granularity (plan decision: 30-minute slots). */
export const SLOT_STEP_MINUTES = 30;
/** Slot horizon in restaurant-local days: today + next 7 days. */
export const SLOT_HORIZON_DAYS = 7;

export interface OperatingHoursRow {
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  is_closed: boolean | null;
}

/** Shape of one ranked option returned by the availability API. */
export interface AvailabilityOption {
  kind: 'table' | 'group';
  id: string;
  label: string;
  tableIds: string[];
  capacity: number;
  surplus: number;
}

export interface TimeSlot {
  /** ISO 8601 with offset ('Z'); matches the API's ISO_8601_RE. */
  startsAt: string;
  endsAt: string;
  /** Restaurant-local calendar date (YYYY-MM-DD) of the slot start. */
  dateKey: string;
}

const CLOCK_RE = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Human day names indexed by day_of_week (0 = Sunday). */
export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

interface WallParts {
  year: number;
  month: number;
  day: number;
  secondsOfDay: number;
  dayOfWeek: number;
  dateKey: string;
}

function pad(value: number, size: number): string {
  return String(value).padStart(size, '0');
}

/** 'HH:MM[:SS[.fff]]' → seconds since local midnight; null when malformed. */
export function parseClockSeconds(value: string | null | undefined): number | null {
  if (typeof value !== 'string') {
    return null;
  }
  const match = CLOCK_RE.exec(value);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] !== undefined ? Number(match[3]) : 0;
  if (hours > 23 || minutes > 59 || seconds > 59) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

/** True when the value is a usable IANA timezone name for Intl. */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function wallFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}

/** Absolute instant → restaurant-local wall parts; null on any bad input. */
function wallPartsOf(instantMs: number, timeZone: string): WallParts | null {
  if (!Number.isFinite(instantMs)) {
    return null;
  }
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = wallFormatter(timeZone).formatToParts(new Date(instantMs));
  } catch {
    return null;
  }
  const value = (type: Intl.DateTimeFormatPartTypes): string | undefined =>
    parts.find((part) => part.type === type)?.value;

  const weekday = value('weekday');
  const year = value('year');
  const month = value('month');
  const day = value('day');
  const hour = value('hour');
  const minute = value('minute');
  const second = value('second');
  if (
    weekday === undefined ||
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined
  ) {
    return null;
  }
  const dayOfWeek = WEEKDAY_INDEX[weekday];
  const hours = Number(hour);
  const minutes = Number(minute);
  const seconds = Number(second);
  if (
    dayOfWeek === undefined ||
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    Number.isNaN(seconds) ||
    hours > 23 ||
    minutes > 59 ||
    seconds > 59
  ) {
    return null;
  }
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    secondsOfDay: hours * 3600 + minutes * 60 + seconds,
    dayOfWeek,
    dateKey: `${year}-${month}-${day}`,
  };
}

/** Offset (ms) of `timeZone` at `utcMs`: local wall clock minus UTC wall clock. */
function timeZoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = wallPartsOf(utcMs, timeZone);
  if (!parts) {
    return 0;
  }
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    Math.floor(parts.secondsOfDay / 3600),
    Math.floor((parts.secondsOfDay % 3600) / 60),
    parts.secondsOfDay % 60,
  );
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Restaurant-local wall time → epoch ms.
 *
 * Two offset passes converge across DST transitions; the result is only
 * accepted when it renders back to the requested wall time, so a
 * spring-forward gap (e.g. 02:30 on a US DST night) fails closed with null.
 * Ambiguous fall-back wall times resolve to one real instant.
 */
export function zonedWallToEpoch(
  dateKey: string,
  secondsOfDay: number,
  timeZone: string,
): number | null {
  const dateMatch = DATE_KEY_RE.exec(dateKey);
  if (!dateMatch || !Number.isInteger(secondsOfDay) || secondsOfDay < 0 || secondsOfDay >= 86400) {
    return null;
  }
  if (!isValidTimeZone(timeZone)) {
    return null;
  }
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const naiveUtc = Date.UTC(year, month - 1, day, 0, 0, 0) + secondsOfDay * 1000;
  const firstGuess = naiveUtc - timeZoneOffsetMs(naiveUtc, timeZone);
  const resolved = naiveUtc - timeZoneOffsetMs(firstGuess, timeZone);

  const parts = wallPartsOf(resolved, timeZone);
  if (
    !parts ||
    parts.year !== year ||
    parts.month !== month ||
    parts.day !== day ||
    parts.secondsOfDay !== secondsOfDay
  ) {
    return null; // non-existent local time (DST gap) or unresolvable input
  }
  return resolved;
}

/** Instant → restaurant-local 'YYYY-MM-DD'; null when input or tz is invalid. */
export function localDateKey(
  instant: Date | number | string,
  timeZone: string,
): string | null {
  const ms =
    instant instanceof Date
      ? instant.getTime()
      : typeof instant === 'number'
        ? instant
        : Date.parse(instant);
  if (!Number.isFinite(ms) || !isValidTimeZone(timeZone)) {
    return null;
  }
  const parts = wallPartsOf(ms, timeZone);
  return parts ? parts.dateKey : null;
}

/** Weekday (0 = Sunday) of a local date in a timezone; null when invalid. */
export function dayOfWeekOf(dateKey: string, timeZone: string): number | null {
  // Noon avoids DST transitions scheduled at local midnight.
  const epoch = zonedWallToEpoch(dateKey, 43200, timeZone);
  if (epoch === null) {
    return null;
  }
  return wallPartsOf(epoch, timeZone)?.dayOfWeek ?? null;
}

function addDays(dateKey: string, days: number): string | null {
  const match = DATE_KEY_RE.exec(dateKey);
  if (!match) {
    return null;
  }
  const target = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) + days * 86400000,
  );
  return `${pad(target.getUTCFullYear(), 4)}-${pad(target.getUTCMonth() + 1, 2)}-${pad(
    target.getUTCDate(),
    2,
  )}`;
}

/**
 * The search horizon: today plus the next `horizonDays` local dates in the
 * restaurant's timezone. Empty when the timezone or anchor is invalid.
 */
export function slotDateKeys(
  now: Date | number,
  timeZone: string,
  horizonDays: number = SLOT_HORIZON_DAYS,
): string[] {
  const today = localDateKey(now, timeZone);
  if (!today || !Number.isInteger(horizonDays) || horizonDays < 0) {
    return [];
  }
  const keys: string[] = [];
  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const key = addDays(today, offset);
    if (key) {
      keys.push(key);
    }
  }
  return keys;
}

/**
 * Slots for one local day: every `stepMinutes` start from `opens` while the
 * full duration still fits at or before `closes`. Each candidate is resolved
 * through zonedWallToEpoch (DST gaps skip) and re-checked against the server
 * gate's rules (same local date, end within closing time).
 */
function daySlots(
  dateKey: string,
  row: OperatingHoursRow,
  timeZone: string,
  stepSeconds: number,
  durationSeconds: number,
): TimeSlot[] {
  const opens = parseClockSeconds(row.opens_at);
  const closes = parseClockSeconds(row.closes_at);
  if (opens === null || closes === null || closes <= opens) {
    return []; // invalid or cross-midnight hours fail closed, like the server
  }

  const out: TimeSlot[] = [];
  for (let start = opens; start + durationSeconds <= closes; start += stepSeconds) {
    const startMs = zonedWallToEpoch(dateKey, start, timeZone);
    if (startMs === null) {
      continue; // DST gap: the local time does not exist
    }
    const endMs = startMs + durationSeconds * 1000;
    const startParts = wallPartsOf(startMs, timeZone);
    const endParts = wallPartsOf(endMs, timeZone);
    if (!startParts || !endParts) {
      continue;
    }
    if (startParts.dateKey !== dateKey || endParts.dateKey !== dateKey) {
      continue; // window crosses local midnight once DST is applied
    }
    if (startParts.secondsOfDay < opens || endParts.secondsOfDay > closes) {
      continue; // mirror evaluateOperatingHours' bounds check
    }
    out.push({
      startsAt: new Date(startMs).toISOString(),
      endsAt: new Date(endMs).toISOString(),
      dateKey,
    });
  }
  return out;
}

export interface GenerateSlotsInput {
  timeZone: string;
  operatingHours: readonly OperatingHoursRow[];
  /** Anchor instant; slots begin at its restaurant-local date. Default now. */
  now?: number;
  stepMinutes?: number;
  durationMinutes?: number;
  horizonDays?: number;
}

/**
 * Ranked-agnostic slot list for the horizon: today + next 7 days by default,
 * ascending by instant. Invalid timezone, bad durations, missing rows, and
 * closed days simply yield no slots (fail closed).
 */
export function generateSlots(input: GenerateSlotsInput): TimeSlot[] {
  const { timeZone, operatingHours } = input;
  if (!isValidTimeZone(timeZone) || !Array.isArray(operatingHours)) {
    return [];
  }
  const stepSeconds = (input.stepMinutes ?? SLOT_STEP_MINUTES) * 60;
  const durationSeconds = (input.durationMinutes ?? RESERVATION_DURATION_MINUTES) * 60;
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0 || durationSeconds <= 0) {
    return [];
  }
  const now = input.now ?? Date.now();
  const dateKeys = slotDateKeys(now, timeZone, input.horizonDays ?? SLOT_HORIZON_DAYS);
  if (dateKeys.length === 0) {
    return [];
  }

  const slots: TimeSlot[] = [];
  for (const dateKey of dateKeys) {
    const dayOfWeek = dayOfWeekOf(dateKey, timeZone);
    if (dayOfWeek === null) {
      continue;
    }
    const row = operatingHours.find((candidate) => candidate.day_of_week === dayOfWeek);
    if (!row || row.is_closed === true) {
      continue; // missing row or closed flag: closed for the day
    }
    slots.push(...daySlots(dateKey, row, timeZone, stepSeconds, durationSeconds));
  }
  return slots;
}

/** '11:00:00' → '11:00 AM'; '' for malformed clock values. */
export function formatClock(value: string | null | undefined): string {
  const total = parseClockSeconds(value);
  if (total === null) {
    return '';
  }
  const hours24 = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${pad(minutes, 2)} ${period}`;
}

/** Slot start instant → '7:00 PM' in the restaurant timezone. */
export function formatSlotLabel(startsAt: string, timeZone: string): string {
  const ms = Date.parse(startsAt);
  if (Number.isNaN(ms)) {
    return startsAt;
  }
  const tz = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(ms);
}

/** 'Mon, Jun 1, 2026 · 11:00 AM – 1:00 PM' in the restaurant timezone. */
export function formatWhenLabel(startsAt: string, endsAt: string, timeZone: string): string {
  const start = Date.parse(startsAt);
  if (Number.isNaN(start)) {
    return startsAt;
  }
  const tz = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const timeFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const end = Date.parse(endsAt);
  const endLabel = Number.isNaN(end) ? '' : timeFmt.format(end);
  return `${dateFmt.format(start)} · ${timeFmt.format(start)}${endLabel ? ` – ${endLabel}` : ''}`;
}

/** '2026-06-01' → 'Mon, Jun 1, 2026' (interpreted as local noon). */
export function formatDateKeyLabel(dateKey: string, timeZone: string): string {
  const epoch = zonedWallToEpoch(dateKey, 43200, timeZone);
  if (epoch === null) {
    return dateKey;
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(epoch);
}
