import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  cleanupTestData,
  createAnonClient,
  createServiceClient,
  createTestUserWithRetry,
  deleteTestUser,
  testId,
  SEED,
} from './database/helpers';

/**
 * M7 Phase 4 operating-hours API tests (plan screen 28).
 *
 * Conventions follow tests/staff-api.test.ts: the route handlers are
 * invoked directly in Vitest and `@/lib/supabase/server` (the Next cookie
 * client) is mocked to bind a real client, so auth.getUser() and RLS run
 * against the hosted database exactly as in production. One signup serves
 * the whole suite (rate-limit friendly): the fixture user creates its own
 * restaurant so the insert trigger (003) makes it the owner, and the 403
 * gate is proven against seed restaurant A where the user has no
 * membership — seed hours are never written by this file.
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

import { GET, PUT } from '@/app/api/restaurants/[restaurantId]/hours/route';

const serviceClient = createServiceClient();

// Distinct from hours-gate's TEMP_RESTAURANT_ID (...999999999999): the two
// files run in parallel and must not fight over the same row.
const TEMP_RESTAURANT_ID = '99999999-9999-4999-8999-999999999998';

let fixture!: { client: SupabaseClient; userId: string; email: string };

function bind(client: SupabaseClient | null): void {
  authState.client = client;
}

function hoursUrl(restaurantId: string): string {
  return `http://localhost/api/restaurants/${restaurantId}/hours`;
}

function getHours(client: SupabaseClient, restaurantId: string): Promise<Response> {
  bind(client);
  return GET(new Request(hoursUrl(restaurantId)), {
    params: Promise.resolve({ restaurantId }),
  });
}

function putHoursRaw(
  client: SupabaseClient,
  restaurantId: string,
  bodyText: string,
): Promise<Response> {
  bind(client);
  return PUT(
    new Request(hoursUrl(restaurantId), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: bodyText,
    }),
    { params: Promise.resolve({ restaurantId }) },
  );
}

function putHours(
  client: SupabaseClient,
  restaurantId: string,
  payload: unknown,
): Promise<Response> {
  return putHoursRaw(client, restaurantId, JSON.stringify(payload));
}

const WEEK: Array<{
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  is_closed: boolean;
}> = [
  { day_of_week: 0, opens_at: '11:00', closes_at: '22:00', is_closed: false },
  { day_of_week: 1, opens_at: '09:00', closes_at: '17:00', is_closed: false },
  // Sent with seconds on purpose: the route must normalize to HH:MM.
  { day_of_week: 2, opens_at: '10:30:00', closes_at: '23:00:00', is_closed: false },
  { day_of_week: 3, opens_at: '09:00', closes_at: '17:00', is_closed: false },
  { day_of_week: 4, opens_at: '09:00', closes_at: '17:00', is_closed: false },
  { day_of_week: 5, opens_at: '12:00', closes_at: '23:00', is_closed: false },
  { day_of_week: 6, opens_at: '12:00', closes_at: '23:00', is_closed: true },
];

beforeAll(async () => {
  fixture = await createTestUserWithRetry();

  // Start from a clean slate for idempotent re-runs, then insert through
  // the authenticated fixture user (not the service role):
  // trg_handle_new_restaurant (003) fires after insert and creates the
  // initial owner membership with auth.uid(), which is NULL under the
  // service role and violates restaurant_memberships.user_id NOT NULL
  // (same pattern as tests/database/hours-gate.test.ts).
  await serviceClient.from('restaurants').delete().eq('id', TEMP_RESTAURANT_ID);
  const { error } = await fixture.client.from('restaurants').insert({
    id: TEMP_RESTAURANT_ID,
    name: 'Hours API probe',
    slug: testId('hours-api'),
    timezone: 'America/New_York',
  });
  expect(error).toBeNull();
});

afterAll(async () => {
  // Guard: if beforeAll failed (e.g. GoTrue rate limit), there is nothing
  // to clean up — don't mask the original error with a TypeError.
  if (!fixture) return;
  // Cascades the owner membership and any hours rows with the restaurant.
  await cleanupTestData(serviceClient, 'restaurants', 'id', TEMP_RESTAURANT_ID);
  await deleteTestUser(fixture.userId);
});

describe('GET /api/restaurants/[restaurantId]/hours', () => {
  it('returns 401 for anonymous callers', async () => {
    const response = await getHours(createAnonClient(), TEMP_RESTAURANT_ID);
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('Authentication required');
  });

  it("returns the seed restaurant's hours normalized to HH:MM", async () => {
    const response = await getHours(fixture.client, SEED.restaurantA);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      hours: Array<{
        day_of_week: number;
        opens_at: string;
        closes_at: string;
        is_closed: boolean;
      }>;
    };
    expect(body.hours).toHaveLength(7);
    expect(body.hours.map((hour) => hour.day_of_week)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(body.hours[0]).toEqual({
      day_of_week: 0,
      opens_at: '11:00',
      closes_at: '22:00',
      is_closed: false,
    });
  });

  it('returns an empty list for a restaurant with no hours', async () => {
    const response = await getHours(fixture.client, TEMP_RESTAURANT_ID);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hours: [] });
  });
});

describe('PUT /api/restaurants/[restaurantId]/hours', () => {
  it('returns 401 for anonymous callers', async () => {
    const response = await putHours(createAnonClient(), TEMP_RESTAURANT_ID, { hours: WEEK });
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('Authentication required');
  });

  it('rejects a closes_at that is not later than opens_at with 422 and writes nothing', async () => {
    const response = await putHours(fixture.client, TEMP_RESTAURANT_ID, {
      hours: [{ day_of_week: 0, opens_at: '18:00', closes_at: '09:00', is_closed: false }],
    });
    expect(response.status).toBe(422);
    expect((await response.json()).error).toMatch(/later than opens_at/);

    const check = await getHours(fixture.client, TEMP_RESTAURANT_ID);
    expect(await check.json()).toEqual({ hours: [] });
  });

  it('rejects equal opens/closes, invalid days, and invalid times with 422', async () => {
    const equal = await putHours(fixture.client, TEMP_RESTAURANT_ID, {
      hours: [{ day_of_week: 0, opens_at: '09:00', closes_at: '09:00', is_closed: false }],
    });
    expect(equal.status).toBe(422);

    const badDay = await putHours(fixture.client, TEMP_RESTAURANT_ID, {
      hours: [{ day_of_week: 7, opens_at: '09:00', closes_at: '17:00', is_closed: false }],
    });
    expect(badDay.status).toBe(422);
    expect((await badDay.json()).error).toMatch(/between 0 and 6/);

    const badTime = await putHours(fixture.client, TEMP_RESTAURANT_ID, {
      hours: [{ day_of_week: 0, opens_at: '9am', closes_at: '17:00', is_closed: false }],
    });
    expect(badTime.status).toBe(422);
    expect((await badTime.json()).error).toMatch(/opens_at/);
  });

  it('rejects a payload without a usable hours array and malformed JSON', async () => {
    const missing = await putHours(fixture.client, TEMP_RESTAURANT_ID, { nope: true });
    expect(missing.status).toBe(422);
    expect((await missing.json()).error).toMatch(/non-empty array/);

    const malformed = await putHoursRaw(fixture.client, TEMP_RESTAURANT_ID, '{not json');
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error).toBe('Invalid JSON body');
  });

  it('returns 403 for a caller without a manager/owner membership', async () => {
    const response = await putHours(fixture.client, SEED.restaurantA, { hours: WEEK });
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe(
      'Owner or manager role required for this restaurant',
    );

    // The gate runs before any write — seed hours stay untouched.
    const check = await getHours(fixture.client, SEED.restaurantA);
    const body = (await check.json()) as { hours: Array<{ opens_at: string }> };
    expect(body.hours).toHaveLength(7);
    expect(body.hours[0].opens_at).toBe('11:00');
  });

  it('upserts all seven days and returns them sorted with 200', async () => {
    const response = await putHours(fixture.client, TEMP_RESTAURANT_ID, { hours: WEEK });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      hours: Array<{
        day_of_week: number;
        opens_at: string;
        closes_at: string;
        is_closed: boolean;
      }>;
    };
    expect(body.hours).toHaveLength(7);
    expect(body.hours.map((hour) => hour.day_of_week)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // Normalization: HH:MM:SS input comes back as HH:MM.
    expect(body.hours[2]).toEqual({
      day_of_week: 2,
      opens_at: '10:30',
      closes_at: '23:00',
      is_closed: false,
    });
    expect(body.hours[6].is_closed).toBe(true);

    // The save is what GET serves.
    const readBack = await getHours(fixture.client, TEMP_RESTAURANT_ID);
    expect(await readBack.json()).toEqual({ hours: body.hours });
  });

  it('replaces an existing day on re-save without duplicating rows', async () => {
    const response = await putHours(fixture.client, TEMP_RESTAURANT_ID, {
      hours: [
        { day_of_week: 0, opens_at: '13:00', closes_at: '21:00', is_closed: false },
        { day_of_week: 1, opens_at: '10:00', closes_at: '16:00', is_closed: false },
      ],
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      hours: Array<{ day_of_week: number; opens_at: string }>;
    };
    expect(body.hours).toHaveLength(7); // UNIQUE (restaurant_id, day_of_week) upsert
    expect(body.hours[0]).toMatchObject({ day_of_week: 0, opens_at: '13:00' });
    expect(body.hours[1]).toMatchObject({ day_of_week: 1, opens_at: '10:00' });
  });
});
