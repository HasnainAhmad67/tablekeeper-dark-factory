import { useState, type FormEvent } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import {
  DAYS_OF_WEEK,
  validateHoursForm,
  type HoursFieldErrors,
  type OperatingHour,
} from '@/lib/hours-client';

/**
 * Operating-hours editor (plan screen 28, "Form labels" a11y).
 *
 * Seven day rows in Sun-Sat order, each a fieldset/legend group (the same
 * native-controls pattern as TableForm): labelled Opens/Closes time inputs
 * plus a "Closed" checkbox. The time inputs stay enabled on closed days —
 * the schema CHECK (closes_at > opens_at) applies to every row regardless
 * of is_closed, so the stored values must stay valid.
 *
 * Validation runs on submit against the same rules as the API (valid
 * times, closes_at > opens_at, no overnight hours) and surfaces through
 * Field's role="alert" wiring without moving focus. There is deliberately
 * no focus-on-mount effect: the form is mounted for the page's lifetime
 * (unlike TableForm's create/edit modes), so stealing focus on load would
 * disorient keyboard users landing from the top of the page.
 */

export interface HoursFormProps {
  /** Current rows used to seed the form (loaded or just saved). */
  initialHours: OperatingHour[];
  /** True while the save request is in flight. */
  busy?: boolean;
  /** Inline submit error from the API (role="alert"). */
  error?: string | null;
  onSubmit: (hours: OperatingHour[]) => void;
}

export function HoursForm({ initialHours, busy = false, error = null, onSubmit }: HoursFormProps) {
  // Keep Sun-Sat display order regardless of how the rows arrived.
  const [values, setValues] = useState<OperatingHour[]>(() =>
    [...initialHours].sort((a, b) => a.day_of_week - b.day_of_week),
  );
  const [errors, setErrors] = useState<HoursFieldErrors>({});

  function update(day: number, patch: Partial<OperatingHour>) {
    setValues((previous) =>
      previous.map((row) => (row.day_of_week === day ? { ...row, ...patch } : row)),
    );
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateHoursForm(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    onSubmit(values);
  }

  return (
    <form
      aria-labelledby="hours-form-heading"
      onSubmit={handleSubmit}
      className="grid gap-4 rounded-lg border border-border bg-surface p-4"
    >
      <h2 id="hours-form-heading" className="text-lg font-semibold text-foreground">
        Edit hours
      </h2>

      {error ? <Alert variant="error">{error}</Alert> : null}

      <div className="grid gap-3">
        {values.map((row) => {
          const day = DAYS_OF_WEEK[row.day_of_week];
          if (!day) {
            return null;
          }
          const dayKey = day.short;
          return (
            <fieldset key={day.value} className="min-w-0 border-0 p-0">
              <legend className="text-sm font-medium text-foreground">{day.name}</legend>
              <div className="mt-1.5 flex flex-wrap items-end gap-4">
                <Field
                  id={`hours-${dayKey}-opens`}
                  label="Opens"
                  type="time"
                  value={row.opens_at}
                  error={errors[`${dayKey}-opens`]}
                  onChange={(event) => update(row.day_of_week, { opens_at: event.target.value })}
                />
                <Field
                  id={`hours-${dayKey}-closes`}
                  label="Closes"
                  type="time"
                  value={row.closes_at}
                  error={errors[`${dayKey}-closes`]}
                  onChange={(event) => update(row.day_of_week, { closes_at: event.target.value })}
                />
                <label
                  htmlFor={`hours-${dayKey}-closed`}
                  className="flex items-center gap-2 pb-2 text-sm font-medium text-foreground"
                >
                  <input
                    type="checkbox"
                    id={`hours-${dayKey}-closed`}
                    checked={row.is_closed}
                    onChange={(event) => update(row.day_of_week, { is_closed: event.target.checked })}
                    className="size-4 accent-primary"
                  />
                  Closed
                </label>
              </div>
            </fieldset>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={busy}>
          Save hours
        </Button>
      </div>
    </form>
  );
}

/**
 * Read-only preview of the stored hours shown above the editor (plan:
 * "Show current hours as read-only preview before editing"). A restaurant
 * with no hours rows gets the standard EmptyState instead of an empty
 * table.
 */
export function HoursPreview({ hours }: { hours: OperatingHour[] }) {
  if (hours.length === 0) {
    return (
      <EmptyState
        title="No operating hours"
        description="This restaurant has no hours set yet. Save the form below to open it for booking."
      />
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold text-foreground">Current hours</h2>
      <table className="mt-3 w-full border-collapse text-sm">
        <caption className="sr-only">Current operating hours by day</caption>
        <thead>
          <tr className="border-b border-border text-left text-foreground-muted">
            <th scope="col" className="py-2 pr-4 font-medium">
              Day
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Opens
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              Closes
            </th>
            <th scope="col" className="py-2 font-medium">
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {hours.map((row) => {
            const day = DAYS_OF_WEEK[row.day_of_week];
            return (
              <tr key={row.day_of_week} className="border-b border-border">
                <th scope="row" className="py-2 pr-4 text-left font-medium text-foreground">
                  {day ? day.name : `Day ${row.day_of_week}`}
                </th>
                <td className="py-2 pr-4 text-foreground-muted">{row.opens_at}</td>
                <td className="py-2 pr-4 text-foreground-muted">{row.closes_at}</td>
                <td className="py-2 text-foreground-muted">
                  {row.is_closed ? 'Closed' : 'Open'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
