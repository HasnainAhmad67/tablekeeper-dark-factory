import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from '@supabase/supabase-js';
import {
  RESERVATION_STATUSES,
  checkTransition,
  isReservationStatus,
  type ReservationStatus,
} from '@/server/status-machine';

/**
 * Reservation booking, listing, lookup, and cancellation (M5a).
 *
 * This module never trusts the caller for identity: `user_id` always comes
 * from the authenticated session (auth.uid() inside the RPCs), never from a
 * request body. All writes go through the existing SECURITY DEFINER RPCs
 * from 004_functions.sql / 008_operating_hours_gate.sql:
 *
 *   - create_reservation: capacity/ownership/idempotency validation, the
 *     operating-hours gate, and the exclusion-constraint conflict check are
 *     all database-enforced. This module maps SQLSTATEs to HTTP semantics.
 *   - cancel_reservation: owner-or-staff authorization and idempotent
 *     terminal-state handling live in the database.
 *
 * Reads run as the caller under RLS (002_rls_policies.sql): guests see their
 * own reservations, restaurant staff see their restaurant's reservations.
 *
 * M5a does not implement reservation holds (deferred to M5b with its own
 * migration).
 */

/** SQLSTATE-ish codes returned by the RPCs, plus PostgREST client codes. */
interface DbErrorLike {
  code?: string;
  message?: string;
}

export type ReservationErrorCode =
  | 'UNAUTHORIZED' // 401
  | 'FORBIDDEN' // 403
  | 'NOT_FOUND' // 404
  | 'CONFLICT' // 409
  | 'VALIDATION' // 422
  | 'INTERNAL'; // 500

const ERROR_STATUS: Record<ReservationErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  VALIDATION: 422,
  INTERNAL: 500,
};

/**
 * Domain error with an HTTP status. Routes map this to a JSON body;
 * anything else becomes a generic 500 with no message leak.
 */
export class ReservationError extends Error {
  readonly code: ReservationErrorCode;
  readonly status: number;

  constructor(code: ReservationErrorCode, message: string) {
    super(message);
    this.name = 'ReservationError';
    this.code = code;
    this.status = ERROR_STATUS[code];
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ReservationAssignmentRecord {
  table_id: string;
  status: 'active' | 'released';
}

export interface ReservationRecord {
  id: string;
  restaurant_id: string;
  user_id: string | null;
  party_size: number;
  starts_at: string;
  ends_at: string;
  status: ReservationStatus;
  notes: string | null;
  idempotency_key: string | null;
  created_at: string;
  updated_at: string;
  reservation_tables?: ReservationAssignmentRecord[] | null;
}

const RESERVATION_COLUMNS =
  'id, restaurant_id, user_id, party_size, starts_at, ends_at, status, ' +
  'notes, idempotency_key, created_at, updated_at, ' +
  'reservation_tables(table_id, status)';

export interface CreateReservationInput {
  restaurantId: string;
  tableIds: string[];
  partySize: number;
  startsAt: string;
  endsAt: string;
  notes: string | null;
  idempotencyKey: string;
}

export interface ListReservationsQuery {
  restaurantId?: string;
  status?: ReservationStatus;
  from?: string;
  to?: string;
  limit: number;
}

export const DEFAULT_LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 100;

/**
 * Resolve the idempotency key: the Idempotency-Key header wins, the body
 * field is the fallback. Returns null when neither carries a usable value.
 */
export function pickIdempotencyKey(
  headerValue: unknown,
  bodyValue: unknown,
): string | null {
  if (typeof headerValue === 'string' && headerValue.trim().length > 0) {
    return headerValue.trim();
  }
  if (typeof bodyValue === 'string' && bodyValue.trim().length > 0) {
    return bodyValue.trim();
  }
  return null;
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new ReservationError('VALIDATION', `${field} must be a UUID`);
  }
  return value;
}

function requireTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new ReservationError(
      'VALIDATION',
      `${field} must be an ISO 8601 timestamp`,
    );
  }
  return value;
}

/** Validate the POST /api/reservations body (throws ReservationError 422). */
export function validateCreateInput(
  body: Record<string, unknown>,
  idempotencyKey: string | null,
): CreateReservationInput {
  if (!idempotencyKey) {
    throw new ReservationError(
      'VALIDATION',
      'An idempotency key is required (Idempotency-Key header or idempotency_key body field)',
    );
  }

  const restaurantId = requireUuid(body.restaurant_id, 'restaurant_id');

  if (!Array.isArray(body.table_ids) || body.table_ids.length === 0) {
    throw new ReservationError(
      'VALIDATION',
      'table_ids must be a non-empty array of UUIDs',
    );
  }
  const tableIds = body.table_ids.map((id, index) =>
    requireUuid(id, `table_ids[${index}]`),
  );

  const partySize = body.party_size;
  if (
    typeof partySize !== 'number' ||
    !Number.isInteger(partySize) ||
    partySize <= 0
  ) {
    throw new ReservationError(
      'VALIDATION',
      'party_size must be a positive integer',
    );
  }

  const startsAt = requireTimestamp(body.starts_at, 'starts_at');
  const endsAt = requireTimestamp(body.ends_at, 'ends_at');
  if (Date.parse(endsAt) <= Date.parse(startsAt)) {
    throw new ReservationError('VALIDATION', 'ends_at must be after starts_at');
  }

  const notes = body.notes;
  if (notes !== undefined && notes !== null && typeof notes !== 'string') {
    throw new ReservationError('VALIDATION', 'notes must be a string or null');
  }

  return {
    restaurantId,
    tableIds,
    partySize,
    startsAt,
    endsAt,
    notes: (notes as string | null | undefined) ?? null,
    idempotencyKey,
  };
}

/** Validate GET /api/reservations query parameters. */
export function validateListQuery(searchParams: URLSearchParams): ListReservationsQuery {
  const query: ListReservationsQuery = { limit: DEFAULT_LIST_LIMIT };

  const restaurantId = searchParams.get('restaurant_id');
  if (restaurantId !== null) {
    query.restaurantId = requireUuid(restaurantId, 'restaurant_id');
  }

  const status = searchParams.get('status');
  if (status !== null) {
    if (!isReservationStatus(status)) {
      throw new ReservationError(
        'VALIDATION',
        `status must be one of: ${RESERVATION_STATUSES.join(', ')}`,
      );
    }
    query.status = status;
  }

  const from = searchParams.get('from');
  if (from !== null) {
    query.from = requireTimestamp(from, 'from');
  }
  const to = searchParams.get('to');
  if (to !== null) {
    query.to = requireTimestamp(to, 'to');
  }
  if (query.from && query.to && Date.parse(query.from) > Date.parse(query.to)) {
    throw new ReservationError('VALIDATION', 'from must not be after to');
  }

  const limit = searchParams.get('limit');
  if (limit !== null) {
    if (!/^[1-9][0-9]{0,9}$/.test(limit)) {
      throw new ReservationError(
        'VALIDATION',
        'limit must be a positive integer',
      );
    }
    // Bounded safely: clamp instead of trusting arbitrarily large values.
    query.limit = Math.min(Number(limit), MAX_LIST_LIMIT);
  }

  return query;
}

/**
 * Validate the PATCH body. M5a accepts only { status: "cancelled" }.
 * Unsupported status values are 422 (not a transition conflict — the
 * request itself is out of contract for this endpoint).
 */
export function validateCancelBody(body: Record<string, unknown>): 'cancelled' {
  const status = body.status;
  if (status === undefined || status === null) {
    throw new ReservationError('VALIDATION', 'status is required');
  }
  if (status !== 'cancelled') {
    throw new ReservationError(
      'VALIDATION',
      isReservationStatus(status)
        ? `Status transition to '${status}' is not supported; this endpoint only accepts { status: "cancelled" }`
        : 'status must be "cancelled"',
    );
  }
  return 'cancelled';
}

/**
 * Map create_reservation SQLSTATEs to domain errors.
 * Returns null for anything unexpected — callers surface a generic 500 so
 * raw database messages and stack traces never reach the client.
 */
function mapCreateRpcError(error: DbErrorLike): ReservationError | null {
  switch (error.code) {
    case '23P01': // exclusion_violation → concurrent table conflict
      return new ReservationError(
        'CONFLICT',
        'Table conflict: one or more tables are already reserved for the specified time',
      );
    case '22023': // RAISE ... USING ERRCODE = '22023' (validation, hours, not found)
      return new ReservationError(
        'VALIDATION',
        error.message || 'Invalid reservation request',
      );
    case '22P02': // invalid input syntax for uuid
      return new ReservationError('VALIDATION', 'Invalid UUID supplied');
    case '42501': // auth.uid() IS NULL inside the RPC
      return new ReservationError('UNAUTHORIZED', 'Authentication required');
    default:
      return null;
  }
}

/** Map cancel_reservation SQLSTATEs to domain errors (see mapCreateRpcError). */
function mapCancelRpcError(error: DbErrorLike): ReservationError | null {
  switch (error.code) {
    case '22023': // 'Reservation not found'
      return new ReservationError('NOT_FOUND', 'Reservation not found');
    case '42501': // not the owner and not restaurant staff
      return new ReservationError(
        'FORBIDDEN',
        'Not authorized to cancel this reservation',
      );
    case '22P02':
      return new ReservationError('VALIDATION', 'Invalid reservation id');
    default:
      return null;
  }
}

/** Fetch one reservation as the caller (RLS-scoped), with its assignments. */
export async function fetchReservation(
  supabase: SupabaseClient,
  reservationId: string,
): Promise<ReservationRecord | null> {
  const { data, error } = await supabase
    .from('reservations')
    .select(RESERVATION_COLUMNS)
    .eq('id', reservationId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load reservation: ${error.message}`);
  }
  return (data as ReservationRecord | null) ?? null;
}

/**
 * Existence probe for GET /api/reservations/[id] when the row is hidden by
 * RLS. RLS exposes only owner/staff rows, so without this an unauthorized
 * cross-user read (403) could not be distinguished from a missing
 * reservation (404). Read-only, server-side only (mirrors the availability
 * route's use of SUPABASE_SECRET_KEY), returns null when unconfigured so the
 * caller falls back to the existence-safe 404.
 */
async function probeReservationExists(
  reservationId: string,
): Promise<boolean | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    return null;
  }
  const service = createSupabaseClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await service
    .from('reservations')
    .select('id')
    .eq('id', reservationId)
    .maybeSingle();
  if (error) {
    return null;
  }
  return Boolean(data);
}

/**
 * Book a reservation through create_reservation.
 *
 * Returns the reservation plus `replay: true` when the idempotency key
 * already existed (HTTP 200 instead of 201). The pre-check runs under RLS
 * as the caller; the RPC itself re-checks the key as SECURITY DEFINER, so a
 * lost race still returns the original reservation rather than raising.
 */
export async function createReservation(
  supabase: SupabaseClient,
  input: CreateReservationInput,
): Promise<{ reservation: ReservationRecord; replay: boolean }> {
  const existing = await supabase
    .from('reservations')
    .select('id')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();
  if (existing.error) {
    throw new Error(`Idempotency lookup failed: ${existing.error.message}`);
  }
  if (existing.data) {
    const replayed = await fetchReservation(supabase, existing.data.id as string);
    if (replayed) {
      return { reservation: replayed, replay: true };
    }
    // Key visible only to the RPC (cross-user collision): fall back to the id.
    return {
      reservation: { id: existing.data.id as string } as ReservationRecord,
      replay: true,
    };
  }

  const { data, error } = await supabase.rpc('create_reservation', {
    p_restaurant_id: input.restaurantId,
    p_table_ids: input.tableIds,
    p_party_size: input.partySize,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_idempotency_key: input.idempotencyKey,
    p_notes: input.notes,
  });
  if (error) {
    const mapped = mapCreateRpcError(error);
    if (mapped) {
      throw mapped;
    }
    throw new Error(`create_reservation failed: ${error.message}`);
  }

  const reservationId = data as string;
  const reservation = await fetchReservation(supabase, reservationId);
  if (!reservation) {
    // Should not happen — the creator always sees their own row (RLS).
    throw new Error('Reservation was created but could not be read back');
  }
  return { reservation, replay: false };
}

/** List reservations for the caller (guest) or a restaurant (staff). */
export async function listReservations(
  supabase: SupabaseClient,
  query: ListReservationsQuery,
): Promise<ReservationRecord[]> {
  let builder = supabase
    .from('reservations')
    .select(RESERVATION_COLUMNS)
    .order('starts_at', { ascending: true })
    .order('id', { ascending: true });

  if (query.restaurantId) {
    builder = builder.eq('restaurant_id', query.restaurantId);
  }
  if (query.status) {
    builder = builder.eq('status', query.status);
  }
  if (query.from) {
    builder = builder.gte('starts_at', query.from);
  }
  if (query.to) {
    builder = builder.lte('ends_at', query.to);
  }

  const { data, error } = await builder.limit(query.limit);
  if (error) {
    throw new Error(`Failed to list reservations: ${error.message}`);
  }
  // Cast via unknown: the embedded reservation_tables(...) relation in the
  // select string defeats supabase-js's template-literal type parser.
  return (data ?? []) as unknown as ReservationRecord[];
}

/**
 * Explicit tenant check for restaurant-scoped list queries: any membership
 * role (owner/manager/staff) qualifies, mirroring public.is_staff.
 * The same result is enforced again by RLS on the query itself.
 */
export async function isRestaurantStaff(
  supabase: SupabaseClient,
  userId: string,
  restaurantId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('restaurant_memberships')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('user_id', userId)
    .limit(1);
  if (error) {
    throw new Error(`Membership check failed: ${error.message}`);
  }
  return Boolean(data && data.length > 0);
}

/**
 * Cancel a reservation through cancel_reservation.
 *
 * Flow:
 *   - Row visible (owner or staff): run the status machine. Terminal →
 *     idempotent no-op returning the unchanged row (HTTP 200). Active →
 *     cancelled: call the RPC. Anything else: 409 (defensive; the M5a API
 *     only accepts "cancelled", which every active state permits).
 *   - Row hidden by RLS: the RPC distinguishes the outcome itself —
 *     'Reservation not found' → 404, 'Not authorized' → 403.
 */
export async function cancelReservation(
  supabase: SupabaseClient,
  userId: string,
  reservationId: string,
): Promise<{ reservation: ReservationRecord }> {
  const existing = await fetchReservation(supabase, reservationId);

  if (existing) {
    const actor = existing.user_id === userId ? 'guest' : 'staff';
    const transition = checkTransition(existing.status, 'cancelled', actor);
    if (!transition.allowed) {
      if (transition.reason === 'terminal_source') {
        // Idempotent repeat cancellation (and other terminal no-ops).
        return { reservation: existing };
      }
      if (transition.reason === 'same_status' && existing.status === 'cancelled') {
        return { reservation: existing };
      }
      throw new ReservationError(
        'CONFLICT',
        `Cannot cancel a reservation in status '${existing.status}'`,
      );
    }
  }

  const { error } = await supabase.rpc('cancel_reservation', {
    p_reservation_id: reservationId,
  });
  if (error) {
    const mapped = mapCancelRpcError(error);
    if (mapped) {
      throw mapped;
    }
    throw new Error(`cancel_reservation failed: ${error.message}`);
  }

  const updated = await fetchReservation(supabase, reservationId);
  if (!updated) {
    throw new Error('Reservation was cancelled but could not be read back');
  }
  return { reservation: updated };
}

/**
 * Distinguish an unauthorized read (403) from a missing reservation (404)
 * for rows hidden by RLS. Returns null when the server-side probe cannot
 * run — callers then answer 404, which never leaks existence.
 */
export async function reservationExists(
  reservationId: string,
): Promise<boolean | null> {
  return probeReservationExists(reservationId);
}
