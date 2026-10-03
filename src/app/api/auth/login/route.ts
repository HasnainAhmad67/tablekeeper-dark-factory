import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/auth/login — email/password sign-in (M6 Phase 1).
 *
 * Runs against the Next cookie server client, so a successful sign-in writes
 * the auth session through the existing server cookie mechanism. Google OAuth
 * is intentionally not implemented in this phase.
 *
 * Status contract: 200 success · 401 invalid credentials · 403 email not
 * confirmed · 422 invalid input · 429 Supabase rate limit · 500 generic.
 * Auth-API error messages pass through only for 4xx (GoTrue's curated,
 * user-facing strings — no internals); anything else becomes a generic 500.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Structural check for GoTrue's AuthApiError (status/code/message). */
function isAuthApiError(error: unknown): error is { status?: number; code?: string; message?: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { status?: unknown }).status === 'number'
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Body must be valid JSON', 422);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse('Body must be a JSON object', 422);
  }

  const record = body as Record<string, unknown>;
  const email = record.email;
  const password = record.password;
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return errorResponse('A valid email is required', 422);
  }
  if (typeof password !== 'string' || password.length === 0) {
    return errorResponse('Password is required', 422);
  }

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      if (isAuthApiError(error)) {
        const code = typeof error.code === 'string' ? error.code : '';
        const message = typeof error.message === 'string' ? error.message : '';
        if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
          return errorResponse('Invalid email or password', 401);
        }
        if (code === 'email_not_confirmed') {
          return errorResponse('Email not confirmed', 403);
        }
        if (error.status === 429) {
          return errorResponse('Too many attempts. Please try again later.', 429);
        }
        if (error.status === 401) {
          return errorResponse('Invalid email or password', 401);
        }
        if (error.status === 400 || error.status === 422) {
          return errorResponse(message || 'Invalid authentication request', 422);
        }
      }
      // Network failures and Supabase 5xx: generic, no internals.
      return errorResponse('Internal error', 500);
    }

    const user = data.user;
    if (!user) {
      return errorResponse('Internal error', 500);
    }
    return NextResponse.json({ user: { id: user.id, email: user.email ?? email.trim() } });
  } catch {
    return errorResponse('Internal error', 500);
  }
}
