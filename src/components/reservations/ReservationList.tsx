import { useCallback, useEffect, useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  ReservationItem,
  type ReservationRecord,
} from '@/components/reservations/ReservationItem';

/**
 * My Reservations list (plan screen 11: skeleton list, "No reservations"
 * empty state, Retry error state, list semantics via <ul>, status badges
 * and actions).
 *
 * Pagination per plan decision: page size 50 with a simple load-more. The
 * frozen API (GET /api/reservations) accepts only `limit` — no offset or
 * cursor — and orders rows deterministically (starts_at, id), so each
 * load-more re-requests a larger limit (50 → 100, the API cap
 * MAX_LIST_LIMIT) and the response superset replaces the list. When a
 * response comes back shorter than requested, no more rows exist and the
 * button disappears.
 *
 * Restaurant names are resolved afterwards through the public detail API
 * (unique ids only); failures degrade to time-only rows.
 */

const LOGIN_URL = '/login?returnTo=/reservations';
const PAGE_SIZE = 50;
const MAX_LIMIT = 100; // mirrors the server's MAX_LIST_LIMIT

type ListPhase = 'loading' | 'error' | 'ready';

export function ReservationList() {
  const [phase, setPhase] = useState<ListPhase>('loading');
  const [items, setItems] = useState<ReservationRecord[]>([]);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);
  const [restaurantNames, setRestaurantNames] = useState<Record<string, string>>({});

  const loadInitial = useCallback(async () => {
    setPhase('loading');
    setLoadMoreError(null);
    try {
      const res = await fetch(`/api/reservations?limit=${PAGE_SIZE}`);
      if (res.status === 401) {
        window.location.replace(LOGIN_URL);
        return;
      }
      if (!res.ok) {
        setPhase('error');
        return;
      }
      const body = (await res.json()) as { reservations?: ReservationRecord[] };
      setItems(Array.isArray(body.reservations) ? body.reservations : []);
      setLimit(PAGE_SIZE);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, []);

  const loadMore = useCallback(async () => {
    const nextLimit = Math.min(limit + PAGE_SIZE, MAX_LIMIT);
    setLoadingMore(true);
    setLoadMoreError(null);
    try {
      const res = await fetch(`/api/reservations?limit=${nextLimit}`);
      if (res.status === 401) {
        window.location.replace(LOGIN_URL);
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setLoadMoreError(
          body?.error ?? 'We could not load more reservations. Please try again.',
        );
        return;
      }
      const body = (await res.json()) as { reservations?: ReservationRecord[] };
      setItems(Array.isArray(body.reservations) ? body.reservations : []);
      setLimit(nextLimit);
    } catch {
      setLoadMoreError('Network error. Please try again.');
    } finally {
      setLoadingMore(false);
    }
  }, [limit]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  // Resolve restaurant display names for the rows (unique ids only).
  useEffect(() => {
    if (items.length === 0) {
      return;
    }
    const ids = [...new Set(items.map((item) => item.restaurant_id))];
    let cancelled = false;
    void (async () => {
      const entries = await Promise.all(
        ids.map(async (id): Promise<[string, string] | null> => {
          try {
            const res = await fetch(`/api/restaurants/${encodeURIComponent(id)}`);
            if (!res.ok) {
              return null;
            }
            const body = (await res.json()) as {
              restaurant?: { name?: string };
            };
            return body.restaurant?.name ? [id, body.restaurant.name] : null;
          } catch {
            return null;
          }
        }),
      );
      if (cancelled) {
        return;
      }
      const map: Record<string, string> = {};
      for (const entry of entries) {
        if (entry) {
          map[entry[0]] = entry[1];
        }
      }
      setRestaurantNames(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [items]);

  if (phase === 'loading') {
    return (
      <div role="status" className="grid gap-4">
        <span className="sr-only">Loading reservations</span>
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    );
  }

  if (phase === 'error') {
    return <ErrorState onRetry={() => void loadInitial()} />;
  }

  if (items.length === 0) {
    return (
      <EmptyState
        title="No reservations"
        description="Bookings you make will appear here."
        action={
          <Button
            variant="secondary"
            onClick={() => {
              window.location.href = '/restaurants';
            }}
          >
            Browse restaurants
          </Button>
        }
      />
    );
  }

  // Response shorter than requested → every row is already shown; the
  // button also disappears once the API's 100-row cap is reached.
  const hasMore = items.length === limit && limit < MAX_LIMIT;

  return (
    <div>
      <ul className="grid gap-4">
        {items.map((item) => (
          <ReservationItem
            key={item.id}
            reservation={item}
            restaurantName={restaurantNames[item.restaurant_id]}
          />
        ))}
      </ul>

      {loadMoreError ? (
        <div className="mt-4">
          <Alert variant="error">{loadMoreError}</Alert>
        </div>
      ) : null}

      {hasMore ? (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" loading={loadingMore} onClick={() => void loadMore()}>
            Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
