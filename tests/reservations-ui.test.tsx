import { renderToString } from 'react-dom/server';
import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ReservationsPage from '@/app/reservations/page';
import ReservationDetailPage from '@/app/reservations/[id]/page';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { CancelDialog } from '@/components/reservations/CancelDialog';
import {
  ReservationItem,
  type ReservationRecord,
} from '@/components/reservations/ReservationItem';
import { ReservationList } from '@/components/reservations/ReservationList';

/**
 * Render tests for the M6 Phase 4 My Reservations UI (conventions: vitest,
 * renderToString in the node environment — effects do not run, so pages
 * and the list assert their initial loading states, components assert
 * their static markup, and the header link's auth visibility is driven
 * through a mocked useAuth).
 */

const authState = vi.hoisted(() => ({
  user: null as { email: string } | null,
  loading: false,
}));

vi.mock('@/components/auth/AuthProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/auth/AuthProvider')>();
  return {
    ...actual,
    useAuth: () => ({
      user: authState.user,
      loading: authState.loading,
      signOut: async () => {},
    }),
  };
});

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & ComponentPropsWithoutRef<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '11111111-2222-4333-8444-555555555555' }),
}));

/** Render and strip React's SSR text-node markers for readable assertions. */
function render(ui: ReactElement): string {
  return renderToString(ui).replace(/<!-- -->/g, '');
}

const RESERVATION: ReservationRecord = {
  id: '11111111-2222-4333-8444-555555555555',
  restaurant_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  party_size: 4,
  starts_at: '2026-06-01T15:00:00.000Z',
  ends_at: '2026-06-01T17:00:00.000Z',
  status: 'confirmed',
  notes: null,
  reservation_tables: [
    { table_id: 'table-1', status: 'active' },
    { table_id: 'table-2', status: 'active' },
  ],
};

beforeEach(() => {
  authState.user = null;
  authState.loading = false;
});

describe('SiteHeader My Reservations link', () => {
  it('shows the link for authenticated users', () => {
    authState.user = { email: 'guest@example.com' };
    const html = render(<SiteHeader />);
    expect(html).toContain('My Reservations');
    expect(html).toContain('href="/reservations"');
  });

  it('hides the link for signed-out visitors', () => {
    const html = render(<SiteHeader />);
    expect(html).not.toContain('My Reservations');
    expect(html).toContain('Log in');
  });

  it('hides the link while the session is still resolving', () => {
    authState.loading = true;
    const html = render(<SiteHeader />);
    expect(html).not.toContain('My Reservations');
  });
});

describe('ReservationItem', () => {
  it('renders time, party, tables, status badge, and actions', () => {
    const html = render(
      <ReservationItem
        reservation={RESERVATION}
        timeZone="UTC"
        restaurantName="Testaurant"
      />,
    );
    expect(html).toContain('Testaurant');
    expect(html).toContain('Mon, Jun 1, 2026 · 3:00 PM – 5:00 PM');
    expect(html).toContain('Party of 4');
    expect(html).toContain('2 tables');
    expect(html).toContain('confirmed');
    expect(html).toContain('View details');
    expect(html).toContain(`href="/reservations/${RESERVATION.id}"`);
    expect(html).toContain('Cancel reservation');
    expect(html).not.toContain('Yes, cancel it'); // dialog closed initially
  });

  it('omits the cancel action for terminal statuses', () => {
    const html = render(
      <ReservationItem
        reservation={{ ...RESERVATION, status: 'cancelled' }}
        timeZone="UTC"
      />,
    );
    expect(html).toContain('cancelled');
    expect(html).toContain('View details');
    expect(html).not.toContain('Cancel reservation');
    expect(html).not.toContain('Yes, cancel it');
  });
});

describe('CancelDialog', () => {
  it('renders the inline confirmation with both actions', () => {
    const html = render(
      <CancelDialog onConfirm={() => {}} onDismiss={() => {}} />,
    );
    expect(html).toContain('role="group"');
    expect(html).toContain('Cancel this reservation? This cannot be undone.');
    expect(html).toContain('Keep reservation');
    expect(html).toContain('Yes, cancel it');
  });

  it('surfaces API errors inline and marks the busy state', () => {
    const html = render(
      <CancelDialog busy error="Table is no longer available" onConfirm={() => {}} onDismiss={() => {}} />,
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Table is no longer available');
    expect(html).toContain('aria-busy="true"');
  });
});

describe('ReservationList', () => {
  it('shows its skeleton loading state first', () => {
    const html = render(<ReservationList />);
    expect(html).toContain('Loading reservations');
  });
});

describe('My Reservations pages (initial render)', () => {
  it('screen 11: list page renders its heading and loading state', () => {
    const html = render(<ReservationsPage />);
    expect(html).toContain('My Reservations');
    expect(html).toContain('Loading reservations');
  });

  it('screen 12: detail page renders its heading and loading state', () => {
    const html = render(<ReservationDetailPage />);
    expect(html).toContain('Reservation details');
    expect(html).toContain('Loading reservation');
  });
});
