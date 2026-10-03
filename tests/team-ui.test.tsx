import { renderToString } from 'react-dom/server';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StaffTeamPage from '@/app/staff/team/page';
import { AddMemberForm } from '@/components/staff/AddMemberForm';
import { TeamMemberItem } from '@/components/staff/TeamMemberItem';
import {
  TEAM_ROLES,
  canManageTeam,
  memberPath,
  membersPath,
  validateInviteForm,
  type InviteFormValues,
  type TeamMember,
} from '@/lib/team-client';

/**
 * M10 Phase 2 render + helper tests (conventions: tests/settings-ui — node
 * environment, renderToString; effects do not run, so the page asserts its
 * initial loading state with useAuth mocked for the auth guard).
 *
 * Covers: the invite form (email Field + role select, API error alert),
 * the member row in owner state (badge + role dropdown + Remove), the
 * read-only state (badge only — manager/staff), and the inline removal
 * confirmation (safe default first, per the GroupItem/WaitlistItem
 * convention); plus the invite validation mirror (valid email, known
 * role, not already on the team) and the owner-only gate/paths.
 */

const authState = vi.hoisted(() => ({
  user: null as { email: string } | null,
  loading: false,
}));

vi.mock('@/components/auth/AuthProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/auth/AuthProvider')>();
  return {
    ...actual,
    useAuth: () => ({
      user: authState.user,
      loading: authState.loading,
      signOut: async () => {},
    }),
  };
});

/** Render and strip React's SSR text-node markers for readable assertions. */
function render(ui: ReactElement): string {
  return renderToString(ui).replace(/<!-- -->/g, '');
}

const noop = () => {};

const MEMBER: TeamMember = {
  id: 'm-1',
  name: 'Sam Ortiz',
  email: 'sam@bistro.dev',
  role: 'manager',
};

const INVITE_VALUES: InviteFormValues = { email: 'sam@bistro.dev', role: 'staff' };

beforeEach(() => {
  authState.user = { email: 'owner@example.com' };
  authState.loading = false;
});

describe('Staff Management page (initial render)', () => {
  it('renders its heading, loading state, and back link', () => {
    const html = render(<StaffTeamPage />);
    expect(html).toContain('Staff Management');
    expect(html).toContain('Loading team');
    expect(html).toContain('Back to dashboard');
  });
});

describe('AddMemberForm', () => {
  it('renders the email field and role select with all three roles', () => {
    const html = render(
      <AddMemberForm members={[]} onSubmit={noop} onCancel={noop} />,
    );
    expect(html).toContain('for="team-invite-email"');
    expect(html).toContain('id="team-invite-email"');
    expect(html).toContain('for="team-invite-role"');
    expect(html).toContain('id="team-invite-role"');
    for (const role of TEAM_ROLES) {
      expect(html).toContain(`value="${role}"`);
    }
    expect(html).toContain('<span>Send invite</span>');
    expect(html).toContain('<span>Cancel</span>');
  });

  it('shows the inline API error as an alert', () => {
    const html = render(
      <AddMemberForm members={[]} error="Invite failed" onSubmit={noop} onCancel={noop} />,
    );
    expect(html).toContain('Invite failed');
    expect(html).toContain('role="alert"');
  });
});

describe('TeamMemberItem (owner state)', () => {
  it('shows name, email, role badge, the role select, and Remove', () => {
    const html = render(
      <TeamMemberItem
        member={MEMBER}
        onRoleChange={noop}
        onAskRemove={noop}
        onConfirmRemove={noop}
        onCancelRemove={noop}
      />,
    );
    expect(html).toContain('Sam Ortiz');
    expect(html).toContain('sam@bistro.dev');
    expect(html).toContain('id="team-role-m-1"');
    expect(html).toContain('for="team-role-m-1"');
    expect(html).toContain('Change role for Sam Ortiz');
    expect(html).toContain('<span>Remove</span>');
    // Badge text carries the role alongside the dropdown.
    expect(html).toContain('manager');
  });
});

describe('TeamMemberItem (read-only state)', () => {
  it('keeps the role badge but hides the select and Remove button', () => {
    const html = render(
      <TeamMemberItem
        member={MEMBER}
        readOnly
        onRoleChange={noop}
        onAskRemove={noop}
        onConfirmRemove={noop}
        onCancelRemove={noop}
      />,
    );
    expect(html).toContain('Sam Ortiz');
    expect(html).toContain('manager');
    expect(html).not.toContain('team-role-');
    expect(html).not.toContain('Remove');
  });
});

describe('TeamMemberItem (inline confirmation)', () => {
  it('offers the safe default first and keeps the confirmation accessible', () => {
    const html = render(
      <TeamMemberItem
        member={MEMBER}
        confirming
        onRoleChange={noop}
        onAskRemove={noop}
        onConfirmRemove={noop}
        onCancelRemove={noop}
      />,
    );
    expect(html).toContain('role="group"');
    expect(html).toContain('Confirm removal of Sam Ortiz');
    expect(html).toContain('Remove “Sam Ortiz” from the team?');
    const keepIndex = html.indexOf('Keep member');
    const removeIndex = html.indexOf('Yes, remove them');
    expect(keepIndex).toBeGreaterThan(-1);
    expect(removeIndex).toBeGreaterThan(keepIndex);
    // The open panel replaces the row controls entirely.
    expect(html).not.toContain('team-role-');
  });

  it('shows the API error inside the confirmation panel as an alert', () => {
    const html = render(
      <TeamMemberItem
        member={MEMBER}
        confirming
        error="Could not remove member"
        onRoleChange={noop}
        onAskRemove={noop}
        onConfirmRemove={noop}
        onCancelRemove={noop}
      />,
    );
    expect(html).toContain('Could not remove member');
    expect(html).toContain('role="alert"');
  });
});

describe('validateInviteForm', () => {
  it('rejects empty or malformed emails', () => {
    for (const email of ['', '   ', 'not-an-email', 'a@b', 'sam@bistro']) {
      expect(validateInviteForm({ email, role: 'staff' })).toEqual({
        email: 'Enter a valid email address.',
      });
    }
  });

  it('rejects an email that is already on the team (case-insensitive)', () => {
    expect(validateInviteForm({ email: 'Sam@Bistro.dev', role: 'staff' }, [MEMBER])).toEqual({
      email: 'That email is already on the team.',
    });
  });

  it('rejects unknown roles', () => {
    expect(validateInviteForm({ email: 'kim@bistro.dev', role: 'admin' })).toEqual({
      role: 'Choose a role.',
    });
  });

  it('accepts a valid invite', () => {
    expect(
      validateInviteForm({ email: '  kim@bistro.dev  ', role: 'manager' }, [MEMBER]),
    ).toEqual({});
  });
});

describe('team helpers', () => {
  it('builds the collection and item paths with encoding', () => {
    expect(membersPath('r-1')).toBe('/api/staff/members?restaurant_id=r-1');
    expect(memberPath('m 1')).toBe('/api/staff/members/m%201');
  });

  it('gates management on the owner role only', () => {
    expect(canManageTeam('owner')).toBe(true);
    expect(canManageTeam('manager')).toBe(false);
    expect(canManageTeam('staff')).toBe(false);
    expect(canManageTeam('')).toBe(false);
  });
});
