import { redirect } from 'next/navigation';

/**
 * Legacy M1 dashboard (retired in M7 Phase 1).
 *
 * The plan's dashboard surface is the staff dashboard at /staff (screen 17);
 * this route now redirects there server-side. Keeping it as the post-login
 * fallback landing (/dashboard when login has no returnTo) means the auth
 * flow from M6 still lands somewhere sensible without rendering the old
 * scaffold (inline styles, a separate browser Supabase client).
 */
export default function DashboardPage() {
  redirect('/staff');
}
