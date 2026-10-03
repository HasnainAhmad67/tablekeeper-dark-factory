"use client";

import { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';

import { useAuth } from '@/components/auth/AuthProvider';
import { FloorLegend } from '@/components/staff/FloorLegend';
import { FloorMap } from '@/components/staff/FloorMap';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
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
import { isWebGLAvailable } from '@/lib/webgl';

/**
 * Live 3D Floor (plan screen 18, /staff/floor — M8 Phase 2).
 *
 * Auth gate follows the M6/M7 pattern: unauthenticated visitors are sent
 * to login with /staff/floor as the return path. Data loads through the
 * single-restaurant MVP context (first membership on GET /api/staff/me);
 * a member without restaurants sees an empty state rather than an error.
 *
 * View switching (decision): the URL query param is the source of truth
 * — /staff/floor defaults to the 3D view (screen 18), ?view=2d shows the
 * top-down map, and the toggle button plus the plan's V key rewrite the
 * param via history.replaceState, so either view is shareable. When WebGL
 * is unavailable the 3D request falls back automatically with the plan's
 * notice, "3D view requires WebGL. Showing 2D view." The scene module is
 * lazy-loaded (plan: 3D components load only when active) and never
 * server-rendered. Realtime "states update live" is deferred: no state
 * source exists yet (Section N decision 5 — polling fallback), so
 * selection and data are page-local until the Zustand floor store lands.
 */

const LOGIN_URL = '/login?returnTo=/staff/floor';

const WEBGL_NOTICE = '3D view requires WebGL. Showing 2D view.';

type Phase = 'loading' | 'error' | 'ready';
type View = '3d' | '2d';

const Floor3D = dynamic(() => import('@/components/staff/Floor3D'), {
  ssr: false,
  loading: () => (
    <div role="status" className="grid gap-3">
      <span className="sr-only">Loading 3D view</span>
      <Skeleton className="h-96" />
    </div>
  ),
});

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(
    element &&
      (element.tagName === 'INPUT' ||
        element.tagName === 'TEXTAREA' ||
        element.tagName === 'SELECT' ||
        element.isContentEditable),
  );
}

export default function StaffFloorPage() {
  const { user, loading } = useAuth();
  const [phase, setPhase] = useState<Phase>('loading');
  const [restaurant, setRestaurant] = useState<StaffContext | null>(null);
  const [sections, setSections] = useState<FloorSection[]>([]);
  const [tables, setTables] = useState<StaffTable[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>('3d');
  const [webgl, setWebgl] = useState<boolean | null>(null);

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

  // Initial view from the URL (?view=2d opts into the map; default 3D).
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('view');
    setView(requested === '2d' ? '2d' : '3d');
  }, []);

  // One-time capability check that drives the automatic 2D fallback.
  useEffect(() => {
    setWebgl(isWebGLAvailable());
  }, []);

  const switchView = useCallback((next: View) => {
    setView(next);
    window.history.replaceState(null, '', `${window.location.pathname}?view=${next}`);
  }, []);

  // Plan interaction matrix: Toggle 2D/3D — key V (and a button, below).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key.toLowerCase() !== 'v' ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        isTypingTarget(event.target)
      ) {
        return;
      }
      switchView(view === '3d' ? '2d' : '3d');
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [view, switchView]);

  return (
    <div>
      <h1 className="text-3xl font-bold text-foreground">Live 3D Floor</h1>
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
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-foreground">{restaurant.name}</h2>
              <Button
                variant="secondary"
                onClick={() => switchView(view === '3d' ? '2d' : '3d')}
              >
                {view === '3d' ? 'Switch to 2D' : 'Switch to 3D'}
              </Button>
            </div>

            {tables.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  title="No layout"
                  description="This restaurant has no tables placed on the floor yet."
                  headingLevel={3}
                />
              </div>
            ) : (
              <div>
                <FloorLegend sections={sections} tables={tables} />

                {view === '3d' ? (
                  webgl === false ? (
                    <div className="mt-4">
                      <Alert variant="warning">{WEBGL_NOTICE}</Alert>
                      <FloorMap
                        tables={tables}
                        sections={sections}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                      />
                    </div>
                  ) : webgl === null ? (
                    <div role="status" className="mt-4 grid gap-3">
                      <span className="sr-only">Loading 3D view</span>
                      <Skeleton className="h-96" />
                    </div>
                  ) : (
                    <Floor3D
                      tables={tables}
                      sections={sections}
                      selectedId={selectedId}
                      onSelect={setSelectedId}
                    />
                  )
                ) : (
                  <FloorMap
                    tables={tables}
                    sections={sections}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                  />
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
