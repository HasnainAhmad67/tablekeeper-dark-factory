import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteTestUser, requireDatabase, SEED } from './helpers';

/**
 * M6 Phase 1 acceptance tests: public restaurant discovery, restaurant
 * detail, and the thin auth routes.
 *
 * Discovery routes are invoked directly in Vitest with no auth client at all:
 * they read through the server's secret key (service-role, server-side only),
 * which is exactly how a logged-out browser request behaves. Detail accepts
 * a UUID or a slug; unknown identifiers 404, non-identifiers 422.
 *
 * The auth routes import `@/lib/supabase/server` (the Next cookie client),
 * so that module is mocked to return a real `@supabase/ssr` server client
 * backed by an in-memory cookie jar. A successful login must write the
 * session through the cookie adapter (jar non-empty), exercising the same
 * setAll path the real `cookies()` binding uses in production. The
 * confirmation-required signup branch is exercised with a stubbed auth
 * client because this test project auto-confirms signups (see afterAll note).
 *
 * HTTP statuses are asserted on the actual NextResponse objects.
 */

const authState = vi.hoisted(() => ({
  client: null as SupabaseClient | null,
  jar: null as Map<string, string> | null,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (!authState.client) {
      throw new Error('No test auth client bound — call bindAuthClient() before invoking a route');
    }
    return authState.client;
  },
}));

import { GET as listRestaurants } from '@/app/api/restaurants/route';
import { GET as restaurantDetail } from '@/app/api/restaurants/[restaurantId]/route';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { POST as signupRoute } from '@/app/api/auth/signup/route';

/** Public discovery fields the list/detail responses are allowed to carry. */
const SAFE_FIELDS = [
  'address',
  'cuisine',
  'description',
  'id',
  'name',
  'phone',
  'price_range',
  'slug',
  'website',
];

/** Users this suite creates through signup, deleted after the run. */
const createdUserIds: string[] = [];

let loginUser!: { email: string; password: string };

function detailRequest(restaurantId: string): Promise<Response> {
  return restaurantDetail(new Request(`http://localhost/api/restaurants/${restaurantId}`), {
    params: Promise.resolve({ restaurantId }),
  });
}

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Random test password, matching the shared fixtures' generation style. */
function testPassword(): string {
  return `M6-Test-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;
}

/**
 * Bind a fresh real ssr server client with an in-memory cookie jar, so a
 * login can be asserted to persist its session through the cookie adapter.
 */
function bindAuthClient(): Map<string, string> {
  const { url, publishableKey } = requireDatabase();
  const jar = new Map<string, string>();
  const client = createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) jar.set(name, value);
      },
    },
  }) as unknown as SupabaseClient;
  authState.client = client;
  authState.jar = jar;
  return jar;
}

beforeAll(async () => {
  bindAuthClient();

  const { url, publishableKey } = requireDatabase();
  const signupClient = (await import('@supabase/supabase-js')).createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  loginUser = {
    email: `m6-login-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: `M6-Test-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`,
  };
  const { data, error } = await signupClient.auth.signUp({
    email: loginUser.email,
    password: loginUser.password,
  });
  if (error || !data.user) {
    throw new Error(`Failed to create login test user: ${error?.message ?? 'no user returned'}`);
  }
  createdUserIds.push(data.user.id);
});

afterAll(async () => {
  for (const userId of createdUserIds) {
    await deleteTestUser(userId);
  }
});

describe('GET /api/restaurants — public discovery', () => {
  it('returns 200 without any authenticated membership scope', async () => {
    // No auth client is involved: the route never reads a session, so a
    // logged-out visitor gets the full public list.
    const response = await listRestaurants(new Request('http://localhost/api/restaurants'));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body.restaurants)).toBe(true);
    expect(body.restaurants.length).toBeGreaterThanOrEqual(2);

    const slugs = body.restaurants.map((row: { slug: string }) => row.slug);
    expect(slugs).toContain('test-kitchen');
    expect(slugs).toContain('second-test-bistro');
  });

  it('contains only safe discovery fields', async () => {
    const response = await listRestaurants(new Request('http://localhost/api/restaurants'));
    const body = await response.json();
    expect(body.restaurants.length).toBeGreaterThanOrEqual(2);

    for (const row of body.restaurants) {
      expect(Object.keys(row).sort()).toEqual([...SAFE_FIELDS].sort());
    }
  });

  it('supports optional name/cuisine search', async () => {
    const byCuisine = await listRestaurants(
      new Request('http://localhost/api/restaurants?search=French'),
    );
    expect(byCuisine.status).toBe(200);
    const byCuisineBody = await byCuisine.json();
    expect(byCuisineBody.restaurants).toHaveLength(1);
    expect(byCuisineBody.restaurants[0].slug).toBe('second-test-bistro');

    const byName = await listRestaurants(
      new Request('http://localhost/api/restaurants?search=Test%20Kitchen'),
    );
    const byNameBody = await byName.json();
    expect(byNameBody.restaurants).toHaveLength(1);
    expect(byNameBody.restaurants[0].slug).toBe('test-kitchen');

    const noMatch = await listRestaurants(
      new Request('http://localhost/api/restaurants?search=no-such-restaurant-xyz'),
    );
    expect(noMatch.status).toBe(200);
    const noMatchBody = await noMatch.json();
    expect(noMatchBody.restaurants).toEqual([]);
  });
});

describe('GET /api/restaurants/[restaurantId] — public detail', () => {
  it('returns restaurant, timezone, and operating hours by slug', async () => {
    const response = await detailRequest('test-kitchen');
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.restaurant.id).toBe(SEED.restaurantA);
    expect(body.restaurant.slug).toBe('test-kitchen');
    expect(body.restaurant.name).toBe('The Test Kitchen');
    expect(body.restaurant.timezone).toBe('America/New_York');
    expect(Object.keys(body.restaurant).sort()).toEqual([...SAFE_FIELDS, 'timezone', 'operating_hours'].sort());

    const hours = body.restaurant.operating_hours;
    expect(Array.isArray(hours)).toBe(true);
    expect(hours).toHaveLength(7);
    expect(hours[0].day_of_week).toBe(0);
    expect(hours[6].day_of_week).toBe(6);
    expect(Object.keys(hours[0]).sort()).toEqual([
      'closes_at',
      'day_of_week',
      'is_closed',
      'opens_at',
    ]);
  });

  it('returns the same restaurant by UUID', async () => {
    const response = await detailRequest(SEED.restaurantA);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.restaurant.id).toBe(SEED.restaurantA);
    expect(body.restaurant.slug).toBe('test-kitchen');
    expect(body.restaurant.timezone).toBe('America/New_York');
  });

  it('returns 404 for an unknown slug', async () => {
    const response = await detailRequest('no-such-restaurant');
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe('Restaurant not found');
  });

  it('returns 404 for an unknown but well-formed UUID', async () => {
    const response = await detailRequest('88888888-4444-4444-8444-121212121212');
    expect(response.status).toBe(404);
  });

  it('returns 422 for an identifier that is neither a UUID nor a slug', async () => {
    const response = await detailRequest('Not a valid slug!');
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe('restaurantId must be a valid UUID or slug');
  });
});

describe('POST /api/auth/login', () => {
  it('signs in with valid credentials and persists the session cookie', async () => {
    const jar = bindAuthClient();
    const response = await loginRoute(
      jsonRequest('http://localhost/api/auth/login', {
        email: loginUser.email,
        password: loginUser.password,
      }),
    );
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.user.email).toBe(loginUser.email);
    expect(typeof body.user.id).toBe('string');

    // No session material in the body — it belongs in the cookie jar.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('access_token');
    expect(raw).not.toContain('refresh_token');

    // The ssr client wrote the session through its cookie adapter, the same
    // setAll path the production cookies() binding uses.
    expect(jar.size).toBeGreaterThan(0);
  });

  it('rejects invalid credentials with 401', async () => {
    bindAuthClient();
    const response = await loginRoute(
      jsonRequest('http://localhost/api/auth/login', {
        email: loginUser.email,
        password: testPassword(),
      }),
    );
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Invalid email or password');
  });

  it('rejects malformed input with 422', async () => {
    bindAuthClient();

    const badEmail = await loginRoute(
      jsonRequest('http://localhost/api/auth/login', { email: 'not-an-email', password: 'x' }),
    );
    expect(badEmail.status).toBe(422);

    const missingPassword = await loginRoute(
      jsonRequest('http://localhost/api/auth/login', { email: loginUser.email }),
    );
    expect(missingPassword.status).toBe(422);

    const badJson = await loginRoute(
      jsonRequest('http://localhost/api/auth/login', '{not-json'),
    );
    expect(badJson.status).toBe(422);
  });
});

describe('POST /api/auth/signup', () => {
  it('validates email, password, and full_name', async () => {
    bindAuthClient();

    const badEmail = await signupRoute(
      jsonRequest('http://localhost/api/auth/signup', {
        email: 'not-an-email',
        password: testPassword(),
      }),
    );
    expect(badEmail.status).toBe(422);

    const shortPassword = await signupRoute(
      jsonRequest('http://localhost/api/auth/signup', {
        email: 'm6-short@example.com',
        password: 'short',
      }),
    );
    expect(shortPassword.status).toBe(422);

    const badFullName = await signupRoute(
      jsonRequest('http://localhost/api/auth/signup', {
        email: 'm6-name@example.com',
        password: testPassword(),
        full_name: 42,
      }),
    );
    expect(badFullName.status).toBe(422);

    const badJson = await signupRoute(
      jsonRequest('http://localhost/api/auth/signup', '{not-json'),
    );
    expect(badJson.status).toBe(422);
  });

  it('creates an account with 201', async () => {
    bindAuthClient();
    const email = `m6-signup-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

    const response = await signupRoute(
      jsonRequest('http://localhost/api/auth/signup', {
        email,
        password: testPassword(),
        full_name: 'M6 Guest',
      }),
    );
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.user.email).toBe(email);
    expect(typeof body.user.id).toBe('string');
    expect(typeof body.confirmation_required).toBe('boolean');
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('access_token');
    expect(raw).not.toContain('refresh_token');

    if (typeof body.user.id === 'string') createdUserIds.push(body.user.id);
  });

  it('returns 201 with confirmation_required when no session is issued', async () => {
    // This project auto-confirms signups (signUp is immediately followed by a
    // successful password sign-in in the shared fixtures), so the
    // confirmation-required branch cannot be produced against the real GoTrue
    // here. Stub the auth client's signUp to return session: null and assert
    // the route reports it without claiming the caller is logged in.
    const stubUserId = '99999999-4444-4444-8444-000000000009';
    authState.client = {
      auth: {
        signUp: async () => ({
          data: {
            user: { id: stubUserId, email: 'confirm-required@example.com' },
            session: null,
          },
          error: null,
        }),
      },
    } as unknown as SupabaseClient;

    try {
      const response = await signupRoute(
        jsonRequest('http://localhost/api/auth/signup', {
          email: 'confirm-required@example.com',
          password: testPassword(),
        }),
      );
      expect(response.status).toBe(201);

      const body = await response.json();
      expect(body.confirmation_required).toBe(true);
      expect(body.user.id).toBe(stubUserId);
      const raw = JSON.stringify(body);
      expect(raw).not.toContain('access_token');
      expect(raw).not.toContain('refresh_token');
    } finally {
      bindAuthClient();
    }
  });

  it('rejects a duplicate email with 409 or 422', async () => {
    bindAuthClient();
    const response = await signupRoute(
      jsonRequest('http://localhost/api/auth/signup', {
        email: loginUser.email,
        password: loginUser.password,
      }),
    );
    const body = await response.json();

    if (response.status === 429) {
      // Hosted GoTrue throttled the request before evaluating duplication
      // (free-tier signup rate limit — known environment caveat). The route's
      // 429 mapping is still asserted; duplicate handling is asserted
      // whenever the request actually reaches GoTrue.
      expect(body.error).toBe('Too many attempts. Please try again later.');
      return;
    }
    // 409 when GoTrue reports user_already_exists; 422 when only its status
    // code surfaces (version-dependent) — both are spec-compliant.
    expect([409, 422]).toContain(response.status);
    expect(typeof body.error).toBe('string');
  });
});

describe('no secrets in any response', () => {
  it('never exposes the service-role key or internal identifiers', async () => {
    const secret = process.env.SUPABASE_SECRET_KEY;
    expect(secret).toBeTruthy();

    bindAuthClient();
    const responses = await Promise.all([
      listRestaurants(new Request('http://localhost/api/restaurants')),
      detailRequest('test-kitchen'),
      loginRoute(
        jsonRequest('http://localhost/api/auth/login', {
          email: loginUser.email,
          password: testPassword(),
        }),
      ),
      signupRoute(
        jsonRequest('http://localhost/api/auth/signup', {
          email: 'not-an-email',
          password: 'x',
        }),
      ),
    ]);

    for (const response of responses) {
      const text = await response.text();
      expect(text).not.toContain(secret!);
      expect(text).not.toContain('service_role');
      expect(text).not.toContain('SUPABASE_SECRET_KEY');
    }
  });
});
