"use client";

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { TableList } from '@/components/staff/TableList';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  TableApiError,
  fetchStaffContext,
  type StaffContext,
} from '@/lib/tables-client';

/**
 * Table Management (plan screen 25, /staff/tables — M7 Phase 2).
 *
 * Auth gate follows the M6/M7 pattern: unauthenticated visitors are sent to
 * login with /staff/tables as the return path. The single-restaurant MVP
 * context comes from the first membership on GET /api/staff/me; a member
 * without restaurants sees an empty state rather than an error. Read-only
 * enforcement is delegated to the API (403 flips TableList into its
 * read-only state).
 */

const LOGIN_URL = '/login?returnTo=/staff/tables';

type Phase = 'loading' | 'error' | 'ready';

export default function StaffTablesPage() {
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
      if (err instanceof TableApiError && err.status === 401) {
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
      <h1 className="text-3xl font-bold text-foreground">Table Management</h1>
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
            <span className="sr-only">Loading tables</span>
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
          <div>
            <h2 className="text-lg font-semibold text-foreground">{restaurant.name}</h2>
            <div className="mt-4">
              <TableList restaurantId={restaurant.id} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
