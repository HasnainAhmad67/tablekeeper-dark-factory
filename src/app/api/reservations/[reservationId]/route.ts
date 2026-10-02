import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  ReservationError,
  cancelReservation,
  fetchReservation,
  reservationExists,
  validateCancelBody,
} from '@/server/reservations';

/**
 * /api/reservations/[reservationId] (M5a)
 *
 * GET — return the reservation only to its owner or to restaurant staff.
 * RLS already restricts visibility to those two cases; when the row is
 * hidden, a read-only server-side existence probe separates "unauthorized"
 * (403) from "missing" (404), falling back to the existence-safe 404 when
 * the probe is unavailable.
 *
 * PATCH — accepts only { status: "cancelled" } and delegates to the
 * cancel_reservation RPC (owner-or-staff authorization and idempotent
 * terminal handling live in the database). Cancellation releases this
 * reservation's reservation_tables rows through
 * trg_release_reservation_tables (003_triggers.sql).
 *
 * Error mapping: 401 unauthenticated, 403 unauthorized, 404 missing, 400
 * malformed JSON/body, 422 invalid id or unsupported status value, 409
 * rejected transition (defensive), 500 unexpected.
 */

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function errorResponse(err: unknown) {
  if (err instanceof ReservationError) {
    return jsonError(err.message, err.status);
  }
  return jsonError('Internal error', 500);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ reservationId: string }> },
) {
  const { reservationId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return jsonError('Authentication required', 401);
  }

  try {
    if (!UUID_RE.test(reservationId)) {
      throw new ReservationError('VALIDATION', 'reservationId must be a UUID');
    }

    const reservation = await fetchReservation(supabase, reservationId);
    if (reservation) {
      return NextResponse.json({ reservation });
    }

    const exists = await reservationExists(reservationId);
    if (exists === true) {
      throw new ReservationError(
        'FORBIDDEN',
        'You do not have access to this reservation',
      );
    }
    return jsonError('Reservation not found', 404);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reservationId: string }> },
) {
  const { reservationId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return jsonError('Authentication required', 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return jsonError('Body must be a JSON object', 400);
  }

  try {
    if (!UUID_RE.test(reservationId)) {
      throw new ReservationError('VALIDATION', 'reservationId must be a UUID');
    }
    validateCancelBody(body as Record<string, unknown>);

    const { reservation } = await cancelReservation(
      supabase,
      user.id,
      reservationId,
    );
    return NextResponse.json({ reservation });
  } catch (err) {
    return errorResponse(err);
  }
}
