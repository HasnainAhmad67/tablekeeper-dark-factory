"use client";

import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Field } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Restaurant discovery list (plan Screen Map row 2). Responsive 2/3/4
 * column grid fed by `GET /api/restaurants?search=` — the applied term
 * is mirrored into the page URL (`?search=`) so results are shareable
 * and restorable. Skeleton/empty/retry states mirror the landing screen;
 * the labelled search form is fully keyboard-operable (type-to-filter,
 * Enter submits, visible focus from the global outline).
 */

interface Restaurant {
  id: string;
  name: string;
  slug: string;
  cuisine: string | null;
  price_range: number | null;
  description: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
}

async function fetchRestaurants(search: string): Promise<Restaurant[]> {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  const response = await fetch(`/api/restaurants${query}`);
  if (!response.ok) {
    throw new Error('Restaurant request failed');
  }
  const body = (await response.json()) as { restaurants?: unknown };
  if (!Array.isArray(body.restaurants)) {
    throw new Error('Unexpected restaurant response');
  }
  return body.restaurants as Restaurant[];
}

type LoadState = 'loading' | 'ready' | 'error';

export default function RestaurantsPage() {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [query, setQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');

  const load = useCallback(async (search: string) => {
    setState('loading');
    setActiveSearch(search);
    try {
      setRestaurants(await fetchRestaurants(search));
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  // Restore an incoming ?search= term, otherwise load the full list.
  useEffect(() => {
    const term = new URLSearchParams(window.location.search).get('search') ?? '';
    if (term) {
      setQuery(term);
    }
    void load(term);
  }, [load]);

  function syncUrl(term: string) {
    const url = term
      ? `${window.location.pathname}?search=${encodeURIComponent(term)}`
      : window.location.pathname;
    window.history.replaceState(null, '', url);
  }

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const term = query.trim();
    syncUrl(term);
    void load(term);
  }

  function handleClear() {
    setQuery('');
    syncUrl('');
    void load('');
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Restaurants</h1>
          <p className="mt-2 text-foreground-muted">
            Browse dining rooms and filter by name or cuisine.
          </p>
        </div>
        <form
          role="search"
          aria-label="Restaurant search"
          onSubmit={handleSearch}
          className="flex w-full items-end gap-2 sm:w-auto"
        >
          <div className="w-full sm:w-64">
            <Field
              id="restaurants-search"
              label="Search restaurants"
              type="search"
              name="search"
              placeholder="Name or cuisine"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary">
            Search
          </Button>
          {activeSearch ? (
            <Button type="button" variant="ghost" onClick={handleClear}>
              Clear
            </Button>
          ) : null}
        </form>
      </div>

      {state === 'loading' ? (
        <div role="status" className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <span className="sr-only">Loading restaurants</span>
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-44" />
          ))}
        </div>
      ) : null}

      {state === 'error' ? (
        <div className="mt-8">
          <ErrorState onRetry={() => void load(activeSearch)} />
        </div>
      ) : null}

      {state === 'ready' && restaurants.length === 0 ? (
        <div className="mt-8">
          {activeSearch ? (
            <EmptyState
              title="No matches"
              description={`No restaurants match "${activeSearch}".`}
              action={
                <Button variant="secondary" onClick={handleClear}>
                  Clear search
                </Button>
              }
            />
          ) : (
            <EmptyState
              title="No restaurants yet"
              description="Check back soon — new dining rooms are added regularly."
            />
          )}
        </div>
      ) : null}

      {state === 'ready' && restaurants.length > 0 ? (
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {restaurants.map((restaurant) => (
            <li key={restaurant.id} className="h-full">
              <Card className="flex h-full flex-col gap-2">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-semibold text-foreground">{restaurant.name}</h2>
                  {restaurant.price_range ? (
                    <Badge variant="info">{'$'.repeat(Math.min(restaurant.price_range, 5))}</Badge>
                  ) : null}
                </div>
                {restaurant.cuisine ? (
                  <p className="text-sm text-foreground-muted">{restaurant.cuisine}</p>
                ) : null}
                {restaurant.description ? (
                  <p className="line-clamp-3 text-sm text-foreground-muted">
                    {restaurant.description}
                  </p>
                ) : null}
                {restaurant.address ? (
                  <p className="text-sm text-foreground-muted">{restaurant.address}</p>
                ) : null}
                <div className="mt-auto pt-2">
                  <a
                    href={`/restaurants/${restaurant.slug}`}
                    className="text-sm font-medium text-primary transition-colors hover:underline"
                  >
                    View {restaurant.name}
                  </a>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
