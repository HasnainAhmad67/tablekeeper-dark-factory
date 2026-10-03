import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * POST /api/auth/signup — email/password registration (M6 Phase 1).
 *
 * `full_name` rides in the GoTrue signup metadata; the 003 trigger
 * (trg_handle_new_user) copies it into profiles.full_name. When the project
 * requires email confirmation, signUp issues no session — the response says
 * so via `confirmation_required: true` and never claims the caller is logged
 * in. Google OAuth is intentionally not implemented in this phase.
 *
 * Status contract: 201 created · 409 duplicate email · 422 invalid input ·
 * 429 Supabase rate limit · 500 generic. Auth-API error messages pass through
 * only for 4xx (GoTrue's curated, user-facing strings — no internals);
 * anything else becomes a generic 500.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Matches the signup form's minLength={8}. */
const MIN_PASSWORD_LENGTH = 8;

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
  const fullName = record.full_name;
  if (typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return errorResponse('A valid email is required', 422);
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return errorResponse(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`, 422);
  }
  if (fullName !== undefined && typeof fullName !== 'string') {
    return errorResponse('full_name must be a string when provided', 422);
  }
  const trimmedFullName = typeof fullName === 'string' ? fullName.trim() : '';

  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      ...(trimmedFullName ? { options: { data: { full_name: trimmedFullName } } } : {}),
    });

    if (error) {
      if (isAuthApiError(error)) {
        const code = typeof error.code === 'string' ? error.code : '';
        const message = typeof error.message === 'string' ? error.message : '';
        if (code === 'user_already_exists' || /already (exists|registered)/i.test(message)) {
          return errorResponse('An account with this email already exists', 409);
        }
        if (code === 'weak_password' || code === 'password_in_list') {
          return errorResponse(message || 'Password is too weak', 422);
        }
        if (error.status === 429) {
          return errorResponse('Too many attempts. Please try again later.', 429);
        }
        if (error.status === 400 || error.status === 422) {
          return errorResponse(message || 'Signup request was rejected', 422);
        }
      }
      // Network failures and Supabase 5xx: generic, no internals.
      return errorResponse('Internal error', 500);
    }

    const user = data.user;
    if (!user) {
      return errorResponse('Internal error', 500);
    }
    // session === null means confirmation is pending: no cookie was written
    // and the caller is NOT logged in yet.
    const confirmationRequired = data.session === null;
    return NextResponse.json(
      {
        user: { id: user.id, email: user.email ?? email.trim() },
        confirmation_required: confirmationRequired,
      },
      { status: 201 },
    );
  } catch {
    return errorResponse('Internal error', 500);
  }
}
