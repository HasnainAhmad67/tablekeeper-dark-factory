import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { changeMemberRole, MembershipError, removeMember } from '@/server/memberships';

/**
 * /api/staff/members/[memberId] (M10 Phase 2, plan screen 30) — team item.
 *
 * PATCH  { role } — owner-only role change ({ member }); demoting the
 *        final owner is a 409.
 * DELETE           — owner-only removal ({ deleted: true }); removing the
 *        final owner is a 409.
 *
 * The membership row is fetched on the cookie client first, so RLS
 * decides visibility: a caller who cannot see the row gets 404 without
 * leaking its existence (the item-route pattern), then the app-side
 * owner check answers 403 for visible rows the caller may not write —
 * with memberships_update_owner / memberships_delete_owner (RLS)
 * backstopping the writes themselves.
 *
 * Errors: 401 without a session, 400 invalid JSON / body validation,
 * 403 caller is not an owner, 404 unknown or invisible member, 409
 * last-owner protection, 500 unexpected. Role validation mirrors
 * team-client's TEAM_ROLES.
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

type RouteContext = { params: Promise<{ memberId: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  const { memberId } = await params;
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
    const member = await changeMemberRole(supabase, user.id, memberId, body);
    return NextResponse.json({ member });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: errorStatus(err) },
    );
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { memberId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    await removeMember(supabase, user.id, memberId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: errorStatus(err) },
    );
  }
}
