import { useEffect, useRef } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import type { StaffGroup } from '@/lib/groups-client';

/**
 * One group row in the management list (plan screen 26).
 *
 * Destructive actions use an inline confirmation panel rendered in place of
 * the row actions — per plan decision, no modal. Following the TableItem
 * pattern: focus moves to the safe default ("Keep group") on open so Enter
 * never deletes, Escape dismisses, and errors render in a role="alert"
 * banner without collapsing the panel so the retry is immediate.
 *
 * Assigned tables surface as neutral Badges (text carries the meaning,
 * never color alone); the group's description shows when present. In
 * read-only state (a write returned 403 — Owner/Manager gate) the
 * Edit/Delete affordances are hidden entirely.
 */

export interface GroupItemProps {
  group: StaffGroup;
  /** Display labels for the group's member tables, resolved by the list. */
  tableLabels: string[];
  /** Hides the Edit/Delete affordances (403 read-only state). */
  readOnly?: boolean;
  /** True while this row's delete confirmation is open. */
  confirming?: boolean;
  /** True while this row's delete request is in flight. */
  busy?: boolean;
  /** Inline delete error shown inside the confirmation panel. */
  error?: string | null;
  onEdit: (group: StaffGroup) => void;
  onAskDelete: (group: StaffGroup) => void;
  onConfirmDelete: (group: StaffGroup) => void;
  onCancelDelete: () => void;
}

export function GroupItem({
  group,
  tableLabels,
  readOnly = false,
  confirming = false,
  busy = false,
  error = null,
  onEdit,
  onAskDelete,
  onConfirmDelete,
  onCancelDelete,
}: GroupItemProps) {
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
          aria-label={`Confirm deletion of ${group.name}`}
          className="rounded-md border border-danger/40 bg-danger/10 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !busy) {
              onCancelDelete();
            }
          }}
        >
          <p className="text-sm font-medium text-foreground">
            Delete &ldquo;{group.name}&rdquo;? This cannot be undone.
          </p>
          {error ? (
            <div className="mt-2">
              <Alert variant="error">{error}</Alert>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-3">
            <Button variant="secondary" disabled={busy} onClick={onCancelDelete}>
              Keep group
            </Button>
            <Button variant="danger" loading={busy} onClick={() => onConfirmDelete(group)}>
              Yes, delete it
            </Button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{group.name}</p>
        {group.description ? (
          <p className="mt-0.5 text-xs text-foreground-muted">{group.description}</p>
        ) : null}
        {tableLabels.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {tableLabels.map((label) => (
              <Badge key={label}>{label}</Badge>
            ))}
          </div>
        ) : (
          <p className="mt-1.5 text-xs text-foreground-muted">No tables assigned</p>
        )}
      </div>
      {!readOnly ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => onEdit(group)}>
            Edit
          </Button>
          <Button variant="danger" onClick={() => onAskDelete(group)}>
            Delete
          </Button>
        </div>
      ) : null}
    </li>
  );
}
