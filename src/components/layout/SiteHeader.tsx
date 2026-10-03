"use client";

import Link from 'next/link';
import * as navigation from 'next/navigation';

import { useAuth } from '@/components/auth/AuthProvider';
import { RestaurantSwitcher } from '@/components/RestaurantSwitcher';
import { Button } from '@/components/ui/Button';

/**
 * Auth-aware site header. Renders guest links (Log in / Sign up) or the
 * signed-in navigation (My Reservations, email + Sign out) from the cookie
 * session via AuthProvider. While the session resolves, auth-dependent
 * items are omitted (no layout shift, no stale flash) — the My Reservations
 * link is therefore visible only to authenticated users.
 *
 * Multi-restaurant: on staff pages (/staff and its subroutes) the
 * authenticated branch also mounts the RestaurantSwitcher. The pathname is
 * read through a guarded usePathname because tests render this header
 * against a next/navigation mock that exposes only useParams and throws on
 * any other export access (tests/reservations-ui.test.tsx) — a failed read
 * degrades to null, which hides the switcher and keeps the guest/staff
 * markup assertions unchanged.
 */

const NAV_LINK_CLASSES =
  'rounded-md px-3 py-2 text-sm text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground';

/**
 * Current pathname, or null when unavailable. The mock's property access
 * throws before any hook registers, so the catch cannot leave React with a
 * half-initialized hook — in the real app the read simply succeeds.
 */
function readPathname(): string | null {
  try {
    return navigation.usePathname();
  } catch {
    return null;
  }
}

/** Staff surfaces: /staff plus every subroute (analytics, tables, team, ...). */
function isStaffPath(pathname: string | null): boolean {
  return pathname !== null && (pathname === '/staff' || pathname.startsWith('/staff/'));
}

export function SiteHeader() {
  const { user, loading, signOut } = useAuth();
  const onStaffPage = isStaffPath(readPathname());

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Composable Floor
        </Link>
        <nav aria-label="Primary" className="flex flex-wrap items-center gap-1">
          <Link href="/restaurants" className={NAV_LINK_CLASSES}>
            Restaurants
          </Link>
          {loading ? null : user ? (
            <>
              {onStaffPage ? <RestaurantSwitcher /> : null}
              <Link href="/reservations" className={NAV_LINK_CLASSES}>
                My Reservations
              </Link>
              <span className="px-2 text-sm text-foreground-muted">{user.email ?? 'Signed in'}</span>
              <Button
                variant="ghost"
                onClick={() => {
                  void signOut();
                }}
              >
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Link href="/login" className={NAV_LINK_CLASSES}>
                Log in
              </Link>
              <Link
                href="/signup"
                className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
