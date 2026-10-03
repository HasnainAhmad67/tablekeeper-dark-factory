import { useEffect, useRef, useState } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { CancelDialog } from '@/components/reservations/CancelDialog';
import { formatWhenLabel } from '@/lib/booking';

/**
 * One reservation row in the My Reservations list (plan screen 11: status
 * badges + actions, list semantics live in ReservationList's <ul>).
 *
 * The row owns its cancel flow: the trigger opens the inline CancelDialog,
 * a PATCH to /api/reservations/[id] with { status: "cancelled" } performs
 * the cancellation, and the row updates in place (badge flips to
 * cancelled). Failures render inside the dialog without losing state.
 * Focus is restored to the trigger (or the view link after a successful
 * cancellation, when the trigger disappears) when the dialog closes.
 *
 * Times render in the given timezone; the list passes the guest's browser
 * zone (guest-facing list), tests pass a fixed zone for determinism.
 */

const LOGIN_URL = '/login?returnTo=/reservations';

export interface ReservationAssignment {
  table_id: string;
  status: 'active' | 'released';
}

export interface ReservationRecord {
  id: string;
  restaurant_id: string;
  party_size: number;
  starts_at: string;
  ends_at: string;
  status: string;
  notes: string | null;
  reservation_tables?: ReservationAssignment[] | null;
}

const STATUS_BADGE_VARIANT: Record<string, BadgeVariant> = {
  pending: 'warning',
  confirmed: 'success',
  seated: 'info',
  completed: 'neutral',
  cancelled: 'danger',
  no_show: 'danger',
};

export function statusBadgeVariant(status: string): BadgeVariant {
  return STATUS_BADGE_VARIANT[status] ?? 'neutral';
}

/** Human status text (badges carry the text, never color alone). */
export function statusLabel(status: string): string {
  return status.replace('_', ' ');
}

/**
 * Guests may cancel from any active state (status machine: pending,
 * confirmed, seated); terminal states are never offered a cancel action.
 */
export function isCancellable(status: string): boolean {
  return status === 'pending' || status === 'confirmed' || status === 'seated';
}

export interface ReservationItemProps {
  reservation: ReservationRecord;
  /** IANA zone for the time labels; defaults to the browser's zone. */
  timeZone?: string;
  /** Restaurant display name, when the list resolved it. */
  restaurantName?: string;
}

export function ReservationItem({ reservation, timeZone, restaurantName }: ReservationItemProps) {
  const [local, setLocal] = useState<ReservationRecord>(reservation);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const containerRef = useRef<HTMLLIElement>(null);
  const hadConfirming = useRef(false);

  const displayZone =
    timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Restore focus after the inline dialog closes (trigger first; after a
  // successful cancel the trigger is gone, so fall back to the view link).
  useEffect(() => {
    if (confirming) {
      hadConfirming.current = true;
      return;
    }
    if (!hadConfirming.current) {
      return;
    }
    const target =
      containerRef.current?.querySelector<HTMLElement>('[data-cancel-trigger]') ??
      containerRef.current?.querySelector<HTMLElement>('[data-view-link]');
    target?.focus();
  }, [confirming]);

  async function handleCancel() {
    if (pending) {
      return;
    }
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/reservations/${encodeURIComponent(local.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled' }),
      });
      if (res.status === 401) {
        window.location.replace(LOGIN_URL);
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        reservation?: Partial<ReservationRecord>;
        error?: string;
      } | null;
      if (!res.ok) {
        // 403/404/409/422/500 stay inline; the dialog keeps its state.
        setError(body?.error ?? 'We could not cancel this reservation. Please try again.');
        setPending(false);
        return;
      }
      setLocal({ ...local, ...(body?.reservation ?? {}) });
      setSuccess(true);
      setConfirming(false);
      setPending(false);
    } catch {
      setError('Network error. Your reservation was not cancelled.');
      setPending(false);
    }
  }

  function handleDismiss() {
    if (pending) {
      return;
    }
    setConfirming(false);
    setError(null);
  }

  const activeTables = (local.reservation_tables ?? []).filter(
    (assignment) => assignment.status === 'active',
  ).length;

  return (
    <li ref={containerRef} className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {restaurantName ? (
            <p className="text-sm font-semibold text-foreground">{restaurantName}</p>
          ) : null}
          <p
            className={
              restaurantName
                ? 'mt-0.5 text-sm text-foreground-muted'
                : 'text-sm font-semibold text-foreground'
            }
          >
            {formatWhenLabel(local.starts_at, local.ends_at, displayZone)}
          </p>
          <p className="mt-1 text-sm text-foreground-muted">
            Party of {local.party_size}
            {activeTables > 0
              ? ` · ${activeTables} table${activeTables === 1 ? '' : 's'}`
              : ''}
          </p>
        </div>
        <Badge variant={statusBadgeVariant(local.status)}>{statusLabel(local.status)}</Badge>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <a
          data-view-link
          href={`/reservations/${encodeURIComponent(local.id)}`}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          View details
        </a>
        {!confirming && isCancellable(local.status) ? (
          <Button
            data-cancel-trigger
            variant="secondary"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
          >
            Cancel reservation
          </Button>
        ) : null}
      </div>

      {success ? (
        <div className="mt-3">
          <Alert variant="success">Reservation cancelled.</Alert>
        </div>
      ) : null}

      {confirming ? (
        <div className="mt-3">
          <CancelDialog
            busy={pending}
            error={error}
            onConfirm={() => void handleCancel()}
            onDismiss={handleDismiss}
          />
        </div>
      ) : null}
    </li>
  );
}
