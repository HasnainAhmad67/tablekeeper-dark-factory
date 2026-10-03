import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import type { AnalyticsRange, DailyPoint, PopularHour } from '@/lib/analytics-client';

/**
 * Charts for the analytics dashboard: daily reservation volume over the
 * selected range, plus the popular-times histogram by local hour of day
 * (plan line 182 "Peak-time analytics [FUTURE]" — shipped here as part
 * of the authorized prototype slice).
 *
 * Accessibility: each chart is a labelled figure — the wrapper carries
 * role="img" and an aria-label containing the full data summary, so
 * screen readers get the numbers without inspecting SVG; the visible
 * captions give the sighted headings. Series and grid use currentColor /
 * text tokens, so charts inherit the design palette (bars render in the
 * surrounding text-primary color). The X-axis preserves the first/last
 * ticks so 90-day ranges stay readable. Recharts measures its container
 * client-side; the dashboard's data always arrives in an effect, so the
 * charts never render on the server.
 *
 * Keyboard users reach everything through the page's range buttons and
 * export action — the figures themselves are informational images, not
 * controls.
 */

export interface ReservationChartProps {
  daily: DailyPoint[];
  popular: PopularHour[];
  range: AnalyticsRange;
}

function dailySummary(daily: DailyPoint[]): string {
  if (daily.length === 0) {
    return 'no data';
  }
  return daily.map((point) => `${point.label}: ${point.count}`).join(', ');
}

function popularSummary(popular: PopularHour[]): string {
  const nonZero = popular.filter((point) => point.count > 0);
  if (nonZero.length === 0) {
    return 'no data';
  }
  return nonZero.map((point) => `${point.hour}:00: ${point.count}`).join(', ');
}

export function ReservationChart({ daily, popular, range }: ReservationChartProps) {
  return (
    <div className="grid gap-6">
      <figure className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <figcaption className="text-sm font-medium text-foreground">
          Reservations per day
        </figcaption>
        <div
          role="img"
          aria-label={`Daily reservations over the last ${range} days — ${dailySummary(daily)}`}
          className="mt-3 h-64 w-full text-primary"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={daily} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.2} />
              <XAxis
                dataKey="label"
                interval="preserveStartEnd"
                tick={{ fontSize: 11 }}
                tickLine={false}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} width={32} />
              <Tooltip />
              <Bar dataKey="count" fill="currentColor" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>

      <figure className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <figcaption className="text-sm font-medium text-foreground">
          Popular times — by hour of day
        </figcaption>
        <div
          role="img"
          aria-label={`Popular times by hour of day over the last ${range} days — ${popularSummary(popular)}`}
          className="mt-3 h-56 w-full text-primary"
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={popular} margin={{ top: 4, right: 8, bottom: 0, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" opacity={0.2} />
              <XAxis
                dataKey="hour"
                interval={2}
                tickFormatter={(hour: number) => `${hour}:00`}
                tick={{ fontSize: 11 }}
                tickLine={false}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} tickLine={false} width={32} />
              <Tooltip
                formatter={(value) => [`${value} reservations`, 'Bookings']}
                labelFormatter={(hour) => `${hour}:00`}
              />
              <Bar dataKey="count" fill="currentColor" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </figure>
    </div>
  );
}
