import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import {
  WaitlistError,
  deleteWaitlistEntry,
  updateWaitlistEntry,
} from '@/server/waitlist';

/**
 * PATCH/DELETE /api/waitlist/[id] (plan screen 23, backend slice).
 *
 * PATCH accepts { position?, status? } — a position move reindexes the
 * restaurant's queue, a status change leaves ordering alone — and
 * answers { entry }; DELETE answers { deleted: true }. Follows the
 * shipped item-route conventions (tables/[tableId]): session cookie
 * client, 401 without a user, invalid JSON -> 400, WaitlistError mapped
 * to 403 (member without owner/manager role), 404 (unknown or invisible
 * entry — RLS hides rows from non-members, so existence is not leaked),
 * 400 (validation), 500 otherwise.
 */

function errorStatus(err: unknown): number {
  if (err instanceof WaitlistError) {
    return err.code === 'FORBIDDEN' ? 403 : err.code === 'NOT_FOUND' ? 404 : 400;
  }
  return 500;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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
    const entry = await updateWaitlistEntry(supabase, user.id, id, body);
    return NextResponse.json({ entry });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: errorStatus(err) },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    await deleteWaitlistEntry(supabase, user.id, id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: errorStatus(err) },
    );
  }
}
