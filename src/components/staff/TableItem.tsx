import { useEffect, useRef } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import type { StaffTable } from '@/lib/tables-client';

/**
 * One table row in the management list (plan screen 25).
 *
 * Destructive actions use an inline confirmation panel rendered in place of
 * the row actions — per plan decision, no modal. Following the M6
 * CancelDialog pattern (its aria-label is hardcoded to reservations, so the
 * panel is rebuilt here with a deletion-specific label): focus moves to the
 * safe default ("Keep table") on open so Enter never deletes, Escape
 * dismisses, and errors render in a role="alert" banner without collapsing
 * the panel so the retry is immediate.
 *
 * In read-only state (a write returned 403 — Owner/Manager gate) the Edit
 * and Delete affordances are hidden entirely.
 */

export interface TableItemProps {
  table: StaffTable;
  /** Floor-section name for display, when the table belongs to one. */
  sectionName?: string | null;
  /** Hides the Edit/Delete affordances (403 read-only state). */
  readOnly?: boolean;
  /** True while this row's delete request is in flight. */
  confirming?: boolean;
  busy?: boolean;
  /** Inline delete error shown inside the confirmation panel. */
  error?: string | null;
  onEdit: (table: StaffTable) => void;
  onAskDelete: (table: StaffTable) => void;
  onConfirmDelete: (table: StaffTable) => void;
  onCancelDelete: () => void;
}

export function TableItem({
  table,
  sectionName = null,
  readOnly = false,
  confirming = false,
  busy = false,
  error = null,
  onEdit,
  onAskDelete,
  onConfirmDelete,
  onCancelDelete,
}: TableItemProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus the safe default button when the confirmation panel opens.
  useEffect(() => {
    if (confirming) {
      panelRef.current?.querySelector('button')?.focus();
    }
  }, [confirming]);

  if (confirming) {
    return (
      <li>
        <div
          ref={panelRef}
          role="group"
          aria-label={`Confirm deletion of ${table.label}`}
          className="rounded-md border border-danger/40 bg-danger/10 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !busy) {
              onCancelDelete();
            }
          }}
        >
          <p className="text-sm font-medium text-foreground">
            Delete &ldquo;{table.label}&rdquo;? This cannot be undone.
          </p>
          {error ? (
            <div className="mt-2">
              <Alert variant="error">{error}</Alert>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-3">
            <Button variant="secondary" disabled={busy} onClick={onCancelDelete}>
              Keep table
            </Button>
            <Button variant="danger" loading={busy} onClick={() => onConfirmDelete(table)}>
              Yes, delete it
            </Button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{table.label}</p>
        <p className="text-xs text-foreground-muted">
          {table.capacity} seats &middot; {table.shape} &middot;{' '}
          {sectionName ?? 'No section'} &middot; x {table.position_x}, y {table.position_y}{' '}
          &middot; {table.width}&times;{table.depth}
        </p>
      </div>
      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => onEdit(table)}>
            Edit
          </Button>
          <Button variant="danger" onClick={() => onAskDelete(table)}>
            Delete
          </Button>
        </div>
      ) : null}
    </li>
  );
}
