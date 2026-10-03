import { LoginForm } from '@/components/auth/LoginForm';

/**
 * Login screen server wrapper (M6 Phase 2, plan criterion 13): decides
 * at render time whether Google OAuth is configured via
 * SUPABASE_AUTH_GOOGLE_CLIENT_ID and passes the boolean to the client
 * form. It also forwards the raw `returnTo` query value (M6 Polish) —
 * the form resolves it after a successful login and falls back to
 * /dashboard when the value is missing or points off-app. Reading
 * `searchParams` makes the route dynamic, which is correct for an auth
 * screen. OAuth itself is not implemented in this phase — the form
 * shows the "Google sign-in pending" label whenever the variable is
 * unset.
 */

interface LoginPageProps {
  /** Next's async search params; `returnTo` may arrive duplicated. */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const googleConfigured = Boolean(process.env.SUPABASE_AUTH_GOOGLE_CLIENT_ID);
  const params = await searchParams;
  const rawReturnTo = params.returnTo;
  return (
    <LoginForm
      googleConfigured={googleConfigured}
      returnTo={typeof rawReturnTo === 'string' ? rawReturnTo : undefined}
    />
  );
}
