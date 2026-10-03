"use client";

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { TeamList } from '@/components/staff/TeamList';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  TeamApiError,
  fetchStaffContext,
  type StaffContext,
} from '@/lib/team-client';

/**
 * Team management (plan screen 30, /staff/team — M10 Phase 2).
 *
 * Auth gate follows the M6/M7 pattern: an unauthenticated visitor is sent
 * to login with /staff/team as the return path. The single-restaurant MVP
 * context comes from the first membership on GET /api/staff/me; its role
 * decides the owner-only write gate that TeamList applies (managers view,
 * owners invite/change roles/remove). A member without restaurants sees an
 * empty state rather than an error. Loading, retry, and empty states
 * follow the screen row: Skeleton / Retry / "No staff" (the latter inside
 * TeamList, which owns the members fetch and every write).
 */

const LOGIN_URL = '/login?returnTo=/staff/team';

type Phase = 'loading' | 'error' | 'ready';

export default function StaffTeamPage() {
  const { user, loading } = useAuth();
  const [phase, setPhase] = useState<Phase>('loading');
  const [restaurant, setRestaurant] = useState<StaffContext | null>(null);

  useEffect(() => {
    if (loading || user) {
      return;
    }
    window.location.replace(LOGIN_URL);
  }, [loading, user]);

  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const context = await fetchStaffContext();
      setRestaurant(context);
      setPhase('ready');
    } catch (err) {
      if (err instanceof TeamApiError && err.status === 401) {
        window.location.replace(LOGIN_URL);
        return;
      }
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <h1 className="text-3xl font-bold text-foreground">Staff Management</h1>
      <p className="mt-3">
        <a
          href="/staff"
          className="text-sm font-medium text-foreground-muted underline underline-offset-4 hover:text-foreground"
        >
          Back to dashboard
        </a>
      </p>

      <div className="mt-6">
        {phase === 'loading' ? (
          <div role="status" className="grid gap-3">
            <span className="sr-only">Loading team</span>
            <Skeleton className="h-10" />
            <Skeleton className="h-40" />
          </div>
        ) : null}

        {phase === 'error' ? <ErrorState onRetry={() => void load()} /> : null}

        {phase === 'ready' && restaurant === null ? (
          <EmptyState
            title="No restaurants"
            description="Your account is not attached to a restaurant yet."
          />
        ) : null}

        {phase === 'ready' && restaurant ? (
          <div>
            <h2 className="text-lg font-semibold text-foreground">{restaurant.name}</h2>
            <div className="mt-4">
              <TeamList restaurant={restaurant} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
