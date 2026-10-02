import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { FloorWriteError, updateTable, deleteTable } from '@/server/floor-writes';

function errorStatus(err: unknown) {
  if (err instanceof FloorWriteError) {
    return err.code === 'FORBIDDEN' ? 403 : err.code === 'NOT_FOUND' ? 404 : 400;
  }
  return 500;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ restaurantId: string; tableId: string }> },
) {
  const { restaurantId, tableId } = await params;
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
    const table = await updateTable(supabase, user.id, restaurantId, tableId, body as never);
    return NextResponse.json({ table });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: errorStatus(err) },
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ restaurantId: string; tableId: string }> },
) {
  const { restaurantId, tableId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    await deleteTable(supabase, user.id, restaurantId, tableId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: errorStatus(err) },
    );
  }
}
