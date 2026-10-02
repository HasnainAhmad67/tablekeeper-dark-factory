import { describe, expect, it } from 'vitest';
import {
  RESERVATION_STATUSES,
  canTransition,
  checkTransition,
  isReservationStatus,
  isTerminalStatus,
  type Actor,
  type ReservationStatus,
} from '@/server/status-machine';

/**
 * Complete-matrix unit tests for the reservation status machine (pure, no I/O).
 *
 * The expected matrices below are written out literally, in
 * RESERVATION_STATUSES order (rows = from, columns = to), so they stand as
 * an independent specification rather than a re-derivation of the code:
 *
 *   - guests may only target 'cancelled' from an active state
 *     (007_restrict_guest_reservation_updates.sql)
 *   - staff may move an active reservation to any other status
 *     (007 passes staff through; RLS does not constrain the target)
 *   - terminal sources (cancelled/completed/no_show) never transition again
 *   - from === to is always rejected as a no-op
 */

type Expectation =
  | true
  | 'same_status'
  | 'terminal_source'
  | 'forbidden_for_actor'
  | 'unknown_status';

// Rows: pending, confirmed, seated, completed, cancelled, no_show.
// Columns: pending, confirmed, seated, completed, cancelled, no_show.
const EXPECTED_GUEST: Record<ReservationStatus, Expectation[]> = {
  pending: [
    'same_status',
    'forbidden_for_actor',
    'forbidden_for_actor',
    'forbidden_for_actor',
    true,
    'forbidden_for_actor',
  ],
  confirmed: [
    'forbidden_for_actor',
    'same_status',
    'forbidden_for_actor',
    'forbidden_for_actor',
    true,
    'forbidden_for_actor',
  ],
  seated: [
    'forbidden_for_actor',
    'forbidden_for_actor',
    'same_status',
    'forbidden_for_actor',
    true,
    'forbidden_for_actor',
  ],
  completed: [
    'terminal_source',
    'terminal_source',
    'terminal_source',
    'same_status',
    'terminal_source',
    'terminal_source',
  ],
  cancelled: [
    'terminal_source',
    'terminal_source',
    'terminal_source',
    'terminal_source',
    'same_status',
    'terminal_source',
  ],
  no_show: [
    'terminal_source',
    'terminal_source',
    'terminal_source',
    'terminal_source',
    'terminal_source',
    'same_status',
  ],
};

const EXPECTED_STAFF: Record<ReservationStatus, Expectation[]> = {
  pending: ['same_status', true, true, true, true, true],
  confirmed: [true, 'same_status', true, true, true, true],
  seated: [true, true, 'same_status', true, true, true],
  completed: [
    'terminal_source',
    'terminal_source',
    'terminal_source',
    'same_status',
    'terminal_source',
    'terminal_source',
  ],
  cancelled: [
    'terminal_source',
    'terminal_source',
    'terminal_source',
    'terminal_source',
    'same_status',
    'terminal_source',
  ],
  no_show: [
    'terminal_source',
    'terminal_source',
    'terminal_source',
    'terminal_source',
    'terminal_source',
    'same_status',
  ],
};

const EXPECTED: Record<Actor, Record<ReservationStatus, Expectation[]>> = {
  guest: EXPECTED_GUEST,
  staff: EXPECTED_STAFF,
};

describe('status machine matrix', () => {
  for (const actor of ['guest', 'staff'] as const) {
    for (const from of RESERVATION_STATUSES) {
      it(`${actor}: ${from} → …`, () => {
        RESERVATION_STATUSES.forEach((to, index) => {
          const expected = EXPECTED[actor][from][index];
          const result = checkTransition(from, to, actor);
          if (expected === true) {
            expect(result, `${actor} ${from} → ${to}`).toEqual({
              allowed: true,
              reason: null,
            });
          } else {
            expect(result, `${actor} ${from} → ${to}`).toEqual({
              allowed: false,
              reason: expected,
            });
          }
          expect(canTransition(from, to, actor)).toBe(expected === true);
        });
      });
    }
  }

  it('rejects unknown source statuses', () => {
    expect(checkTransition('bogus', 'cancelled', 'guest')).toEqual({
      allowed: false,
      reason: 'unknown_status',
    });
    expect(checkTransition('Bogus', 'cancelled', 'staff')).toEqual({
      allowed: false,
      reason: 'unknown_status',
    });
    expect(checkTransition('', 'cancelled', 'guest')).toEqual({
      allowed: false,
      reason: 'unknown_status',
    });
    expect(checkTransition(undefined, 'cancelled', 'staff')).toEqual({
      allowed: false,
      reason: 'unknown_status',
    });
  });

  it('rejects unknown target statuses', () => {
    expect(checkTransition('confirmed', 'bogus', 'guest')).toEqual({
      allowed: false,
      reason: 'unknown_status',
    });
    expect(checkTransition('confirmed', 42, 'staff')).toEqual({
      allowed: false,
      reason: 'unknown_status',
    });
    expect(checkTransition('confirmed', null, 'guest')).toEqual({
      allowed: false,
      reason: 'unknown_status',
    });
  });

  it('reports same_status before terminal_source', () => {
    expect(checkTransition('cancelled', 'cancelled', 'guest')).toEqual({
      allowed: false,
      reason: 'same_status',
    });
    expect(checkTransition('completed', 'completed', 'staff')).toEqual({
      allowed: false,
      reason: 'same_status',
    });
  });

  it('classifies exactly the three database terminal states', () => {
    expect(isTerminalStatus('cancelled')).toBe(true);
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('no_show')).toBe(true);
    expect(isTerminalStatus('pending')).toBe(false);
    expect(isTerminalStatus('confirmed')).toBe(false);
    expect(isTerminalStatus('seated')).toBe(false);
  });

  it('isReservationStatus mirrors the database CHECK constraint', () => {
    for (const status of RESERVATION_STATUSES) {
      expect(isReservationStatus(status)).toBe(true);
    }
    for (const value of ['Bogus', '', 1, null, undefined, ['confirmed']]) {
      expect(isReservationStatus(value)).toBe(false);
    }
  });

  it('exposes the six statuses from 001_initial_schema.sql in order', () => {
    expect([...RESERVATION_STATUSES]).toEqual([
      'pending',
      'confirmed',
      'seated',
      'completed',
      'cancelled',
      'no_show',
    ]);
  });
});
