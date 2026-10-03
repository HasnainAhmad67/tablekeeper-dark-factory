'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { POLL_INTERVAL_MS, subscribeToRestaurant } from '@/lib/realtime';
import { createClient } from '@/lib/supabase/client';
import { fetchWaitlist, type WaitlistEntry } from '@/lib/waitlist-client';

/**
 * Live waitlist queue for one restaurant (realtime slice; plan decision 5
 * — polling is the required fallback, Realtime is the enhancement).
 *
 * Data comes from the existing GET /api/waitlist contract (already
 * returned in queue order). The hook fetches on mount, subscribes to
 * postgres_changes on `waitlist` (restaurant_id-scoped), refetches on
 * any INSERT/UPDATE/DELETE — covers add, promote/seat, status changes,
 * and reorders — and falls back to polling every POLL_INTERVAL_MS (5s,
 * plan line 1091) when the subscription reports 'unavailable'. Unmount
 * closes the channel and clears the timer.
 *
 * No existing component imports this yet (requirement: no breaking
 * changes) — wiring the M9 waitlist screen to it is a separate slice.
 * Races are last-write-wins, matching the existing screens' style.
 */

export interface RealtimeWaitlistState {
  entries: WaitlistEntry[];
  loading: boolean;
  error: string | null;
  /** True while Realtime is connected; false during connect/polling. */
  live: boolean;
  refetch: () => void;
}

export function useRealtimeWaitlist(restaurantId: string | null): RealtimeWaitlistState {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(restaurantId !== null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const load = useCallback(async () => {
    if (!restaurantId) {
      return;
    }
    try {
      const rows = await fetchWaitlist(restaurantId);
      setEntries(rows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  // Latest fetch for subscription callbacks — keeps the subscription
  // effect keyed on restaurantId alone.
  const loadRef = useRef(load);
  loadRef.current = load;

  const refetch = useCallback(() => {
    void loadRef.current();
  }, []);

  // Initial fetch.
  useEffect(() => {
    if (!restaurantId) {
      setEntries([]);
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

    const subscription = subscribeToRestaurant(client, restaurantId, ['waitlist'], {
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

  return { entries, loading, error, live, refetch };
}
