import { useCallback, useEffect, useState } from 'react';

import { WaitlistForm } from '@/components/staff/WaitlistForm';
import { WaitlistItem } from '@/components/staff/WaitlistItem';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  WaitlistApiError,
  addWaitlistEntry,
  fetchWaitlist,
  removeWaitlistEntry,
  seatWaitlistEntry,
  sortWaitlist,
  updateWaitlistEntry,
  type WaitlistEntry,
  type WaitlistFormValues,
  type WaitlistStatus,
} from '@/lib/waitlist-client';
import { fetchTables, type StaffTable } from '@/lib/tables-client';

/**
 * Waitlist surface for one restaurant (plan screen 23: Skeleton loading,
 * "No guests" empty state, Retry error state, list semantics, DoD "Promote
 * guest" via the Seat action).
 *
 * Mirrors GroupList's state machine: a list phase (loading/error/ready),
 * an add-editor mode, and per-row confirmation panels — all owned here so
 * the presentational children stay render-testable. Writes classify
 * errors by status: 401 refreshes the session via login, 403 flips the
 * whole surface into read-only (banner + hidden add/move/seat/remove,
 * per the write-gate decision), anything else surfaces inline for retry.
 * A successful Seat creates the reservation first, then marks the entry
 * seated; notices announce through the polite role="status" banner.
 *
 * Queue moves send a 1-based target position and re-sort locally — the
 * backend reindexes neighbours (contract documented in waitlist-client).
 */

const LOGIN_URL = '/login?returnTo=/staff/waitlist';
const READ_ONLY_MESSAGE =
  'You have read-only access to the waitlist — only owners and managers can make changes.';

type Phase = 'loading' | 'error' | 'ready';
type EditorMode = { kind: 'none' } | { kind: 'add' };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

export interface WaitlistListProps {
  restaurantId: string;
}

export function WaitlistList({ restaurantId }: WaitlistListProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [tables, setTables] = useState<StaffTable[]>([]);
  const [readOnly, setReadOnly] = useState(false);

  const [editor, setEditor] = useState<EditorMode>({ kind: 'none' });
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const [seatingId, setSeatingId] = useState<string | null>(null);
  const [seatBusy, setSeatBusy] = useState(false);
  const [seatError, setSeatError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPhase('loading');
    setFormError(null);
    setRemoveError(null);
    setSeatError(null);
    setActionError(null);
    try {
      const [nextEntries, nextTables] = await Promise.all([
        fetchWaitlist(restaurantId),
        fetchTables(restaurantId),
      ]);
      setEntries(nextEntries);
      setTables([...nextTables].sort((a, b) => a.label.localeCompare(b.label)));
      setPhase('ready');
    } catch (err) {
      if (err instanceof WaitlistApiError && err.status === 401) {
        window.location.replace(LOGIN_URL);
        return;
      }
      setPhase('error');
    }
  }, [restaurantId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Classify a write failure; returns true when the request may be retried. */
  function handleWriteError(err: unknown): boolean {
    if (err instanceof WaitlistApiError && err.status === 401) {
      window.location.replace(LOGIN_URL);
      return false;
    }
    if (err instanceof WaitlistApiError && err.status === 403) {
      // Write gate: flip the surface to read-only (403 decision).
      setReadOnly(true);
      setEditor({ kind: 'none' });
      setConfirmingId(null);
      setSeatingId(null);
      setFormError(null);
      setRemoveError(null);
      setSeatError(null);
      setActionError(null);
      setNotice(null);
      return false;
    }
    return true;
  }

  async function handleAdd(values: WaitlistFormValues) {
    setFormBusy(true);
    setFormError(null);
    try {
      const entry = await addWaitlistEntry(restaurantId, values);
      setEntries((previous) => sortWaitlist([...previous, entry]));
      setEditor({ kind: 'none' });
      setNotice(`Added ${entry.name}.`);
    } catch (err) {
      if (handleWriteError(err)) {
        setFormError(errorMessage(err));
      }
    } finally {
      setFormBusy(false);
    }
  }

  async function handleMove(entry: WaitlistEntry, direction: 'up' | 'down') {
    const ordered = sortWaitlist(entries);
    const index = ordered.findIndex((row) => row.id === entry.id);
    const target = index + (direction === 'up' ? -1 : 1);
    if (index < 0 || target < 0 || target >= ordered.length) {
      return;
    }
    const nextPosition = target + 1;
    setNotice(null);
    setActionError(null);
    try {
      await updateWaitlistEntry(entry.id, { position: nextPosition });
      setEntries((previous) =>
        sortWaitlist(
          previous.map((row) => (row.id === entry.id ? { ...row, position: nextPosition } : row)),
        ),
      );
      setNotice(`Moved ${entry.name} ${direction}.`);
    } catch (err) {
      if (handleWriteError(err)) {
        setActionError(errorMessage(err));
      }
    }
  }

  async function handleStatus(entry: WaitlistEntry, status: WaitlistStatus) {
    setNotice(null);
    setActionError(null);
    try {
      const updated = await updateWaitlistEntry(entry.id, { status });
      setEntries((previous) =>
        previous.map((row) => (row.id === updated.id ? updated : row)),
      );
      setNotice(
        status === 'cancelled'
          ? `Cancelled ${entry.name}.`
          : `Marked ${entry.name} as no-show.`,
      );
    } catch (err) {
      if (handleWriteError(err)) {
        setActionError(errorMessage(err));
      }
    }
  }

  async function handleRemove(entry: WaitlistEntry) {
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await removeWaitlistEntry(entry.id);
      setEntries((previous) => previous.filter((row) => row.id !== entry.id));
      setConfirmingId(null);
      setNotice(`Removed ${entry.name}.`);
    } catch (err) {
      if (handleWriteError(err)) {
        setRemoveError(errorMessage(err));
      }
    } finally {
      setRemoveBusy(false);
    }
  }

  async function handleSeat(entry: WaitlistEntry, tableIds: string[]) {
    setSeatBusy(true);
    setSeatError(null);
    try {
      const updated = await seatWaitlistEntry(entry, tableIds);
      setEntries((previous) => previous.map((row) => (row.id === updated.id ? updated : row)));
      setSeatingId(null);
      setNotice(`Seated ${entry.name}.`);
    } catch (err) {
      if (handleWriteError(err)) {
        setSeatError(errorMessage(err));
      }
    } finally {
      setSeatBusy(false);
    }
  }

  if (phase === 'loading') {
    return (
      <div role="status" className="grid gap-3">
        <span className="sr-only">Loading waitlist</span>
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  }

  if (phase === 'error') {
    return <ErrorState onRetry={() => void load()} />;
  }

  return (
    <div className="grid gap-6">
      {readOnly ? <Alert variant="info">{READ_ONLY_MESSAGE}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}
      {actionError ? <Alert variant="error">{actionError}</Alert> : null}

      {!readOnly && editor.kind === 'none' ? (
        <div>
          <Button
            onClick={() => {
              setNotice(null);
              setActionError(null);
              setEditor({ kind: 'add' });
            }}
          >
            Add party
          </Button>
        </div>
      ) : null}

      {editor.kind === 'add' ? (
        <WaitlistForm
          busy={formBusy}
          error={formError}
          onSubmit={(values) => void handleAdd(values)}
          onCancel={() => {
            setEditor({ kind: 'none' });
            setFormError(null);
          }}
        />
      ) : null}

      <section aria-labelledby="queue-heading" className="grid gap-3">
        <h2 id="queue-heading" className="text-lg font-semibold text-foreground">
          Queue
        </h2>

        {entries.length === 0 && editor.kind === 'none' ? (
          <EmptyState
            title="No guests"
            description="Add a party to start the queue — name, size, and optional contact details."
            action={
              !readOnly ? (
                <Button
                  onClick={() => {
                    setNotice(null);
                    setActionError(null);
                    setEditor({ kind: 'add' });
                  }}
                >
                  Add party
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="grid gap-3">
            {entries.map((entry, index) => {
              // `entries` is kept in queue order (fetch + every update re-sort).
              const isFirst = index === 0;
              const isLast = index === entries.length - 1;
              return (
                <WaitlistItem
                  key={entry.id}
                  entry={entry}
                  readOnly={readOnly}
                  canMoveUp={!isFirst}
                  canMoveDown={!isLast}
                  confirming={confirmingId === entry.id}
                  seating={seatingId === entry.id}
                  tables={tables}
                  busy={removeBusy || seatBusy}
                  error={confirmingId === entry.id ? removeError : seatError}
                  onMove={(row, direction) => void handleMove(row, direction)}
                  onSeat={(row) => {
                    setNotice(null);
                    setActionError(null);
                    setRemoveError(null);
                    setSeatingId(row.id);
                  }}
                  onCancelSeat={() => {
                    setSeatingId(null);
                    setSeatError(null);
                  }}
                  onConfirmSeat={(row, tableIds) => void handleSeat(row, tableIds)}
                  onStatus={(row, status) => void handleStatus(row, status)}
                  onAskRemove={(row) => {
                    setRemoveError(null);
                    setConfirmingId(row.id);
                  }}
                  onConfirmRemove={(row) => void handleRemove(row)}
                  onCancelRemove={() => {
                    setConfirmingId(null);
                    setRemoveError(null);
                  }}
                />
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
