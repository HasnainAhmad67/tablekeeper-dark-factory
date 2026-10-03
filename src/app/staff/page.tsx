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
      <div className="mt-6">
        <StaffOverview />
      </div>
    </div>
  );
}
