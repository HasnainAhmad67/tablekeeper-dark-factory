import { useEffect, useRef } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';

/**
 * Inline cancellation confirmation (plan screen 13 behavior, per plan
 * decision: inline confirmation, no modal).
 *
 * A plain bordered panel rendered in place of the trigger — no backdrop,
 * no aria-modal — so keyboard and screen-reader flow is unaffected. On
 * open, focus moves to the first button ("Keep reservation"): the safe
 * default, so Enter never confirms a destructive action by accident.
 * Escape dismisses while idle; errors render in a role="alert" banner
 * without collapsing the panel, so the guest can retry immediately.
 */

export interface CancelDialogProps {
  /** True while the PATCH is in flight (spinner + aria-busy + disabled). */
  busy?: boolean;
  /** Inline error message from the API or network layer. */
  error?: string | null;
  onConfirm: () => void;
  onDismiss: () => void;
  message?: string;
  confirmLabel?: string;
  dismissLabel?: string;
}

export function CancelDialog({
  busy = false,
  error = null,
  onConfirm,
  onDismiss,
  message = 'Cancel this reservation? This cannot be undone.',
  confirmLabel = 'Yes, cancel it',
  dismissLabel = 'Keep reservation',
}: CancelDialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus the safe default button when the panel opens.
  useEffect(() => {
    panelRef.current?.querySelector('button')?.focus();
  }, []);

  return (
    <div
      ref={panelRef}
      role="group"
      aria-label="Confirm cancellation"
      className="rounded-md border border-danger/40 bg-danger/10 p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !busy) {
          onDismiss();
        }
      }}
    >
      <p className="text-sm font-medium text-foreground">{message}</p>
      {error ? (
        <div className="mt-2">
          <Alert variant="error">{error}</Alert>
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-3">
        <Button variant="secondary" disabled={busy} onClick={onDismiss}>
          {dismissLabel}
        </Button>
        <Button variant="danger" loading={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
