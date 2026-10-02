import { describe, expect, it } from 'vitest';
import {
  AvailabilityError,
  computeAvailability,
  overlapsHalfOpen,
  parseAvailabilityParams,
  type AvailabilityInput,
  type AvailabilityParams,
} from '@/server/availability';
import type { OperatingHoursRecord } from '@/server/hours';

const RESTAURANT_ID = '11111111-1111-4111-8111-111111111111';
const T0 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0000';
const T1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0001';
const T2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0002';
const T3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0003';
const T4 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaa0004';
const GHOST = 'cccccccc-cccc-4ccc-8ccc-cccccccc0009';
const G1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0001';
const G2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbb0002';

const WINDOW_START = '2026-06-01T18:00:00Z';
const WINDOW_END = '2026-06-01T20:00:00Z';

const BASE_PARAMS: AvailabilityParams = {
  restaurantId: RESTAURANT_ID,
  startsAt: WINDOW_START,
  endsAt: WINDOW_END,
  partySize: 4,
};

// Default fixture hours: every weekday open around the clock so the hours
// gate passes and existing capacity/conflict assertions stay unchanged.
const OPEN_ALL_WEEK: OperatingHoursRecord[] = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
  day_of_week: dayOfWeek,
  opens_at: '00:00:00',
  closes_at: '23:59:59',
  is_closed: false,
}));

function input(overrides: Partial<AvailabilityInput>): AvailabilityInput {
  return {
    params: BASE_PARAMS,
    tables: [],
    groups: [],
    members: [],
    assignments: [],
    hours: { timeZone: 'America/New_York', hours: OPEN_ALL_WEEK },
    ...overrides,
  };
}

function captureAvailabilityError(run: () => unknown): AvailabilityError {
  try {
    run();
  } catch (err) {
    if (err instanceof AvailabilityError) {
      return err;
    }
    throw err;
  }
  throw new Error('Expected AvailabilityError to be thrown');
}

describe('parseAvailabilityParams', () => {
  const valid = {
    restaurantId: RESTAURANT_ID,
    startsAt: WINDOW_START,
    endsAt: WINDOW_END,
    partySize: '4',
  };

  it('accepts valid input and normalizes party_size to a number', () => {
    expect(parseAvailabilityParams(valid)).toEqual({
      restaurantId: RESTAURANT_ID,
      startsAt: WINDOW_START,
      endsAt: WINDOW_END,
      partySize: 4,
    });
  });

  it('rejects a missing or non-UUID restaurantId', () => {
    for (const restaurantId of [null, undefined, '', 'not-a-uuid']) {
      const error = captureAvailabilityError(() =>
        parseAvailabilityParams({ ...valid, restaurantId }),
      );
      expect(error.code).toBe('VALIDATION');
      expect(error.message).toContain('restaurantId');
    }
  });

  it('rejects missing timestamps', () => {
    for (const field of ['startsAt', 'endsAt'] as const) {
      const error = captureAvailabilityError(() =>
        parseAvailabilityParams({ ...valid, [field]: null }),
      );
      expect(error.code).toBe('VALIDATION');
    }
  });

  it('rejects timestamps without a timezone offset', () => {
    const error = captureAvailabilityError(() =>
      parseAvailabilityParams({ ...valid, startsAt: '2026-06-01T18:00:00' }),
    );
    expect(error.message).toContain('starts_at');
  });

  it('rejects unparseable timestamps', () => {
    const error = captureAvailabilityError(() =>
      parseAvailabilityParams({ ...valid, endsAt: 'tomorrow evening' }),
    );
    expect(error.message).toContain('ends_at');
  });

  it('rejects a non-positive range (ends_at at or before starts_at)', () => {
    const equal = captureAvailabilityError(() =>
      parseAvailabilityParams({ ...valid, endsAt: WINDOW_START }),
    );
    expect(equal.message).toContain('ends_at');

    // Same instant written with a different offset is still zero-length.
    const sameInstant = captureAvailabilityError(() =>
      parseAvailabilityParams({ ...valid, endsAt: '2026-06-01T14:00:00-04:00' }),
    );
    expect(sameInstant.message).toContain('ends_at');

    const reversed = captureAvailabilityError(() =>
      parseAvailabilityParams({ ...valid, endsAt: '2026-06-01T17:00:00Z' }),
    );
    expect(reversed.message).toContain('ends_at');
  });

  it('rejects invalid or non-positive party_size values', () => {
    for (const partySize of [null, undefined, '', '0', '-1', '2.5', 'abc', ' 4']) {
      const error = captureAvailabilityError(() =>
        parseAvailabilityParams({ ...valid, partySize }),
      );
      expect(error.code).toBe('VALIDATION');
      expect(error.message).toContain('party_size');
    }
  });
});

describe('overlapsHalfOpen', () => {
  const start = Date.parse(WINDOW_START);
  const end = Date.parse(WINDOW_END);

  it('treats windows that only touch at an endpoint as non-conflicting', () => {
    expect(overlapsHalfOpen(start - 7200_000, start, start, end)).toBe(false);
    expect(overlapsHalfOpen(start, end, end, end + 7200_000)).toBe(false);
  });

  it('detects partial overlap in both directions', () => {
    expect(overlapsHalfOpen(start - 3600_000, start + 3600_000, start, end)).toBe(true);
    expect(overlapsHalfOpen(start, end, start - 3600_000, start + 3600_000)).toBe(true);
  });

  it('detects containment in both directions', () => {
    expect(overlapsHalfOpen(start - 1000, end + 1000, start, end)).toBe(true);
    expect(overlapsHalfOpen(start, end, start - 1000, end + 1000)).toBe(true);
  });

  it('detects identical windows as conflicting', () => {
    expect(overlapsHalfOpen(start, end, start, end)).toBe(true);
  });

  it('keeps disjoint windows non-conflicting', () => {
    expect(overlapsHalfOpen(start - 10_000, start - 5000, start, end)).toBe(false);
  });
});

describe('computeAvailability — tables', () => {
  it('returns a single-table option with capacity and surplus', () => {
    const options = computeAvailability(
      input({ tables: [{ id: T1, label: 'T1', capacity: 6 }] }),
    );
    expect(options).toEqual([
      { kind: 'table', id: T1, label: 'T1', tableIds: [T1], capacity: 6, surplus: 2 },
    ]);
  });

  it('excludes tables whose capacity is below party_size', () => {
    const options = computeAvailability(
      input({
        tables: [
          { id: T1, label: 'T1', capacity: 3 },
          { id: T2, label: 'T2', capacity: 4 },
        ],
      }),
    );
    expect(options.map((option) => option.id)).toEqual([T2]);
  });

  it('excludes tables with an active overlapping assignment', () => {
    const options = computeAvailability(
      input({
        tables: [
          { id: T1, label: 'T1', capacity: 4 },
          { id: T2, label: 'T2', capacity: 4 },
        ],
        assignments: [{ table_id: T1, starts_at: '2026-06-01T17:00:00Z', ends_at: '2026-06-01T19:00:00Z' }],
      }),
    );
    expect(options.map((option) => option.id)).toEqual([T2]);
  });

  const boundaryCases: Array<{
    name: string;
    startsAt: string;
    endsAt: string;
    available: boolean;
  }> = [
    {
      name: 'assignment ending exactly at window start stays available',
      startsAt: '2026-06-01T16:00:00Z',
      endsAt: WINDOW_START,
      available: true,
    },
    {
      name: 'assignment starting exactly at window end stays available',
      startsAt: WINDOW_END,
      endsAt: '2026-06-01T22:00:00Z',
      available: true,
    },
    {
      name: 'assignment spanning the whole window blocks it',
      startsAt: '2026-06-01T12:00:00Z',
      endsAt: '2026-06-01T23:00:00Z',
      available: false,
    },
    {
      name: 'assignment inside the window blocks it',
      startsAt: '2026-06-01T19:00:00Z',
      endsAt: '2026-06-01T19:30:00Z',
      available: false,
    },
    {
      name: 'assignment partially overlapping the window blocks it',
      startsAt: '2026-06-01T17:00:00Z',
      endsAt: '2026-06-01T19:00:00Z',
      available: false,
    },
  ];

  for (const testCase of boundaryCases) {
    it(testCase.name, () => {
      const options = computeAvailability(
        input({
          tables: [{ id: T1, label: 'T1', capacity: 4 }],
          assignments: [
            { table_id: T1, starts_at: testCase.startsAt, ends_at: testCase.endsAt },
          ],
        }),
      );
      expect(options.map((option) => option.id)).toEqual(testCase.available ? [T1] : []);
    });
  }

  it('ignores assignments for tables outside the restaurant result set', () => {
    const options = computeAvailability(
      input({
        tables: [{ id: T1, label: 'T1', capacity: 4 }],
        assignments: [
          { table_id: GHOST, starts_at: '2026-06-01T17:00:00Z', ends_at: '2026-06-01T19:00:00Z' },
        ],
      }),
    );
    expect(options.map((option) => option.id)).toEqual([T1]);
  });

  it('throws when an assignment has an invalid window', () => {
    expect(() =>
      computeAvailability(
        input({
          tables: [{ id: T1, label: 'T1', capacity: 4 }],
          assignments: [{ table_id: T1, starts_at: 'not-a-timestamp', ends_at: WINDOW_END }],
        }),
      ),
    ).toThrow('Invalid assignment window');
  });
});

describe('computeAvailability — groups', () => {
  const pair: Array<{ id: string; label: string; capacity: number }> = [
    { id: T3, label: 'T3', capacity: 2 },
    { id: T4, label: 'T4', capacity: 2 },
  ];

  it('returns a group option when every member table is free', () => {
    const options = computeAvailability(
      input({
        tables: pair,
        groups: [{ id: G1, name: 'Corner pair' }],
        members: [
          { group_id: G1, table_id: T3 },
          { group_id: G1, table_id: T4 },
        ],
      }),
    );
    expect(options).toEqual([
      { kind: 'group', id: G1, label: 'Corner pair', tableIds: [T3, T4], capacity: 4, surplus: 0 },
    ]);
  });

  it('returns no group option when any member table is busy', () => {
    const options = computeAvailability(
      input({
        tables: pair,
        groups: [{ id: G1, name: 'Corner pair' }],
        members: [
          { group_id: G1, table_id: T3 },
          { group_id: G1, table_id: T4 },
        ],
        assignments: [
          { table_id: T4, starts_at: '2026-06-01T18:30:00Z', ends_at: '2026-06-01T19:30:00Z' },
        ],
      }),
    );
    expect(options).toEqual([]);
  });

  it('skips a group with a member table outside the restaurant', () => {
    const options = computeAvailability(
      input({
        tables: [{ id: T3, label: 'T3', capacity: 4 }],
        groups: [{ id: G1, name: 'Corner pair' }],
        members: [
          { group_id: G1, table_id: T3 },
          { group_id: G1, table_id: GHOST },
        ],
      }),
    );
    // T3 remains a valid single; the group combination must not appear.
    expect(options.map((option) => option.id)).toEqual([T3]);
    expect(options.every((option) => option.kind === 'table')).toBe(true);
  });

  it('skips a group with no members', () => {
    const options = computeAvailability(
      input({
        tables: [{ id: T3, label: 'T3', capacity: 4 }],
        groups: [{ id: G1, name: 'Corner pair' }],
      }),
    );
    expect(options.map((option) => option.id)).toEqual([T3]);
    expect(options.every((option) => option.kind === 'table')).toBe(true);
  });

  it('skips a group whose combined capacity is below party_size', () => {
    const options = computeAvailability(
      input({
        tables: [{ id: T3, label: 'T3', capacity: 3 }],
        groups: [{ id: G1, name: 'Corner pair' }],
        members: [{ group_id: G1, table_id: T3 }],
      }),
    );
    expect(options).toEqual([]);
  });

  it('offers free group members as singles and the group combination together', () => {
    const options = computeAvailability(
      input({
        params: { ...BASE_PARAMS, partySize: 2 },
        tables: pair,
        groups: [{ id: G1, name: 'Corner pair' }],
        members: [
          { group_id: G1, table_id: T3 },
          { group_id: G1, table_id: T4 },
        ],
      }),
    );
    expect(options.map((option) => option.id)).toEqual([T3, T4, G1]);
  });
});

describe('computeAvailability — ranking', () => {
  it('ranks smallest capacity surplus first', () => {
    const options = computeAvailability(
      input({
        tables: [
          { id: T1, label: 'T1', capacity: 6 },
          { id: T2, label: 'T2', capacity: 4 },
        ],
      }),
    );
    expect(options.map((option) => option.id)).toEqual([T2, T1]);
  });

  it('ranks a single table before a group on equal surplus', () => {
    const options = computeAvailability(
      input({
        tables: [
          { id: T1, label: 'T1', capacity: 4 },
          { id: T3, label: 'T3', capacity: 2 },
          { id: T4, label: 'T4', capacity: 2 },
        ],
        groups: [{ id: G1, name: 'Corner pair' }],
        members: [
          { group_id: G1, table_id: T3 },
          { group_id: G1, table_id: T4 },
        ],
      }),
    );
    expect(options.map((option) => option.id)).toEqual([T1, G1]);
  });

  it('breaks remaining ties by ascending id', () => {
    const options = computeAvailability(
      input({
        tables: [
          { id: T1, label: 'T1', capacity: 6 },
          { id: T2, label: 'T2', capacity: 4 },
          { id: T0, label: 'T0', capacity: 4 },
          { id: T3, label: 'T3', capacity: 2 },
          { id: T4, label: 'T4', capacity: 2 },
        ],
        groups: [
          { id: G1, name: 'Corner pair' },
          { id: G2, name: 'Large six' },
        ],
        members: [
          { group_id: G1, table_id: T3 },
          { group_id: G1, table_id: T4 },
          { group_id: G2, table_id: T1 },
        ],
      }),
    );
    expect(options.map((option) => option.id)).toEqual([T0, T2, G1, T1, G2]);
  });
});

describe('computeAvailability — empty results', () => {
  it('returns an empty list when nothing is seeded', () => {
    expect(computeAvailability(input({}))).toEqual([]);
  });

  it('returns an empty list when no table covers the party', () => {
    const options = computeAvailability(
      input({ tables: [{ id: T1, label: 'T1', capacity: 3 }] }),
    );
    expect(options).toEqual([]);
  });

  it('returns an empty list when every table is busy', () => {
    const options = computeAvailability(
      input({
        tables: [{ id: T1, label: 'T1', capacity: 4 }],
        assignments: [
          { table_id: T1, starts_at: '2026-06-01T17:00:00Z', ends_at: '2026-06-01T19:00:00Z' },
        ],
      }),
    );
    expect(options).toEqual([]);
  });
});

describe('computeAvailability — operating-hours gate', () => {
  const window: Array<{ id: string; label: string; capacity: number }> = [
    { id: T1, label: 'T1', capacity: 6 },
  ];

  it('returns an empty list when the day has no hours row (closed)', () => {
    const options = computeAvailability(
      input({ tables: window, hours: { timeZone: 'America/New_York', hours: [] } }),
    );
    expect(options).toEqual([]);
  });

  it('returns an empty list when the day is marked is_closed', () => {
    // 2026-06-01 is a Monday (day_of_week 1) in the restaurant timezone.
    const options = computeAvailability(
      input({
        tables: window,
        hours: {
          timeZone: 'America/New_York',
          hours: [
            { day_of_week: 1, opens_at: '00:00:00', closes_at: '23:59:59', is_closed: true },
          ],
        },
      }),
    );
    expect(options).toEqual([]);
  });

  it('keeps an in-hours window available and rejects an out-of-hours window', () => {
    const hours = {
      timeZone: 'America/New_York',
      hours: [{ day_of_week: 1, opens_at: '11:00:00', closes_at: '22:00:00', is_closed: false }],
    };
    // 18:00-20:00Z = 14:00-16:00 local Monday — inside opening hours.
    const open = computeAvailability(input({ tables: window, hours }));
    expect(open.map((option) => option.id)).toEqual([T1]);

    // 04:00-05:00Z = 00:00-01:00 local Monday — before the 11:00 open.
    const closed = computeAvailability(
      input({
        params: { ...BASE_PARAMS, startsAt: '2026-06-01T04:00:00Z', endsAt: '2026-06-01T05:00:00Z' },
        tables: window,
        hours,
      }),
    );
    expect(closed).toEqual([]);
  });

  it('fails closed when the restaurant timezone is invalid', () => {
    const options = computeAvailability(
      input({ tables: window, hours: { timeZone: 'Not/AZone', hours: OPEN_ALL_WEEK } }),
    );
    expect(options).toEqual([]);
  });
});
