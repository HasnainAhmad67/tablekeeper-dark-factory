import { useCallback, useEffect, useState } from 'react';

import { AddMemberForm } from '@/components/staff/AddMemberForm';
import { TeamMemberItem } from '@/components/staff/TeamMemberItem';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  TEAM_READ_ONLY_MESSAGE,
  TeamApiError,
  canManageTeam,
  fetchTeamMembers,
  inviteMember,
  removeMember,
  updateMemberRole,
  type InviteFormValues,
  type StaffContext,
  type TeamMember,
} from '@/lib/team-client';

/**
 * Team surface for one restaurant (plan screen 30: Skeleton loading,
 * "No staff" empty state, Retry error state, role badges, Form labels,
 * DoD "Roles assigned").
 *
 * Mirrors WaitlistList's state machine: a list phase (loading/error/
 * ready), an invite-editor mode, and a per-row confirmation panel — all
 * owned here so the presentational children stay render-testable. The
 * write gate combines the membership role (owner-only per decision:
 * manager views only, so the read-only banner shows for anyone but an
 * owner) with a 403 from any write flipping the surface read-only
 * (requirement 7). 401 refreshes the session via login; other failures
 * surface inline for retry. Notices announce through the polite
 * role="status" banner.
 */

const LOGIN_URL = '/login?returnTo=/staff/team';

type Phase = 'loading' | 'error' | 'ready';
type EditorMode = { kind: 'none' } | { kind: 'invite' };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

export interface TeamListProps {
  /** Single-restaurant context from /api/staff/me (page owns the fetch). */
  restaurant: StaffContext;
}

export function TeamList({ restaurant }: TeamListProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [writeForbidden, setWriteForbidden] = useState(false);

  const [editor, setEditor] = useState<EditorMode>({ kind: 'none' });
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const readOnly = !canManageTeam(restaurant.role) || writeForbidden;

  const load = useCallback(async () => {
    setPhase('loading');
    setFormError(null);
    setRemoveError(null);
    setActionError(null);
    try {
      const nextMembers = await fetchTeamMembers(restaurant.id);
      setMembers(nextMembers);
      setPhase('ready');
    } catch (err) {
      if (err instanceof TeamApiError && err.status === 401) {
        window.location.replace(LOGIN_URL);
        return;
      }
      setPhase('error');
    }
  }, [restaurant.id]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Classify a write failure; returns true when the request may be retried. */
  function handleWriteError(err: unknown): boolean {
    if (err instanceof TeamApiError && err.status === 401) {
      window.location.replace(LOGIN_URL);
      return false;
    }
    if (err instanceof TeamApiError && err.status === 403) {
      // Owner-only gate: flip the surface to read-only (requirement 7).
      setWriteForbidden(true);
      setEditor({ kind: 'none' });
      setConfirmingId(null);
      setFormError(null);
      setRemoveError(null);
      setActionError(null);
      setNotice(null);
      return false;
    }
    return true;
  }

  async function handleInvite(values: InviteFormValues) {
    setFormBusy(true);
    setFormError(null);
    try {
      const member = await inviteMember(restaurant.id, values);
      setMembers((previous) => [...previous, member]);
      setEditor({ kind: 'none' });
      setNotice(`Invited ${member.email}.`);
    } catch (err) {
      if (handleWriteError(err)) {
        setFormError(errorMessage(err));
      }
    } finally {
      setFormBusy(false);
    }
  }

  async function handleRoleChange(member: TeamMember, role: string) {
    setNotice(null);
    setActionError(null);
    try {
      const updated = await updateMemberRole(member.id, role);
      setMembers((previous) =>
        previous.map((row) => (row.id === updated.id ? updated : row)),
      );
      setNotice(`Changed ${member.name || member.email}’s role to ${role}.`);
    } catch (err) {
      if (handleWriteError(err)) {
        setActionError(errorMessage(err));
      }
    }
  }

  async function handleRemove(member: TeamMember) {
    setRemoveBusy(true);
    setRemoveError(null);
    try {
      await removeMember(member.id);
      setMembers((previous) => previous.filter((row) => row.id !== member.id));
      setConfirmingId(null);
      setNotice(`Removed ${member.name || member.email}.`);
    } catch (err) {
      if (handleWriteError(err)) {
        setRemoveError(errorMessage(err));
      }
    } finally {
      setRemoveBusy(false);
    }
  }

  if (phase === 'loading') {
    return (
      <div role="status" className="grid gap-3">
        <span className="sr-only">Loading team members</span>
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    );
  }

  if (phase === 'error') {
    return <ErrorState onRetry={() => void load()} />;
  }

  return (
    <div className="grid gap-6">
      {readOnly ? <Alert variant="info">{TEAM_READ_ONLY_MESSAGE}</Alert> : null}
      {notice ? <Alert variant="success">{notice}</Alert> : null}
      {actionError ? <Alert variant="error">{actionError}</Alert> : null}

      {!readOnly && editor.kind === 'none' ? (
        <div>
          <Button
            onClick={() => {
              setNotice(null);
              setActionError(null);
              setEditor({ kind: 'invite' });
            }}
          >
            Invite member
          </Button>
        </div>
      ) : null}

      {editor.kind === 'invite' ? (
        <AddMemberForm
          members={members}
          busy={formBusy}
          error={formError}
          onSubmit={(values) => void handleInvite(values)}
          onCancel={() => {
            setEditor({ kind: 'none' });
            setFormError(null);
          }}
        />
      ) : null}

      <section aria-labelledby="members-heading" className="grid gap-3">
        <h2 id="members-heading" className="text-lg font-semibold text-foreground">
          Members
        </h2>

        {members.length === 0 && editor.kind === 'none' ? (
          <EmptyState
            title="No staff"
            description="Invite your first teammate by email and give them a role."
            action={
              !readOnly ? (
                <Button
                  onClick={() => {
                    setNotice(null);
                    setActionError(null);
                    setEditor({ kind: 'invite' });
                  }}
                >
                  Invite member
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="grid gap-3">
            {members.map((member) => (
              <TeamMemberItem
                key={member.id}
                member={member}
                readOnly={readOnly}
                confirming={confirmingId === member.id}
                busy={removeBusy}
                error={confirmingId === member.id ? removeError : null}
                onRoleChange={(row, role) => void handleRoleChange(row, role)}
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
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
