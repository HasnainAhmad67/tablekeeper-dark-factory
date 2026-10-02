import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  ReservationError,
  createReservation,
  isRestaurantStaff,
  listReservations,
  pickIdempotencyKey,
  validateCreateInput,
  validateListQuery,
} from '@/server/reservations';

/**
 * /api/reservations (M5a)
 *
 * POST — book a table. Identity always comes from the session; `user_id` is
 * never read from the body. The idempotency key is taken from the
 * Idempotency-Key header first, with the body field as fallback; a request
 * carrying neither is rejected. Booking, the operating-hours gate, and
 * exclusion-constraint conflict detection all run inside the
 * create_reservation RPC (004/008).
 *
 * GET — list reservations: the caller's own rows (RLS) by default, or every
 * reservation of a restaurant when the caller is a member of it (explicit
 * membership check + RLS select_staff).
 *
 * Error mapping: 401 unauthenticated, 400 malformed JSON/body, 409 table
 * conflict, 422 validation / invalid window / invalid UUID / outside
 * operating hours, 403 non-member restaurant scope, 500 unexpected.
 */

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

function errorResponse(err: unknown) {
  if (err instanceof ReservationError) {
    return jsonError(err.message, err.status);
  }
  // Unexpected failure: no message, no stack.
  return jsonError('Internal error', 500);
}

async function requireUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<{ id: string } | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  return error || !user ? null : user;
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  if (!user) {
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
    const record = body as Record<string, unknown>;
    const idempotencyKey = pickIdempotencyKey(
      request.headers.get('Idempotency-Key'),
      record.idempotency_key,
    );
    const input = validateCreateInput(record, idempotencyKey);
    const { reservation, replay } = await createReservation(supabase, input);
    return NextResponse.json({ reservation }, { status: replay ? 200 : 201 });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  if (!user) {
    return jsonError('Authentication required', 401);
  }

  try {
    const query = validateListQuery(new URL(request.url).searchParams);

    if (
      query.restaurantId &&
      !(await isRestaurantStaff(supabase, user.id, query.restaurantId))
    ) {
      throw new ReservationError(
        'FORBIDDEN',
        'Staff membership required for this restaurant',
      );
    }

    const reservations = await listReservations(supabase, query);
    return NextResponse.json({ reservations });
  } catch (err) {
    return errorResponse(err);
  }
}
