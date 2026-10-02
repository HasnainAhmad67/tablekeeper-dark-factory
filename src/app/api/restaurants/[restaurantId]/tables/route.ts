import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { FloorAccessError, listRestaurantTables } from '@/server/floor';

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
    const tables = await listRestaurantTables(supabase, user.id, restaurantId);
    return NextResponse.json({ tables });
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
