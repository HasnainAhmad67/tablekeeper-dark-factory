import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';

/**
 * Operating hours API (plan screen 28: GET/PUT /api/restaurants/.../hours).
 *
 * GET  — any authenticated caller (RLS: operating_hours SELECT is open to
 *        authenticated users, and the data is public via discovery anyway).
 *        Rows are normalized from the database `time` type ('HH:MM:SS') to
 *        'HH:MM' and sorted Sunday-first.
 *
 * PUT  — manager/owner only. The membership gate mirrors
 *        src/server/floor-writes.ts (requireManagerOrOwner): RLS
 *        (operating_hours_insert/update_manager, migration 002) enforces
 *        the same rule at the database, this check exists to return a
 *        clean 403 instead of an opaque Postgres error. The body is
 *        upserted on UNIQUE (restaurant_id, day_of_week) (migration 001),
 *        so re-saving the same day replaces it rather than duplicating.
 *
 * Validation matches the schema CHECK constraints — same-day hours only
 * (no overnight, migration 001 note) — and the client's
 * validateHoursForm (src/lib/hours-client.ts): 400 for malformed JSON,
 * 422 for well-formed payloads that violate a rule.
 */

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

interface HoursRow {
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  is_closed: boolean;
}

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(':');
  return Number(hours) * 60 + Number(minutes);
}

function normalizeTime(value: string): string {
  return TIME_PATTERN.test(value) ? value.slice(0, 5) : '';
}

/** Validate the PUT payload; returns the rows or an error message. */
function validateBody(
  body: unknown,
): { ok: true; hours: HoursRow[] } | { ok: false; error: string } {
  if (typeof body !== 'object' || body === null) {
    return { ok: false, error: 'Request body must be a JSON object' };
  }
  const { hours } = body as { hours?: unknown };
  if (!Array.isArray(hours) || hours.length === 0) {
    return { ok: false, error: 'hours must be a non-empty array' };
  }
  if (hours.length > 7) {
    return { ok: false, error: 'hours must contain at most 7 entries (one per day)' };
  }

  const seenDays = new Set<number>();
  const rows: HoursRow[] = [];

  for (const entry of hours) {
    if (typeof entry !== 'object' || entry === null) {
      return { ok: false, error: 'each hours entry must be an object' };
    }
    const candidate = entry as Record<string, unknown>;

    const day = candidate.day_of_week;
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 0 || day > 6) {
      return { ok: false, error: 'day_of_week must be an integer between 0 and 6' };
    }
    if (seenDays.has(day)) {
      return { ok: false, error: 'day_of_week values must be unique' };
    }
    seenDays.add(day);

    if (typeof candidate.opens_at !== 'string' || !TIME_PATTERN.test(candidate.opens_at)) {
      return { ok: false, error: 'opens_at must be a time like HH:MM' };
    }
    if (typeof candidate.closes_at !== 'string' || !TIME_PATTERN.test(candidate.closes_at)) {
      return { ok: false, error: 'closes_at must be a time like HH:MM' };
    }
    if (typeof candidate.is_closed !== 'boolean') {
      return { ok: false, error: 'is_closed must be a boolean' };
    }
    if (toMinutes(candidate.closes_at) <= toMinutes(candidate.opens_at)) {
      return {
        ok: false,
        error: 'closes_at must be later than opens_at (overnight hours are not supported)',
      };
    }

    rows.push({
      day_of_week: day,
      opens_at: candidate.opens_at.slice(0, 5),
      closes_at: candidate.closes_at.slice(0, 5),
      is_closed: candidate.is_closed,
    });
  }

  rows.sort((a, b) => a.day_of_week - b.day_of_week);
  return { ok: true, hours: rows };
}

function serialize(row: {
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  is_closed: boolean | null;
}): HoursRow {
  return {
    day_of_week: row.day_of_week,
    opens_at: normalizeTime(row.opens_at),
    closes_at: normalizeTime(row.closes_at),
    is_closed: row.is_closed === true,
  };
}

async function authenticate(): Promise<
  { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; userId: string } | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    };
  }
  return { ok: true, supabase, userId: user.id };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ restaurantId: string }> },
) {
  const { restaurantId } = await params;
  const auth = await authenticate();
  if (!auth.ok) {
    return auth.response;
  }

  const { data, error } = await auth.supabase
    .from('operating_hours')
    .select('day_of_week, opens_at, closes_at, is_closed')
    .eq('restaurant_id', restaurantId)
    .order('day_of_week');

  if (error) {
    return NextResponse.json({ error: 'Failed to load operating hours' }, { status: 500 });
  }

  return NextResponse.json({
    hours: (data ?? []).map(serialize),
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ restaurantId: string }> },
) {
  const { restaurantId } = await params;
  const auth = await authenticate();
  if (!auth.ok) {
    return auth.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const validation = validateBody(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 422 });
  }

  // Manager/owner gate (mirrors requireManagerOrOwner in floor-writes.ts).
  const { data: membership, error: membershipError } = await auth.supabase
    .from('restaurant_memberships')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('user_id', auth.userId)
    .in('role', ['owner', 'manager'])
    .limit(1);

  if (membershipError) {
    return NextResponse.json({ error: 'Membership check failed' }, { status: 500 });
  }
  if (!membership || membership.length === 0) {
    return NextResponse.json(
      { error: 'Owner or manager role required for this restaurant' },
      { status: 403 },
    );
  }

  const { error: upsertError } = await auth.supabase.from('operating_hours').upsert(
    validation.hours.map((hour) => ({ ...hour, restaurant_id: restaurantId })),
    { onConflict: 'restaurant_id,day_of_week' },
  );

  if (upsertError) {
    // 42501 = RLS violation; the role gate above makes this unreachable in
    // practice, but surface it as 403 rather than leaking a 500.
    if (upsertError.code === '42501') {
      return NextResponse.json(
        { error: 'Owner or manager role required for this restaurant' },
        { status: 403 },
      );
    }
    return NextResponse.json({ error: 'Failed to save operating hours' }, { status: 500 });
  }

  const { data: saved, error: readError } = await auth.supabase
    .from('operating_hours')
    .select('day_of_week, opens_at, closes_at, is_closed')
    .eq('restaurant_id', restaurantId)
    .order('day_of_week');

  if (readError) {
    return NextResponse.json({ error: 'Failed to load operating hours' }, { status: 500 });
  }

  return NextResponse.json({
    hours: (saved ?? []).map(serialize),
  });
}
