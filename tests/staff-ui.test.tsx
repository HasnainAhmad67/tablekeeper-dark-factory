import { renderToString } from 'react-dom/server';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StaffPage from '@/app/staff/page';
import { StaffOverview } from '@/components/staff/StaffOverview';
import { OVERVIEW_WINDOW_HOURS, localDayCount, overviewWindow } from '@/lib/staff';

/**
 * M7 Phase 1 render + helper tests (conventions: tests/reservations-ui —
 * node environment, renderToString; effects do not run, so the page and
 * overview assert their initial loading states, with useAuth mocked for
 * the page's auth guard).
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

/** Render and strip React's SSR text-node markers for readable assertions. */
function render(ui: ReactElement): string {
  return renderToString(ui).replace(/<!-- -->/g, '');
}

beforeEach(() => {
  authState.user = { email: 'staff@example.com' };
  authState.loading = false;
});

describe('Staff dashboard page (initial render)', () => {
  it('renders its heading and loading state', () => {
    const html = render(<StaffPage />);
    expect(html).toContain('Staff Dashboard');
    expect(html).toContain('Loading dashboard');
  });
});

describe('StaffOverview (initial render)', () => {
  it('shows its skeleton loading state first', () => {
    const html = render(<StaffOverview />);
    expect(html).toContain('Loading dashboard');
  });
});

describe('localDayCount', () => {
  const NOW = Date.parse('2026-06-01T18:00:00Z');

  it('counts rows starting on today in the given timezone', () => {
    // NOW is 14:00 on 2026-06-01 in America/New_York (EDT, UTC-4).
    const rows = [
      { starts_at: '2026-06-01T15:00:00.000Z' }, // 11:00 local Jun 1 → count
      { starts_at: '2026-06-02T01:00:00.000Z' }, // 21:00 local Jun 1 → count
      { starts_at: '2026-06-02T05:00:00.000Z' }, // 01:00 local Jun 2 → skip
    ];
    const result = localDayCount(rows, NOW, 'America/New_York');
    expect(result.dateKey).toBe('2026-06-01');
    expect(result.count).toBe(2);
  });

  it('returns a zero count and null dateKey for an invalid timezone', () => {
    const result = localDayCount([{ starts_at: '2026-06-01T15:00:00Z' }], NOW, 'Not/AZone');
    expect(result).toEqual({ count: 0, dateKey: null });
  });
});

describe('overviewWindow', () => {
  it('spans the configured window symmetrically around now', () => {
    const now = Date.parse('2026-06-01T18:00:00Z');
    const { from, to } = overviewWindow(now);
    const spanMs = OVERVIEW_WINDOW_HOURS * 60 * 60 * 1000;
    expect(Date.parse(from)).toBe(now - spanMs);
    expect(Date.parse(to)).toBe(now + spanMs);
  });
});
