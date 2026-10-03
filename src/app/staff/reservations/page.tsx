"use client";

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { ReservationList } from '@/components/staff/ReservationList';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  ReservationApiError,
  fetchStaffContext,
  type StaffContext,
} from '@/lib/reservations-client';

/**
 * Staff reservations list route (M7 Phase 3).
 *
 * Plan decision: single-restaurant MVP — the context is the first
 * membership from GET /api/staff/me, same as the tables screen. The auth
 * gate follows the M6/M7 pattern (login with /staff/reservations as the
 * return path); a member without restaurants sees an empty state rather
 * than an error. The screen map has no dedicated list route (screen 20 is
 * the timeline, screen 21 the detail), so this list feeds screen 21 via
 * /staff/reservations/[id] and borrows screen 20's "No reservations" copy.
 */

const LOGIN_URL = '/login?returnTo=/staff/reservations';

type Phase = 'loading' | 'error' | 'ready';

export default function StaffReservationsPage() {
  const { user, loading } = useAuth();
  const [phase, setPhase] = useState<Phase>('loading');
  const [restaurant, setRestaurant] = useState<StaffContext | null>(null);

  useEffect(() => {
    if (loading || user) {
      return;
    }
    window.location.replace(LOGIN_URL);
  }, [loading, user]);

  const loadContext = useCallback(async () => {
    setPhase('loading');
    try {
      const context = await fetchStaffContext();
      setRestaurant(context);
      setPhase('ready');
    } catch (err) {
      if (err instanceof ReservationApiError && err.status === 401) {
        window.location.replace(LOGIN_URL);
        return;
      }
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  return (
    <div>
      <h1 className="text-3xl font-bold text-foreground">Reservations</h1>
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
            <span className="sr-only">Loading reservations</span>
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : null}

        {phase === 'error' ? <ErrorState onRetry={() => void loadContext()} /> : null}

        {phase === 'ready' && restaurant === null ? (
          <EmptyState
            title="No restaurants"
            description="Your account is not attached to a restaurant yet."
          />
        ) : null}

        {phase === 'ready' && restaurant ? (
          <ReservationList restaurantId={restaurant.id} />
        ) : null}
      </div>
    </div>
  );
}
