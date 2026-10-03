"use client";

import Link from 'next/link';
import { useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';

/**
 * Signup screen (M6 Phase 2) — client form posting to the Phase 1 auth
 * route. Mirrors LoginForm: the server wrapper passes `googleConfigured`
 * for the plan's "Google sign-in pending" label (criterion 13).
 *
 * A 201 with `confirmation_required: true` shows a success notice and
 * never claims the user is logged in (no session cookie was written);
 * `confirmation_required: false` means a session exists, so the page
 * navigates to /dashboard exactly like the login flow.
 */

export interface SignupFormProps {
  /** True when SUPABASE_AUTH_GOOGLE_CLIENT_ID is configured server-side. */
  googleConfigured: boolean;
}

export function SignupForm({ googleConfigured }: SignupFormProps) {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);

    let response: Response;
    try {
      response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          ...(fullName.trim() ? { full_name: fullName.trim() } : {}),
        }),
      });
    } catch {
      setPending(false);
      setError('Network error. Please try again.');
      return;
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setPending(false);
      setError(body?.error ?? 'Unable to create the account. Please try again.');
      return;
    }

    const body = (await response.json().catch(() => null)) as {
      confirmation_required?: boolean;
    } | null;

    if (body?.confirmation_required) {
      setPending(false);
      setNotice('Account created. Please check your email to confirm your account, then log in.');
      return;
    }

    // Session established: full navigation picks up the fresh cookie.
    window.location.href = '/dashboard';
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <h1 className="text-2xl font-semibold tracking-tight">Create account</h1>
      <p className="mt-1 text-sm text-foreground-muted">
        Join TableKeeper to book and manage reservations.
      </p>

      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        className="mt-6 grid gap-4"
      >
        {error ? <Alert variant="error">{error}</Alert> : null}
        {notice ? <Alert variant="success">{notice}</Alert> : null}
        <Field
          id="signup-full-name"
          label="Full name"
          type="text"
          autoComplete="name"
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
        />
        <Field
          id="signup-email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Field
          id="signup-password"
          label="Password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        <Button type="submit" loading={pending}>
          {pending ? 'Creating...' : 'Sign up'}
        </Button>
      </form>

      <p className="mt-4 text-sm text-foreground-muted">
        <Link href="/login" className="text-primary hover:underline">
          Already have an account? Log in
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
