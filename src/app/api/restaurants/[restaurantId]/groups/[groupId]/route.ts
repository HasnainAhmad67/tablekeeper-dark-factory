import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  deleteGroup,
  FloorWriteError,
  updateGroup,
  type GroupInput,
} from '@/server/floor-writes';

function errorStatus(err: unknown) {
  if (err instanceof FloorWriteError) {
    return err.code === 'FORBIDDEN' ? 403 : err.code === 'NOT_FOUND' ? 404 : 400;
  }
  return 500;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ restaurantId: string; groupId: string }> },
) {
  const { restaurantId, groupId } = await params;
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
    const group = await updateGroup(
      supabase,
      user.id,
      restaurantId,
      groupId,
      body as GroupInput,
    );
    return NextResponse.json({ group });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: errorStatus(err) },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ restaurantId: string; groupId: string }> },
) {
  const { restaurantId, groupId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    await deleteGroup(supabase, user.id, restaurantId, groupId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: errorStatus(err) },
    );
  }
}
