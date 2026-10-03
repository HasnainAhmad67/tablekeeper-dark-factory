"use client";

import { useEffect, useRef, useState } from 'react';

import { useAuth } from '@/components/auth/AuthProvider';
import { MetricsCards } from '@/components/staff/MetricsCards';
import { ReservationChart } from '@/components/staff/ReservationChart';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  ANALYTICS_RANGES,
  AnalyticsError,
  computeDailySeries,
  computeMetrics,
  computePopularTimes,
  csvFilename,
  downloadCsv,
  fetchAnalyticsReservations,
  fetchRestaurantTimezone,
  fetchStaffContext,
  fetchWindowStart,
  filterRowsInRange,
  toCsv,
  type AnalyticsRange,
  type AnalyticsReservation,
  type StaffContext,
} from '@/lib/analytics-client';

/**
 * Analytics dashboard (plan line 944 "What May Be a Polished
 * Prototype"; peak-time analytics [FUTURE] at line 182, owner "view
 * analytics" at line 530).
 *
 * Auth gate follows the M6/M7 pattern (401/session redirect with
 * /staff/analytics as the return path). One bootstrap fetch loads the
 * single-restaurant context (first /api/staff/me membership), the
 * restaurant timezone (public detail route, browser-zone fallback — the
 * StaffOverview precedence), and the reservation window (max(range, 30)
 * days so today/week/month stay correct for every filter). Range changes
 * refetch in place behind a refreshing flag, keeping focus on the
 * pressed button; a failed refetch surfaces an inline Alert with Retry
 * while the loaded data stays visible. A member without restaurants sees
 * an empty state rather than an error.
 *
 * States follow the screen conventions: Skeleton / Retry / EmptyState.
 * The list API caps at 100 rows per window — the footnote says so; CSV
 * export is generated client-side from the in-range rows (no endpoint).
 */

const LOGIN_URL = '/login?returnTo=/staff/analytics';

type Phase = 'loading' | 'error' | 'ready';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

export default function StaffAnalyticsPage() {
  const { user, loading } = useAuth();
  const [phase, setPhase] = useState<Phase>('loading');
  const [restaurant, setRestaurant] = useState<StaffContext | null>(null);
  const [timezone, setTimezone] = useState('UTC');
  const [rows, setRows] = useState<AnalyticsReservation[]>([]);
  const [range, setRange] = useState<AnalyticsRange>(7);
  const [fetchedAt, setFetchedAt] = useState<number>(() => Date.now());
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const bootstrapped = useRef(false);

  useEffect(() => {
    if (loading || user) {
      return;
    }
    window.location.replace(LOGIN_URL);
  }, [loading, user]);

  async function bootstrap() {
    setPhase('loading');
    setActionError(null);
    try {
      const context = await fetchStaffContext();
      if (!context) {
        setRestaurant(null);
        setPhase('ready');
        return;
      }
      const now = Date.now();
      const [tz, reservations] = await Promise.all([
        fetchRestaurantTimezone(context.slug),
        fetchAnalyticsReservations(context.id, fetchWindowStart(7, now), now),
      ]);
      setRestaurant(context);
      setTimezone(tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
      setRows(reservations);
      setRange(7);
      setFetchedAt(now);
      setPhase('ready');
    } catch (err) {
      if (err instanceof AnalyticsError && err.status === 401) {
        window.location.replace(LOGIN_URL);
        return;
      }
      setPhase('error');
    }
  }

  useEffect(() => {
    if (bootstrapped.current) {
      return;
    }
    bootstrapped.current = true;
    void bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Refetch the reservation window for a new range; focus stays put. */
  async function changeRange(next: AnalyticsRange) {
    if (!restaurant || refreshing) {
      return;
    }
    setRefreshing(true);
    setActionError(null);
    try {
      const now = Date.now();
      const reservations = await fetchAnalyticsReservations(
        restaurant.id,
        fetchWindowStart(next, now),
        now,
      );
      setRows(reservations);
      setRange(next);
      setFetchedAt(now);
    } catch (err) {
      if (err instanceof AnalyticsError && err.status === 401) {
        window.location.replace(LOGIN_URL);
        return;
      }
      setActionError(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }

  function handleExport() {
    const inRange = filterRowsInRange(rows, range, fetchedAt);
    if (inRange.length === 0) {
      return;
    }
    downloadCsv(toCsv(inRange), csvFilename(range, fetchedAt));
  }

  const inRange = restaurant ? filterRowsInRange(rows, range, fetchedAt) : [];
  const metrics = computeMetrics(rows, range, fetchedAt, timezone);

  return (
    <div>
      <h1 className="text-3xl font-bold text-foreground">Analytics</h1>
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
            <span className="sr-only">Loading analytics</span>
            <Skeleton className="h-24" />
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        ) : null}

        {phase === 'error' ? <ErrorState onRetry={() => void bootstrap()} /> : null}

        {phase === 'ready' && restaurant === null ? (
          <EmptyState
            title="No restaurants"
            description="Your account is not attached to a restaurant yet."
          />
        ) : null}

        {phase === 'ready' && restaurant ? (
          <div className="grid gap-6">
            <h2 className="text-lg font-semibold text-foreground">{restaurant.name}</h2>

            <MetricsCards metrics={metrics} />

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div role="group" aria-label="Date range" className="flex flex-wrap gap-2">
                {ANALYTICS_RANGES.map((option) => (
                  <Button
                    key={option}
                    variant={range === option ? 'primary' : 'secondary'}
                    aria-pressed={range === option}
                    disabled={refreshing}
                    onClick={() => void changeRange(option)}
                  >
                    Last {option} days
                  </Button>
                ))}
              </div>
              <Button
                variant="secondary"
                disabled={refreshing || inRange.length === 0}
                onClick={handleExport}
              >
                Export CSV
              </Button>
            </div>

            {actionError ? (
              <div className="flex flex-wrap items-center gap-3">
                <Alert variant="error">{actionError}</Alert>
                <Button
                  variant="secondary"
                  disabled={refreshing}
                  onClick={() => void changeRange(range)}
                >
                  Retry
                </Button>
              </div>
            ) : null}

            {inRange.length === 0 ? (
              <EmptyState
                title="No reservations"
                description={`No bookings in the last ${range} days — try a longer range.`}
              />
            ) : (
              <ReservationChart
                daily={computeDailySeries(rows, range, fetchedAt, timezone)}
                popular={computePopularTimes(rows, range, fetchedAt, timezone)}
                range={range}
              />
            )}

            <p className="text-xs text-foreground-muted">
              Figures and export cover up to 100 reservations per window (API list limit).
              Week and month are trailing 7/30 days in the restaurant&rsquo;s timezone.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
