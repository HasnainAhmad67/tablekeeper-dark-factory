import { useEffect, useRef, useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  WAITLIST_STATUS_LABELS,
  type WaitlistEntry,
  type WaitlistStatus,
} from '@/lib/waitlist-client';
import type { StaffTable } from '@/lib/tables-client';

/**
 * One waitlist row (plan screen 23, "List semantics" a11y).
 *
 * A waiting party shows its queue position, party size, contact details,
 * and a status badge (text carries the meaning, never colour alone), with
 * the screen's actions: Seat (open the table picker for the conversion to
 * a reservation), Move up/Move down (queue position), Cancel/Mark no-show
 * (status changes), and Remove (delete confirmation). Seated/cancelled/
 * no-show rows keep their badge and only offer Remove so finished records
 * can be cleared.
 *
 * Both secondary panels follow the TableItem/GroupItem conventions: the
 * destructive Remove confirmation puts the safe default ("Keep entry")
 * first so Enter never removes, Escape dismisses, and the seating picker
 * validates at least one table before calling the API. In read-only state
 * (a write returned 403) every affordance is hidden. Stack on mobile:
 * every row/panel wraps.
 */

const STATUS_BADGES: Record<WaitlistStatus, BadgeVariant> = {
  waiting: 'info',
  seated: 'success',
  cancelled: 'neutral',
  no_show: 'danger',
};

export interface WaitlistItemProps {
  entry: WaitlistEntry;
  /** Hides every write affordance (403 read-only state). */
  readOnly?: boolean;
  /** Queue bounds — false disables the move button at either end. */
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  /** True while this row's remove confirmation is open. */
  confirming?: boolean;
  /** True while this row's seating panel is open. */
  seating?: boolean;
  /** Restaurant tables offered in the seating picker. */
  tables?: StaffTable[];
  /** True while this row's write request is in flight. */
  busy?: boolean;
  /** Inline error for the open panel (seat/remove). */
  error?: string | null;
  onMove: (entry: WaitlistEntry, direction: 'up' | 'down') => void;
  onSeat: (entry: WaitlistEntry) => void;
  onCancelSeat: () => void;
  onConfirmSeat: (entry: WaitlistEntry, tableIds: string[]) => void;
  onStatus: (entry: WaitlistEntry, status: WaitlistStatus) => void;
  onAskRemove: (entry: WaitlistEntry) => void;
  onConfirmRemove: (entry: WaitlistEntry) => void;
  onCancelRemove: () => void;
}

export function WaitlistItem({
  entry,
  readOnly = false,
  canMoveUp = false,
  canMoveDown = false,
  confirming = false,
  seating = false,
  tables = [],
  busy = false,
  error = null,
  onMove,
  onSeat,
  onCancelSeat,
  onConfirmSeat,
  onStatus,
  onAskRemove,
  onConfirmRemove,
  onCancelRemove,
}: WaitlistItemProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [seatError, setSeatError] = useState<string | null>(null);

  // Reset the table selection whenever the seating panel opens or closes.
  useEffect(() => {
    setSelectedTables([]);
    setSeatError(null);
  }, [seating]);

  // Focus the first (safe) button when a panel opens.
  useEffect(() => {
    if (confirming || seating) {
      panelRef.current?.querySelector('button')?.focus();
    }
  }, [confirming, seating]);

  function toggleTable(tableId: string, checked: boolean) {
    setSeatError(null);
    setSelectedTables((previous) =>
      checked ? [...previous, tableId] : previous.filter((id) => id !== tableId),
    );
  }

  function handleConfirmSeat() {
    if (selectedTables.length === 0) {
      setSeatError('Select at least one table.');
      return;
    }
    onConfirmSeat(entry, selectedTables);
  }

  if (seating) {
    return (
      <li>
        <div
          ref={panelRef}
          role="group"
          aria-label={`Seat ${entry.name}`}
          className="rounded-md border border-border bg-surface p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !busy) {
              onCancelSeat();
            }
          }}
        >
          <p className="text-sm font-semibold text-foreground">
            Seat &ldquo;{entry.name}&rdquo; &mdash; party of {entry.party_size}
          </p>
          <p className="mt-0.5 text-xs text-foreground-muted">
            Books the selected tables for the next two hours.
          </p>
          {error ? (
            <div className="mt-2">
              <Alert variant="error">{error}</Alert>
            </div>
          ) : null}

          <fieldset className="mt-3 min-w-0 border-0 p-0">
            <legend className="text-sm font-medium text-foreground">Tables</legend>
            {tables.length === 0 ? (
              <p className="mt-1.5 text-sm text-foreground-muted">
                No tables available yet — add tables first.
              </p>
            ) : (
              <div className="mt-1.5 grid gap-2">
                {tables.map((table) => (
                  <label
                    key={table.id}
                    htmlFor={`waitlist-seat-${table.id}`}
                    className="flex items-center gap-2 text-sm text-foreground"
                  >
                    <input
                      type="checkbox"
                      id={`waitlist-seat-${table.id}`}
                      checked={selectedTables.includes(table.id)}
                      onChange={(event) => toggleTable(table.id, event.target.checked)}
                      className="size-4 accent-primary"
                    />
                    {table.label}
                    <span className="text-foreground-muted">
                      &middot; {table.capacity} seats
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          {seatError ? (
            <div className="mt-2">
              <Alert variant="error">{seatError}</Alert>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-3">
            <Button variant="secondary" disabled={busy} onClick={onCancelSeat}>
              Cancel
            </Button>
            <Button loading={busy} disabled={tables.length === 0} onClick={handleConfirmSeat}>
              Confirm seating
            </Button>
          </div>
        </div>
      </li>
    );
  }

  if (confirming) {
    return (
      <li>
        <div
          ref={panelRef}
          role="group"
          aria-label={`Confirm removal of ${entry.name}`}
          className="rounded-md border border-danger/40 bg-danger/10 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !busy) {
              onCancelRemove();
            }
          }}
        >
          <p className="text-sm font-medium text-foreground">
            Remove &ldquo;{entry.name}&rdquo; from the waitlist? This cannot be undone.
          </p>
          {error ? (
            <div className="mt-2">
              <Alert variant="error">{error}</Alert>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-3">
            <Button variant="secondary" disabled={busy} onClick={onCancelRemove}>
              Keep entry
            </Button>
            <Button variant="danger" loading={busy} onClick={() => onConfirmRemove(entry)}>
              Yes, remove it
            </Button>
          </div>
        </div>
      </li>
    );
  }

  const isWaiting = entry.status === 'waiting';

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">
          {entry.name}
          {isWaiting ? (
            <span className="ml-2 text-xs font-normal text-foreground-muted">
              #{entry.position} in line
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-foreground-muted">
          Party of {entry.party_size}
          {entry.phone ? (
            <>
              {' '}
              &middot;{' '}
              <a
                href={`tel:${entry.phone}`}
                className="underline underline-offset-4 hover:text-foreground"
              >
                {entry.phone}
              </a>
            </>
          ) : null}
        </p>
        {entry.notes ? (
          <p className="mt-0.5 text-xs text-foreground-muted">{entry.notes}</p>
        ) : null}
        <div className="mt-1.5">
          <Badge variant={STATUS_BADGES[entry.status]}>
            {WAITLIST_STATUS_LABELS[entry.status]}
          </Badge>
        </div>
      </div>

      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          {isWaiting ? (
            <>
              <Button
                variant="secondary"
                aria-label={`Seat ${entry.name}`}
                disabled={busy}
                onClick={() => onSeat(entry)}
              >
                Seat
              </Button>
              <Button
                variant="ghost"
                aria-label={`Move ${entry.name} up`}
                disabled={busy || !canMoveUp}
                onClick={() => onMove(entry, 'up')}
              >
                Move up
              </Button>
              <Button
                variant="ghost"
                aria-label={`Move ${entry.name} down`}
                disabled={busy || !canMoveDown}
                onClick={() => onMove(entry, 'down')}
              >
                Move down
              </Button>
              <Button
                variant="ghost"
                aria-label={`Cancel ${entry.name}`}
                disabled={busy}
                onClick={() => onStatus(entry, 'cancelled')}
              >
                Cancel
              </Button>
              <Button
                variant="ghost"
                aria-label={`Mark ${entry.name} as no-show`}
                disabled={busy}
                onClick={() => onStatus(entry, 'no_show')}
              >
                Mark no-show
              </Button>
            </>
          ) : null}
          <Button
            variant="danger"
            aria-label={`Remove ${entry.name}`}
            disabled={busy}
            onClick={() => onAskRemove(entry)}
          >
            Remove
          </Button>
        </div>
      ) : null}
    </li>
  );
}
