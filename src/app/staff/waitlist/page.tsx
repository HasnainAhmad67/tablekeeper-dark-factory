"use client";

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { WaitlistList } from '@/components/staff/WaitlistList';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  WaitlistApiError,
  fetchStaffContext,
  type StaffContext,
} from '@/lib/waitlist-client';

/**
 * Waitlist (plan screen 23, /staff/waitlist — M9 Phase 1).
 *
 * Auth gate follows the M6/M7 pattern: an unauthenticated visitor is sent
 * to login with /staff/waitlist as the return path. The single-restaurant
 * MVP context comes from the first membership on GET /api/staff/me; a
 * member without restaurants sees an empty state rather than an error.
 * Read-only enforcement is delegated to the API (403 flips WaitlistList
 * into its read-only state); the queue itself loads inside WaitlistList,
 * mirroring GroupList/TableList.
 *
 * The waitlist backend is not implemented yet (plan labels waitlist future
 * scope and migrations are frozen), so a failed GET surfaces the plan's
 * Retry error state; seating writes go through the real POST
 * /api/reservations endpoint.
 */

const LOGIN_URL = '/login?returnTo=/staff/waitlist';

type Phase = 'loading' | 'error' | 'ready';

export default function StaffWaitlistPage() {
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
      if (err instanceof WaitlistApiError && err.status === 401) {
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
      <h1 className="text-3xl font-bold text-foreground">Waitlist</h1>
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
            <span className="sr-only">Loading waitlist</span>
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
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
              <WaitlistList restaurantId={restaurant.id} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
