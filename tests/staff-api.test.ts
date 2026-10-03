import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  cleanupTestData,
  createAnonClient,
  createServiceClient,
  createTestUserWithRetry,
  deleteTestUser,
  SEED,
} from './database/helpers';

/**
 * M7 Phase 1 staff identity API tests.
 *
 * Conventions follow tests/database/reservations-api.test.ts: the route
 * handler is invoked directly in Vitest and `@/lib/supabase/server` (the
 * Next cookie client) is mocked to bind a real client, so auth.getUser()
 * and RLS run against the hosted database exactly as in production. One
 * signup serves the whole suite (rate-limit friendly): the user is asserted
 * membership-free first, then given an owner membership for the happy path.
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

import { GET as staffMeRoute } from '@/app/api/staff/me/route';

const serviceClient = createServiceClient();

let member!: { client: SupabaseClient; userId: string; email: string };

function bind(client: SupabaseClient | null): void {
  authState.client = client;
}

function getStaffMe(client: SupabaseClient): Promise<Response> {
  bind(client);
  return staffMeRoute(new Request('http://localhost/api/staff/me'));
}

beforeAll(async () => {
  member = await createTestUserWithRetry();
});

afterAll(async () => {
  // Guard: if beforeAll failed (e.g. GoTrue rate limit), there is nothing
  // to clean up — don't mask the original error with a TypeError.
  if (!member) return;
  await cleanupTestData(serviceClient, 'restaurant_memberships', 'user_id', member.userId);
  await deleteTestUser(member.userId);
});

describe('GET /api/staff/me', () => {
  it('returns 401 for anonymous callers', async () => {
    const response = await getStaffMe(createAnonClient());
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('Authentication required');
  });

  it('returns an empty restaurant list for a user with no memberships', async () => {
    const response = await getStaffMe(member.client);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ restaurants: [] });
  });

  it("returns the caller's restaurant with its membership role", async () => {
    const { error: insertError } = await serviceClient
      .from('restaurant_memberships')
      .insert({ restaurant_id: SEED.restaurantA, user_id: member.userId, role: 'owner' });
    expect(insertError).toBeNull();

    const response = await getStaffMe(member.client);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      restaurants: { id: string; name: string; slug: string; role: string }[];
    };
    expect(body.restaurants).toHaveLength(1);
    const [restaurant] = body.restaurants;
    expect(restaurant).toMatchObject({ id: SEED.restaurantA, role: 'owner' });
    expect(restaurant.name).toEqual(expect.any(String));
    expect(restaurant.slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  });
});
