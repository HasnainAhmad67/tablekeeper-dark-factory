import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { listStaffRestaurants } from '@/server/floor';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const restaurants = await listStaffRestaurants(supabase, user.id);
    return NextResponse.json({ restaurants });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
