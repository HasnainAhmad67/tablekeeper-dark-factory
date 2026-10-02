/**
 * Reservation status machine (M5a).
 *
 * Pure, I/O-free transition validation. The matrix mirrors what the database
 * enforces today and tightens only what the plan requires:
 *
 *   - reservations.status CHECK: pending, confirmed, seated, completed,
 *     cancelled, no_show (001_initial_schema.sql).
 *   - Guests may move their own reservation to 'cancelled' from any active
 *     state; every other guest transition is rejected by
 *     007_restrict_guest_reservation_updates.sql (both the WITH CHECK policy
 *     and the column-scope trigger).
 *   - Restaurant staff pass the 007 trigger untouched and RLS
 *     (reservations_update_staff) constrains only the actor, not the target
 *     status, so staff may move an active reservation to any other status.
 *   - cancelled / completed / no_show are terminal: the release trigger
 *     (003_triggers.sql) fires on entry, and cancel_reservation treats them
 *     as idempotent no-ops (004_functions.sql). Terminal states never
 *     transition again — including to 'cancelled'. The API layer maps a
 *     terminal → cancelled request to an idempotent 200 instead of an error
 *     (see reservations.ts), but the matrix itself reports it as rejected so
 *     callers cannot silently rewrite history.
 *
 * Actor matters only for active states: 'guest' is the reservation owner,
 * 'staff' is any owner/manager/staff member of the reservation's restaurant.
 */

export const RESERVATION_STATUSES = [
  'pending',
  'confirmed',
  'seated',
  'completed',
  'cancelled',
  'no_show',
] as const;

export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

/** Who is attempting the transition (determines guest vs staff rules). */
export type Actor = 'guest' | 'staff';

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'cancelled',
  'completed',
  'no_show',
]);

/** Why a transition was rejected. */
export type TransitionRejection =
  | 'unknown_status' // `from` or `to` is not a known reservation status
  | 'same_status' // no-op transition (from === to)
  | 'terminal_source' // from ∈ {cancelled, completed, no_show}
  | 'forbidden_for_actor'; // guest attempting anything other than → cancelled

export type TransitionResult =
  | { allowed: true; reason: null }
  | { allowed: false; reason: TransitionRejection };

/** Narrow an arbitrary value to a ReservationStatus (mirrors the DB CHECK). */
export function isReservationStatus(value: unknown): value is ReservationStatus {
  return (
    typeof value === 'string' &&
    (RESERVATION_STATUSES as readonly string[]).includes(value)
  );
}

/** Terminal states never transition again. */
export function isTerminalStatus(status: ReservationStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Validate a status transition for the given actor.
 *
 * Evaluation order (matters for the reason reported):
 *   1. unknown_status   — either side is not a valid status
 *   2. same_status      — from === to
 *   3. terminal_source  — from is cancelled/completed/no_show
 *   4. guest rule       — guests may only target 'cancelled'
 *   5. allowed          — staff may move an active reservation anywhere
 */
export function checkTransition(
  from: unknown,
  to: unknown,
  actor: Actor,
): TransitionResult {
  if (!isReservationStatus(from) || !isReservationStatus(to)) {
    return { allowed: false, reason: 'unknown_status' };
  }
  if (from === to) {
    return { allowed: false, reason: 'same_status' };
  }
  if (isTerminalStatus(from)) {
    return { allowed: false, reason: 'terminal_source' };
  }
  if (actor === 'guest') {
    return to === 'cancelled'
      ? { allowed: true, reason: null }
      : { allowed: false, reason: 'forbidden_for_actor' };
  }
  // Staff: any transition out of an active state is supported by the
  // database (007 passes staff through; RLS does not constrain the target).
  return { allowed: true, reason: null };
}

/** Boolean convenience wrapper around checkTransition. */
export function canTransition(
  from: unknown,
  to: unknown,
  actor: Actor,
): boolean {
  return checkTransition(from, to, actor).allowed;
}
