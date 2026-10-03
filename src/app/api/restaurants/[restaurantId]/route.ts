import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

import { isValidTimeZone } from '@/lib/booking';
import { createClient as createCookieClient } from '@/lib/supabase/server';
import { MembershipError, requireRole } from '@/server/memberships';

/**
 * GET /api/restaurants/[restaurantId] — public restaurant detail (M6 Phase 1).
 *
 * Accepts the restaurant id (UUID) or its slug so pretty URLs work without a
 * lookup migration. Public read via the server's secret key — same rationale
 * as the list route: server-side only, read-only, discovery fields plus the
 * timezone and weekly operating hours the booking flow needs to render and
 * interpret availability. The key never reaches the browser.
 *
 * PUT — update the editable settings { name, timezone } (M10 Phase 1, plan
 * screen 29), manager/owner only. The session's cookie client resolves the
 * slug, enforces the membership check app-side, and performs the write, so
 * RLS restaurants_update_manager remains the backstop; slug and every other
 * column are untouched. Validation mirrors settings-client's rules (name
 * non-empty after trim, timezone via booking's isValidTimeZone), answering
 * 400 like the other write routes — the GET's legacy 422 for a malformed
 * identifier is kept for parity within this file.
 *
 * Errors: 401 unauthenticated, 400 invalid JSON / invalid settings, 403
 * not owner/manager, 404 unknown restaurant, 422 malformed identifier,
 * 500 unexpected.
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

export async function PUT(request: Request, { params }: RouteContext) {
  try {
    const { restaurantId } = await params;

    const supabase = await createCookieClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    // Same identifier rule as GET: UUID → id, slug → id (authenticated
    // read — restaurants_select_authenticated), anything else → 422.
    let restaurantIdValue: string;
    if (UUID_RE.test(restaurantId)) {
      restaurantIdValue = restaurantId.toLowerCase();
    } else if (SLUG_RE.test(restaurantId)) {
      const { data: slugRow, error: slugError } = await supabase
        .from('restaurants')
        .select('id')
        .eq('slug', restaurantId.toLowerCase())
        .maybeSingle();
      if (slugError) {
        return NextResponse.json({ error: 'Internal error' }, { status: 500 });
      }
      if (!slugRow) {
        return NextResponse.json({ error: 'Restaurant not found' }, { status: 404 });
      }
      restaurantIdValue = slugRow.id;
    } else {
      return NextResponse.json(
        { error: 'restaurantId must be a valid UUID or slug' },
        { status: 422 },
      );
    }

    // Body rules mirror settings-client's validateSettingsForm/toSettingsPayload.
    const record =
      typeof body === 'object' && body !== null && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const timezone = typeof record.timezone === 'string' ? record.timezone.trim() : '';
    if (name.length === 0) {
      return NextResponse.json({ error: 'name must be a non-empty string' }, { status: 400 });
    }
    if (!isValidTimeZone(timezone)) {
      return NextResponse.json(
        { error: 'timezone must be a valid time zone (for example, America/New_York)' },
        { status: 400 },
      );
    }

    // App-side manager/owner gate; restaurants_update_manager (RLS) backstops
    // the write below on the same predicate.
    try {
      await requireRole(
        supabase,
        user.id,
        restaurantIdValue,
        ['owner', 'manager'],
        'Owner or manager role required for this restaurant',
      );
    } catch (err) {
      if (err instanceof MembershipError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }

    const { data: updated, error: updateError } = await supabase
      .from('restaurants')
      .update({ name, timezone })
      .eq('id', restaurantIdValue)
      .select(DETAIL_COLUMNS)
      .maybeSingle();
    if (updateError) {
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
    if (!updated) {
      // RLS filtered the row despite the app check — treat as unauthorized.
      return NextResponse.json(
        { error: 'Owner or manager role required for this restaurant' },
        { status: 403 },
      );
    }

    return NextResponse.json({ restaurant: updated });
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
