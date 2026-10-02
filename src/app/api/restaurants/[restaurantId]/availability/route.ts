import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  AvailabilityError,
  computeAvailability,
  parseAvailabilityParams,
  type AssignmentRecord,
  type AvailabilityParams,
  type GroupMemberRecord,
  type GroupRecord,
  type TableRecord,
} from '@/server/availability';

/**
 * GET /api/restaurants/[restaurantId]/availability (M4)
 *
 * Query: starts_at, ends_at (ISO 8601 with offset), party_size (positive int).
 * Any authenticated caller (guest or member) may search; anonymous requests
 * return 401. Responds with `{ options }`, ranked smallest surplus first.
 */
export async function GET(
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

  let parsed: AvailabilityParams;
  try {
    const query = new URL(request.url).searchParams;
    parsed = parseAvailabilityParams({
      restaurantId,
      startsAt: query.get('starts_at'),
      endsAt: query.get('ends_at'),
      partySize: query.get('party_size'),
    });
  } catch (err) {
    if (err instanceof AvailabilityError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }

  try {
    const [tablesResult, groupsResult] = await Promise.all([
      supabase.from('tables').select('id, label, capacity').eq('restaurant_id', parsed.restaurantId),
      supabase.from('table_groups').select('id, name').eq('restaurant_id', parsed.restaurantId),
    ]);
    if (tablesResult.error) {
      throw new Error(`Failed to load tables: ${tablesResult.error.message}`);
    }
    if (groupsResult.error) {
      throw new Error(`Failed to load groups: ${groupsResult.error.message}`);
    }
    const tables = tablesResult.data as TableRecord[];
    const groups = groupsResult.data as GroupRecord[];

    let members: GroupMemberRecord[] = [];
    if (groups.length > 0) {
      const { data, error: membersError } = await supabase
        .from('table_group_members')
        .select('group_id, table_id')
        .in('group_id', groups.map((group) => group.id));
      if (membersError) {
        throw new Error(`Failed to load group members: ${membersError.message}`);
      }
      members = (data ?? []) as GroupMemberRecord[];
    }

    // Busy detection: reservation_tables rows are visible under RLS only to
    // their own guest or to restaurant staff (002_rls_policies.sql), so a
    // guest's client cannot see competing bookings. Read active assignments
    // with the server's secret key instead — read-only and scoped to this
    // restaurant. The lt/gt pair matches the exclusion constraint's half-open
    // [starts_at, ends_at) overlap exactly; computeAvailability re-checks it.
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const secretKey = process.env.SUPABASE_SECRET_KEY;
    if (!supabaseUrl || !secretKey) {
      throw new Error('Missing Supabase server configuration');
    }
    const service = createSupabaseClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: assignments, error: assignmentsError } = await service
      .from('reservation_tables')
      .select('table_id, starts_at, ends_at')
      .eq('restaurant_id', parsed.restaurantId)
      .eq('status', 'active')
      .lt('starts_at', parsed.endsAt)
      .gt('ends_at', parsed.startsAt);
    if (assignmentsError) {
      throw new Error(`Failed to load assignments: ${assignmentsError.message}`);
    }

    const options = computeAvailability({
      params: parsed,
      tables,
      groups,
      members,
      assignments: (assignments ?? []) as AssignmentRecord[],
    });
    return NextResponse.json({ options });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}
