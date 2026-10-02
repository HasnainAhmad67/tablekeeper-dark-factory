/**
 * Operating-hours gate: pure, I/O-free evaluation of whether an absolute
 * reservation window fits inside a restaurant's local opening hours.
 *
 * Semantics mirror public.is_within_operating_hours in
 * 008_operating_hours_gate.sql:
 *   - day_of_week: 0=Sunday .. 6=Saturday (PostgreSQL EXTRACT(DOW), JS getDay)
 *   - a missing operating_hours row for the local day means closed
 *   - the entire half-open [startsAt, endsAt) must fit inside the local
 *     [opensAt, closesAt]; exact open and close boundaries are allowed
 *   - overnight (cross-local-midnight) windows are unsupported -> closed
 *   - invalid timezones, clock values, or instants fail closed
 *
 * Local wall-clock parts come from Intl.DateTimeFormat with the restaurant's
 * IANA timezone (restaurants.timezone), so DST transitions are handled by the
 * runtime tz database rather than by offset arithmetic.
 */

export interface OperatingHoursRecord {
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  is_closed: boolean | null;
}

export interface HoursContext {
  timeZone: string;
  hours: readonly OperatingHoursRecord[];
}

export type HoursClosedReason =
  | 'missing_day'
  | 'closed_flag'
  | 'crosses_midnight'
  | 'outside_hours'
  | 'invalid_hours'
  | 'invalid_timezone'
  | 'invalid_window';

export type HoursDecision = { open: true } | { open: false; reason: HoursClosedReason };

export interface LocalWallParts {
  dateKey: string;
  dayOfWeek: number;
  secondsOfDay: number;
}

// Accepts 'HH:MM', 'HH:MM:SS', and fractional seconds (Postgres time output).
const CLOCK_RE = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function closed(reason: HoursClosedReason): HoursDecision {
  return { open: false, reason };
}

/** 'HH:MM[:SS[.fff]]' -> seconds since local midnight; null when malformed. */
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

function wallFormatter(timeZone: string): Intl.DateTimeFormat | null {
  try {
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
  } catch {
    return null; // invalid IANA timezone name -> caller fails closed
  }
}

function partsOf(
  formatter: Intl.DateTimeFormat,
  instantIso: string | null | undefined,
): LocalWallParts | null {
  if (typeof instantIso !== 'string') {
    return null;
  }
  const time = Date.parse(instantIso);
  if (Number.isNaN(time)) {
    return null;
  }
  const parts = formatter.formatToParts(new Date(time));
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
    dateKey: `${year}-${month}-${day}`,
    dayOfWeek,
    secondsOfDay: hours * 3600 + minutes * 60 + seconds,
  };
}

/** Absolute instant -> restaurant-local wall parts; null on any invalid input. */
export function localWallParts(
  instantIso: string | null | undefined,
  timeZone: string | null | undefined,
): LocalWallParts | null {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') {
    return null;
  }
  const formatter = wallFormatter(timeZone);
  if (!formatter) {
    return null;
  }
  return partsOf(formatter, instantIso);
}

/**
 * Decide whether [startsAt, endsAt) fits inside the restaurant's local
 * opening interval for its start day. Fails closed on every invalid input:
 * bad timezone, malformed clock values, missing day row, cross-midnight
 * windows, and windows outside [opensAt, closesAt].
 */
export function evaluateOperatingHours(input: {
  startsAt: string | null | undefined;
  endsAt: string | null | undefined;
  timeZone: string | null | undefined;
  hours: readonly OperatingHoursRecord[] | null | undefined;
}): HoursDecision {
  const { startsAt, endsAt, timeZone, hours } = input;

  if (typeof timeZone !== 'string' || timeZone.trim() === '') {
    return closed('invalid_timezone');
  }
  const formatter = wallFormatter(timeZone);
  if (!formatter) {
    return closed('invalid_timezone');
  }

  const start = partsOf(formatter, startsAt);
  const end = partsOf(formatter, endsAt);
  if (!start || !end) {
    return closed('invalid_window');
  }

  // Overnight windows are unsupported: both endpoints must share one local date.
  if (start.dateKey !== end.dateKey) {
    return closed('crosses_midnight');
  }

  const dayRows = Array.isArray(hours) ? hours : [];
  const row = dayRows.find((candidate) => candidate?.day_of_week === start.dayOfWeek);
  if (!row) {
    return closed('missing_day'); // a missing row means closed
  }
  if (row.is_closed === true) {
    return closed('closed_flag');
  }

  const opens = parseClockSeconds(row.opens_at);
  const closes = parseClockSeconds(row.closes_at);
  if (opens === null || closes === null || closes <= opens) {
    return closed('invalid_hours');
  }

  // Entire half-open window must fit; exact open/close boundaries are allowed.
  if (start.secondsOfDay < opens || end.secondsOfDay > closes) {
    return closed('outside_hours');
  }
  return { open: true };
}
