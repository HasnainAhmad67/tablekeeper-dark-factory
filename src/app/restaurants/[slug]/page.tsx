"use client";

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { WEEKDAY_NAMES, formatClock, type OperatingHoursRow } from '@/lib/booking';

/**
 * Screen 3 — restaurant detail (plan Screen Map §G: slug URL, public read
 * through GET /api/restaurants/[slug], hours table, booking CTA; photos
 * intentionally omitted per plan decision).
 */

interface RestaurantDetail {
  id: string;
  name: string;
  slug: string;
  cuisine: string | null;
  price_range: string | null;
  description: string | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  timezone: string;
  operating_hours: OperatingHoursRow[];
}

type LoadPhase = 'loading' | 'ready' | 'error' | 'notfound';

const PRIMARY_LINK_CLASSES =
  'inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90';

export default function RestaurantDetailPage() {
  const params = useParams<{ slug: string }>();
  const slug = params?.slug ?? '';
  const [phase, setPhase] = useState<LoadPhase>('loading');
  const [restaurant, setRestaurant] = useState<RestaurantDetail | null>(null);

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
      if (!body.restaurant) {
        setPhase('notfound');
        return;
      }
      setRestaurant(body.restaurant);
      setPhase('ready');
    } catch {
      setPhase('error');
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  if (phase === 'loading') {
    return (
      <div role="status" className="grid gap-4">
        <span className="sr-only">Loading restaurant</span>
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40 max-w-md" />
      </div>
    );
  }

  if (phase === 'error') {
    return <ErrorState onRetry={() => void load()} />;
  }

  if (phase === 'notfound' || !restaurant) {
    return (
      <EmptyState
        title="Restaurant not found"
        description="It may have moved, or the link may be incorrect."
        action={
          <Button variant="secondary" onClick={() => { window.location.href = '/restaurants'; }}>
            Browse restaurants
          </Button>
        }
      />
    );
  }

  const hoursByDay = new Map<number, OperatingHoursRow>(
    restaurant.operating_hours.map((row) => [row.day_of_week, row]),
  );

  return (
    <article>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-3xl font-bold text-foreground">{restaurant.name}</h1>
        <div className="flex flex-wrap gap-2">
          {restaurant.cuisine ? <Badge variant="info">{restaurant.cuisine}</Badge> : null}
          {restaurant.price_range ? <Badge variant="neutral">{restaurant.price_range}</Badge> : null}
        </div>
      </div>

      {restaurant.description ? (
        <p className="mt-4 max-w-2xl text-sm leading-6 text-foreground-muted">
          {restaurant.description}
        </p>
      ) : null}

      {restaurant.address || restaurant.phone || restaurant.website ? (
        <dl className="mt-6 grid gap-4 sm:grid-cols-3">
          {restaurant.address ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
                Address
              </dt>
              <dd className="mt-1 text-sm text-foreground">{restaurant.address}</dd>
            </div>
          ) : null}
          {restaurant.phone ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
                Phone
              </dt>
              <dd className="mt-1 text-sm text-foreground">{restaurant.phone}</dd>
            </div>
          ) : null}
          {restaurant.website ? (
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
                Website
              </dt>
              <dd className="mt-1 text-sm">
                <a
                  href={restaurant.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline-offset-4 hover:underline"
                >
                  {restaurant.website}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <section aria-labelledby="hours-heading" className="mt-10">
        <h2 id="hours-heading" className="text-lg font-semibold text-foreground">
          Hours
        </h2>
        <table className="mt-3 w-full max-w-md text-sm">
          <caption className="sr-only">Weekly opening hours</caption>
          <thead>
            <tr className="border-b border-border text-left">
              <th scope="col" className="py-2 font-medium text-foreground-muted">Day</th>
              <th scope="col" className="py-2 font-medium text-foreground-muted">Hours</th>
            </tr>
          </thead>
          <tbody>
            {WEEKDAY_NAMES.map((dayName, index) => {
              const row = hoursByDay.get(index);
              const closed = !row || row.is_closed === true;
              return (
                <tr key={dayName} className="border-b border-border/60">
                  <th scope="row" className="py-2 text-left font-normal text-foreground">
                    {dayName}
                  </th>
                  <td className="py-2 text-foreground-muted">
                    {closed
                      ? 'Closed'
                      : `${formatClock(row.opens_at)} – ${formatClock(row.closes_at)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-sm text-foreground-muted">
          Times shown in {restaurant.timezone} time.
        </p>
      </section>

      <div className="mt-8">
        <a href={`/restaurants/${encodeURIComponent(restaurant.slug)}/book`} className={PRIMARY_LINK_CLASSES}>
          Book a table
        </a>
      </div>
    </article>
  );
}
