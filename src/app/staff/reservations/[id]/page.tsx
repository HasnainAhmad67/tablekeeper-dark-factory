"use client";

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

import { useAuth } from '@/components/auth/AuthProvider';
import { ReservationDetail } from '@/components/staff/ReservationDetail';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  ReservationApiError,
  fetchReservation,
  type StaffReservation,
} from '@/lib/reservations-client';

/**
 * Staff reservation detail (plan screen 21, /staff/reservations/[id] —
 * M7 Phase 3: "Manage reservation", GET/PATCH /api/reservations/[id]).
 *
 * Load states mirror the M6 guest detail: Skeleton while fetching, the
 * Retry ErrorState on failure, and EmptyState for 403/404 (a non-member or
 * a stale link). Authentication follows the M6/M7 pattern — login with
 * this reservation as the return path. The loaded record renders through
 * ReservationDetail, which owns the details, table list, and the inline
 * cancel confirmation.
 */

type LoadPhase = 'loading' | 'ready' | 'forbidden' | 'notfound' | 'error';

export default function StaffReservationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { user, loading: authLoading } = useAuth();

  const [phase, setPhase] = useState<LoadPhase>('loading');
  const [reservation, setReservation] = useState<StaffReservation | null>(null);

  const loginUrl = `/login?returnTo=/staff/reservations/${encodeURIComponent(id)}`;

  // Unauthenticated staff are sent to login with this page as the return path.
  useEffect(() => {
    if (authLoading || user) {
      return;
    }
    window.location.replace(loginUrl);
  }, [authLoading, user, loginUrl]);

  const load = useCallback(async () => {
    if (!id) {
      setPhase('notfound');
      return;
    }
    setPhase('loading');
    try {
      const record = await fetchReservation(id);
      setReservation(record);
      setPhase('ready');
    } catch (err) {
      if (err instanceof ReservationApiError) {
        if (err.status === 401) {
          window.location.replace(loginUrl);
          return;
        }
        if (err.status === 403) {
          setPhase('forbidden');
          return;
        }
        if (err.status === 404) {
          setPhase('notfound');
          return;
        }
      }
      setPhase('error');
    }
  }, [id, loginUrl]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <h1 className="text-3xl font-bold text-foreground">Reservation details</h1>

      {phase === 'loading' ? (
        <div role="status" className="mt-6 grid gap-4">
          <span className="sr-only">Loading reservation</span>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48" />
        </div>
      ) : phase === 'forbidden' ? (
        <div className="mt-6">
          <EmptyState
            title="You do not have access to this reservation"
            description="Only staff of this restaurant can manage it."
            action={
              <Button
                onClick={() => {
                  window.location.href = '/staff/reservations';
                }}
              >
                Reservations
              </Button>
            }
          />
        </div>
      ) : phase === 'error' ? (
        <div className="mt-6">
          <ErrorState onRetry={() => void load()} />
        </div>
      ) : phase === 'notfound' || !reservation ? (
        <div className="mt-6">
          <EmptyState
            title="Reservation not found"
            description="It may have been cancelled, or the link may be incorrect."
            action={
              <Button
                variant="secondary"
                onClick={() => {
                  window.location.href = '/staff/reservations';
                }}
              >
                Reservations
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-6">
          <ReservationDetail reservation={reservation} />
        </div>
      )}
    </div>
  );
}
