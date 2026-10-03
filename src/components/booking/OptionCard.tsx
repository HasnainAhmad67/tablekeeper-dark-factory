import { Badge } from '@/components/ui/Badge';
import type { AvailabilityOption } from '@/lib/booking';

/**
 * One selectable availability option (plan screen 6: "Choose table/group" —
 * a radio group with keyboard navigation; native inputs provide both).
 *
 * The card is a <label> wrapping the radio, so clicking anywhere in the card
 * toggles the option. Kind, capacity, and fit are text — never color alone.
 */

export interface OptionCardProps {
  option: AvailabilityOption;
  checked: boolean;
  onChange: () => void;
  /** Radio group name; unique per form. */
  name?: string;
}

function fitLabel(option: AvailabilityOption): string {
  if (option.surplus > 0) {
    return `${option.surplus} spare seat${option.surplus === 1 ? '' : 's'}`;
  }
  return 'Perfect fit';
}

export function OptionCard({ option, checked, onChange, name = 'availability-option' }: OptionCardProps) {
  const kindLabel = option.kind === 'group' ? 'Group' : 'Table';

  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface p-4 has-[:checked]:border-primary has-[:checked]:bg-surface-raised">
      <input
        type="radio"
        name={name}
        value={option.id}
        checked={checked}
        onChange={onChange}
        className="mt-1 size-4 accent-primary"
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <Badge variant={option.kind === 'group' ? 'info' : 'neutral'}>{kindLabel}</Badge>
          <span className="text-sm font-semibold text-foreground">{option.label}</span>
        </span>
        <span className="mt-1 block text-sm text-foreground-muted">
          Seats {option.capacity} · {fitLabel(option)}
        </span>
      </span>
    </label>
  );
}
