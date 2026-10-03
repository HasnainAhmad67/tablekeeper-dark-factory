"use client";

import { useEffect } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { StaffOverview } from '@/components/staff/StaffOverview';

/**
 * Staff dashboard (plan screen 17, /staff — M7 Phase 1).
 *
 * Auth gate follows the M6 pattern: an unauthenticated visitor is sent to
 * login with /staff as the return path. Any membership role may enter —
 * plan screen 17 is a Staff-role screen; manager/owner-only screens gate
 * separately. The legacy M1 /dashboard now server-redirects here, which
 * also keeps the login fallback landing (/dashboard when no returnTo is
 * present) working end-to-end.
 */

const LOGIN_URL = '/login?returnTo=/staff';

export default function StaffPage() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || user) {
      return;
    }
    window.location.replace(LOGIN_URL);
  }, [loading, user]);

  return (
    <div>
      <h1 className="text-3xl font-bold text-foreground">Staff Dashboard</h1>
      <nav
        aria-label="Staff sections"
        className="mt-4 flex flex-wrap gap-4 border-b border-border pb-2"
      >
        <a
          href="/staff"
          aria-current="page"
          className="text-sm font-medium text-foreground underline underline-offset-4"
        >
          Overview
        </a>
        <a
          href="/staff/tables"
          className="text-sm font-medium text-foreground-muted underline-offset-4 hover:text-foreground hover:underline"
        >
          Tables
        </a>
        <a
          href="/staff/reservations"
          className="text-sm font-medium text-foreground-muted underline-offset-4 hover:text-foreground hover:underline"
        >
          Reservations
        </a>
        <a
          href="/staff/hours"
          className="text-sm font-medium text-foreground-muted underline-offset-4 hover:text-foreground hover:underline"
        >
          Hours
        </a>
      </nav>
      <div className="mt-6">
        <StaffOverview />
      </div>
    </div>
  );
}
