import { renderToString } from 'react-dom/server';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StaffReservationsPage from '@/app/staff/reservations/page';
import StaffReservationDetailPage from '@/app/staff/reservations/[id]/page';
import { ReservationDetail } from '@/components/staff/ReservationDetail';
import { ReservationList } from '@/components/staff/ReservationList';
import {
  INITIAL_FILTERS,
  cancelReservation,
  dayStartIso,
  fetchReservations,
  listReservationsPath,
  type StaffReservation,
} from '@/lib/reservations-client';

/**
 * M7 Phase 3 render + client-helper tests (conventions: tests/reservations-ui
 * — node environment, renderToString; effects do not run, so pages and the
 * list assert their initial loading states with useAuth/useParams mocked,
 * while ReservationDetail renders a fixture in its loaded shape). The helper
 * tests pin the filter URL semantics (whole-local-day bounds, omitted
 * defaults) and the PATCH cancel contract without touching the database.
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

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '11111111-2222-4333-8444-555555555555' }),
}));

/** Render and strip React's SSR text-node markers for readable assertions. */
function render(ui: ReactElement): string {
  return renderToString(ui).replace(/<!-- -->/g, '');
}

const RESERVATION: StaffReservation = {
  id: '11111111-2222-4333-8444-555555555555',
  restaurant_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  user_id: 'guest-user-1',
  party_size: 4,
  starts_at: '2026-06-01T15:00:00.000Z',
  ends_at: '2026-06-01T17:00:00.000Z',
  status: 'confirmed',
  notes: 'Window seat',
  created_at: '2026-05-01T10:00:00.000Z',
  updated_at: '2026-05-01T10:00:00.000Z',
  reservation_tables: [
    { table_id: 'table-1', status: 'active' },
    { table_id: 'table-2', status: 'released' },
  ],
};

beforeEach(() => {
  authState.user = { email: 'staff@example.com' };
  authState.loading = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Staff reservations pages (initial render)', () => {
  it('list page renders its heading and loading state', () => {
    const html = render(<StaffReservationsPage />);
    expect(html).toContain('Reservations');
    expect(html).toContain('Loading reservations');
    expect(html).toContain('Back to dashboard');
  });

  it('detail page renders its heading and loading state', () => {
    const html = render(<StaffReservationDetailPage />);
    expect(html).toContain('Reservation details');
    expect(html).toContain('Loading reservation');
  });
});

describe('ReservationList (initial render)', () => {
  it('shows the filter controls alongside its skeleton', () => {
    const html = render(<ReservationList restaurantId="restaurant-1" />);
    expect(html).toContain('Filter reservations');
    expect(html).toContain('Status');
    expect(html).toContain('All statuses');
    expect(html).toContain('Refresh');
    expect(html).toContain('Loading reservations');
  });
});

describe('ReservationDetail', () => {
  it('renders the details, table list, and cancel action for a confirmed reservation', () => {
    const html = render(<ReservationDetail reservation={RESERVATION} />);
    expect(html).toContain('Back to reservations');
    expect(html).toContain('confirmed');
    expect(html).toContain('Details');
    expect(html).toContain('Party size');
    expect(html).toContain('Window seat');
    expect(html).toContain('11111111-2222-4333-8444-555555555555');
    expect(html).toContain('Tables');
    expect(html).toContain('table-1');
    expect(html).toContain('table-2');
    expect(html).toContain('Released');
    expect(html).toContain('Cancel reservation');
  });

  it('omits the cancel action for a terminal status', () => {
    const html = render(
      <ReservationDetail reservation={{ ...RESERVATION, status: 'cancelled' }} />,
    );
    expect(html).toContain('cancelled');
    expect(html).not.toContain('Cancel reservation');
  });
});

describe('listReservationsPath', () => {
  it('keeps only the restaurant scope and limit when filters are unset', () => {
    const path = listReservationsPath('restaurant-1', INITIAL_FILTERS);
    expect(path).toContain('restaurant_id=restaurant-1');
    expect(path).toContain('limit=100');
    expect(path).not.toContain('status=');
    expect(path).not.toContain('from=');
    expect(path).not.toContain('to=');
  });

  it('applies status and widens date picks to whole local days', () => {
    const path = listReservationsPath('restaurant-1', {
      status: 'confirmed',
      fromDate: '2027-01-05',
      toDate: '2027-01-07',
    });
    const params = new URL(path, 'https://example.test').searchParams;
    expect(params.get('status')).toBe('confirmed');

    const from = new Date(params.get('from') ?? '');
    expect(from.getFullYear()).toBe(2027);
    expect(from.getMonth()).toBe(0);
    expect(from.getDate()).toBe(5);
    expect(from.getHours()).toBe(0);
    expect(from.getMinutes()).toBe(0);

    const to = new Date(params.get('to') ?? '');
    expect(to.getFullYear()).toBe(2027);
    expect(to.getMonth()).toBe(0);
    expect(to.getDate()).toBe(7);
    expect(to.getHours()).toBe(23);
    expect(to.getMinutes()).toBe(59);
  });

  it('treats a malformed date key as unset', () => {
    expect(dayStartIso('not-a-date')).toBeNull();
    expect(dayStartIso('2027-01-05')).not.toBeNull();
  });
});

describe('fetchReservations', () => {
  it('requests the filtered list URL and returns the rows', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ reservations: [RESERVATION] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const rows = await fetchReservations('restaurant-1', INITIAL_FILTERS);

    expect(rows).toEqual([RESERVATION]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('restaurant_id=restaurant-1');
  });
});

describe('cancelReservation', () => {
  it('PATCHes { status: "cancelled" } and returns the updated record', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ reservation: { ...RESERVATION, status: 'cancelled' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const updated = await cancelReservation(RESERVATION.id);

    expect(updated.status).toBe('cancelled');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/reservations/${RESERVATION.id}`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ status: 'cancelled' });
  });
});
