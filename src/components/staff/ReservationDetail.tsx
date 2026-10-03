import { useEffect, useRef, useState } from 'react';

import { BookingSummary } from '@/components/booking/BookingSummary';
import { CancelDialog } from '@/components/reservations/CancelDialog';
import {
  isCancellable,
  statusBadgeVariant,
  statusLabel,
} from '@/components/reservations/ReservationItem';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatWhenLabel } from '@/lib/booking';
import { fetchTables } from '@/lib/tables-client';
import {
  ReservationApiError,
  cancelReservation,
  fetchRestaurantBrief,
  type RestaurantBrief,
  type StaffReservation,
} from '@/lib/reservations-client';

/**
 * Staff reservation detail content (plan screen 21: "Manage reservation",
 * full details + associated tables + status actions work).
 *
 * Reuses the M6 patterns end to end: BookingSummary for the label/value
 * details, the shared CancelDialog for the inline confirmation (its
 * "Confirm cancellation" label is exactly right here), and
 * statusBadgeVariant/statusLabel/isCancellable from ReservationItem —
 * cancel runs as PATCH /api/reservations/[id] { status: "cancelled" } with
 * errors kept inline and the record updated in place on success.
 *
 * The table list resolves each assignment's label via the restaurant's
 * tables route (member reads are allowed); while or if that lookup fails,
 * the raw table ids are shown so the section never lies by omission.
 * Times render in the restaurant's timezone when the public brief loads,
 * falling back to the browser zone. Focus returns to the cancel trigger —
 * or the back link after a successful cancel, when the trigger disappears.
 */

const LOGIN_URL = '/login?returnTo=/staff/reservations';

export interface ReservationDetailProps {
  reservation: StaffReservation;
}

export function ReservationDetail({ reservation: initial }: ReservationDetailProps) {
  const [reservation, setReservation] = useState<StaffReservation>(initial);
  const [brief, setBrief] = useState<RestaurantBrief | null>(null);
  const [tableLabels, setTableLabels] = useState<Record<string, string>>({});

  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelledHere, setCancelledHere] = useState(false);
  const hadConfirming = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const assignments = reservation.reservation_tables ?? [];

  // Restaurant brief (timezone/name) — non-fatal on failure.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchRestaurantBrief(reservation.restaurant_id);
        if (!cancelled && result) {
          setBrief(result);
        }
      } catch {
        // Fall back to the browser timezone.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reservation.restaurant_id]);

  // Table labels for the assignments — non-fatal; ids render as fallback.
  useEffect(() => {
    if (assignments.length === 0) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const tables = await fetchTables(reservation.restaurant_id);
        if (cancelled) {
          return;
        }
        const labels: Record<string, string> = {};
        for (const table of tables) {
          labels[table.id] = table.label;
        }
        setTableLabels(labels);
      } catch {
        // Keep raw ids.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reservation.restaurant_id, assignments.length]);

  // Restore focus when the inline dialog closes (trigger, else back link).
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
      containerRef.current?.querySelector<HTMLElement>('[data-back-link]');
    target?.focus();
  }, [confirming]);

  async function handleCancel() {
    if (pending) {
      return;
    }
    setPending(true);
    setCancelError(null);
    try {
      const updated = await cancelReservation(reservation.id);
      setReservation({ ...reservation, ...updated });
      setCancelledHere(true);
      setConfirming(false);
      setPending(false);
    } catch (err) {
      if (err instanceof ReservationApiError && err.status === 401) {
        window.location.replace(LOGIN_URL);
        return;
      }
      // 403/404/409/422/500 stay inline; the dialog keeps its state.
      setCancelError(
        err instanceof ReservationApiError
          ? err.message
          : 'We could not cancel this reservation. Please try again.',
      );
      setPending(false);
    }
  }

  function handleDismiss() {
    if (pending) {
      return;
    }
    setConfirming(false);
    setCancelError(null);
  }

  const zone = brief?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const cancellable = isCancellable(reservation.status);

  return (
    <div ref={containerRef} className="grid max-w-2xl gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant={statusBadgeVariant(reservation.status)}>
          {statusLabel(reservation.status)}
        </Badge>
        <a
          data-back-link
          href="/staff/reservations"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          Back to reservations
        </a>
      </div>

      {cancelledHere ? (
        <Alert variant="success">Reservation cancelled.</Alert>
      ) : null}

      <BookingSummary
        heading="Details"
        items={[
          {
            term: 'When',
            value: formatWhenLabel(
              reservation.starts_at,
              reservation.ends_at,
              zone,
            ),
          },
          { term: 'Party size', value: String(reservation.party_size) },
          { term: 'Confirmation', value: reservation.id },
          { term: 'Guest', value: reservation.user_id ?? '—' },
          ...(reservation.notes ? [{ term: 'Notes', value: reservation.notes }] : []),
        ]}
      />

      <section
        aria-labelledby="reservation-tables-heading"
        className="rounded-lg border border-border bg-surface p-6"
      >
        <h2
          id="reservation-tables-heading"
          className="text-base font-semibold text-foreground"
        >
          Tables
        </h2>
        {assignments.length === 0 ? (
          <p className="mt-4 text-sm text-foreground-muted">No tables assigned.</p>
        ) : (
          <ul className="mt-4 grid gap-2">
            {assignments.map((assignment) => (
              <li
                key={assignment.table_id}
                className="flex flex-wrap items-center justify-between gap-3 text-sm text-foreground"
              >
                <span>{tableLabels[assignment.table_id] ?? assignment.table_id}</span>
                {assignment.status === 'released' ? (
                  <span className="text-xs text-foreground-muted">Released</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {cancellable ? (
        confirming ? (
          <CancelDialog
            busy={pending}
            error={cancelError}
            onConfirm={() => void handleCancel()}
            onDismiss={handleDismiss}
          />
        ) : (
          <div>
            <Button
              data-cancel-trigger
              variant="secondary"
              onClick={() => {
                setCancelError(null);
                setConfirming(true);
              }}
            >
              Cancel reservation
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}
