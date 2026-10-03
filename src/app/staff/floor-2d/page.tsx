"use client";

import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { FloorLegend } from '@/components/staff/FloorLegend';
import { FloorMap } from '@/components/staff/FloorMap';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  FloorApiError,
  fetchFloorData,
  fetchStaffContext,
  type FloorSection,
  type StaffContext,
} from '@/lib/floor-client';
import type { StaffTable } from '@/lib/tables-client';

/**
 * 2D Floor Map (plan screen 19, /staff/floor-2d — M8 Phase 1).
 *
 * Auth gate follows the M6/M7 pattern: unauthenticated visitors are sent
 * to login with /staff/floor-2d as the return path. Data loads through
 * the single-restaurant MVP context (first membership on GET
 * /api/staff/me); a member without restaurants sees an empty state rather
 * than an error. Selection is page-local state for now — the plan's
 * Zustand floor store (shared with the 3D view) comes with the 3D slice.
 * The map is read-only: plan screen 27's drag-and-compose editor is a
 * separate scope still pending Section N decision 10.
 */

const LOGIN_URL = '/login?returnTo=/staff/floor-2d';

type Phase = 'loading' | 'error' | 'ready';

export default function StaffFloor2DPage() {
  const { user, loading } = useAuth();
  const [phase, setPhase] = useState<Phase>('loading');
  const [restaurant, setRestaurant] = useState<StaffContext | null>(null);
  const [sections, setSections] = useState<FloorSection[]>([]);
  const [tables, setTables] = useState<StaffTable[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (loading || user) {
      return;
    }
    window.location.replace(LOGIN_URL);
  }, [loading, user]);

  const load = useCallback(async () => {
    setPhase('loading');
    setSelectedId(null);
    try {
      const context = await fetchStaffContext();
      if (!context) {
        setRestaurant(null);
        setSections([]);
        setTables([]);
        setPhase('ready');
        return;
      }
      const floor = await fetchFloorData(context.id);
      setRestaurant(context);
      setSections(floor.sections);
      setTables(floor.tables);
      setPhase('ready');
    } catch (err) {
      if (err instanceof FloorApiError && err.status === 401) {
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
      <h1 className="text-3xl font-bold text-foreground">2D Floor Map</h1>
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
            <span className="sr-only">Loading floor</span>
            <Skeleton className="h-64" />
            <Skeleton className="h-8" />
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
            {tables.length > 0 ? (
              <FloorLegend sections={sections} tables={tables} />
            ) : null}
            <FloorMap
              tables={tables}
              sections={sections}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
