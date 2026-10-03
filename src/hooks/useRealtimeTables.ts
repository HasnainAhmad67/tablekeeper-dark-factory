'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { POLL_INTERVAL_MS, subscribeToRestaurant } from '@/lib/realtime';
import { createClient } from '@/lib/supabase/client';
import { fetchTables, type StaffTable } from '@/lib/tables-client';

/**
 * Live table state for one restaurant (realtime slice; plan decision 5 —
 * polling is the required fallback, Realtime is the enhancement).
 *
 * Data comes from the existing GET /api/floor tables contract
 * (tables-client fetchTables). The hook fetches on mount, subscribes to
 * postgres_changes on `tables` (restaurant_id-scoped — label, capacity,
 * section, geometry edits), refetches on any INSERT/UPDATE/DELETE, and
 * falls back to polling every POLL_INTERVAL_MS (5s, plan line 1091) when
 * the subscription reports 'unavailable'. Unmount closes the channel and
 * clears the timer.
 *
 * Reserved for the floor/table surfaces: state changes that affect table
 * rendering (renames, capacity/section/geometry edits, adds, deletes)
 * land here once those screens adopt the hook. No existing component
 * imports it yet (requirement: no breaking changes), and table *state*
 * (seated/reserved overlays) already flows through the reservation
 * hooks — this hook watches the tables table itself. Races are
 * last-write-wins, matching the existing screens' style.
 */

export interface RealtimeTablesState {
  tables: StaffTable[];
  loading: boolean;
  error: string | null;
  /** True while Realtime is connected; false during connect/polling. */
  live: boolean;
  refetch: () => void;
}

export function useRealtimeTables(restaurantId: string | null): RealtimeTablesState {
  const [tables, setTables] = useState<StaffTable[]>([]);
  const [loading, setLoading] = useState(restaurantId !== null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);

  const load = useCallback(async () => {
    if (!restaurantId) {
      return;
    }
    try {
      const rows = await fetchTables(restaurantId);
      setTables(rows);
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
      setTables([]);
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

    const subscription = subscribeToRestaurant(client, restaurantId, ['tables'], {
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

  return { tables, loading, error, live, refetch };
}
