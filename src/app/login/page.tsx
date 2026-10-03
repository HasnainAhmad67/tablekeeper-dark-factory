import { LoginForm } from '@/components/auth/LoginForm';

/**
 * Login screen server wrapper (M6 Phase 2, plan criterion 13): decides
 * at render time whether Google OAuth is configured via
 * SUPABASE_AUTH_GOOGLE_CLIENT_ID and passes the boolean to the client
 * form. OAuth itself is not implemented in this phase — the form shows
 * the "Google sign-in pending" label whenever the variable is unset.
 */
export default function LoginPage() {
  const googleConfigured = Boolean(process.env.SUPABASE_AUTH_GOOGLE_CLIENT_ID);
  return <LoginForm googleConfigured={googleConfigured} />;
}
