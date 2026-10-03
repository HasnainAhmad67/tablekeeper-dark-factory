import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * GET /api/restaurants/[restaurantId] — public restaurant detail (M6 Phase 1).
 *
 * Accepts the restaurant id (UUID) or its slug so pretty URLs work without a
 * lookup migration. Public read via the server's secret key — same rationale
 * as the list route: server-side only, read-only, discovery fields plus the
 * timezone and weekly operating hours the booking flow needs to render and
 * interpret availability. The key never reaches the browser.
 */

const DETAIL_COLUMNS =
  'id, name, slug, cuisine, price_range, description, address, phone, website, timezone';
const HOURS_COLUMNS = 'day_of_week, opens_at, closes_at, is_closed';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

function createServiceClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error('Missing Supabase server configuration');
  }
  return createSupabaseClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type RouteContext = { params: Promise<{ restaurantId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const { restaurantId } = await params;

    // UUID → id lookup; slug-shaped → slug lookup (slugs are stored
    // lowercase); anything that is neither → 422.
    let column: 'id' | 'slug';
    let value: string;
    if (UUID_RE.test(restaurantId)) {
      column = 'id';
      value = restaurantId.toLowerCase();
    } else if (SLUG_RE.test(restaurantId)) {
      column = 'slug';
      value = restaurantId.toLowerCase();
    } else {
      return NextResponse.json(
        { error: 'restaurantId must be a valid UUID or slug' },
        { status: 422 },
      );
    }

    const service = createServiceClient();
    const { data: restaurant, error } = await service
      .from('restaurants')
      .select(DETAIL_COLUMNS)
      .eq(column, value)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
    if (!restaurant) {
      return NextResponse.json({ error: 'Restaurant not found' }, { status: 404 });
    }

    const { data: hours, error: hoursError } = await service
      .from('operating_hours')
      .select(HOURS_COLUMNS)
      .eq('restaurant_id', restaurant.id)
      .order('day_of_week', { ascending: true });
    if (hoursError) {
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }

    return NextResponse.json({
      restaurant: { ...restaurant, operating_hours: hours ?? [] },
    });
  } catch {
    // Never leak configuration or database error details to the public.
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
