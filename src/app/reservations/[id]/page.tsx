"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

import { useAuth } from '@/components/auth/AuthProvider';
import { BookingSummary } from '@/components/booking/BookingSummary';
import { CancelDialog } from '@/components/reservations/CancelDialog';
import {
  isCancellable,
  statusBadgeVariant,
  statusLabel,
  type ReservationRecord,
} from '@/components/reservations/ReservationItem';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatWhenLabel } from '@/lib/booking';

/**
 * Screen 12 — reservation detail (plan Screen Map §G: GET
 * /api/reservations/[id], full details + cancel button; screen 13's cancel
 * runs inline here per the plan decision — confirmation replaces the
 * modal, and no separate /manage route is opened in this phase).
 *
 * Cancel: PATCH /api/reservations/[id] with { status: "cancelled" } through
 * the shared CancelDialog — errors stay inline and keep their state, and a
 * successful cancellation updates the record in place (badge, released
 * tables) with a role="status" success alert. Restaurant name/timezone
 * come from the public detail API; failures degrade to generic labels.
 */

const LOGIN_URL = '/login?returnTo=/reservations';

interface RestaurantBrief {
  name: string;
  timezone: string;
}

type LoadPhase = 'loading' | 'ready' | 'forbidden' | 'notfound' | 'error';

export default function ReservationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { user, loading: authLoading } = useAuth();

  const [phase, setPhase] = useState<LoadPhase>('loading');
  const [reservation, setReservation] = useState<ReservationRecord | null>(null);
  const [restaurant, setRestaurant] = useState<RestaurantBrief | null>(null);

  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelledHere, setCancelledHere] = useState(false);
  const hadConfirming = useRef(false);

  // Unauthenticated guests are sent to login with the reservations return path.
  useEffect(() => {
    if (authLoading || user) {
      return;
    }
    window.location.replace(LOGIN_URL);
  }, [authLoading, user]);

  const load = useCallback(async () => {
    if (!id) {
      setPhase('notfound');
      return;
    }
    setPhase('loading');
    try {
      const res = await fetch(`/api/reservations/${encodeURIComponent(id)}`);
      if (res.status === 401) {
        window.location.replace(LOGIN_URL);
        return;
      }
      if (res.status === 403) {
        setPhase('forbidden');
        return;
      }
      if (res.status === 404) {
        setPhase('notfound');
        return;
      }
      if (!res.ok) {
        setPhase('error');
        return;
      }
      const body = (await res.json()) as { reservation?: ReservationRecord };
      if (!body.reservation) {
        setPhase('notfound');
        return;
      }
      setReservation(body.reservation);
      setPhase('ready');

      // Enrich with the restaurant's name/timezone; failure is non-fatal.
      try {
        const detailRes = await fetch(
          `/api/restaurants/${encodeURIComponent(body.reservation.restaurant_id)}`,
        );
        if (detailRes.ok) {
          const detailBody = (await detailRes.json()) as {
            restaurant?: { name?: string; timezone?: string };
          };
          if (detailBody.restaurant?.name && detailBody.restaurant.timezone) {
            setRestaurant({
              name: detailBody.restaurant.name,
              timezone: detailBody.restaurant.timezone,
            });
          }
        }
      } catch {
        // Non-fatal: the summary falls back to generic labels.
      }
    } catch {
      setPhase('error');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Restore focus when the inline dialog closes (trigger, else back link).
  useEffect(() => {
    if (confirming) {
      hadConfirming.current = true;
      return;
    }
    if (!hadConfirming.current) {
      return;
    }
    const target =
      document.querySelector<HTMLElement>('[data-cancel-trigger]') ??
      document.querySelector<HTMLElement>('[data-back-link]');
    target?.focus();
  }, [confirming]);

  async function handleCancel() {
    if (!reservation || pending) {
      return;
    }
    setPending(true);
    setCancelError(null);
    try {
      const res = await fetch(`/api/reservations/${encodeURIComponent(reservation.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      if (res.status === 401) {
        window.location.replace(LOGIN_URL);
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        reservation?: Partial<ReservationRecord>;
        error?: string;
      } | null;
      if (!res.ok) {
        // 403/404/409/422/500 stay inline; the dialog keeps its state.
        setCancelError(
          body?.error ?? 'We could not cancel this reservation. Please try again.',
        );
        setPending(false);
        return;
      }
      setReservation({ ...reservation, ...(body?.reservation ?? {}) });
      setCancelledHere(true);
      setConfirming(false);
      setPending(false);
    } catch {
      setCancelError('Network error. Your reservation was not cancelled.');
      setPending(false);
    }
  }

  function handleDismiss() {
    if (pending) {
      return;
    }
    setConfirming(false);
    setCancelError(null);
  }

  const activeTables = (reservation?.reservation_tables ?? []).filter(
    (assignment) => assignment.status === 'active',
  ).length;
  const cancellable = reservation !== null && isCancellable(reservation.status);

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
            description="Sign in as the guest who booked it to see the details."
            action={
              <Button
                onClick={() => {
                  window.location.href = '/';
                }}
              >
                Home
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
                  window.location.href = '/reservations';
                }}
              >
                My Reservations
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-6 grid max-w-2xl gap-6">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={statusBadgeVariant(reservation.status)}>
              {statusLabel(reservation.status)}
            </Badge>
            <a
              data-back-link
              href="/reservations"
              className="text-sm text-primary underline-offset-4 hover:underline"
            >
              Back to my reservations
            </a>
          </div>

          {cancelledHere ? (
            <Alert variant="success">Reservation cancelled.</Alert>
          ) : null}

          <BookingSummary
            heading="Details"
            items={[
              { term: 'Restaurant', value: restaurant?.name ?? 'Restaurant' },
              {
                term: 'When',
                value: formatWhenLabel(
                  reservation.starts_at,
                  reservation.ends_at,
                  restaurant?.timezone ?? 'UTC',
                ),
              },
              { term: 'Party size', value: String(reservation.party_size) },
              { term: 'Guest', value: user?.email ?? '—' },
              { term: 'Confirmation', value: reservation.id },
              ...(activeTables > 0
                ? [
                    {
                      term: 'Seating',
                      value: `${activeTables} table${activeTables === 1 ? '' : 's'}`,
                    },
                  ]
                : []),
              ...(reservation.notes ? [{ term: 'Notes', value: reservation.notes }] : []),
            ]}
          />

          {cancellable ? (
            confirming ? (
              <CancelDialog
                busy={pending}
                error={cancelError}
                onConfirm={() => void handleCancel()}
                onDismiss={handleDismiss}
              />
            ) : (
              <div>
                <Button
                  data-cancel-trigger
                  variant="secondary"
                  onClick={() => {
                    setCancelError(null);
                    setConfirming(true);
                  }}
                >
                  Cancel reservation
                </Button>
              </div>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}
