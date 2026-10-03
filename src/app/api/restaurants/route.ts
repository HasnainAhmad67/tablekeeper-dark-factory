import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

/**
 * GET /api/restaurants — public restaurant discovery (M6 Phase 1).
 *
 * No authentication required: guests browse restaurants before signing in.
 * The `restaurants` SELECT policy is `TO authenticated` (002_rls_policies.sql),
 * so a logged-out visitor would see an empty list through an RLS-scoped
 * client. Read with the server's secret key instead — server-side only,
 * read-only, and limited to the public discovery columns below (never
 * membership or authorization fields). The key never reaches the browser.
 */

/** Public discovery fields only — no membership, auth, or server fields. */
const DISCOVERY_COLUMNS =
  'id, name, slug, cuisine, price_range, description, address, phone, website';

/**
 * PostgREST's `or=` grammar treats `,` `(` `)` as delimiters and `\` as an
 * escape; `%` and `_` would act as ilike wildcards. Strip them so the term
 * matches literally and the filter grammar cannot be altered.
 */
function sanitizeSearch(term: string): string {
  return term.replace(/[\\,()%_"]/g, ' ').trim().slice(0, 100);
}

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

export async function GET(request: Request) {
  try {
    const service = createServiceClient();
    let query = service
      .from('restaurants')
      .select(DISCOVERY_COLUMNS)
      .order('name', { ascending: true });

    // Optional name/cuisine search: ?search=term (additive to the original
    // contract; omitting it returns the full list as before).
    const search = new URL(request.url).searchParams.get('search');
    const term = search ? sanitizeSearch(search) : '';
    if (term) {
      query = query.or(`name.ilike.%${term}%,cuisine.ilike.%${term}%`);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: 'Internal error' }, { status: 500 });
    }
    return NextResponse.json({ restaurants: data ?? [] });
  } catch {
    // Never leak configuration or database error details to the public.
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
