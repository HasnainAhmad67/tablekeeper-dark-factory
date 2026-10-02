import { describe, expect, it } from 'vitest';
import {
  evaluateOperatingHours,
  localWallParts,
  parseClockSeconds,
  type OperatingHoursRecord,
} from '@/server/hours';

/**
 * Unit tests for the operating-hours gate (pure logic, no I/O).
 *
 * Wall-clock conversions use America/New_York so DST rules (spring-forward
 * 2026-03-08, fall-back 2026-11-01 — both US rules) are exercised against
 * real tz data. Local weekday anchors used here (verified independently):
 *   2026-06-01 Monday, 2026-06-06 Saturday, 2026-06-07 Sunday.
 */

const NY = 'America/New_York';

function day(
  dayOfWeek: number,
  opensAt = '11:00:00',
  closesAt = '22:00:00',
  isClosed: boolean | null = false,
): OperatingHoursRecord {
  return { day_of_week: dayOfWeek, opens_at: opensAt, closes_at: closesAt, is_closed: isClosed };
}

/** All seven days, 11:00-22:00. */
const WEEK: OperatingHoursRecord[] = [0, 1, 2, 3, 4, 5, 6].map((dow) => day(dow));

/** Seed-like shape: Sun-Thu 11:00-22:00, Fri-Sat 11:00-23:00. */
const SEED_LIKE: OperatingHoursRecord[] = [
  day(0),
  day(1),
  day(2),
  day(3),
  day(4),
  day(5, '11:00:00', '23:00:00'),
  day(6, '11:00:00', '23:00:00'),
];

function evaluate(
  startsAt: string,
  endsAt: string,
  hours: readonly OperatingHoursRecord[],
  timeZone: string = NY,
) {
  return evaluateOperatingHours({ startsAt, endsAt, timeZone, hours });
}

describe('parseClockSeconds', () => {
  it('parses HH:MM:SS into seconds since midnight', () => {
    expect(parseClockSeconds('11:00:00')).toBe(39600);
    expect(parseClockSeconds('00:00:00')).toBe(0);
    expect(parseClockSeconds('23:59:59')).toBe(86399);
  });

  it('parses HH:MM and fractional seconds', () => {
    expect(parseClockSeconds('11:00')).toBe(39600);
    expect(parseClockSeconds('11:00:00.500')).toBe(39600);
  });

  it('returns null for malformed clock values', () => {
    expect(parseClockSeconds('24:00:00')).toBeNull();
    expect(parseClockSeconds('11:60:00')).toBeNull();
    expect(parseClockSeconds('11:00:60')).toBeNull();
    expect(parseClockSeconds('9:00')).toBeNull();
    expect(parseClockSeconds('11:00:00Z')).toBeNull();
    expect(parseClockSeconds('abc')).toBeNull();
    expect(parseClockSeconds('')).toBeNull();
    expect(parseClockSeconds(null)).toBeNull();
    expect(parseClockSeconds(undefined)).toBeNull();
  });
});

describe('localWallParts', () => {
  it('converts an instant to restaurant-local date, weekday, and seconds', () => {
    // 2026-06-07T16:30:00Z = Sunday 12:30 EDT in New York.
    expect(localWallParts('2026-06-07T16:30:00Z', NY)).toEqual({
      dateKey: '2026-06-07',
      dayOfWeek: 0,
      secondsOfDay: 12 * 3600 + 30 * 60,
    });
    // 2026-06-06T16:30:00Z = Saturday 12:30 EDT.
    expect(localWallParts('2026-06-06T16:30:00Z', NY)?.dayOfWeek).toBe(6);
    // 2026-06-01T16:30:00Z = Monday 12:30 EDT.
    expect(localWallParts('2026-06-01T16:30:00Z', NY)?.dayOfWeek).toBe(1);
  });

  it('uses the local date, not the UTC date', () => {
    // UTC is already June 2, New York is still June 1 (22:00 EDT).
    expect(localWallParts('2026-06-02T02:00:00Z', NY)?.dateKey).toBe('2026-06-01');
  });

  it('returns null for invalid timezones and invalid instants', () => {
    expect(localWallParts('2026-06-01T18:00:00Z', 'Not/AZone')).toBeNull();
    expect(localWallParts('2026-06-01T18:00:00Z', '')).toBeNull();
    expect(localWallParts('not-a-timestamp', NY)).toBeNull();
    expect(localWallParts(null, NY)).toBeNull();
  });
});

describe('evaluateOperatingHours — window fit', () => {
  it('accepts a window fully inside hours', () => {
    // Monday 2026-06-01, 14:00-16:00 local inside 11:00-22:00.
    expect(evaluate('2026-06-01T18:00:00Z', '2026-06-01T20:00:00Z', WEEK)).toEqual({ open: true });
  });

  it('accepts the exact opening boundary', () => {
    expect(evaluate('2026-06-01T15:00:00Z', '2026-06-01T17:00:00Z', WEEK)).toEqual({ open: true });
  });

  it('accepts a window ending exactly at closing time', () => {
    // 19:00-22:00 local; the UTC date rolls over but the local date does not.
    expect(evaluate('2026-06-01T23:00:00Z', '2026-06-02T02:00:00Z', WEEK)).toEqual({ open: true });
  });

  it('rejects a window starting before opening', () => {
    expect(evaluate('2026-06-01T14:59:00Z', '2026-06-01T16:00:00Z', WEEK)).toEqual({
      open: false,
      reason: 'outside_hours',
    });
  });

  it('rejects a window ending after closing', () => {
    expect(evaluate('2026-06-01T23:30:00Z', '2026-06-02T02:30:00Z', WEEK)).toEqual({
      open: false,
      reason: 'outside_hours',
    });
  });
});

describe('evaluateOperatingHours — hours rows', () => {
  it('treats a missing day row as closed', () => {
    // Window is Monday; only Fri/Sat rows exist.
    const hours = [day(5), day(6)];
    expect(evaluate('2026-06-01T18:00:00Z', '2026-06-01T20:00:00Z', hours)).toEqual({
      open: false,
      reason: 'missing_day',
    });
  });

  it('treats an empty hours list as closed', () => {
    expect(evaluate('2026-06-01T18:00:00Z', '2026-06-01T20:00:00Z', [])).toEqual({
      open: false,
      reason: 'missing_day',
    });
  });

  it('rejects when is_closed is true', () => {
    const hours = [day(1, '11:00:00', '22:00:00', true)];
    expect(evaluate('2026-06-01T18:00:00Z', '2026-06-01T20:00:00Z', hours)).toEqual({
      open: false,
      reason: 'closed_flag',
    });
  });

  it('accepts when nullable is_closed is null', () => {
    const hours = [day(1, '11:00:00', '22:00:00', null)];
    expect(evaluate('2026-06-01T18:00:00Z', '2026-06-01T20:00:00Z', hours)).toEqual({ open: true });
  });

  it('accepts when nullable is_closed is false', () => {
    const hours = [day(1, '11:00:00', '22:00:00', false)];
    expect(evaluate('2026-06-01T18:00:00Z', '2026-06-01T20:00:00Z', hours)).toEqual({ open: true });
  });
});

describe('evaluateOperatingHours — overnight and weekday mapping', () => {
  it('rejects cross-midnight windows even when both days are wide open', () => {
    // 22:00 Mon -> 01:00 Tue local; both rows would fit individually, but the
    // date rule rejects the window outright.
    const hours = [
      day(1, '00:00:00', '23:59:59'),
      day(2, '00:00:00', '23:59:59'),
    ];
    expect(evaluate('2026-06-02T02:00:00Z', '2026-06-02T05:00:00Z', hours)).toEqual({
      open: false,
      reason: 'crosses_midnight',
    });
  });

  it('maps Sunday to day_of_week 0', () => {
    // Sunday 2026-06-07, 12:00-14:00 local.
    expect(evaluate('2026-06-07T16:00:00Z', '2026-06-07T18:00:00Z', SEED_LIKE)).toEqual({
      open: true,
    });
    // Sunday closes at 22:00 under SEED_LIKE (day 0): 21:00-22:30 is too late.
    expect(evaluate('2026-06-08T01:00:00Z', '2026-06-08T02:30:00Z', SEED_LIKE)).toEqual({
      open: false,
      reason: 'outside_hours',
    });
    // Without a day-0 row, the same Sunday window is closed for missing_day.
    expect(evaluate('2026-06-07T16:00:00Z', '2026-06-07T18:00:00Z', [day(6)])).toEqual({
      open: false,
      reason: 'missing_day',
    });
  });

  it('maps Saturday to day_of_week 6 with its later closing time', () => {
    // Saturday 2026-06-06, 19:00-23:00 local: exact Saturday close (23:00),
    // which would be out of hours on a Sunday (22:00).
    expect(evaluate('2026-06-06T23:00:00Z', '2026-06-07T03:00:00Z', SEED_LIKE)).toEqual({
      open: true,
    });
    // Same wall window with only a Sunday row -> closed.
    expect(evaluate('2026-06-06T23:00:00Z', '2026-06-07T03:00:00Z', [day(0)])).toEqual({
      open: false,
      reason: 'missing_day',
    });
  });
});

describe('evaluateOperatingHours — non-UTC inputs', () => {
  it('uses the restaurant timezone, not the input offset', () => {
    // 14:00+05:30 = 08:30Z = 04:30 EDT — before opening despite a "business
    // hours" looking local time in the input string.
    expect(evaluate('2026-06-01T14:00:00+05:30', '2026-06-01T16:00:00+05:30', WEEK)).toEqual({
      open: false,
      reason: 'outside_hours',
    });
    // 23:00+05:30 = 17:30Z = 13:30 EDT — inside hours.
    expect(evaluate('2026-06-01T23:00:00+05:30', '2026-06-02T01:00:00+05:30', WEEK)).toEqual({
      open: true,
    });
  });

  it('handles offsets east and west of UTC identically (restaurant tz wins)', () => {
    // Exact open boundary (11:00 local) expressed with the -04:00 input offset.
    expect(evaluate('2026-06-01T11:00:00-04:00', '2026-06-01T13:00:00-04:00', WEEK)).toEqual({
      open: true,
    });
  });
});

describe('evaluateOperatingHours — fail-closed validation', () => {
  it('fails closed on malformed clock values', () => {
    expect(evaluate('2026-06-01T18:00:00Z', '2026-06-01T20:00:00Z', [day(1, '25:00:00')])).toEqual({
      open: false,
      reason: 'invalid_hours',
    });
    expect(
      evaluate('2026-06-01T18:00:00Z', '2026-06-01T20:00:00Z', [day(1, '11:00:00', 'nonsense')]),
    ).toEqual({ open: false, reason: 'invalid_hours' });
    expect(
      evaluate('2026-06-01T18:00:00Z', '2026-06-01T20:00:00Z', [day(1, '11:00:00', '11:00:00')]),
    ).toEqual({ open: false, reason: 'invalid_hours' });
  });

  it('fails closed on invalid timezones', () => {
    expect(evaluate('2026-06-01T18:00:00Z', '2026-06-01T20:00:00Z', WEEK, 'Not/AZone')).toEqual({
      open: false,
      reason: 'invalid_timezone',
    });
    expect(evaluate('2026-06-01T18:00:00Z', '2026-06-01T20:00:00Z', WEEK, '')).toEqual({
      open: false,
      reason: 'invalid_timezone',
    });
    expect(
      evaluateOperatingHours({
        startsAt: '2026-06-01T18:00:00Z',
        endsAt: '2026-06-01T20:00:00Z',
        timeZone: undefined,
        hours: WEEK,
      }),
    ).toEqual({ open: false, reason: 'invalid_timezone' });
  });

  it('fails closed on malformed instants', () => {
    expect(evaluate('not-a-timestamp', '2026-06-01T20:00:00Z', WEEK)).toEqual({
      open: false,
      reason: 'invalid_window',
    });
    expect(evaluate('2026-06-01T18:00:00Z', 'garbage', WEEK)).toEqual({
      open: false,
      reason: 'invalid_window',
    });
    expect(evaluateOperatingHours({ startsAt: null, endsAt: null, timeZone: NY, hours: WEEK })).toEqual({
      open: false,
      reason: 'invalid_window',
    });
  });
});

describe('evaluateOperatingHours — DST (America/New_York)', () => {
  it('accepts an in-hours window on the spring-forward day (2026-03-08)', () => {
    // 15:00Z = 11:00 EDT (transition happened at 07:00Z), 21:00Z = 17:00 EDT.
    expect(evaluate('2026-03-08T15:00:00Z', '2026-03-08T21:00:00Z', [day(0)])).toEqual({
      open: true,
    });
  });

  it('accepts a window spanning the spring-forward gap by wall clock', () => {
    // 06:00Z = 01:00 EST (before the jump), 07:30Z = 03:30 EDT (after it):
    // 1.5 real hours, but both endpoints are inside local [01:00, 04:00]
    // on the same local date — the gate is defined on local wall time.
    const hours = [day(0, '01:00:00', '04:00:00')];
    expect(evaluate('2026-03-08T06:00:00Z', '2026-03-08T07:30:00Z', hours)).toEqual({ open: true });
    // Ending before the local opening hour on that day is still rejected.
    expect(evaluate('2026-03-08T05:30:00Z', '2026-03-08T06:30:00Z', hours)).toEqual({
      open: false,
      reason: 'outside_hours',
    });
  });

  it('accepts a window in the first pass of the fall-back repeated hour (2026-11-01)', () => {
    // 05:00Z = 01:00 EDT (exact open), 05:30Z = 01:30 EDT.
    const hours = [day(0, '01:00:00', '02:00:00')];
    expect(evaluate('2026-11-01T05:00:00Z', '2026-11-01T05:30:00Z', hours)).toEqual({ open: true });
  });

  it('accepts a window spanning the fall-back fold (01:45 EDT -> 01:15 EST)', () => {
    // The wall clock runs backwards across the fold: start seconds (01:45)
    // exceed end seconds (01:15), yet both lie within [01:00, 02:00] on the
    // same local date and the real window is 30 minutes inside opening hours.
    const hours = [day(0, '01:00:00', '02:00:00')];
    expect(evaluate('2026-11-01T05:45:00Z', '2026-11-01T06:15:00Z', hours)).toEqual({ open: true });
  });

  it('accepts an exact-boundary window spanning the whole repeated hour', () => {
    // 05:00Z = 01:00 EDT (open) -> 07:00Z = 02:00 EST (exact close).
    const hours = [day(0, '01:00:00', '02:00:00')];
    expect(evaluate('2026-11-01T05:00:00Z', '2026-11-01T07:00:00Z', hours)).toEqual({ open: true });
  });

  it('rejects an after-close window across the fall-back fold', () => {
    // 07:30Z = 02:30 EST — past the local 02:00 close.
    const hours = [day(0, '01:00:00', '02:00:00')];
    expect(evaluate('2026-11-01T05:00:00Z', '2026-11-01T07:30:00Z', hours)).toEqual({
      open: false,
      reason: 'outside_hours',
    });
  });

  it('rejects windows starting before opening on the repeated hour', () => {
    // 05:00Z = 01:00 EDT but opening is 01:30 local that day.
    const hours = [day(0, '01:30:00', '02:00:00')];
    expect(evaluate('2026-11-01T05:00:00Z', '2026-11-01T05:30:00Z', hours)).toEqual({
      open: false,
      reason: 'outside_hours',
    });
  });
});
