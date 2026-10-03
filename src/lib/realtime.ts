import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Restaurant-scoped Supabase Realtime subscriptions (realtime slice).
 *
 * Plan: line 144 selects Supabase Realtime for real-time (priority
 * Optional), and Section N decision 5 (line 991) makes polling the
 * REQUIRED fallback — "Realtime is optional for correctness". The
 * acceptance check at line 1091 requires polling to pick up changes
 * within 5 seconds when Realtime is disabled, which is where
 * POLL_INTERVAL_MS and the connect watchdog below come from.
 *
 * One channel per restaurant carries one `postgres_changes` listener per
 * subscribed table, every listener filtered `restaurant_id=eq.<id>` (the
 * channel carries no cross-tenant events — requirement: channel with
 * restaurant_id filter). Events are payload-agnostic: any INSERT,
 * UPDATE, or DELETE (event '*' subscribes to all three) means "refetch";
 * consumers reload through their existing API paths instead of trusting
 * payload contents, so REPLICA IDENTITY and column shapes don't matter.
 *
 * Lifecycle: status starts 'connecting', moves to 'live' on SUBSCRIBED,
 * or to 'unavailable' on CHANNEL_ERROR / TIMED_OUT / CLOSED — or when
 * the handshake takes longer than connectTimeoutMs (watchdog, default
 * 5s). 'unavailable' is where callers start their polling interval;
 * 'live' clears it (the client auto-reconnects, so status can move
 * back). onStatus fires immediately with 'connecting', then on every
 * transition. close() is idempotent: it clears the watchdog, detaches
 * the listeners, and leaves the channel — call it from effect cleanup.
 *
 * Note (environment, not code): postgres_changes only delivers rows for
 * tables included in the project's `supabase_realtime` publication with
 * RLS the session user can SELECT. If a table was never added there,
 * subscriptions may report 'live' while events never arrive — the
 * dashboard/CLI publication membership is an operational prerequisite
 * this repo's migrations do not set (no migration authorized in this
 * slice).
 */

/** Database tables the staff UI watches (001_initial_schema names). */
export type RealtimeTable = 'reservations' | 'waitlist' | 'tables';

export type RealtimeStatus = 'connecting' | 'live' | 'unavailable';

/**
 * Plan line 1091's freshness bound: polling (and the connect watchdog)
 * must deliver changes within 5 seconds of Realtime being unavailable.
 */
export const POLL_INTERVAL_MS = 5_000;
export const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

export interface SubscribeOptions {
  /** Fired for any INSERT/UPDATE/DELETE on a subscribed table. */
  onChange(table: RealtimeTable): void;
  /** Called immediately with 'connecting', then on every transition. */
  onStatus?(status: RealtimeStatus): void;
  /** Handshake budget before 'unavailable'; defaults to 5s (plan 1091). */
  connectTimeoutMs?: number;
}

export interface RestaurantSubscription {
  /** Current status (starts 'connecting'). */
  readonly status: RealtimeStatus;
  /** Idempotent: clears the watchdog and leaves the channel. */
  close(): void;
}

/**
 * Subscribe to `tables` changes for one restaurant on a single channel.
 *
 * The returned handle reports status transitions for the polling
 * fallback and must be closed by the caller's effect cleanup.
 */
export function subscribeToRestaurant(
  client: SupabaseClient,
  restaurantId: string,
  tables: readonly RealtimeTable[],
  options: SubscribeOptions,
): RestaurantSubscription {
  let status: RealtimeStatus = 'connecting';
  let closed = false;

  const setStatus = (next: RealtimeStatus) => {
    if (closed || status === next) {
      return;
    }
    status = next;
    options.onStatus?.(next);
  };

  // Topic includes the table set so two hooks on one restaurant (e.g.
  // reservations + waitlist pages) never collide.
  const channel = client.channel(`restaurant:${restaurantId}:${tables.join(',')}`);
  for (const table of tables) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `restaurant_id=eq.${restaurantId}` },
      () => options.onChange(table),
    );
  }

  const watchdog = setTimeout(() => {
    setStatus('unavailable');
  }, options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS);

  // Report the starting status before subscribing so consumers reset
  // their flags up front and a fast handshake can never be overwritten.
  options.onStatus?.('connecting');

  channel.subscribe((rawStatus: string) => {
    if (rawStatus === 'SUBSCRIBED') {
      clearTimeout(watchdog);
      setStatus('live');
    } else if (rawStatus === 'CHANNEL_ERROR' || rawStatus === 'TIMED_OUT' || rawStatus === 'CLOSED') {
      clearTimeout(watchdog);
      // 'CLOSED' after our own close() is ignored by the guard in setStatus.
      setStatus('unavailable');
    }
  });

  return {
    get status() {
      return status;
    },
    close() {
      if (closed) {
        return;
      }
      closed = true;
      clearTimeout(watchdog);
      void client.removeChannel(channel);
    },
  };
}
