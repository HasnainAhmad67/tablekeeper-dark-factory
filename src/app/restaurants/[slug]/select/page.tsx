"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

import { useAuth } from '@/components/auth/AuthProvider';
import { OptionCard } from '@/components/booking/OptionCard';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatWhenLabel, type AvailabilityOption } from '@/lib/booking';

/**
 * Screen 6 — table/group selection (plan Screen Map §G: radio group over
 * GET /api/restaurants/[id]/availability, "None available" empty state,
 * selection confirmed via URL query params into /confirm — plan decision:
 * state travels through the URL).
 *
 * The window comes from the query string, availability is re-fetched (the
 * authoritative list), and table ids come from the option the guest picks
 * here — never from stale URLs — so a concurrent booking is caught by the
 * POST's 409 rather than an out-of-date selection.
 */

interface SearchQuery {
  restaurantId: string;
  startsAt: string;
  endsAt: string;
  partySize: number;
}

interface RestaurantBrief {
  name: string;
  timezone: string;
}

type LoadPhase = 'loading' | 'invalid' | 'error' | 'ready';

const PRIMARY_LINK_CLASSES =
  'inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90';

function redirectToLogin(): void {
  const returnTo = window.location.pathname + window.location.search;
  window.location.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

export default function SelectPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? '';
  const { user, loading: authLoading } = useAuth();

  const [phase, setPhase] = useState<LoadPhase>('loading');
  const [query, setQuery] = useState<SearchQuery | null>(null);
  const [restaurant, setRestaurant] = useState<RestaurantBrief | null>(null);
  const [options, setOptions] = useState<AvailabilityOption[]>([]);
  const [errorMessage, setErrorMessage] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Unauthenticated guests are sent to login with a return path.
  useEffect(() => {
    if (authLoading || user) {
      return;
    }
    redirectToLogin();
  }, [authLoading, user]);

  const load = useCallback(async (activeQuery: SearchQuery) => {
    setPhase('loading');
    setSelectedId(null);
    try {
      const availabilityQuery = new URLSearchParams({
        starts_at: activeQuery.startsAt,
        ends_at: activeQuery.endsAt,
        party_size: String(activeQuery.partySize),
      });
      const [availabilityRes, detailRes] = await Promise.all([
        fetch(
          `/api/restaurants/${activeQuery.restaurantId}/availability?${availabilityQuery.toString()}`,
        ),
        fetch(`/api/restaurants/${encodeURIComponent(activeQuery.restaurantId)}`),
      ]);

      if (availabilityRes.status === 401) {
        redirectToLogin();
        return;
      }
      if (!availabilityRes.ok) {
        const body = (await availabilityRes.json().catch(() => null)) as {
          error?: string;
        } | null;
        setErrorMessage(
          body?.error ?? 'We could not load availability. Please try again.',
        );
        setPhase('error');
        return;
      }
      const body = (await availabilityRes.json()) as { options?: AvailabilityOption[] };

      let brief: RestaurantBrief | null = null;
      if (detailRes.ok) {
        const detailBody = (await detailRes.json()) as {
          restaurant?: { name?: string; timezone?: string };
        };
        if (detailBody.restaurant?.name && detailBody.restaurant.timezone) {
          brief = {
            name: detailBody.restaurant.name,
            timezone: detailBody.restaurant.timezone,
          };
        }
      }

      setRestaurant(brief);
      setOptions(Array.isArray(body.options) ? body.options : []);
      setPhase('ready');
    } catch {
      setErrorMessage('Network error. Please try again.');
      setPhase('error');
    }
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
    if (
      !restaurantId ||
      !startsAt ||
      !endsAt ||
      !Number.isInteger(partySize) ||
      partySize < 1
    ) {
      setPhase('invalid');
      return;
    }
    const activeQuery: SearchQuery = { restaurantId, startsAt, endsAt, partySize };
    setQuery(activeQuery);
    void load(activeQuery);
  }, [authLoading, user, load]);

  const selected = useMemo(
    () => options.find((option) => option.id === selectedId) ?? null,
    [options, selectedId],
  );

  const confirmHref = useMemo(() => {
    if (!query || !selected) {
      return null;
    }
    const searchParams = new URLSearchParams({
      restaurant_id: query.restaurantId,
      starts_at: query.startsAt,
      ends_at: query.endsAt,
      party_size: String(query.partySize),
      tables: selected.tableIds.join(','),
      label: selected.label,
    });
    return `/restaurants/${slug}/confirm?${searchParams.toString()}`;
  }, [query, selected, slug]);

  const changeSearchHref = query
    ? `/restaurants/${slug}/book`
    : `/restaurants/${slug}/book`;

  return (
    <div>
      <h1 className="text-3xl font-bold text-foreground">Select a table</h1>

      {phase === 'loading' ? (
        <div role="status" className="mt-6 grid gap-4">
          <span className="sr-only">Loading selection</span>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : phase === 'invalid' ? (
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
      ) : phase === 'error' ? (
        <div className="mt-6">
          <ErrorState
            title="Availability failed to load"
            message={errorMessage}
            onRetry={() => {
              if (query) {
                void load(query);
              }
            }}
          />
        </div>
      ) : !query ? (
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
      ) : options.length === 0 ? (
        <>
          <p className="mt-2 text-sm text-foreground-muted">
            {restaurant ? `${restaurant.name} · ` : ''}
            {formatWhenLabel(query.startsAt, query.endsAt, restaurant?.timezone ?? 'UTC')} ·
            Party of {query.partySize}
          </p>
          <div className="mt-6">
            <EmptyState
              title="None available"
              description="Every table for this time was just taken. Try another time."
              action={
                <Button variant="secondary" onClick={() => { window.location.href = `/restaurants/${slug}/book`; }}>
                  Change search
                </Button>
              }
            />
          </div>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-foreground-muted">
            {restaurant ? `${restaurant.name} · ` : ''}
            {formatWhenLabel(query.startsAt, query.endsAt, restaurant?.timezone ?? 'UTC')} ·
            Party of {query.partySize}
          </p>

          <form className="mt-6 grid gap-6" onSubmit={(event) => event.preventDefault()}>
            <p role="status" className="text-sm text-foreground-muted">
              {options.length} option{options.length === 1 ? '' : 's'} available.
            </p>

            <fieldset className="grid gap-3">
              <legend className="text-sm font-medium text-foreground">
                Choose a table or group
              </legend>
              {options.map((option) => (
                <OptionCard
                  key={`${option.kind}-${option.id}`}
                  option={option}
                  checked={selectedId === option.id}
                  onChange={() => setSelectedId(option.id)}
                  name="availability-option"
                />
              ))}
            </fieldset>

            <div className="flex flex-wrap items-center gap-4">
              {confirmHref ? (
                <a href={confirmHref} className={PRIMARY_LINK_CLASSES}>
                  Continue to confirmation
                </a>
              ) : (
                <p className="text-sm text-foreground-muted">Select an option to continue.</p>
              )}
              <a
                href={changeSearchHref}
                className="text-sm text-primary underline-offset-4 hover:underline"
              >
                Change search
              </a>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
