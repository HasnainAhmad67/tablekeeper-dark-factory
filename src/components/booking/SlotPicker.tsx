import { formatSlotLabel, type TimeSlot } from '@/lib/booking';

/**
 * Slot radio group (plan screen 5/6 a11y: fieldset + legend + native radio
 * buttons, keyboard operable for free).
 *
 * Labels come from Intl via formatSlotLabel in the restaurant's timezone;
 * selection state is lifted to the page through `value`/`onChange`.
 */

export interface SlotPickerProps {
  /** Group label — becomes the <legend>, e.g. "Choose a time". */
  legend: string;
  slots: TimeSlot[];
  timeZone: string;
  /** Currently selected slot start (ISO), or null. */
  value: string | null;
  onChange: (startsAt: string) => void;
  /** Radio group name; unique per form. */
  name?: string;
  /** Copy for a day with no bookable slots. */
  emptyMessage?: string;
}

export function SlotPicker({
  legend,
  slots,
  timeZone,
  value,
  onChange,
  name = 'booking-slot',
  emptyMessage = 'No times available.',
}: SlotPickerProps) {
  return (
    <fieldset className="grid gap-2">
      <legend className="text-sm font-medium text-foreground">{legend}</legend>
      {slots.length === 0 ? (
        <p className="text-sm text-foreground-muted">{emptyMessage}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {slots.map((slot) => {
            const label = formatSlotLabel(slot.startsAt, timeZone);
            return (
              <label
                key={slot.startsAt}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground has-[:checked]:border-primary has-[:checked]:bg-surface-raised has-[:checked]:font-medium"
              >
                <input
                  type="radio"
                  name={name}
                  value={slot.startsAt}
                  checked={value === slot.startsAt}
                  onChange={() => onChange(slot.startsAt)}
                  className="size-4 accent-primary"
                />
                <span>{label}</span>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}
