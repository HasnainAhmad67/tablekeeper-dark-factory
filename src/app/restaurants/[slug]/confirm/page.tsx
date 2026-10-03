"use client";

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';

import { useAuth } from '@/components/auth/AuthProvider';
import { BookingSummary } from '@/components/booking/BookingSummary';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatWhenLabel } from '@/lib/booking';

/**
 * Screen 7 — reservation summary and booking POST (plan Screen Map §G:
 * POST /api/reservations with Idempotency-Key, success → screen 10,
 * conflicts/validation shown inline without clearing the form).
 *
 * Idempotency: a fresh crypto.randomUUID() per submission is sent as the
 * Idempotency-Key header with the same value in the body as a fallback
 * (server prefers the header). 409/422/4xx/5xx responses render the
 * server's message in a role="alert" banner while the guest's inputs —
 * including notes — stay intact.
 *
 * On success the page navigates to /reservations/[id]/confirmed, whose
 * heading takes focus (plan requirement: focus management on confirmation).
 */

interface ConfirmQuery {
  restaurantId: string;
  startsAt: string;
  endsAt: string;
  partySize: number;
  tableIds: string[];
  label: string;
}

interface RestaurantBrief {
  name: string;
  timezone: string;
}

type LoadPhase = 'loading' | 'invalid' | 'ready';

function redirectToLogin(): void {
  const returnTo = window.location.pathname + window.location.search;
  window.location.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

export default function ConfirmPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? '';
  const { user, loading: authLoading } = useAuth();

  const [phase, setPhase] = useState<LoadPhase>('loading');
  const [query, setQuery] = useState<ConfirmQuery | null>(null);
  const [restaurant, setRestaurant] = useState<RestaurantBrief | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // Unauthenticated guests are sent to login with a return path.
  useEffect(() => {
    if (authLoading || user) {
      return;
    }
    redirectToLogin();
  }, [authLoading, user]);

  // Restaurant name/timezone enrich the summary; failure is non-fatal.
  const load = useCallback(async (activeQuery: ConfirmQuery) => {
    try {
      const res = await fetch(
        `/api/restaurants/${encodeURIComponent(activeQuery.restaurantId)}`,
      );
      if (res.ok) {
        const body = (await res.json()) as {
          restaurant?: { name?: string; timezone?: string };
        };
        if (body.restaurant?.name && body.restaurant.timezone) {
          setRestaurant({ name: body.restaurant.name, timezone: body.restaurant.timezone });
        }
      }
    } catch {
      // Non-fatal: the summary falls back to generic labels.
    }
    setPhase('ready');
  }, []);

  useEffect(() => {
    if (authLoading || !user) {
      return;
    }
    const searchParams = new URLSearchParams(window.location.search);
    const restaurantId = searchParams.get('restaurant_id') ?? '';
    const startsAt = searchParams.get('starts_at') ?? '';
    const endsAt = searchParams.get('ends_at') ?? '';
    const partySize = Number(searchParams.get('party_size') ?? '');
    const tableIds = (searchParams.get('tables') ?? '')
      .split(',')
      .map((tableId) => tableId.trim())
      .filter(Boolean);
    const label = searchParams.get('label') ?? '';
    if (
      !restaurantId ||
      !startsAt ||
      !endsAt ||
      !Number.isInteger(partySize) ||
      partySize < 1 ||
      tableIds.length === 0
    ) {
      setPhase('invalid');
      return;
    }
    const activeQuery: ConfirmQuery = { restaurantId, startsAt, endsAt, partySize, tableIds, label };
    setQuery(activeQuery);
    void load(activeQuery);
  }, [authLoading, user, load]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!query || pending) {
      return;
    }
    setError(null);
    setPending(true);
    const idempotencyKey = globalThis.crypto.randomUUID();
    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          restaurant_id: query.restaurantId,
          table_ids: query.tableIds,
          party_size: query.partySize,
          starts_at: query.startsAt,
          ends_at: query.endsAt,
          notes: notes.trim() ? notes.trim() : null,
          // Body fallback for environments that strip the header.
          idempotency_key: idempotencyKey,
        }),
      });
      if (res.status === 401) {
        setPending(false);
        redirectToLogin();
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        reservation?: { id?: string };
        error?: string;
      } | null;
      if (!res.ok) {
        // 409 conflicts and 422 validation failures stay inline; the form
        // keeps every guest input so the search does not have to be redone.
        setError(body?.error ?? 'We could not confirm your reservation. Please try again.');
        setPending(false);
        return;
      }
      const reservationId = body?.reservation?.id;
      if (!reservationId) {
        setError('The booking was created, but its confirmation could not be loaded.');
        setPending(false);
        return;
      }
      // Full navigation: the confirmed page focuses its own heading.
      window.location.href = `/reservations/${encodeURIComponent(reservationId)}/confirmed`;
    } catch {
      setError('Network error. Your reservation was not created. Please try again.');
      setPending(false);
    }
  }

  const backHref = query
    ? `/restaurants/${slug}/select?${new URLSearchParams({
        restaurant_id: query.restaurantId,
        starts_at: query.startsAt,
        ends_at: query.endsAt,
        party_size: String(query.partySize),
      }).toString()}`
    : `/restaurants/${slug}/book`;

  return (
    <div>
      <h1 className="text-3xl font-bold text-foreground">Confirm your reservation</h1>

      {phase === 'loading' ? (
        <div role="status" className="mt-6 grid gap-4">
          <span className="sr-only">Loading confirmation</span>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-48" />
        </div>
      ) : phase === 'invalid' || !query ? (
        <div className="mt-6">
          <EmptyState
            title="Search required"
            description="Choose a date, time, and party size first."
            action={
              <Button onClick={() => { window.location.href = `/restaurants/${slug}/book`; }}>
                Start a new search
              </Button>
            }
          />
        </div>
      ) : (
        <>
          {error ? (
            <div className="mt-4">
              <Alert variant="error">{error}</Alert>
            </div>
          ) : null}

          <div className="mt-6 grid gap-6">
            <BookingSummary
              heading="Reservation summary"
              items={[
                { term: 'Restaurant', value: restaurant?.name ?? 'Restaurant' },
                {
                  term: 'When',
                  value: formatWhenLabel(
                    query.startsAt,
                    query.endsAt,
                    restaurant?.timezone ?? 'UTC',
                  ),
                },
                { term: 'Party size', value: String(query.partySize) },
                {
                  term: 'Seating',
                  value:
                    query.label ||
                    `${query.tableIds.length} table${query.tableIds.length === 1 ? '' : 's'}`,
                },
                { term: 'Guest', value: user?.email ?? '—' },
              ]}
            />

            <form onSubmit={handleSubmit} className="grid max-w-xl gap-4">
              <Field
                id="confirm-notes"
                label="Special requests (optional)"
                type="text"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-4">
                <Button type="submit" loading={pending}>
                  Confirm reservation
                </Button>
                <a
                  href={backHref}
                  className="text-sm text-primary underline-offset-4 hover:underline"
                >
                  Back to selection
                </a>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
