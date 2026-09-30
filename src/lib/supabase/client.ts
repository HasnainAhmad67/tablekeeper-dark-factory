import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser Supabase client.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.
 * The underlying Supabase client throws when either value is missing, so the
 * failure is loud and immediate instead of a silent anonymous connection.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
