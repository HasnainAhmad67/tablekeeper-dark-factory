"use client";

import Image from 'next/image';
import { useCallback, useEffect, useState, type FormEvent } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Field } from '@/components/ui/Field';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Restaurant discovery (plan Screen Map row 2, `/restaurants`) — premium
 * image-led redesign.
 *
 * Behaviour is unchanged from the original list: `GET /api/restaurants?search=`
 * feeds the grid, the applied term is mirrored into the page URL
 * (`?search=`) so results stay shareable/restorable, and the labelled
 * search form is fully keyboard-operable (type-to-filter, Enter submits,
 * visible focus from the global outline; the global reduced-motion rule
 * plus per-element `motion-reduce:` variants disable hover motion).
 *
 * Presentation: hero (eyebrow + h1 + supporting copy + search + trust
 * chips), an "Explore restaurants" section with a result count, and wide
 * image cards in a 3/2/1 responsive grid. Images use a deterministic
 * slug/name map to the local photos in public/images/restaurants — no
 * schema or API change — with an initials-gradient fallback whenever a
 * photo is unmapped or fails to load, so the page never shows a broken
 * image. Only public discovery fields from the existing API are rendered:
 * no invented ratings or availability data.
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

/**
 * Deterministic slug/name → local photo map for all six seeded
 * restaurants. No schema or API change: keyed by slug and by lowercased
 * name so the photo survives either identifier the API returns; anything
 * unmapped or failing to load falls back to the initials gradient below.
 */
const RESTAURANT_IMAGES: Record<string, string> = {
  'second-test-bistro': '/images/restaurants/second-test-bistro.jpg',
  'test-kitchen': '/images/restaurants/test-kitchen.jpg',
  'casa-verde': '/images/restaurants/casa-verde.jpg',
  'sora-sushi-house': '/images/restaurants/sora-sushi-house.jpg',
  'garden-table': '/images/restaurants/garden-table.jpg',
  'ember-and-oak': '/images/restaurants/ember-and-oak.jpg',
  'the second test bistro': '/images/restaurants/second-test-bistro.jpg',
  'the test kitchen': '/images/restaurants/test-kitchen.jpg',
  'casa verde': '/images/restaurants/casa-verde.jpg',
  'sora sushi house': '/images/restaurants/sora-sushi-house.jpg',
  'the garden table': '/images/restaurants/garden-table.jpg',
  'ember & oak': '/images/restaurants/ember-and-oak.jpg',
};

function imageSrcFor(restaurant: Restaurant): string | null {
  return (
    RESTAURANT_IMAGES[restaurant.slug] ??
    RESTAURANT_IMAGES[restaurant.name.toLowerCase()] ??
    null
  );
}

/** Alt text carries the restaurant name and its cuisine (when present). */
function altFor(restaurant: Restaurant): string {
  return restaurant.cuisine ? `${restaurant.name} — ${restaurant.cuisine}` : restaurant.name;
}

/** Initials for the fallback surface ("The Second Test Bistro" -> "SB"). */
function initialsFor(name: string): string {
  const words = name.split(/\s+/).filter((word) => word.length > 2);
  const picked = words.length > 0 ? words : name.split(/\s+/);
  const first = picked[0] ?? name;
  const last = picked.length > 1 ? picked[picked.length - 1] : '';
  const initials = `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
  return initials.length > 0 ? initials : name.slice(0, 2).toUpperCase();
}

/**
 * Photo with graceful fallback: an unmapped slug or a failed load swaps
 * to a token-gradient surface with the restaurant's initials (never a
 * broken-image icon).
 */
function RestaurantImage({ restaurant }: { restaurant: Restaurant }) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : imageSrcFor(restaurant);
  const alt = altFor(restaurant);

  if (src === null) {
    return (
      <div
        role="img"
        aria-label={alt}
        className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,var(--surface-raised),var(--surface))] text-3xl font-semibold tracking-wide text-primary/70"
      >
        <span aria-hidden="true">{initialsFor(restaurant.name)}</span>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
      className="object-cover transition-transform duration-500 ease-out group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
      onError={() => setFailed(true)}
    />
  );
}

/** Card copy points shown in the hero — static product value props. */
const TRUST_CHIPS = ['Live availability', 'Flexible seating', 'Instant booking'] as const;

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
      {/* Hero */}
      <section
        aria-labelledby="discovery-heading"
        className="relative overflow-hidden rounded-[20px] border border-border bg-surface px-6 py-14 sm:px-10 sm:py-16"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-28 size-72 rounded-full bg-primary/15 blur-3xl" />
          <div className="absolute -bottom-32 -right-28 size-80 rounded-full bg-info/10 blur-3xl" />
        </div>

        <div className="relative z-10 mx-auto flex max-w-2xl flex-col items-center text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
            Discover your next table
          </p>
          <h1
            id="discovery-heading"
            className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-5xl"
          >
            Dining experiences worth planning for.
          </h1>
          <p className="mt-5 max-w-xl text-base text-foreground-muted sm:text-lg">
            Discover restaurants, explore their spaces, and reserve with confidence.
          </p>

          <form
            role="search"
            aria-label="Restaurant search"
            onSubmit={handleSearch}
            className="mt-8 flex w-full items-end gap-2"
          >
            <div className="min-w-0 flex-1">
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
            <Button type="submit" variant="primary">
              Search
            </Button>
            {activeSearch ? (
              <Button type="button" variant="ghost" onClick={handleClear}>
                Clear
              </Button>
            ) : null}
          </form>

          <ul className="mt-9 flex flex-wrap items-center justify-center gap-2.5">
            {TRUST_CHIPS.map((chip) => (
              <li
                key={chip}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-raised/70 px-3 py-1 text-xs font-medium text-foreground-muted"
              >
                <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
                {chip}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Explore restaurants */}
      <section aria-labelledby="explore-heading" className="mt-14">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
          <h2
            id="explore-heading"
            className="text-2xl font-bold tracking-tight text-foreground"
          >
            Explore restaurants
          </h2>
          {state === 'ready' && restaurants.length > 0 ? (
            <p className="text-sm text-foreground-muted">
              <span className="font-semibold text-foreground">{restaurants.length}</span>{' '}
              {restaurants.length === 1 ? 'restaurant' : 'restaurants'}
              {activeSearch ? ` matching “${activeSearch}”` : ''}
            </p>
          ) : null}
        </div>

        {state === 'loading' ? (
          <div
            role="status"
            aria-label="Loading restaurants"
            className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
          >
            <span className="sr-only">Loading restaurants</span>
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} className="h-72" />
            ))}
          </div>
        ) : null}

        {state === 'error' ? (
          <div className="mt-6">
            <ErrorState onRetry={() => void load(activeSearch)} />
          </div>
        ) : null}

        {state === 'ready' && restaurants.length === 0 ? (
          <div className="mt-6">
            {activeSearch ? (
              <EmptyState
                headingLevel={3}
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
                headingLevel={3}
                title="No restaurants yet"
                description="Check back soon — new dining rooms are added regularly."
              />
            )}
          </div>
        ) : null}

        {state === 'ready' && restaurants.length > 0 ? (
          <ul className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {restaurants.map((restaurant) => (
              <li key={restaurant.id} className="h-full">
                <a
                  href={`/restaurants/${restaurant.slug}`}
                  aria-label={`Explore restaurant — ${restaurant.name}`}
                  className="group flex h-full flex-col overflow-hidden rounded-[20px] border border-border bg-surface shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0"
                >
                  <div className="relative aspect-[16/10] w-full overflow-hidden bg-surface-raised">
                    <RestaurantImage restaurant={restaurant} />
                    <div
                      aria-hidden="true"
                      className="absolute inset-0 bg-gradient-to-b from-background/60 via-transparent to-background/75"
                    />
                    <div className="absolute left-4 right-4 top-4 flex flex-wrap items-center gap-2">
                      {restaurant.cuisine ? (
                        <Badge variant="neutral">{restaurant.cuisine}</Badge>
                      ) : null}
                      {restaurant.price_range ? (
                        <Badge variant="info">
                          {'$'.repeat(Math.min(restaurant.price_range, 5))}
                        </Badge>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col gap-2 p-5">
                    <h3 className="text-lg font-semibold leading-snug tracking-tight text-foreground">
                      {restaurant.name}
                    </h3>
                    {restaurant.address ? (
                      <p className="text-sm text-foreground-muted">{restaurant.address}</p>
                    ) : null}
                    {restaurant.description ? (
                      <p className="line-clamp-3 text-sm text-foreground-muted">
                        {restaurant.description}
                      </p>
                    ) : null}
                    <span className="mt-auto flex items-center justify-between border-t border-border/60 pt-3 text-sm font-semibold text-primary">
                      Explore restaurant
                      <span
                        aria-hidden="true"
                        className="transition-transform duration-300 group-hover:translate-x-1 motion-reduce:transition-none motion-reduce:group-hover:translate-x-0"
                      >
                        →
                      </span>
                    </span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </>
  );
}
