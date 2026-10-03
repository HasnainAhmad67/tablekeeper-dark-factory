import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  cleanupByIdempotencyKeys,
  cleanupTestData,
  createAnonClient,
  createServiceClient,
  createTestUserWithRetry,
  deleteTestUser,
  SEED,
  testId,
} from './helpers';

/**
 * M5a reservation API acceptance tests.
 *
 * Route handlers are invoked directly in Vitest: `@/lib/supabase/server`
 * (the Next cookie client) is mocked to return a real authenticated test
 * client, so `auth.getUser()`, RLS, and both RPCs (004/008) all run against
 * the hosted database exactly as they do in production. HTTP statuses are
 * asserted on the actual NextResponse objects.
 *
 * Window design (no collisions with other suites):
 *   - Seed hours for restaurant A: weekdays 11:00-22:00 America/New_York.
 *   - 2027-01-07 is a Thursday; all booking windows sit inside opening hours
 *     except WINDOW_CLOSED, which exists to trip the 008 hours gate.
 *   - Tables T4/T5/T6 and the 2027-01-07 date are untouched by the other
 *     database suites (concurrency/hours-gate use T1-T3 in 2026-10..2027-01;
 *     rls uses T6 only at 2026-12-01; constraints use 2026-10/11).
 */

const authState = vi.hoisted(() => ({ client: null as SupabaseClient | null }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!authState.client) {
      throw new Error('No test auth client bound — call bind() before invoking a route');
    }
    return authState.client;
  },
}));

import { GET as listRoute, POST as createRoute } from '@/app/api/reservations/route';
import {
  GET as detailRoute,
  PATCH as patchRoute,
} from '@/app/api/reservations/[reservationId]/route';

const serviceClient = createServiceClient();

let guestA!: { client: SupabaseClient; userId: string; email: string };
let guestB!: { client: SupabaseClient; userId: string; email: string };
let staffUser!: { client: SupabaseClient; userId: string; email: string };
let anonClient!: SupabaseClient;

/** Every idempotency key this suite hands out, cleaned up after the run. */
const trackedKeys: string[] = [];

// Thu 2027-01-07, America/New_York (EST, UTC-5) — inside 11:00-22:00:
//   WINDOW_A      14:00-16:00 local
//   WINDOW_B      16:00-18:00 local
//   WINDOW_C      18:00-19:00 local
//   WINDOW_CLOSED 02:00-04:00 local (outside hours → 008 gate)
const WINDOW_A = { starts_at: '2027-01-07T19:00:00Z', ends_at: '2027-01-07T21:00:00Z' };
const WINDOW_B = { starts_at: '2027-01-07T21:00:00Z', ends_at: '2027-01-07T23:00:00Z' };
const WINDOW_C = { starts_at: '2027-01-07T23:00:00Z', ends_at: '2027-01-08T00:00:00Z' };
const WINDOW_CLOSED = {
  starts_at: '2027-01-07T07:00:00Z',
  ends_at: '2027-01-07T09:00:00Z',
};

/** A reservation that never exists (valid UUID shape, not used by any suite). */
const MISSING_ID = '88888888-4444-4444-8444-121212121212';

// Set by earlier tests, consumed by later ones (tests run sequentially).
let createdA!: string; // POST 201 happy path (T4 + WINDOW_A)
let idC!: string; // header-precedence booking (T6 + WINDOW_C)
let idF!: string; // cancel + release + rebook booking (T4 + WINDOW_B)
let idG!: string; // staff/non-member booking (T6 + WINDOW_A)

function bind(client: SupabaseClient | null): void {
  authState.client = client;
}

function newKey(tag: string): string {
  const key = testId(`m5a-${tag}`);
  trackedKeys.push(key);
  return key;
}

function bookingBody(
  overrides: Record<string, unknown> = {},
  key = newKey('booking'),
): Record<string, unknown> {
  return {
    restaurant_id: SEED.restaurantA,
    table_ids: [SEED.tableT4],
    party_size: 2,
    ...WINDOW_A,
    idempotency_key: key,
    ...overrides,
  };
}

function postReservations(
  body: unknown,
  options: { client: SupabaseClient; headers?: Record<string, string> },
): Promise<Response> {
  bind(options.client);
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return createRoute(
    new Request('http://localhost/api/reservations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...options.headers },
      body: raw,
    }),
  );
}

function getReservations(client: SupabaseClient, query = ''): Promise<Response> {
  bind(client);
  return listRoute(new Request(`http://localhost/api/reservations${query}`));
}

function getReservationDetail(
  client: SupabaseClient,
  reservationId: string,
): Promise<Response> {
  bind(client);
  return detailRoute(new Request(`http://localhost/api/reservations/${reservationId}`), {
    params: Promise.resolve({ reservationId }),
  });
}

function patchReservation(
  client: SupabaseClient,
  reservationId: string,
  body: unknown,
): Promise<Response> {
  bind(client);
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  return patchRoute(
    new Request(`http://localhost/api/reservations/${reservationId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: raw,
    }),
    { params: Promise.resolve({ reservationId }) },
  );
}

beforeAll(async () => {
  guestA = await createTestUserWithRetry();
  guestB = await createTestUserWithRetry();
  staffUser = await createTestUserWithRetry();
  anonClient = createAnonClient();

  const { error } = await serviceClient.from('restaurant_memberships').insert({
    restaurant_id: SEED.restaurantA,
    user_id: staffUser.userId,
    role: 'staff',
  });
  if (error) {
    throw new Error(`Failed to seed staff membership: ${error.message}`);
  }
}, 60000);

afterAll(async () => {
  await cleanupByIdempotencyKeys(serviceClient, trackedKeys);
  if (staffUser) {
    await cleanupTestData(serviceClient, 'restaurant_memberships', 'user_id', staffUser.userId);
    await deleteTestUser(staffUser.userId);
  }
  if (guestA) await deleteTestUser(guestA.userId);
  if (guestB) await deleteTestUser(guestB.userId);
  bind(null);
}, 60000);

describe('reservation API (M5a)', () => {
  it('rejects unauthenticated POST, list, detail, and PATCH with 401', async () => {
    const post = await postReservations(bookingBody(), { client: anonClient });
    expect(post.status).toBe(401);

    const list = await getReservations(anonClient);
    expect(list.status).toBe(401);

    const detail = await getReservationDetail(anonClient, MISSING_ID);
    expect(detail.status).toBe(401);

    const patch = await patchReservation(anonClient, MISSING_ID, { status: 'cancelled' });
    expect(patch.status).toBe(401);
  });

  it('creates a reservation with 201 under the caller identity', async () => {
    const body = bookingBody();
    const res = await postReservations(body, { client: guestA.client });
    expect(res.status).toBe(201);

    const { reservation } = await res.json();
    createdA = reservation.id;
    expect(reservation.status).toBe('confirmed');
    expect(reservation.user_id).toBe(guestA.userId); // from auth, never from body
    expect(reservation.restaurant_id).toBe(SEED.restaurantA);
    expect(reservation.reservation_tables).toEqual([
      { table_id: SEED.tableT4, status: 'active' },
    ]);

    const { data: row } = await serviceClient
      .from('reservations')
      .select('user_id, status, idempotency_key')
      .eq('id', createdA)
      .maybeSingle();
    expect(row?.user_id).toBe(guestA.userId);
    expect(row?.status).toBe('confirmed');
    expect(row?.idempotency_key).toBe(body.idempotency_key);
  });

  it('replays an idempotency key with 200 and no duplicate rows', async () => {
    const key = newKey('replay');
    const body = bookingBody({ table_ids: [SEED.tableT6], ...WINDOW_B }, key);

    const first = await postReservations(body, { client: guestA.client });
    expect(first.status).toBe(201);
    const firstId = (await first.json()).reservation.id;

    const second = await postReservations(body, { client: guestA.client });
    expect(second.status).toBe(200);
    const secondPayload = await second.json();
    expect(secondPayload.reservation.id).toBe(firstId);
    expect(secondPayload.reservation.status).toBe('confirmed');

    const { count } = await serviceClient
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('idempotency_key', key);
    expect(count).toBe(1);

    const { data: assignments } = await serviceClient
      .from('reservation_tables')
      .select('table_id')
      .eq('reservation_id', firstId);
    expect(assignments).toHaveLength(1);
  });

  it('prefers the Idempotency-Key header over the body field', async () => {
    const headerKey = newKey('header');
    const bodyKey = newKey('body');
    const body = bookingBody(
      { table_ids: [SEED.tableT6], ...WINDOW_C, idempotency_key: bodyKey },
    );

    const res = await postReservations(body, {
      client: guestA.client,
      headers: { 'Idempotency-Key': headerKey },
    });
    expect(res.status).toBe(201);
    const { reservation } = await res.json();
    idC = reservation.id;

    const { data: row } = await serviceClient
      .from('reservations')
      .select('idempotency_key')
      .eq('id', idC)
      .maybeSingle();
    expect(row?.idempotency_key).toBe(headerKey);
  });

  it('rejects a request with no usable idempotency key with 422', async () => {
    const body = bookingBody({ table_ids: [SEED.tableT5] });
    delete body.idempotency_key;

    const noHeader = await postReservations(body, { client: guestA.client });
    expect(noHeader.status).toBe(422);
    expect((await noHeader.json()).error).toMatch(/idempotency/i);

    const blankHeader = await postReservations(body, {
      client: guestA.client,
      headers: { 'Idempotency-Key': '   ' },
    });
    expect(blankHeader.status).toBe(422);
  });

  it('rejects a booking outside operating hours with 422 and writes nothing', async () => {
    const key = newKey('hours');
    const body = bookingBody({ ...WINDOW_CLOSED }, key);

    const res = await postReservations(body, { client: guestA.client });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/outside operating hours/i);

    const { count } = await serviceClient
      .from('reservations')
      .select('id', { count: 'exact', head: true })
      .eq('idempotency_key', key);
    expect(count).toBe(0);
  });

  it('rejects malformed JSON and non-object bodies with 400', async () => {
    const brokenJson = await postReservations('{"restaurant_id": ', {
      client: guestA.client,
    });
    expect(brokenJson.status).toBe(400);

    const arrayBody = await postReservations('["not", "an", "object"]', {
      client: guestA.client,
    });
    expect(arrayBody.status).toBe(400);

    const nullBody = await postReservations('null', { client: guestA.client });
    expect(nullBody.status).toBe(400);
  });

  it('rejects invalid time windows with 422', async () => {
    const sameInstant = await postReservations(
      bookingBody({ ends_at: WINDOW_A.starts_at }),
      { client: guestA.client },
    );
    expect(sameInstant.status).toBe(422);
    expect((await sameInstant.json()).error).toMatch(/after starts_at/i);

    const inverted = await postReservations(
      bookingBody({ starts_at: WINDOW_A.ends_at, ends_at: WINDOW_A.starts_at }),
      { client: guestA.client },
    );
    expect(inverted.status).toBe(422);

    const badStamp = await postReservations(bookingBody({ starts_at: 'not-a-date' }), {
      client: guestA.client,
    });
    expect(badStamp.status).toBe(422);
    expect((await badStamp.json()).error).toMatch(/ISO 8601/i);
  });

  it('rejects invalid UUIDs and field types with 422', async () => {
    const badRestaurant = await postReservations(
      bookingBody({ restaurant_id: 'not-a-uuid' }),
      { client: guestA.client },
    );
    expect(badRestaurant.status).toBe(422);
    expect((await badRestaurant.json()).error).toMatch(/restaurant_id/);

    const emptyTables = await postReservations(bookingBody({ table_ids: [] }), {
      client: guestA.client,
    });
    expect(emptyTables.status).toBe(422);

    const badTable = await postReservations(bookingBody({ table_ids: ['nope'] }), {
      client: guestA.client,
    });
    expect(badTable.status).toBe(422);
    expect((await badTable.json()).error).toMatch(/table_ids\[0\]/);

    const zeroParty = await postReservations(bookingBody({ party_size: 0 }), {
      client: guestA.client,
    });
    expect(zeroParty.status).toBe(422);
    expect((await zeroParty.json()).error).toMatch(/party_size/);

    const stringParty = await postReservations(bookingBody({ party_size: '2' }), {
      client: guestA.client,
    });
    expect(stringParty.status).toBe(422);

    const badNotes = await postReservations(bookingBody({ notes: 42 }), {
      client: guestA.client,
    });
    expect(badNotes.status).toBe(422);
    expect((await badNotes.json()).error).toMatch(/notes/);
  });

  it('lets exactly one of 5 concurrent same-table bookings win (201 vs 409) with no orphan rows', async () => {
    const raceKeys = Array.from({ length: 5 }, (_, index) => newKey(`race-${index}`));
    const responses = await Promise.all(
      raceKeys.map((key) =>
        postReservations(
          bookingBody({ table_ids: [SEED.tableT5], party_size: 4, ...WINDOW_A }, key),
          { client: guestA.client },
        ),
      ),
    );

    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(4);

    // Losers left no reservation rows and the winner has exactly one
    // active assignment — no partial or orphaned rows of either kind.
    const { data: rows } = await serviceClient
      .from('reservations')
      .select('id')
      .in('idempotency_key', raceKeys);
    expect(rows).toHaveLength(1);

    const { data: assignments } = await serviceClient
      .from('reservation_tables')
      .select('table_id, status')
      .eq('reservation_id', rows![0].id);
    expect(assignments).toEqual([{ table_id: SEED.tableT5, status: 'active' }]);
  });

  it("excludes other guests' reservations from the list (guest isolation)", async () => {
    const res = await getReservations(guestB.client);
    expect(res.status).toBe(200);
    const { reservations } = await res.json();
    expect(Array.isArray(reservations)).toBe(true);
    expect(reservations).toHaveLength(0);
    expect(reservations.some((row: { id: string }) => row.id === createdA)).toBe(false);
  });

  it('returns 200 to the owner, 403 cross-user, 404 missing, 422 for a bad id', async () => {
    const owner = await getReservationDetail(guestA.client, createdA);
    expect(owner.status).toBe(200);
    expect((await owner.json()).reservation.id).toBe(createdA);

    const crossUser = await getReservationDetail(guestB.client, createdA);
    expect(crossUser.status).toBe(403);

    const missing = await getReservationDetail(guestA.client, MISSING_ID);
    expect(missing.status).toBe(404);
    expect((await missing.json()).error).toMatch(/not found/i);

    const badId = await getReservationDetail(guestA.client, 'not-a-uuid');
    expect(badId.status).toBe(422);
  });

  it('cancels a reservation, releases its assignments, and permits immediate rebooking', async () => {
    const create = await postReservations(bookingBody({ ...WINDOW_B }), {
      client: guestA.client,
    });
    expect(create.status).toBe(201);
    idF = (await create.json()).reservation.id;

    const cancel = await patchReservation(guestA.client, idF, { status: 'cancelled' });
    expect(cancel.status).toBe(200);
    const cancelled = (await cancel.json()).reservation;
    expect(cancelled.id).toBe(idF);
    expect(cancelled.status).toBe('cancelled');

    // trg_release_reservation_tables (003) fired on the status change.
    const { data: assignments } = await serviceClient
      .from('reservation_tables')
      .select('status')
      .eq('reservation_id', idF);
    expect(assignments).toEqual([{ status: 'released' }]);

    // The released window is immediately bookable again.
    const rebook = await postReservations(bookingBody({ ...WINDOW_B }), {
      client: guestA.client,
    });
    expect(rebook.status).toBe(201);
  });

  it('treats repeated cancellation of a terminal reservation as an idempotent 200', async () => {
    const repeat = await patchReservation(guestA.client, idF, { status: 'cancelled' });
    expect(repeat.status).toBe(200);
    const payload = await repeat.json();
    expect(payload.reservation.id).toBe(idF);
    expect(payload.reservation.status).toBe('cancelled');

    // 'completed' is terminal too: cancelling is a no-op that keeps the status.
    const { error } = await serviceClient
      .from('reservations')
      .update({ status: 'completed' })
      .eq('id', idC);
    expect(error).toBeNull();

    const noOp = await patchReservation(guestA.client, idC, { status: 'cancelled' });
    expect(noOp.status).toBe(200);
    expect((await noOp.json()).reservation.status).toBe('completed');
  });

  it('enforces staff access, membership scope, and PATCH validation', async () => {
    const create = await postReservations(
      bookingBody({ table_ids: [SEED.tableT6], ...WINDOW_A }),
      { client: guestA.client },
    );
    expect(create.status).toBe(201);
    idG = (await create.json()).reservation.id;

    // Neither owner nor staff → RPC authorization rejects with 403.
    const foreign = await patchReservation(guestB.client, idG, { status: 'cancelled' });
    expect(foreign.status).toBe(403);
    expect((await foreign.json()).error).toMatch(/not authorized/i);

    // Missing reservation → 404 (distinguished by the RPC).
    const missing = await patchReservation(guestA.client, MISSING_ID, {
      status: 'cancelled',
    });
    expect(missing.status).toBe(404);

    // Invalid id → 422 before any database call.
    const badId = await patchReservation(guestA.client, 'not-a-uuid', {
      status: 'cancelled',
    });
    expect(badId.status).toBe(422);

    // Unsupported status values / missing status → 422; malformed JSON → 400.
    const seated = await patchReservation(guestA.client, idG, { status: 'seated' });
    expect(seated.status).toBe(422);
    expect((await seated.json()).error).toMatch(/cancelled/);

    const missingStatus = await patchReservation(guestA.client, idG, {});
    expect(missingStatus.status).toBe(422);

    const bogusStatus = await patchReservation(guestA.client, idG, { status: 'bogus' });
    expect(bogusStatus.status).toBe(422);

    const badJson = await patchReservation(guestA.client, idG, '{oops');
    expect(badJson.status).toBe(400);

    // Restaurant staff may cancel a guest's reservation.
    const staffCancel = await patchReservation(staffUser.client, idG, {
      status: 'cancelled',
    });
    expect(staffCancel.status).toBe(200);
    expect((await staffCancel.json()).reservation.status).toBe('cancelled');
  });

  it('lists a restaurant for staff and rejects non-members with 403', async () => {
    const staffList = await getReservations(
      staffUser.client,
      `?restaurant_id=${SEED.restaurantA}`,
    );
    expect(staffList.status).toBe(200);
    const { reservations } = await staffList.json();
    expect(reservations.some((row: { id: string }) => row.id === createdA)).toBe(true);
    expect(
      reservations.every(
        (row: { restaurant_id: string }) => row.restaurant_id === SEED.restaurantA,
      ),
    ).toBe(true);

    const ownerGuestList = await getReservations(
      guestA.client,
      `?restaurant_id=${SEED.restaurantA}`,
    );
    expect(ownerGuestList.status).toBe(403);

    const nonMemberList = await getReservations(
      guestB.client,
      `?restaurant_id=${SEED.restaurantA}`,
    );
    expect(nonMemberList.status).toBe(403);
  });

  it('bounds the list limit and validates query parameters', async () => {
    const page = await getReservations(guestA.client, '?limit=2');
    expect(page.status).toBe(200);
    expect((await page.json()).reservations).toHaveLength(2);

    const all = await getReservations(guestA.client);
    expect(all.status).toBe(200);
    expect((await all.json()).reservations.length).toBeGreaterThanOrEqual(3);

    const zero = await getReservations(guestA.client, '?limit=0');
    expect(zero.status).toBe(422);

    const garbage = await getReservations(guestA.client, '?limit=abc');
    expect(garbage.status).toBe(422);

    const badStatus = await getReservations(guestA.client, '?status=bogus');
    expect(badStatus.status).toBe(422);

    const badFrom = await getReservations(guestA.client, '?from=not-a-date');
    expect(badFrom.status).toBe(422);

    const badRestaurant = await getReservations(
      guestA.client,
      '?restaurant_id=not-a-uuid',
    );
    expect(badRestaurant.status).toBe(422);

    const huge = await getReservations(guestA.client, '?limit=9999999999');
    expect(huge.status).toBe(200);
    expect((await huge.json()).reservations.length).toBeLessThanOrEqual(100);
  });
});
