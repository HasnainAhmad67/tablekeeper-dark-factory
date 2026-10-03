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
 * Landing / discovery screen (plan Screen Map row 1). Client-side fetch
 * of the public `GET /api/restaurants` route so the required loading
 * skeleton, empty state, and retry affordance are real runtime states.
 * Layout chrome (skip link, header, footer, main) comes from the root
 * layout; search submits to the route's `?search=` filter.
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

export default function HomePage() {
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

  useEffect(() => {
    void load('');
  }, [load]);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(query.trim());
  }

  function handleClear() {
    setQuery('');
    void load('');
  }

  return (
    <>
      <section aria-labelledby="hero-heading">
        <p className="text-sm font-medium uppercase tracking-widest text-primary">Tablekeeper</p>
        <h1
          id="hero-heading"
          className="mt-2 text-4xl font-bold tracking-tight text-foreground sm:text-5xl"
        >
          Composable Floor
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-foreground-muted">
          A restaurant reservation system with dynamically joinable table groups and strict
          double-booking prevention.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <a
            href="/restaurants"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
          >
            Browse restaurants
          </a>
          <a
            href="/login"
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised"
          >
            Log in
          </a>
        </div>
      </section>

      <section aria-labelledby="restaurants-heading" className="mt-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2
              id="restaurants-heading"
              className="text-2xl font-semibold tracking-tight text-foreground"
            >
              Restaurants
            </h2>
            <p className="mt-2 text-foreground-muted">
              Find a table — search by restaurant name or cuisine.
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
                id="landing-search"
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
          </form>
        </div>

        {state === 'loading' ? (
          <div role="status" className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <span className="sr-only">Loading restaurants</span>
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-44" />
            ))}
          </div>
        ) : null}

        {state === 'error' ? (
          <div className="mt-6">
            <ErrorState onRetry={() => void load(activeSearch)} />
          </div>
        ) : null}

        {state === 'ready' && restaurants.length === 0 ? (
          activeSearch ? (
            <div className="mt-6">
              <EmptyState
                title="No matches"
                description={`No restaurants match "${activeSearch}".`}
                headingLevel={3}
                action={
                  <Button variant="secondary" onClick={handleClear}>
                    Clear search
                  </Button>
                }
              />
            </div>
          ) : (
            <div className="mt-6">
              <EmptyState
                title="No restaurants yet"
                description="Check back soon — new dining rooms are added regularly."
                headingLevel={3}
              />
            </div>
          )
        ) : null}

        {state === 'ready' && restaurants.length > 0 ? (
          <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {restaurants.map((restaurant) => (
              <li key={restaurant.id} className="h-full">
                <Card className="flex h-full flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold text-foreground">{restaurant.name}</h3>
                    {restaurant.price_range ? (
                      <Badge variant="info">
                        {'$'.repeat(Math.min(restaurant.price_range, 5))}
                      </Badge>
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
      </section>
    </>
  );
}
