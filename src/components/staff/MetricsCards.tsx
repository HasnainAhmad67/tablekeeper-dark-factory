import { Card } from '@/components/ui/Card';
import type { AnalyticsMetrics } from '@/lib/analytics-client';

/**
 * Headline metric cards for the analytics dashboard (plan line 944
 * prototype): total reservations in the selected range, today / this
 * week / this month buckets (week = trailing 7 days, month = trailing
 * 30 days — see analytics-client), and the average party size over the
 * range (the decisions' fifth metric; empty ranges show an em dash).
 *
 * Pure presentation: the page computes the numbers, this component
 * renders them as labelled cards with tabular numerals so values align
 * across the grid. Stack on mobile, five-up on wide screens; M6/M7 Card
 * and color tokens only.
 */

const CARDS: { key: keyof AnalyticsMetrics; label: string }[] = [
  { key: 'total', label: 'Total' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'avgPartySize', label: 'Avg party size' },
];

function formatValue(key: keyof AnalyticsMetrics, value: number): string {
  if (key === 'avgPartySize') {
    if (value <= 0) {
      return '—';
    }
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }
  return String(value);
}

export interface MetricsCardsProps {
  metrics: AnalyticsMetrics;
}

export function MetricsCards({ metrics }: MetricsCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {CARDS.map((card) => (
        <Card key={card.key}>
          <p className="text-sm text-foreground-muted">{card.label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">
            {formatValue(card.key, metrics[card.key])}
          </p>
        </Card>
      ))}
    </div>
  );
}
