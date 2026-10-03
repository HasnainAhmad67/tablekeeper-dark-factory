"use client";

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';

/**
 * Login screen (M6 Phase 2) — client form posting to the Phase 1 auth
 * route. The page wrapper (`src/app/login/page.tsx`) is a server
 * component that passes `googleConfigured` down, per plan criteria 13:
 * without `SUPABASE_AUTH_GOOGLE_CLIENT_ID` the Google button renders
 * its "pending" label while email/password stays fully functional.
 *
 * Errors from the route's `{ error }` body render inline in a
 * role="alert"; success performs a full navigation to /dashboard so the
 * cookie written by the route is picked up on a clean mount.
 */

export interface LoginFormProps {
  /** True when SUPABASE_AUTH_GOOGLE_CLIENT_ID is configured server-side. */
  googleConfigured: boolean;
}

export function LoginForm({ googleConfigured }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    let response: Response;
    try {
      response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
    } catch {
      setPending(false);
      setError('Network error. Please try again.');
      return;
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setPending(false);
      setError(body?.error ?? 'Unable to log in. Please try again.');
      return;
    }

    // Full navigation: AuthProvider remounts and reads the fresh cookie.
    window.location.href = '/dashboard';
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">TableKeeper Login</h1>
      <p className="mt-1 text-sm text-foreground-muted">
        Sign in to reserve tables and manage your bookings.
      </p>

      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        className="mt-6 grid gap-4"
      >
        {error ? <Alert variant="error">{error}</Alert> : null}
        <Field
          id="login-email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Field
          id="login-password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button type="submit" loading={pending}>
          {pending ? 'Logging in...' : 'Log in'}
        </Button>
      </form>

      <p className="mt-4 text-sm text-foreground-muted">
        <Link href="/signup" className="text-primary hover:underline">
          New user? Create an account
        </Link>
      </p>

      <div className="mt-6 border-t border-border pt-6">
        {googleConfigured ? (
          <>
            <Button variant="secondary" type="button" disabled>
              Continue with Google
            </Button>
            <p className="mt-2 text-sm text-foreground-muted">
              Google sign-in ships in a later phase.
            </p>
          </>
        ) : (
          <Button variant="secondary" type="button" disabled aria-disabled="true">
            Google sign-in pending
          </Button>
        )}
      </div>
    </div>
  );
}
