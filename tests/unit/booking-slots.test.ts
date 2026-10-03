import { describe, expect, it } from 'vitest';

import {
  dayOfWeekOf,
  formatClock,
  formatDateKeyLabel,
  formatSlotLabel,
  formatWhenLabel,
  generateSlots,
  isValidTimeZone,
  localDateKey,
  parseClockSeconds,
  slotDateKeys,
  zonedWallToEpoch,
  type OperatingHoursRow,
} from '@/lib/booking';

/**
 * Unit tests for the client booking helpers (pure logic, no I/O).
 *
 * America/New_York is used so DST rules (spring-forward 2026-03-08,
 * fall-back 2026-11-01 — both US rules) run against real tz data. Local
 * weekday anchors verified independently: 2026-06-01 Monday, 2026-06-06
 * Saturday, 2026-06-07 Sunday (same anchors as operating-hours.test.ts).
 */

const NY = 'America/New_York';

function row(
  dayOfWeek: number,
  opensAt = '11:00:00',
  closesAt = '22:00:00',
  isClosed: boolean | null = false,
): OperatingHoursRow {
  return { day_of_week: dayOfWeek, opens_at: opensAt, closes_at: closesAt, is_closed: isClosed };
}

/** All seven days, 11:00-22:00. */
const WEEK: OperatingHoursRow[] = [0, 1, 2, 3, 4, 5, 6].map((dow) => row(dow));

describe('parseClockSeconds', () => {
  it('parses HH:MM:SS and HH:MM into seconds since midnight', () => {
    expect(parseClockSeconds('11:00:00')).toBe(39600);
    expect(parseClockSeconds('00:00:00')).toBe(0);
    expect(parseClockSeconds('22:30')).toBe(81000);
    expect(parseClockSeconds('11:00:00.500')).toBe(39600);
  });

  it('returns null for malformed clock values', () => {
    expect(parseClockSeconds('24:00:00')).toBeNull();
    expect(parseClockSeconds('11:60:00')).toBeNull();
    expect(parseClockSeconds('9:00')).toBeNull();
    expect(parseClockSeconds('11:00:00Z')).toBeNull();
    expect(parseClockSeconds(null)).toBeNull();
    expect(parseClockSeconds('abc')).toBeNull();
  });
});

describe('isValidTimeZone', () => {
  it('accepts IANA names and rejects everything else', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(42)).toBe(false);
  });
});

describe('zonedWallToEpoch', () => {
  it('resolves wall times with the correct offset across DST', () => {
    // 2026-06-01 10:00 EDT (-04:00); 2026-01-15 10:00 EST (-05:00).
    expect(zonedWallToEpoch('2026-06-01', 36000, NY)).toBe(Date.UTC(2026, 5, 1, 14, 0, 0));
    expect(zonedWallToEpoch('2026-01-15', 36000, NY)).toBe(Date.UTC(2026, 0, 15, 15, 0, 0));
  });

  it('returns null for the spring-forward gap (02:30 does not exist)', () => {
    expect(zonedWallToEpoch('2026-03-08', 9000, NY)).toBeNull();
  });

  it('resolves the repeated fall-back wall time to a real instant', () => {
    // 01:30 occurs twice on 2026-11-01; one valid instant is required.
    const epoch = zonedWallToEpoch('2026-11-01', 5400, NY);
    expect(epoch).not.toBeNull();
    expect(formatSlotLabel(new Date(epoch as number).toISOString(), NY)).toBe('1:30 AM');
    expect(localDateKey(new Date(epoch as number), NY)).toBe('2026-11-01');
  });

  it('rejects invalid timezones, dates, and seconds of day', () => {
    expect(zonedWallToEpoch('2026-06-01', 36000, 'Not/AZone')).toBeNull();
    expect(zonedWallToEpoch('2026-06-01', -1, NY)).toBeNull();
    expect(zonedWallToEpoch('2026-06-01', 86400, NY)).toBeNull();
    expect(zonedWallToEpoch('not-a-date', 36000, NY)).toBeNull();
    expect(zonedWallToEpoch('2026-13-01', 36000, NY)).toBeNull();
  });
});

describe('localDateKey and dayOfWeekOf', () => {
  it('maps instants to the restaurant-local calendar date', () => {
    // 2026-07-02 03:00 UTC is still 2026-07-01 23:00 in New York.
    expect(localDateKey(Date.UTC(2026, 6, 2, 3, 0, 0), NY)).toBe('2026-07-01');
    expect(localDateKey(Date.UTC(2026, 6, 2, 3, 0, 0), 'UTC')).toBe('2026-07-02');
    expect(localDateKey(Date.UTC(2026, 6, 2, 3, 0, 0), 'Not/AZone')).toBeNull();
  });

  it('reads weekday numbers with 0 = Sunday', () => {
    expect(dayOfWeekOf('2026-06-07', NY)).toBe(0); // Sunday
    expect(dayOfWeekOf('2026-06-01', NY)).toBe(1); // Monday
    expect(dayOfWeekOf('2026-06-06', NY)).toBe(6); // Saturday
    expect(dayOfWeekOf('bad-date', NY)).toBeNull();
  });
});

describe('slotDateKeys', () => {
  it('covers today plus the next 7 local days', () => {
    const now = Date.UTC(2026, 5, 1, 16, 0, 0); // 2026-06-01 12:00 EDT
    const keys = slotDateKeys(now, NY);
    expect(keys).toHaveLength(8);
    expect(keys[0]).toBe('2026-06-01');
    expect(keys[7]).toBe('2026-06-08');
  });

  it('returns an empty list for invalid timezones', () => {
    expect(slotDateKeys(Date.now(), 'Not/AZone')).toEqual([]);
  });
});

describe('generateSlots', () => {
  const NOW = Date.UTC(2026, 5, 1, 16, 0, 0); // 2026-06-01 12:00 EDT

  it('generates 30-minute slots whose full 2 hours fit inside opening hours', () => {
    const slots = generateSlots({ timeZone: NY, operatingHours: WEEK, now: NOW });
    // 8 local days x 19 slots: 11:00 through 20:00 starts (20:00 + 2h = 22:00).
    expect(slots).toHaveLength(8 * 19);
    expect(slots[0]).toEqual({
      startsAt: '2026-06-01T15:00:00.000Z', // 11:00 EDT
      endsAt: '2026-06-01T17:00:00.000Z',
      dateKey: '2026-06-01',
    });
    const lastMonday = slots.filter((slot) => slot.dateKey === '2026-06-01').pop();
    expect(lastMonday?.startsAt).toBe('2026-06-02T00:00:00.000Z'); // 20:00 EDT
  });

  it('skips closed days and days with no operating-hours row', () => {
    const closedSunday = WEEK.map((r) => (r.day_of_week === 0 ? row(0, '11:00:00', '22:00:00', true) : r));
    const closedSlots = generateSlots({ timeZone: NY, operatingHours: closedSunday, now: NOW });
    expect(closedSlots.filter((s) => s.dateKey === '2026-06-07')).toHaveLength(0);
    expect(closedSlots).toHaveLength(7 * 19); // 2026-06-07 is the only Sunday

    const noSunday = WEEK.filter((r) => r.day_of_week !== 0);
    const missingSlots = generateSlots({ timeZone: NY, operatingHours: noSunday, now: NOW });
    expect(missingSlots.filter((s) => s.dateKey === '2026-06-07')).toHaveLength(0);
    expect(missingSlots).toHaveLength(7 * 19);
  });

  it('fails closed for cross-midnight and invalid hours', () => {
    expect(
      generateSlots({ timeZone: NY, operatingHours: [row(0, '17:00:00', '02:00:00')], now: NOW, horizonDays: 7 }),
    ).toEqual([]);
    expect(
      generateSlots({ timeZone: NY, operatingHours: [row(0, 'bogus', '22:00:00')], now: NOW }),
    ).toEqual([]);
  });

  it('fails closed for invalid timezones and bad durations', () => {
    expect(generateSlots({ timeZone: 'Not/AZone', operatingHours: WEEK, now: NOW })).toEqual([]);
    expect(generateSlots({ timeZone: NY, operatingHours: [], now: NOW })).toEqual([]);
    expect(generateSlots({ timeZone: NY, operatingHours: WEEK, now: NOW, stepMinutes: 0 })).toEqual([]);
  });

  it('honors the horizon', () => {
    const slots = generateSlots({ timeZone: NY, operatingHours: WEEK, now: NOW, horizonDays: 0 });
    expect(slots).toHaveLength(19);
    expect(new Set(slots.map((s) => s.dateKey))).toEqual(new Set(['2026-06-01']));
  });

  it('handles the spring-forward day without generating invalid windows', () => {
    // 2026-03-08 (Sunday): 01:00 EST + 2h ends 04:00 EDT (accepted at the
    // exact close boundary); 01:30 would end 04:30 (rejected); 02:00 does
    // not exist (skipped).
    const hours = WEEK.map((r) => (r.day_of_week === 0 ? row(0, '01:00:00', '04:00:00') : r));
    const slots = generateSlots({
      timeZone: NY,
      operatingHours: hours,
      now: Date.UTC(2026, 2, 6, 12, 0, 0), // 2026-03-06 07:00 EST
    });
    const dstDay = slots.filter((s) => s.dateKey === '2026-03-08');
    expect(dstDay).toHaveLength(1);
    expect(dstDay[0].startsAt).toBe('2026-03-08T06:00:00.000Z'); // 01:00 EST
    expect(dstDay[0].endsAt).toBe('2026-03-08T08:00:00.000Z'); // 04:00 EDT
    expect(slots).toHaveLength(7 * 19 + 1);
  });

  it('handles the fall-back day with repeated wall times', () => {
    // 2026-11-01 (Sunday): 01:00-05:00 hours crossing the fall-back
    // transition; every candidate start must yield a real, in-bounds window.
    const hours = WEEK.map((r) => (r.day_of_week === 0 ? row(0, '01:00:00', '05:00:00') : r));
    const slots = generateSlots({
      timeZone: NY,
      operatingHours: hours,
      now: Date.UTC(2026, 10, 1, 17, 0, 0), // 2026-11-01 12:00 EST
    });
    const dstDay = slots.filter((s) => s.dateKey === '2026-11-01');
    expect(dstDay.map((s) => formatSlotLabel(s.startsAt, NY))).toEqual([
      '1:00 AM',
      '1:30 AM',
      '2:00 AM',
      '2:30 AM',
      '3:00 AM',
    ]);
    // All five starts resolve to distinct instants within the local day.
    expect(new Set(dstDay.map((s) => s.startsAt)).size).toBe(5);
  });
});

describe('formatters', () => {
  it('formats clock values for the hours table', () => {
    expect(formatClock('11:00:00')).toBe('11:00 AM');
    expect(formatClock('17:30:00')).toBe('5:30 PM');
    expect(formatClock('00:00:00')).toBe('12:00 AM');
    expect(formatClock('12:00:00')).toBe('12:00 PM');
    expect(formatClock('nope')).toBe('');
  });

  it('formats slot times, ranges, and date keys in the restaurant timezone', () => {
    expect(formatSlotLabel('2026-06-01T15:00:00.000Z', NY)).toBe('11:00 AM');
    expect(formatWhenLabel('2026-06-01T15:00:00.000Z', '2026-06-01T17:00:00.000Z', NY)).toBe(
      'Mon, Jun 1, 2026 · 11:00 AM – 1:00 PM',
    );
    expect(formatDateKeyLabel('2026-06-01', NY)).toBe('Mon, Jun 1, 2026');
    // Invalid input degrades gracefully instead of throwing.
    expect(formatSlotLabel('not-a-date', NY)).toBe('not-a-date');
    expect(formatDateKeyLabel('bad-date', NY)).toBe('bad-date');
  });
});
