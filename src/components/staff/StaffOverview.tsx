import { useCallback, useEffect, useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDateKeyLabel, isValidTimeZone } from '@/lib/booking';
import { localDayCount, overviewWindow, type StaffRestaurant } from '@/lib/staff';

/**
 * Staff overview (plan screen 17, /staff: "KPIs, today's stats").
 *
 * Load flow: GET /api/staff/me, then — for the first membership (MVP
 * decision: single restaurant, first membership wins) — three parallel
 * reads: the public detail route for the restaurant timezone, the tables
 * route for the active-tables count, and GET /api/reservations with
 * restaurant_id plus a wide from/to window, counting the rows that start
 * on today's restaurant-local date. Any 401 sends the guest to login with
 * a /staff return path.
 *
 * Freshness is manual only (MVP decision: a Refresh button; auto-polling
 * is deferred). The last-updated line is a polite role="status" live
 * region so a refresh is announced without moving focus.
 */

const LOGIN_URL = '/login?returnTo=/staff';

type Phase = 'loading' | 'error' | 'ready';

interface OverviewData {
  restaurants: StaffRestaurant[];
  tablesCount: number;
  todayCount: number;
  dateKey: string | null;
  timeZone: string;
}

function roleBadgeVariant(role: string): BadgeVariant {
  if (role === 'owner') {
    return 'success';
  }
  if (role === 'manager') {
    return 'info';
  }
  return 'neutral';
}

export function StaffOverview() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [data, setData] = useState<OverviewData | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') {
      setPhase('loading');
    } else {
      setRefreshing(true);
    }
    setRefreshError(null);
    try {
      const meRes = await fetch('/api/staff/me');
      if (meRes.status === 401) {
        window.location.replace(LOGIN_URL);
        return;
      }
      if (!meRes.ok) {
        throw new Error('staff identity request failed');
      }
      const meBody = (await meRes.json()) as { restaurants?: StaffRestaurant[] };
      const restaurants = Array.isArray(meBody.restaurants) ? meBody.restaurants : [];

      if (restaurants.length === 0) {
        setData({ restaurants, tablesCount: 0, todayCount: 0, dateKey: null, timeZone: '' });
        setPhase('ready');
        setLastUpdated(new Date());
        return;
      }

      // Single-restaurant MVP: KPIs scope to the first membership (the
      // identity list is name-ordered, so "first" is deterministic).
      const primary = restaurants[0];
      const now = Date.now();
      const { from, to } = overviewWindow(now);

      const [detailRes, tablesRes, reservationsRes] = await Promise.all([
        fetch(`/api/restaurants/${encodeURIComponent(primary.id)}`),
        fetch(`/api/restaurants/${encodeURIComponent(primary.id)}/tables`),
        fetch(
          `/api/reservations?restaurant_id=${encodeURIComponent(primary.id)}` +
            `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=100`,
        ),
      ]);

      if (tablesRes.status === 401 || reservationsRes.status === 401) {
        window.location.replace(LOGIN_URL);
        return;
      }
      if (!detailRes.ok || !tablesRes.ok || !reservationsRes.ok) {
        throw new Error('overview request failed');
      }

      const detailBody = (await detailRes.json()) as {
        restaurant?: { timezone?: unknown };
      };
      const tablesBody = (await tablesRes.json()) as { tables?: unknown[] };
      const reservationsBody = (await reservationsRes.json()) as {
        reservations?: { starts_at: string }[];
      };

      const detailTimezone = detailBody.restaurant?.timezone;
      const timeZone = isValidTimeZone(detailTimezone)
        ? detailTimezone
        : Intl.DateTimeFormat().resolvedOptions().timeZone;

      const { count, dateKey } = localDayCount(
        Array.isArray(reservationsBody.reservations) ? reservationsBody.reservations : [],
        now,
        timeZone,
      );

      setData({
        restaurants,
        tablesCount: Array.isArray(tablesBody.tables) ? tablesBody.tables.length : 0,
        todayCount: count,
        dateKey,
        timeZone,
      });
      setPhase('ready');
      setLastUpdated(new Date());
    } catch {
      if (mode === 'initial') {
        setPhase('error');
      } else {
        setRefreshError('We could not refresh the dashboard. Please try again.');
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load('initial');
  }, [load]);

  if (phase === 'loading') {
    return (
      <div role="status" className="grid gap-4">
        <span className="sr-only">Loading dashboard</span>
        <Skeleton className="h-24" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return <ErrorState onRetry={() => void load('initial')} />;
  }

  if (!data) {
    return null;
  }

  const primary = data.restaurants.length > 0 ? data.restaurants[0] : null;

  return (
    <div className="grid gap-6">
      {refreshError ? <Alert variant="error">{refreshError}</Alert> : null}

      <section aria-labelledby="staff-restaurants-heading" className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="staff-restaurants-heading" className="text-lg font-semibold text-foreground">
            My restaurants
          </h2>
          <div className="flex items-center gap-3">
            {lastUpdated ? (
              <p role="status" className="text-xs text-foreground-muted">
                Last updated {lastUpdated.toLocaleTimeString()}
              </p>
            ) : null}
            <Button variant="secondary" loading={refreshing} onClick={() => void load('refresh')}>
              Refresh
            </Button>
          </div>
        </div>

        {data.restaurants.length === 0 ? (
          <EmptyState
            title="No restaurants"
            description="Your account is not attached to a restaurant yet."
          />
        ) : (
          <ul className="grid gap-3">
            {data.restaurants.map((restaurant) => (
              <li
                key={restaurant.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{restaurant.name}</p>
                  <p className="text-xs text-foreground-muted">/{restaurant.slug}</p>
                </div>
                <Badge variant={roleBadgeVariant(restaurant.role)}>{restaurant.role}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      {primary ? (
        <section aria-labelledby="staff-kpis-heading" className="grid gap-3">
          <h2 id="staff-kpis-heading" className="text-lg font-semibold text-foreground">
            Today at {primary.name}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <p className="text-sm text-foreground-muted">Reservations today</p>
              <p className="mt-1 text-3xl font-semibold text-foreground">{data.todayCount}</p>
              <p className="mt-1 text-xs text-foreground-muted">
                {data.dateKey ? formatDateKeyLabel(data.dateKey, data.timeZone) : 'Today'}
              </p>
            </Card>
            <Card>
              <p className="text-sm text-foreground-muted">Active tables</p>
              <p className="mt-1 text-3xl font-semibold text-foreground">{data.tablesCount}</p>
              <p className="mt-1 text-xs text-foreground-muted">{primary.name}</p>
            </Card>
          </div>
        </section>
      ) : null}
    </div>
  );
}
