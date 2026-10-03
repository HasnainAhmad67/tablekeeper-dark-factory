"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';

import { useAuth } from '@/components/auth/AuthProvider';
import { SlotPicker } from '@/components/booking/SlotPicker';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Field } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import {
  formatDateKeyLabel,
  formatWhenLabel,
  generateSlots,
  localDateKey,
  type AvailabilityOption,
  type OperatingHoursRow,
  type TimeSlot,
} from '@/lib/booking';

/**
 * Screen 5 — availability search (plan Screen Map §G: /book form, live
 * results through GET /api/restaurants/[id]/availability, "No availability"
 * empty state, Retry error state, form labels + polite live region).
 *
 * Slot candidates are generated client-side from the detail API's timezone
 * and operating hours (src/lib/booking.ts), then each search asks the
 * existing availability API for ranked options in that window. Unauthenticated
 * entry redirects to /login?returnTo=<current-path> per plan decision; note
 * that the login screen does not consume returnTo yet (Phase 2 behavior).
 */

interface RestaurantDetail {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  operating_hours: OperatingHoursRow[];
}

type LoadPhase = 'loading' | 'ready' | 'error' | 'notfound';
type SearchPhase = 'idle' | 'loading' | 'error' | 'ready';

interface SearchWindow {
  startsAt: string;
  endsAt: string;
  partySize: number;
}

const PRIMARY_LINK_CLASSES =
  'inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90';

function redirectToLogin(): void {
  const returnTo = window.location.pathname + window.location.search;
  window.location.replace(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

function availabilityUrl(restaurantId: string, searchWindow: SearchWindow): string {
  const query = new URLSearchParams({
    starts_at: searchWindow.startsAt,
    ends_at: searchWindow.endsAt,
    party_size: String(searchWindow.partySize),
  });
  return `/api/restaurants/${restaurantId}/availability?${query.toString()}`;
}

export default function BookPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? '';
  const { user, loading: authLoading } = useAuth();

  const [phase, setPhase] = useState<LoadPhase>('loading');
  const [restaurant, setRestaurant] = useState<RestaurantDetail | null>(null);
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [dateKey, setDateKey] = useState('');
  const [slotValue, setSlotValue] = useState<string | null>(null);
  const [partySize, setPartySize] = useState('2');
  const [formError, setFormError] = useState<string | null>(null);

  const [searchPhase, setSearchPhase] = useState<SearchPhase>('idle');
  const [searchError, setSearchError] = useState('');
  const [searchedWindow, setSearchedWindow] = useState<SearchWindow | null>(null);
  const [options, setOptions] = useState<AvailabilityOption[]>([]);

  // Unauthenticated guests are sent to login with a return path.
  useEffect(() => {
    if (authLoading || user) {
      return;
    }
    redirectToLogin();
  }, [authLoading, user]);

  const load = useCallback(async () => {
    if (!slug) {
      setPhase('notfound');
      return;
    }
    setPhase('loading');
    try {
      const res = await fetch(`/api/restaurants/${encodeURIComponent(slug)}`);
      if (res.status === 404) {
        setPhase('notfound');
        return;
      }
      if (!res.ok) {
        setPhase('error');
        return;
      }
      const body = (await res.json()) as { restaurant?: RestaurantDetail };
      const next = body.restaurant;
      if (!next) {
        setPhase('notfound');
        return;
      }
      const generated = generateSlots({
        timeZone: next.timezone,
        operatingHours: next.operating_hours ?? [],
        now: Date.now(),
      });
      setRestaurant(next);
      setSlots(generated);
      setDateKey(
        generated[0]?.dateKey ?? localDateKey(Date.now(), next.timezone) ?? '',
      );
      setSlotValue(null);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const authReady = !authLoading && Boolean(user);
  const dateKeys = useMemo(() => [...new Set(slots.map((slot) => slot.dateKey))], [slots]);
  const daySlots = useMemo(
    () => slots.filter((slot) => slot.dateKey === dateKey),
    [slots, dateKey],
  );
  const todayKey =
    restaurant !== null ? localDateKey(Date.now(), restaurant.timezone) : '';

  const runSearch = useCallback(
    async (searchWindow: SearchWindow) => {
      if (!restaurant) {
        return;
      }
      setSearchPhase('loading');
      setSearchedWindow(searchWindow);
      try {
        const res = await fetch(availabilityUrl(restaurant.id, searchWindow));
        if (res.status === 401) {
          redirectToLogin();
          return;
        }
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setSearchError(
            body?.error ?? 'We could not search availability. Please try again.',
          );
          setSearchPhase('error');
          return;
        }
        const body = (await res.json()) as { options?: AvailabilityOption[] };
        setOptions(Array.isArray(body.options) ? body.options : []);
        setSearchPhase('ready');
      } catch {
        setSearchError('Network error. Please try again.');
        setSearchPhase('error');
      }
    },
    [restaurant],
  );

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!restaurant) {
      return;
    }
    const party = Number(partySize);
    if (!Number.isInteger(party) || party < 1) {
      setFormError('Enter a party size of at least 1.');
      return;
    }
    const slot = slots.find((candidate) => candidate.startsAt === slotValue);
    if (!slot) {
      setFormError('Select a time to search for a table.');
      return;
    }
    setFormError(null);
    void runSearch({ startsAt: slot.startsAt, endsAt: slot.endsAt, partySize: party });
  }

  const selectHref = useMemo(() => {
    if (!restaurant || !searchedWindow) {
      return null;
    }
    const query = new URLSearchParams({
      restaurant_id: restaurant.id,
      starts_at: searchedWindow.startsAt,
      ends_at: searchedWindow.endsAt,
      party_size: String(searchedWindow.partySize),
    });
    return `/restaurants/${slug}/select?${query.toString()}`;
  }, [restaurant, searchedWindow, slug]);

  return (
    <div>
      <h1 className="text-3xl font-bold text-foreground">Book a table</h1>

      {phase === 'loading' || (phase === 'ready' && !authReady) ? (
        <div role="status" className="mt-6 grid gap-4">
          <span className="sr-only">Loading booking form</span>
          <Skeleton className="h-8 w-64" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        </div>
      ) : phase === 'error' ? (
        <div className="mt-6">
          <ErrorState onRetry={() => void load()} />
        </div>
      ) : phase === 'notfound' || !restaurant ? (
        <div className="mt-6">
          <EmptyState
            title="Restaurant not found"
            description="It may have moved, or the link may be incorrect."
            action={
              <Button variant="secondary" onClick={() => { window.location.href = '/restaurants'; }}>
                Browse restaurants
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <p className="mt-2 text-sm text-foreground-muted">
            {restaurant.name} · Times in {restaurant.timezone}
          </p>

          {slots.length === 0 ? (
            <div className="mt-6">
              <EmptyState
                title="No availability"
                description="This restaurant has no bookable times in the next 7 days."
              />
            </div>
          ) : (
            <form onSubmit={handleSearch} className="mt-6 grid max-w-xl gap-4">
              {formError ? <Alert variant="error">{formError}</Alert> : null}

              <Field
                id="book-party"
                label="Party size"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={partySize}
                onChange={(event) => {
                  setPartySize(event.target.value);
                  setFormError(null);
                }}
              />

              <div className="grid gap-1.5">
                <label htmlFor="book-date" className="text-sm font-medium text-foreground">
                  Date
                </label>
                <select
                  id="book-date"
                  value={dateKey}
                  onChange={(event) => {
                    setDateKey(event.target.value);
                    setSlotValue(null);
                    setFormError(null);
                  }}
                  className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground"
                >
                  {dateKeys.map((key) => (
                    <option key={key} value={key}>
                      {key === todayKey ? 'Today, ' : ''}
                      {formatDateKeyLabel(key, restaurant.timezone)}
                    </option>
                  ))}
                </select>
              </div>

              <SlotPicker
                legend="Time"
                slots={daySlots}
                timeZone={restaurant.timezone}
                value={slotValue}
                onChange={(value) => {
                  setSlotValue(value);
                  setFormError(null);
                }}
                name="booking-slot"
                emptyMessage="No times on this date."
              />

              <div>
                <Button type="submit" loading={searchPhase === 'loading'}>
                  Find a table
                </Button>
              </div>
            </form>
          )}

          {searchPhase === 'loading' ? (
            <div role="status" className="mt-8 flex items-center gap-2 text-sm text-foreground-muted">
              <Spinner className="size-4" />
              Searching availability…
            </div>
          ) : searchPhase === 'error' ? (
            <div className="mt-8">
              <ErrorState
                title="Search failed"
                message={searchError}
                onRetry={() => {
                  if (searchedWindow) {
                    void runSearch(searchedWindow);
                  }
                }}
              />
            </div>
          ) : searchPhase === 'ready' ? (
            <section aria-labelledby="search-results-heading" className="mt-10">
              <h2 id="search-results-heading" className="text-lg font-semibold text-foreground">
                Search results
              </h2>
              {options.length === 0 ? (
                <div className="mt-4">
                  <EmptyState
                    title="No availability"
                    description={
                      searchedWindow
                        ? `Nothing open for a party of ${searchedWindow.partySize} at ${formatWhenLabel(
                            searchedWindow.startsAt,
                            searchedWindow.endsAt,
                            restaurant.timezone,
                          )}. Try another time or party size.`
                        : 'Try another time or party size.'
                    }
                  />
                </div>
              ) : (
                <>
                  <p role="status" className="mt-2 text-sm text-foreground-muted">
                    {options.length} option{options.length === 1 ? '' : 's'} available, best fit
                    first.
                  </p>
                  <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                    {options.slice(0, 6).map((option) => (
                      <li
                        key={`${option.kind}-${option.id}`}
                        className="rounded-lg border border-border bg-surface p-4"
                      >
                        <span className="flex items-center gap-2">
                          <Badge variant={option.kind === 'group' ? 'info' : 'neutral'}>
                            {option.kind === 'group' ? 'Group' : 'Table'}
                          </Badge>
                          <span className="text-sm font-semibold text-foreground">
                            {option.label}
                          </span>
                        </span>
                        <p className="mt-1 text-sm text-foreground-muted">
                          Seats {option.capacity}
                          {option.surplus > 0 ? ` · ${option.surplus} spare seat${option.surplus === 1 ? '' : 's'}` : ' · Perfect fit'}
                        </p>
                      </li>
                    ))}
                  </ul>
                  {selectHref ? (
                    <p className="mt-6">
                      <a href={selectHref} className={PRIMARY_LINK_CLASSES}>
                        Continue to selection
                      </a>
                    </p>
                  ) : null}
                </>
              )}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
