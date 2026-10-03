import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import {
  addMember,
  isValidUuid,
  listMembers,
  MembershipError,
} from '@/server/memberships';

/**
 * /api/staff/members (M10 Phase 2, plan screen 30) — team collection.
 *
 * GET  ?restaurant_id=<uuid> — every member ({ id, name, email, role }),
 *      ordered by join date. Requires any membership on the restaurant
 *      (staff included); member emails hydrate through the auth admin
 *      API because profiles carries no email column.
 * POST { restaurant_id, email, role } — owner-only invite/attach by
 *      email (201 { member }); the server resolves email → account
 *      (creating a confirmed account for unknown addresses — no SMTP in
 *      MVP, see src/server/memberships.ts) and owns duplicate detection.
 *
 * Errors: 401 without a session, 400 invalid JSON / query / body
 * validation, 403 caller lacks the required role, 404 unknown
 * restaurant, 409 duplicate membership, 500 unexpected. Writes run on
 * the cookie client so memberships_insert_owner (RLS) backstops the
 * app-side owner check. Validation mirrors team-client's rules
 * (EMAIL_RE, TEAM_ROLES).
 */

function errorStatus(err: unknown) {
  if (err instanceof MembershipError) {
    return err.code === 'FORBIDDEN'
      ? 403
      : err.code === 'NOT_FOUND'
        ? 404
        : err.code === 'CONFLICT'
          ? 409
          : 400;
  }
  return 500;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const restaurantId = new URL(request.url).searchParams.get('restaurant_id');
  if (!isValidUuid(restaurantId)) {
    return NextResponse.json(
      { error: 'restaurant_id query parameter must be a valid uuid' },
      { status: 400 },
    );
  }

  try {
    const members = await listMembers(supabase, user.id, restaurantId);
    return NextResponse.json({ members });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: errorStatus(err) },
    );
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  try {
    const member = await addMember(supabase, user.id, body);
    return NextResponse.json({ member }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: errorStatus(err) },
    );
  }
}
