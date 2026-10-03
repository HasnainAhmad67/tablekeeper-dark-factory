import { useCallback, useEffect, useState } from 'react';

import { statusBadgeVariant, statusLabel } from '@/components/reservations/ReservationItem';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Field } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatWhenLabel } from '@/lib/booking';
import {
  INITIAL_FILTERS,
  RESERVATION_STATUS_OPTIONS,
  ReservationApiError,
  fetchReservations,
  fetchRestaurantBrief,
  type RestaurantBrief,
  type ReservationFilters,
  type StaffReservation,
} from '@/lib/reservations-client';

/**
 * Staff reservations list (M7 Phase 3 — filters + status badges).
 *
 * Plan decision: filters apply on manual refresh only (no auto-refetch), so
 * the form submits through Refresh — Enter in any field does the same thing.
 * The row layout mirrors the M6 ReservationItem (time, party, badge) but
 * links to the staff detail screen 21 at /staff/reservations/[id]; cancel
 * lives on the detail per plan decision, so rows stay read-only.
 *
 * States: Skeleton while loading, ErrorState with Retry on failure, and the
 * plan's "No reservations" empty state (screen 20 copy) with a Clear
 * filters escape hatch when a filter set produced the emptiness. A 422
 * (e.g. from after to) renders inline without discarding the last good
 * results; 401 refreshes the session via login.
 */

const LOGIN_URL = '/login?returnTo=/staff/reservations';
const SELECT_CLASSES =
  'rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground';

type Phase = 'loading' | 'error' | 'ready';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

export interface ReservationListProps {
  restaurantId: string;
}

export function ReservationList({ restaurantId }: ReservationListProps) {
  const [filters, setFilters] = useState<ReservationFilters>(INITIAL_FILTERS);
  const [phase, setPhase] = useState<Phase>('loading');
  const [reservations, setReservations] = useState<StaffReservation[]>([]);
  const [brief, setBrief] = useState<RestaurantBrief | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const load = useCallback(
    async (applied: ReservationFilters) => {
      setPhase('loading');
      setListError(null);
      try {
        const rows = await fetchReservations(restaurantId, applied);
        setReservations(rows);
        setPhase('ready');
      } catch (err) {
        if (err instanceof ReservationApiError && err.status === 401) {
          window.location.replace(LOGIN_URL);
          return;
        }
        if (err instanceof ReservationApiError && err.status === 422) {
          // Bad filter values (e.g. from after to): keep the last results
          // and surface the server message inline.
          setListError(errorMessage(err));
          setPhase('ready');
          return;
        }
        setPhase('error');
      }
    },
    [restaurantId],
  );

  // Initial load (manual refresh applies filter changes from here on).
  useEffect(() => {
    void load(INITIAL_FILTERS);
  }, [load]);

  // Restaurant brief for the timezone/name labels; failure is non-fatal.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchRestaurantBrief(restaurantId);
        if (!cancelled) {
          setBrief(result);
        }
      } catch {
        // Fall back to the browser timezone below.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  function update<K extends keyof ReservationFilters>(key: K, value: string) {
    setFilters((previous) => ({ ...previous, [key]: value }));
  }

  function clearFilters() {
    setFilters(INITIAL_FILTERS);
    void load(INITIAL_FILTERS);
  }

  const zone = brief?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hasFilters =
    filters.status !== '' || filters.fromDate !== '' || filters.toDate !== '';

  return (
    <div className="grid gap-6">
      <form
        aria-label="Filter reservations"
        onSubmit={(event) => {
          event.preventDefault();
          void load(filters);
        }}
        className="grid gap-4 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
      >
        <div className="grid gap-1.5">
          <label
            htmlFor="reservation-status"
            className="text-sm font-medium text-foreground"
          >
            Status
          </label>
          <select
            id="reservation-status"
            value={filters.status}
            onChange={(event) => update('status', event.target.value)}
            className={SELECT_CLASSES}
          >
            {RESERVATION_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <Field
          id="reservation-from"
          label="From"
          type="date"
          value={filters.fromDate}
          onChange={(event) => update('fromDate', event.target.value)}
        />
        <Field
          id="reservation-to"
          label="To"
          type="date"
          value={filters.toDate}
          onChange={(event) => update('toDate', event.target.value)}
        />

        <div>
          <Button type="submit" loading={phase === 'loading'}>
            Refresh
          </Button>
        </div>
      </form>

      {brief ? (
        <p className="text-sm text-foreground-muted">{brief.name}</p>
      ) : null}

      {listError ? <Alert variant="error">{listError}</Alert> : null}

      {phase === 'loading' ? (
        <div role="status" className="grid gap-3">
          <span className="sr-only">Loading reservations</span>
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : null}

      {phase === 'error' ? <ErrorState onRetry={() => void load(filters)} /> : null}

      {phase === 'ready' && reservations.length === 0 && !listError ? (
        <EmptyState
          title="No reservations"
          description="Reservations for this restaurant will appear here."
          action={
            hasFilters ? (
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : null}

      {phase === 'ready' && reservations.length > 0 ? (
        <ul className="grid gap-3">
          {reservations.map((reservation) => {
            const when = formatWhenLabel(
              reservation.starts_at,
              reservation.ends_at,
              zone,
            );
            const activeTables = (reservation.reservation_tables ?? []).filter(
              (assignment) => assignment.status === 'active',
            ).length;
            return (
              <li
                key={reservation.id}
                className="rounded-lg border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{when}</p>
                    <p className="mt-1 text-sm text-foreground-muted">
                      Party of {reservation.party_size}
                      {activeTables > 0
                        ? ` · ${activeTables} table${activeTables === 1 ? '' : 's'}`
                        : ''}
                    </p>
                  </div>
                  <Badge variant={statusBadgeVariant(reservation.status)}>
                    {statusLabel(reservation.status)}
                  </Badge>
                </div>
                <div className="mt-3">
                  <a
                    href={`/staff/reservations/${encodeURIComponent(reservation.id)}`}
                    aria-label={`View details for reservation ${reservation.id}`}
                    className="text-sm text-primary underline-offset-4 hover:underline"
                  >
                    View details
                  </a>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
