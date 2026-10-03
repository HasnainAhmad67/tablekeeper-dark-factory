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
 *
 * Brand: the "/" link carries an aria-label and a 36px dark-gradient
 * concierge-bell mark (inline SVG — no icon dependency). The mark is
 * decorative (aria-hidden); the link's aria-label contains the visible
 * brand text (WCAG 2.5.3 label-in-name), and hover/focus motion is
 * disabled under reduced motion.
 *
 * Public nav: "Our Team" (/team) sits beside Restaurants. Its active
 * state reuses the same guarded pathname read as the switcher (single
 * call per render, null in tests), so no additional pathname plumbing
 * exists purely for styling.
 */

const NAV_LINK_CLASSES =
  'rounded-md px-3 py-2 text-sm text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground';

/** Brand link: text label plus a 36px dark-gradient identity mark. */
const BRAND_LINK_CLASSES =
  'group -m-1 inline-flex items-center gap-2.5 rounded-full p-1 text-lg font-semibold tracking-tight';

/** Mark shell: dark gradient disc, hairline ring, warm inner glow. */
const BRAND_MARK_CLASSES =
  'relative flex size-9 shrink-0 items-center justify-center rounded-full ring-1 ring-border transition-transform duration-300 group-hover:scale-105 group-hover:-rotate-3 group-hover:ring-primary/40 group-focus-visible:scale-105 group-focus-visible:ring-primary/40 motion-reduce:transition-none motion-reduce:group-hover:rotate-0 motion-reduce:group-hover:scale-100 motion-reduce:group-focus-visible:scale-100';

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
  const pathname = readPathname();
  const onStaffPage = isStaffPath(pathname);
  const onTeamPage = pathname === '/team';

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-4 sm:px-6">
        <Link href="/" aria-label="Composable Floor home" className={BRAND_LINK_CLASSES}>
          <span aria-hidden="true" className={BRAND_MARK_CLASSES}>
            <span className="absolute inset-0 rounded-full bg-primary/10" />
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              focusable="false"
              className="relative size-4 text-primary"
            >
              {/* Concierge bell: dome, base plate, stem, knob, clapper. */}
              <path d="M4 16h16" />
              <path d="M5.5 16a6.5 6.5 0 0 1 13 0" />
              <path d="M12 6V9.5" />
              <path d="M10.75 19.5h2.5" />
              <circle cx="12" cy="4.25" r="1.1" />
            </svg>
          </span>
          <span>Composable Floor</span>
        </Link>
        <nav aria-label="Primary" className="flex flex-wrap items-center gap-1">
          <Link href="/restaurants" className={NAV_LINK_CLASSES}>
            Restaurants
          </Link>
          <Link
            href="/team"
            className={
              onTeamPage ? `${NAV_LINK_CLASSES} bg-surface-raised font-medium text-foreground` : NAV_LINK_CLASSES
            }
            aria-current={onTeamPage ? 'page' : undefined}
          >
            Our Team
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
