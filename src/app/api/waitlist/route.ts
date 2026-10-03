import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import {
  WaitlistError,
  createWaitlistEntry,
  listWaitlist,
} from '@/server/waitlist';

/**
 * GET/POST /api/waitlist (plan screen 23, backend slice).
 *
 * GET returns { entries } for `?restaurant_id=` in queue order; POST
 * appends a party (auto-incremented position) and answers 201 { entry }.
 * Both follow the shipped route conventions: session cookie client, 401
 * without a user, WaitlistError mapped to 403 (not owner/manager), 404
 * (item routes), 400 (validation), 500 otherwise with the opaque message
 * the server module produced. Membership and role are checked twice —
 * app-level for clean statuses, RLS (009) as the backstop.
 */

function errorStatus(err: unknown): number {
  if (err instanceof WaitlistError) {
    return err.code === 'FORBIDDEN' ? 403 : err.code === 'NOT_FOUND' ? 404 : 400;
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

  // Missing param reaches the same validation as a malformed one.
  const restaurantId = new URL(request.url).searchParams.get('restaurant_id') ?? '';

  try {
    const entries = await listWaitlist(supabase, user.id, restaurantId);
    return NextResponse.json({ entries });
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
    const entry = await createWaitlistEntry(supabase, user.id, body);
    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: errorStatus(err) },
    );
  }
}
