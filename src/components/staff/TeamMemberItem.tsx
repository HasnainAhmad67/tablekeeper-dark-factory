import { useEffect, useRef } from 'react';

import { Alert } from '@/components/ui/Alert';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TEAM_ROLES, type TeamMember } from '@/lib/team-client';

/**
 * One team row (plan screen 30: name/email/role with badges, role dropdown,
 * inline remove confirmation — "Form labels"/keyboard a11y).
 *
 * Every state shows the member's name, email, and a role badge (text
 * carries the meaning, never colour alone) so the list satisfies the
 * view-only requirement for managers. In owner state the row adds the
 * role <select> (PATCH /api/staff/members/[memberId]) labelled per row
 * via aria-label, and the Remove button; read-only state (manager/staff
 * role, or a write returned 403) hides both affordances.
 *
 * The remove panel follows the TableItem/GroupItem/WaitlistItem
 * conventions: the safe default ("Keep member") comes first so Enter
 * never removes, Escape dismisses while idle, focus lands on the safe
 * button when the panel opens, and the API error surfaces inside it as
 * role="alert". Stack on mobile: every row/panel wraps.
 */

const ROLE_BADGES: Record<string, BadgeVariant> = {
  owner: 'success',
  manager: 'info',
  staff: 'neutral',
};

/** Field-style classes reused for the native role <select>. */
const SELECT_CLASSES =
  'rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground';

export interface TeamMemberItemProps {
  member: TeamMember;
  /** Hides the role select and remove button (manager/staff/403 state). */
  readOnly?: boolean;
  /** True while this row's remove confirmation is open. */
  confirming?: boolean;
  /** True while this row's write request is in flight. */
  busy?: boolean;
  /** Inline error for the open remove panel. */
  error?: string | null;
  onRoleChange: (member: TeamMember, role: string) => void;
  onAskRemove: (member: TeamMember) => void;
  onConfirmRemove: (member: TeamMember) => void;
  onCancelRemove: () => void;
}

export function TeamMemberItem({
  member,
  readOnly = false,
  confirming = false,
  busy = false,
  error = null,
  onRoleChange,
  onAskRemove,
  onConfirmRemove,
  onCancelRemove,
}: TeamMemberItemProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus the first (safe) button when the confirmation panel opens.
  useEffect(() => {
    if (confirming) {
      panelRef.current?.querySelector('button')?.focus();
    }
  }, [confirming]);

  const displayName = member.name.trim() || member.email;

  if (confirming) {
    return (
      <li>
        <div
          ref={panelRef}
          role="group"
          aria-label={`Confirm removal of ${displayName}`}
          className="rounded-md border border-danger/40 bg-danger/10 p-4"
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !busy) {
              onCancelRemove();
            }
          }}
        >
          <p className="text-sm font-medium text-foreground">
            Remove &ldquo;{displayName}&rdquo; from the team? They will lose access to this
            restaurant.
          </p>
          {error ? (
            <div className="mt-2">
              <Alert variant="error">{error}</Alert>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-3">
            <Button variant="secondary" disabled={busy} onClick={onCancelRemove}>
              Keep member
            </Button>
            <Button variant="danger" loading={busy} onClick={() => onConfirmRemove(member)}>
              Yes, remove them
            </Button>
          </div>
        </div>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{displayName}</p>
        <p className="mt-0.5 text-xs text-foreground-muted">{member.email}</p>
        <div className="mt-1.5">
          <Badge variant={ROLE_BADGES[member.role] ?? 'neutral'}>{member.role}</Badge>
        </div>
      </div>

      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`team-role-${member.id}`}>
            {`Change role for ${displayName}`}
          </label>
          <select
            id={`team-role-${member.id}`}
            value={member.role}
            disabled={busy}
            onChange={(event) => onRoleChange(member, event.target.value)}
            className={SELECT_CLASSES}
          >
            {TEAM_ROLES.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
          <Button
            variant="danger"
            aria-label={`Remove ${displayName}`}
            disabled={busy}
            onClick={() => onAskRemove(member)}
          >
            Remove
          </Button>
        </div>
      ) : null}
    </li>
  );
}
