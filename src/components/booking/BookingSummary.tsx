/**
 * Booking summary definition list (plan screens 7 and 10: reservation
 * details as label/value pairs). A semantic <dl> pairs each term with its
 * value so assistive tech announces them together.
 */

export interface BookingSummaryItem {
  term: string;
  value: string;
}

export interface BookingSummaryProps {
  items: BookingSummaryItem[];
  /** Optional heading rendered above the list. */
  heading?: string;
}

export function BookingSummary({ items, heading }: BookingSummaryProps) {
  return (
    <div className="rounded-lg border border-border bg-surface p-6">
      {heading ? (
        <h2 className="text-base font-semibold text-foreground">{heading}</h2>
      ) : null}
      <dl className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.term}>
            <dt className="text-xs font-medium uppercase tracking-wide text-foreground-muted">
              {item.term}
            </dt>
            <dd className="mt-0.5 text-sm text-foreground">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
