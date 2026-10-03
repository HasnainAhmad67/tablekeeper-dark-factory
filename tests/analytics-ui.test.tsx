import { renderToString } from 'react-dom/server';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StaffAnalyticsPage from '@/app/staff/analytics/page';
import { MetricsCards } from '@/components/staff/MetricsCards';
import { ReservationChart } from '@/components/staff/ReservationChart';
import {
  computeDailySeries,
  computeMetrics,
  computePopularTimes,
  csvFilename,
  fetchWindowStart,
  filterRowsInRange,
  toCsv,
  type AnalyticsMetrics,
  type AnalyticsReservation,
} from '@/lib/analytics-client';

/**
 * Analytics dashboard render + helper tests (conventions: tests/team-ui —
 * node environment, renderToString; effects do not run, so the page
 * asserts its initial loading state with useAuth mocked for the auth
 * guard).
 *
 * The metric tests pin exact buckets against a fixed clock (2026-10-03
 * 12:00 UTC): today/this week (trailing 7)/this month (trailing 30) in
 * the restaurant timezone, the zero-filled daily series, the 24-hour
 * popular-times histogram (including a Tokyo timezone check), the
 * range-window helpers that drive chart + CSV, and RFC 4180 CSV
 * escaping. Charts assert their accessible figure/role="img" summaries;
 * recharts draws the SVG client-side only.
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

const NOW = Date.UTC(2026, 9, 3, 12, 0, 0); // 2026-10-03T12:00:00Z
const TZ = 'UTC';

function row(id: string, startsAt: string, partySize = 2, notes: string | null = null): AnalyticsReservation {
  return {
    id,
    starts_at: startsAt,
    ends_at: startsAt,
    party_size: partySize,
    status: 'confirmed',
    notes,
  };
}

/** today / this week / this month / outside-30-days. */
const ROWS: AnalyticsReservation[] = [
  row('r1', '2026-10-03T09:00:00Z', 4),
  row('r2', '2026-10-01T18:00:00Z', 2),
  row('r3', '2026-09-15T12:00:00Z', 6),
  row('r4', '2026-08-20T12:00:00Z', 2),
];

beforeEach(() => {
  authState.user = { email: 'manager@example.com' };
  authState.loading = false;
});

describe('Analytics page (initial render)', () => {
  it('renders its heading, loading state, and back link', () => {
    const html = render(<StaffAnalyticsPage />);
    expect(html).toContain('Analytics');
    expect(html).toContain('Loading analytics');
    expect(html).toContain('Back to dashboard');
  });
});

describe('MetricsCards', () => {
  it('renders every card label with its value', () => {
    const metrics: AnalyticsMetrics = {
      total: 12,
      today: 2,
      week: 5,
      month: 9,
      avgPartySize: 3.5,
    };
    const html = render(<MetricsCards metrics={metrics} />);
    for (const label of ['Total', 'Today', 'This week', 'This month', 'Avg party size']) {
      expect(html).toContain(label);
    }
    for (const value of ['12', '2', '5', '9', '3.5']) {
      expect(html).toContain(value);
    }
  });

  it('shows an em dash for an empty average', () => {
    const metrics: AnalyticsMetrics = {
      total: 0,
      today: 0,
      week: 0,
      month: 0,
      avgPartySize: 0,
    };
    const html = render(<MetricsCards metrics={metrics} />);
    expect(html).toContain('—');
  });
});

describe('ReservationChart', () => {
  it('labels both figures with their data summaries', () => {
    const html = render(
      <ReservationChart
        daily={[
          { date: '2026-10-01', label: 'Oct 1', count: 2 },
          { date: '2026-10-02', label: 'Oct 2', count: 0 },
        ]}
        popular={[
          { hour: 9, count: 3 },
          { hour: 10, count: 0 },
        ]}
        range={7}
      />,
    );
    expect(html).toContain('Reservations per day');
    expect(html).toContain('Popular times — by hour of day');
    expect(html).toContain('role="img"');
    expect(html).toContain('Daily reservations over the last 7 days');
    expect(html).toContain('Oct 1: 2');
    expect(html).toContain('Popular times by hour of day');
    expect(html).toContain('9:00: 3');
    expect(html).not.toContain('10:00: 0');
  });
});

describe('computeMetrics', () => {
  it('buckets today, trailing-7, trailing-30, and range totals exactly', () => {
    expect(computeMetrics(ROWS, 30, NOW, TZ)).toEqual({
      total: 3,
      today: 1,
      week: 2,
      month: 3,
      avgPartySize: 4,
    });
  });

  it('recomputes total and average for the selected range', () => {
    expect(computeMetrics(ROWS, 7, NOW, TZ)).toEqual({
      total: 2,
      today: 1,
      week: 2,
      month: 3,
      avgPartySize: 3,
    });
    expect(computeMetrics([], 7, NOW, TZ)).toEqual({
      total: 0,
      today: 0,
      week: 0,
      month: 0,
      avgPartySize: 0,
    });
  });
});

describe('computeDailySeries', () => {
  it('zero-fills every day of the range ending today', () => {
    const series = computeDailySeries(ROWS, 7, NOW, TZ);
    expect(series).toHaveLength(7);
    expect(series[0].date).toBe('2026-09-27');
    expect(series[6].date).toBe('2026-10-03');
    expect(series[6].count).toBe(1);
    const oct1 = series.find((point) => point.date === '2026-10-01');
    expect(oct1?.count).toBe(1);
    const sep28 = series.find((point) => point.date === '2026-09-28');
    expect(sep28?.count).toBe(0);
    for (const point of series) {
      expect(point.label.length).toBeGreaterThan(0);
    }
  });

  it('drops rows outside the selected range', () => {
    const series7 = computeDailySeries(ROWS, 7, NOW, TZ);
    expect(series7.reduce((sum, point) => sum + point.count, 0)).toBe(2);
    const series90 = computeDailySeries(ROWS, 90, NOW, TZ);
    expect(series90.reduce((sum, point) => sum + point.count, 0)).toBe(4);
  });
});

describe('computePopularTimes', () => {
  it('histograms reservations by local hour and zero-fills the day', () => {
    const popular = computePopularTimes(ROWS, 30, NOW, TZ);
    expect(popular).toHaveLength(24);
    expect(popular[9].count).toBe(1);
    expect(popular[18].count).toBe(1);
    expect(popular[12].count).toBe(1);
    expect(popular[0].count).toBe(0);
  });

  it('buckets hours in the restaurant timezone', () => {
    // 2026-10-03 09:00 UTC is 18:00 in Asia/Tokyo.
    const popular = computePopularTimes([ROWS[0]], 7, NOW, 'Asia/Tokyo');
    expect(popular[18].count).toBe(1);
    expect(popular[9].count).toBe(0);
  });
});

describe('range windows and CSV export', () => {
  it('extends the fetch window to at least 30 days', () => {
    expect(fetchWindowStart(7, NOW)).toBe(NOW - 30 * 86_400_000);
    expect(fetchWindowStart(30, NOW)).toBe(NOW - 30 * 86_400_000);
    expect(fetchWindowStart(90, NOW)).toBe(NOW - 90 * 86_400_000);
  });

  it('slices rows to the selected range for chart and CSV', () => {
    expect(filterRowsInRange(ROWS, 7, NOW).map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(filterRowsInRange(ROWS, 90, NOW)).toHaveLength(4);
  });

  it('renders RFC 4180 CSV with escaped cells', () => {
    const csv = toCsv([
      row('r1', '2026-10-03T09:00:00Z', 4, 'Party of 4, "window" seat'),
      row('r2', '2026-10-01T18:00:00Z', 2, null),
    ]);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('"id","starts_at","ends_at","party_size","status","notes"');
    expect(lines[1]).toBe(
      '"r1","2026-10-03T09:00:00Z","2026-10-03T09:00:00Z","4","confirmed","Party of 4, ""window"" seat"',
    );
    expect(lines[2]).toBe(
      '"r2","2026-10-01T18:00:00Z","2026-10-01T18:00:00Z","2","confirmed",""',
    );
    expect(lines).toHaveLength(3);
  });

  it('stamps the export filename with range and UTC date', () => {
    expect(csvFilename(7, NOW)).toBe('reservations-7d-2026-10-03.csv');
    expect(csvFilename(90, NOW)).toBe('reservations-90d-2026-10-03.csv');
  });
});
