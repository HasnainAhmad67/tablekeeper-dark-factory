"use client";

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { GroupList } from '@/components/staff/GroupList';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  GroupsApiError,
  fetchStaffContext,
  type StaffContext,
} from '@/lib/groups-client';

/**
 * Table-Group Builder (plan screen 26, /staff/groups — M7 Phase 5).
 *
 * Auth gate follows the M6/M7 pattern: an unauthenticated visitor is sent to
 * login with /staff/groups as the return path. The single-restaurant MVP
 * context comes from the first membership on GET /api/staff/me; a member
 * without restaurants sees an empty state rather than an error. Read-only
 * enforcement is delegated to the API (403 flips GroupList into its
 * read-only state); the list itself loads groups + tables inside
 * GroupList, mirroring TableList.
 */

const LOGIN_URL = '/login?returnTo=/staff/groups';

type Phase = 'loading' | 'error' | 'ready';

export default function StaffGroupsPage() {
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
      if (err instanceof GroupsApiError && err.status === 401) {
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
      <h1 className="text-3xl font-bold text-foreground">Table-Group Builder</h1>
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
            <span className="sr-only">Loading groups</span>
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
              <GroupList restaurantId={restaurant.id} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
