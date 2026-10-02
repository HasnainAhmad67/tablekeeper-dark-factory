import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { FloorAccessError, listRestaurantGroups } from '@/server/floor';
import { createGroup, FloorWriteError, type GroupInput } from '@/server/floor-writes';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ restaurantId: string }> },
) {
  const { restaurantId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const groups = await listRestaurantGroups(supabase, user.id, restaurantId);
    return NextResponse.json({ groups });
  } catch (err) {
    if (err instanceof FloorAccessError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ restaurantId: string }> },
) {
  const { restaurantId } = await params;
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
    const group = await createGroup(supabase, user.id, restaurantId, body as GroupInput);
    return NextResponse.json({ group }, { status: 201 });
  } catch (err) {
    if (err instanceof FloorWriteError) {
      const status =
        err.code === 'FORBIDDEN' ? 403 : err.code === 'NOT_FOUND' ? 404 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
