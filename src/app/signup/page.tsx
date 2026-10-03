import { SignupForm } from '@/components/auth/SignupForm';

/**
 * Signup screen server wrapper (M6 Phase 2, plan criterion 13): mirrors
 * the login wrapper, reading SUPABASE_AUTH_GOOGLE_CLIENT_ID server-side
 * and passing the result to the client form for the "Google sign-in
 * pending" label. Google OAuth ships in a later phase.
 */
export default function SignupPage() {
  const googleConfigured = Boolean(process.env.SUPABASE_AUTH_GOOGLE_CLIENT_ID);
  return <SignupForm googleConfigured={googleConfigured} />;
}
