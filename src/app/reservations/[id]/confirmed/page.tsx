"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

import { useAuth } from '@/components/auth/AuthProvider';
import { AddToCalendar } from '@/components/booking/AddToCalendar';
import { BookingSummary } from '@/components/booking/BookingSummary';
import { Alert } from '@/components/ui/Alert';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatWhenLabel } from '@/lib/booking';

/**
 * Screen 10 — reservation confirmed (plan Screen Map §G: GET
 * /api/reservations/[id], success alert, details + add-to-calendar).
 *
 * Focus management: the page heading carries tabIndex={-1} and receives
 * focus once the reservation has loaded, so keyboard and screen-reader
 * guests land on the confirmation result after the POST navigation.
 */

interface AssignmentRecord {
  table_id: string;
  status: 'active' | 'released';
}

interface ReservationRecord {
  id: string;
  restaurant_id: string;
  party_size: number;
  starts_at: string;
  ends_at: string;
  status: string;
  notes: string | null;
  reservation_tables?: AssignmentRecord[] | null;
}

interface RestaurantBrief {
  name: string;
  timezone: string;
}

type LoadPhase = 'loading' | 'ready' | 'forbidden' | 'notfound' | 'error';

const STATUS_VARIANT = {
  pending: 'warning',
  confirmed: 'success',
  seated: 'info',
  completed: 'neutral',
  cancelled: 'danger',
  no_show: 'danger',
} as const;

function statusVariant(status: string): BadgeVariant {
  return STATUS_VARIANT[status as keyof typeof STATUS_VARIANT] ?? 'neutral';
}

function redirectToLogin(): void {
  const returnTo = window.location.pathname + window.location.search;
  window.location.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

export default function ConfirmedPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const { user, loading: authLoading } = useAuth();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [phase, setPhase] = useState<LoadPhase>('loading');
  const [reservation, setReservation] = useState<ReservationRecord | null>(null);
  const [restaurant, setRestaurant] = useState<RestaurantBrief | null>(null);

  // Unauthenticated guests are sent to login with a return path.
  useEffect(() => {
    if (authLoading || user) {
      return;
    }
    redirectToLogin();
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
        redirectToLogin();
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

  // Focus management: announce the confirmation result on arrival.
  useEffect(() => {
    if (phase === 'ready') {
      headingRef.current?.focus();
    }
  }, [phase]);

  const activeTables = (reservation?.reservation_tables ?? []).filter(
    (assignment) => assignment.status === 'active',
  ).length;

  return (
    <div>
      <h1
        ref={headingRef}
        tabIndex={-1}
        className="text-3xl font-bold text-foreground"
      >
        Reservation confirmed
      </h1>

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
            action={<Button onClick={() => { window.location.href = '/'; }}>Home</Button>}
          />
        </div>
      ) : phase === 'notfound' ? (
        <div className="mt-6">
          <EmptyState
            title="Reservation not found"
            description="It may have been cancelled, or the link may be incorrect."
            action={<Button variant="secondary" onClick={() => { window.location.href = '/'; }}>Home</Button>}
          />
        </div>
      ) : phase === 'error' ? (
        <div className="mt-6">
          <ErrorState onRetry={() => void load()} />
        </div>
      ) : reservation ? (
        <>
          <div className="mt-4">
            <Alert variant="success">Your booking is confirmed.</Alert>
          </div>

          <div className="mt-6 grid gap-6">
            <BookingSummary
              heading="Reservation details"
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

            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={statusVariant(reservation.status)}>
                {reservation.status.replace('_', ' ')}
              </Badge>
              <AddToCalendar
                summary={
                  restaurant ? `Reservation at ${restaurant.name}` : 'Reservation'
                }
                description={`Party of ${reservation.party_size}. Confirmation ${reservation.id}.`}
                startsAt={reservation.starts_at}
                endsAt={reservation.ends_at}
                uid={reservation.id}
              />
              <a
                href={`/restaurants/${encodeURIComponent(reservation.restaurant_id)}`}
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                View restaurant
              </a>
              <a href="/" className="text-sm text-primary underline-offset-4 hover:underline">
                Home
              </a>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
