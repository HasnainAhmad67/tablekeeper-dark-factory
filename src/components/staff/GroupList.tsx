import { useCallback, useEffect, useState } from 'react';

import { GroupForm } from '@/components/staff/GroupForm';
import { GroupItem } from '@/components/staff/GroupItem';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  GroupsApiError,
  createGroup,
  deleteGroup,
  fetchGroups,
  updateGroup,
  type GroupFormValues,
  type StaffGroup,
} from '@/lib/groups-client';
import { fetchTables, type StaffTable } from '@/lib/tables-client';

/**
 * Group CRUD surface for one restaurant (plan screen 26: Skeleton loading,
 * "No groups" empty state, Retry error state, inline everything).
 *
 * Mirrors TableList's state machine: a list phase (loading/error/ready), an
 * editor mode (none/add/edit), and a per-row delete confirmation — all
 * owned here so the presentational children stay render-testable. Writes
 * classify errors by status: 401 refreshes the session via login, 403
 * flips the whole surface into read-only (banner + hidden add/edit/delete,
 * per plan decision), anything else surfaces inline for retry. Successful
 * actions announce through a polite role="status" success banner.
 */

const LOGIN_URL = '/login?returnTo=/staff/groups';
const READ_ONLY_MESSAGE =
  'You have read-only access to groups — only owners and managers can make changes.';

type Phase = 'loading' | 'error' | 'ready';
type EditorMode = { kind: 'none' } | { kind: 'add' } | { kind: 'edit'; group: StaffGroup };

function byName(a: StaffGroup, b: StaffGroup): number {
  return a.name.localeCompare(b.name);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

export interface GroupListProps {
  restaurantId: string;
}

export function GroupList({ restaurantId }: GroupListProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [groups, setGroups] = useState<StaffGroup[]>([]);
  const [tables, setTables] = useState<StaffTable[]>([]);
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
      const [nextGroups, nextTables] = await Promise.all([
        fetchGroups(restaurantId),
        fetchTables(restaurantId),
      ]);
      setGroups(nextGroups);
      setTables([...nextTables].sort((a, b) => a.label.localeCompare(b.label)));
      setPhase('ready');
    } catch (err) {
      if (err instanceof GroupsApiError && err.status === 401) {
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
    if (err instanceof GroupsApiError && err.status === 401) {
      window.location.replace(LOGIN_URL);
      return false;
    }
    if (err instanceof GroupsApiError && err.status === 403) {
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

  async function handleCreate(values: GroupFormValues) {
    setFormBusy(true);
    setFormError(null);
    try {
      const group = await createGroup(restaurantId, values);
      setGroups((previous) => [...previous, group].sort(byName));
      setEditor({ kind: 'none' });
      setNotice(`Added ${group.name}.`);
    } catch (err) {
      if (handleWriteError(err)) {
        setFormError(errorMessage(err));
      }
    } finally {
      setFormBusy(false);
    }
  }

  async function handleUpdate(group: StaffGroup, values: GroupFormValues) {
    setFormBusy(true);
    setFormError(null);
    try {
      const updated = await updateGroup(restaurantId, group.id, values);
      setGroups((previous) =>
        previous.map((row) => (row.id === updated.id ? updated : row)).sort(byName),
      );
      setEditor({ kind: 'none' });
      setNotice(`Saved changes to ${updated.name}.`);
    } catch (err) {
      if (handleWriteError(err)) {
        setFormError(errorMessage(err));
      }
    } finally {
      setFormBusy(false);
    }
  }

  async function handleDelete(group: StaffGroup) {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteGroup(restaurantId, group.id);
      setGroups((previous) => previous.filter((row) => row.id !== group.id));
      setConfirmingId(null);
      setNotice(`Deleted ${group.name}.`);
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
        <span className="sr-only">Loading groups</span>
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    );
  }

  if (phase === 'error') {
    return <ErrorState onRetry={() => void load()} />;
  }

  /** Display labels for one group's member tables (unresolvable ids dropped). */
  function labelsFor(group: StaffGroup): string[] {
    const labelById = new Map(tables.map((table) => [table.id, table.label]));
    return group.table_ids
      .map((id) => labelById.get(id))
      .filter((label): label is string => typeof label === 'string')
      .sort((a, b) => a.localeCompare(b));
  }

  return (
    <div className="grid gap-6">
      {readOnly ? <Alert variant="info">{READ_ONLY_MESSAGE}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}

      {!readOnly && editor.kind === 'none' ? (
        <div>
          <Button
            onClick={() => {
              setNotice(null);
              setEditor({ kind: 'add' });
            }}
          >
            Create group
          </Button>
        </div>
      ) : null}

      {editor.kind === 'add' ? (
        <GroupForm
          mode="create"
          tables={tables}
          busy={formBusy}
          error={formError}
          onSubmit={(values) => void handleCreate(values)}
          onCancel={() => {
            setEditor({ kind: 'none' });
            setFormError(null);
          }}
        />
      ) : null}

      <section aria-labelledby="groups-heading" className="grid gap-3">
        <h2 id="groups-heading" className="text-lg font-semibold text-foreground">
          Groups
        </h2>

        {groups.length === 0 && editor.kind === 'none' ? (
          <EmptyState
            title="No groups"
            description="Group tables into sections like “Section A” or “VIP Area”."
            action={
              !readOnly ? (
                <Button
                  onClick={() => {
                    setNotice(null);
                    setEditor({ kind: 'add' });
                  }}
                >
                  Create group
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="grid gap-3">
            {groups.map((group) =>
              editor.kind === 'edit' && editor.group.id === group.id ? (
                <li key={group.id}>
                  <GroupForm
                    mode="edit"
                    tables={tables}
                    initialValues={{
                      name: group.name,
                      tableIds: [...group.table_ids],
                    }}
                    busy={formBusy}
                    error={formError}
                    onSubmit={(values) => void handleUpdate(group, values)}
                    onCancel={() => {
                      setEditor({ kind: 'none' });
                      setFormError(null);
                    }}
                  />
                </li>
              ) : (
                <GroupItem
                  key={group.id}
                  group={group}
                  tableLabels={labelsFor(group)}
                  readOnly={readOnly}
                  confirming={confirmingId === group.id}
                  busy={deleteBusy}
                  error={deleteError}
                  onEdit={(row) => {
                    setNotice(null);
                    setFormError(null);
                    setConfirmingId(null);
                    setEditor({ kind: 'edit', group: row });
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
