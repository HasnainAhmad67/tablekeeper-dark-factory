import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { getStaffIdentity } from '@/lib/staff';

/**
 * GET /api/staff/me (M7 Phase 1) — the caller's staff identity.
 *
 * Returns { restaurants: [{ id, name, slug, role }] } for every restaurant
 * the session user is a member of, in any role (owner/manager/staff) — plan
 * screen 17 (/staff) is a Staff-role screen. The membership query is scoped
 * explicitly to the session user and again by RLS (memberships_select_own)
 * on the caller's cookie client.
 *
 * Errors: 401 without a session; 500 when a read fails (message kept
 * opaque, mirroring the floor routes' error handling).
 */
export async function GET(_request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const restaurants = await getStaffIdentity(supabase, user.id);
    return NextResponse.json({ restaurants });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
