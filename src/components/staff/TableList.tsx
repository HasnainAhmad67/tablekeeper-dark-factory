import { useCallback, useEffect, useState } from 'react';

import { TableForm } from '@/components/staff/TableForm';
import { TableItem } from '@/components/staff/TableItem';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  TableApiError,
  createTable,
  deleteTable,
  fetchSections,
  fetchTables,
  updateTable,
  type StaffTable,
  type TableFormValues,
  type TableSection,
} from '@/lib/tables-client';

/**
 * Table CRUD surface for one restaurant (plan screen 25: Skeleton loading,
 * "No tables" empty state, Retry error state, inline everything).
 *
 * State machine: a list phase (loading/error/ready), an editor mode
 * (none/add/edit-table), and a per-row delete confirmation — all owned here
 * so the presentational children stay render-testable. Writes classify
 * errors by status: 401 refreshes the session via login, 403 flips the
 * whole surface into read-only (banner + hidden add/edit/delete, per plan
 * decision), anything else surfaces inline for retry. Successful actions
 * announce through a polite role="status" success banner.
 */

const LOGIN_URL = '/login?returnTo=/staff/tables';
const READ_ONLY_MESSAGE =
  'You have read-only access to tables — only owners and managers can make changes.';

type Phase = 'loading' | 'error' | 'ready';
type EditorMode = { kind: 'none' } | { kind: 'add' } | { kind: 'edit'; table: StaffTable };

function byLabel(a: StaffTable, b: StaffTable): number {
  return a.label.localeCompare(b.label);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

export interface TableListProps {
  restaurantId: string;
}

export function TableList({ restaurantId }: TableListProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [tables, setTables] = useState<StaffTable[]>([]);
  const [sections, setSections] = useState<TableSection[]>([]);
  const [readOnly, setReadOnly] = useState(false);

  const [editor, setEditor] = useState<EditorMode>({ kind: 'none' });
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPhase('loading');
    setFormError(null);
    setDeleteError(null);
    try {
      const [nextTables, nextSections] = await Promise.all([
        fetchTables(restaurantId),
        fetchSections(restaurantId),
      ]);
      setTables([...nextTables].sort(byLabel));
      setSections(nextSections);
      setPhase('ready');
    } catch (err) {
      if (err instanceof TableApiError && err.status === 401) {
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
    if (err instanceof TableApiError && err.status === 401) {
      window.location.replace(LOGIN_URL);
      return false;
    }
    if (err instanceof TableApiError && err.status === 403) {
      // Owner/Manager gate: flip the surface to read-only (plan decision).
      setReadOnly(true);
      setEditor({ kind: 'none' });
      setConfirmingId(null);
      setFormError(null);
      setDeleteError(null);
      setNotice(null);
      return false;
    }
    return true;
  }

  async function handleCreate(values: TableFormValues) {
    setFormBusy(true);
    setFormError(null);
    try {
      const table = await createTable(restaurantId, values);
      setTables((previous) => [...previous, table].sort(byLabel));
      setEditor({ kind: 'none' });
      setNotice(`Added ${table.label}.`);
    } catch (err) {
      if (handleWriteError(err)) {
        setFormError(errorMessage(err));
      }
    } finally {
      setFormBusy(false);
    }
  }

  async function handleUpdate(table: StaffTable, values: TableFormValues) {
    setFormBusy(true);
    setFormError(null);
    try {
      const updated = await updateTable(restaurantId, table.id, values);
      setTables((previous) =>
        previous
          .map((row) => (row.id === updated.id ? updated : row))
          .sort(byLabel),
      );
      setEditor({ kind: 'none' });
      setNotice(`Saved changes to ${updated.label}.`);
    } catch (err) {
      if (handleWriteError(err)) {
        setFormError(errorMessage(err));
      }
    } finally {
      setFormBusy(false);
    }
  }

  async function handleDelete(table: StaffTable) {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteTable(restaurantId, table.id);
      setTables((previous) => previous.filter((row) => row.id !== table.id));
      setConfirmingId(null);
      setNotice(`Deleted ${table.label}.`);
    } catch (err) {
      if (handleWriteError(err)) {
        setDeleteError(errorMessage(err));
      }
    } finally {
      setDeleteBusy(false);
    }
  }

  if (phase === 'loading') {
    return (
      <div role="status" className="grid gap-3">
        <span className="sr-only">Loading tables</span>
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  }

  if (phase === 'error') {
    return <ErrorState onRetry={() => void load()} />;
  }

  function sectionName(sectionId: string | null): string | null {
    if (sectionId === null) {
      return null;
    }
    return sections.find((section) => section.id === sectionId)?.name ?? null;
  }

  return (
    <div className="grid gap-6">
      {readOnly ? <Alert variant="info">{READ_ONLY_MESSAGE}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      {!readOnly && editor.kind === 'none' ? (
        <div>
          <Button onClick={() => { setNotice(null); setEditor({ kind: 'add' }); }}>
            Add table
          </Button>
        </div>
      ) : null}

      {editor.kind === 'add' ? (
        <TableForm
          mode="create"
          sections={sections}
          busy={formBusy}
          error={formError}
          onSubmit={(values) => void handleCreate(values)}
          onCancel={() => {
            setEditor({ kind: 'none' });
            setFormError(null);
          }}
        />
      ) : null}

      <section aria-labelledby="tables-heading" className="grid gap-3">
        <h2 id="tables-heading" className="text-lg font-semibold text-foreground">
          Tables
        </h2>

        {tables.length === 0 && editor.kind === 'none' ? (
          <EmptyState
            title="No tables"
            description="Add a table to start building this restaurant's floor."
            action={
              !readOnly ? (
                <Button onClick={() => { setNotice(null); setEditor({ kind: 'add' }); }}>
                  Add table
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="grid gap-3">
            {tables.map((table) =>
              editor.kind === 'edit' && editor.table.id === table.id ? (
                <li key={table.id}>
                  <TableForm
                    mode="edit"
                    sections={sections}
                    initialValues={{
                      label: table.label,
                      capacity: String(table.capacity),
                      sectionId: table.section_id ?? '',
                      shape: table.shape,
                      positionX: String(table.position_x),
                      positionY: String(table.position_y),
                      width: String(table.width),
                      depth: String(table.depth),
                    }}
                    busy={formBusy}
                    error={formError}
                    onSubmit={(values) => void handleUpdate(table, values)}
                    onCancel={() => {
                      setEditor({ kind: 'none' });
                      setFormError(null);
                    }}
                  />
                </li>
              ) : (
                <TableItem
                  key={table.id}
                  table={table}
                  sectionName={sectionName(table.section_id)}
                  readOnly={readOnly}
                  confirming={confirmingId === table.id}
                  busy={deleteBusy}
                  error={deleteError}
                  onEdit={(row) => {
                    setNotice(null);
                    setFormError(null);
                    setConfirmingId(null);
                    setEditor({ kind: 'edit', table: row });
                  }}
                  onAskDelete={(row) => {
                    setDeleteError(null);
                    setConfirmingId(row.id);
                  }}
                  onConfirmDelete={(row) => void handleDelete(row)}
                  onCancelDelete={() => {
                    setConfirmingId(null);
                    setDeleteError(null);
                  }}
                />
              ),
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
