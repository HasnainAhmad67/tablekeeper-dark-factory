'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchReservations,
  INITIAL_FILTERS,
  type ReservationFilters,
  type StaffReservation,
} from '@/lib/reservations-client';
import { POLL_INTERVAL_MS, subscribeToRestaurant } from '@/lib/realtime';
import { createClient } from '@/lib/supabase/client';

/**
 * Live reservations for one restaurant (realtime slice; plan decision 5 —
 * polling is the required fallback, Realtime is the enhancement).
 *
 * Data comes from the existing GET /api/reservations contract — nothing
 * about the endpoint changes. The hook fetches on mount and whenever the
 * filter primitives change, subscribes to postgres_changes on
 * `reservations` (restaurant_id-scoped), refetches on any INSERT/UPDATE/
 * DELETE event, and — if the subscription reports 'unavailable'
 * (CHANNEL_ERROR / TIMED_OUT / CLOSED / handshake timeout) — falls back
 * to polling every POLL_INTERVAL_MS (5s, plan line 1091) until Realtime
 * recovers. The subscription outlives filter changes (only the refetch
 * callback is re-created), and unmount closes the channel and clears the
 * timer.
 *
 * No existing component imports this yet (requirement: no breaking
 * changes) — integration into the reservations screen is a separate
 * slice. Races are last-write-wins, matching the existing screens'
 * fetch style.
 */

export interface RealtimeReservationsState {
  reservations: StaffReservation[];
  loading: boolean;
  error: string | null;
  /** True while Realtime is connected; false during connect/polling. */
  live: boolean;
  refetch: () => void;
}

export function useRealtimeReservations(
  restaurantId: string | null,
  filters: ReservationFilters = INITIAL_FILTERS,
): RealtimeReservationsState {
  const [reservations, setReservations] = useState<StaffReservation[]>([]);
  const [loading, setLoading] = useState(restaurantId !== null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  // Primitive deps keep this callback stable when callers pass a fresh
  // filters object literal each render.
  const { status, fromDate, toDate } = filters;

  const load = useCallback(async () => {
    if (!restaurantId) {
      return;
    }
    try {
      const rows = await fetchReservations(restaurantId, { status, fromDate, toDate });
      setReservations(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [restaurantId, status, fromDate, toDate]);

  // Latest fetch for subscription callbacks — keeps the subscription
  // effect keyed on restaurantId alone instead of re-joining per filter.
  const loadRef = useRef(load);
  loadRef.current = load;

  const refetch = useCallback(() => {
    void loadRef.current();
  }, []);

  // Initial fetch (and refetch when filters change).
  useEffect(() => {
    if (!restaurantId) {
      setReservations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    void loadRef.current();
  }, [restaurantId, load]);

  // Realtime subscription + polling fallback.
  useEffect(() => {
    if (!restaurantId) {
      return;
    }
    const client = createClient();
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (pollTimer === null) {
        pollTimer = setInterval(() => {
          void loadRef.current();
        }, POLL_INTERVAL_MS);
      }
    };
    const stopPolling = () => {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const subscription = subscribeToRestaurant(client, restaurantId, ['reservations'], {
      onChange: () => {
        void loadRef.current();
      },
      onStatus: (next) => {
        setLive(next === 'live');
        if (next === 'live') {
          stopPolling();
        } else if (next === 'unavailable') {
          startPolling();
        }
        // 'connecting': leave any running fallback in place until the
        // handshake resolves either way.
      },
    });

    return () => {
      stopPolling();
      subscription.close();
      setLive(false);
    };
  }, [restaurantId]);

  return { reservations, loading, error, live, refetch };
}
