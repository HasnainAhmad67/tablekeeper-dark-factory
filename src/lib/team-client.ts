/**
 * Client-side team-management helpers (M10 Phase 2, plan screen 30
 * "Staff Management").
 *
 * Contract (plan row 30: GET/POST/PATCH /api/staff/members) — no route
 * ships under src/app/api/staff/members yet (only /api/staff/me), so this
 * module defines the client half a backend must implement:
 *
 *   GET    /api/staff/members?restaurant_id=<uuid> -> { members: [...] }
 *   POST   /api/staff/members        { restaurant_id, email, role } -> 201 { member }
 *   PATCH  /api/staff/members/[id]   { role } -> { member }
 *   DELETE /api/staff/members/[id]   -> 2xx   (the remove decision needs a
 *                                            delete; plan row lists only
 *                                            GET/POST/PATCH — flagged)
 *
 * The flat collection needs the restaurant in the query/body because the
 * plan keeps /api/staff/members unnested. Role values are the
 * ('owner', 'manager', 'staff') CHECK from 001_initial_schema; RLS
 * already enforces the decisions server-side once the routes exist
 * (memberships_insert_owner, owner-only writes), and the backend owns
 * invite resolution (email -> user) and last-owner protection. Until the
 * routes land, requests fail with their HTTP status and surfaces classify
 * them: 401 -> session refresh, 403 -> read-only (requirement 7),
 * otherwise inline for retry. No local persistence is invented here.
 */

/** Editable invite values (form state). */
export interface InviteFormValues {
  email: string;
  role: string;
}

export interface InviteFieldErrors {
  email?: string;
  role?: string;
}

/** One team row: membership id, display name, account email, role. */
export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
}

/** First membership from GET /api/staff/me (single-restaurant MVP). */
export interface StaffContext {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export const TEAM_ROLES = ['owner', 'manager', 'staff'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export const TEAM_READ_ONLY_MESSAGE =
  'You have read-only access to team management — only owners can invite, change roles, or remove members.';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class TeamApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TeamApiError';
    this.status = status;
  }
}

/** Collection path with the restaurant context (flat route). */
export function membersPath(restaurantId: string): string {
  return `/api/staff/members?restaurant_id=${encodeURIComponent(restaurantId)}`;
}

/** Item path for PATCH/DELETE. */
export function memberPath(memberId: string): string {
  return `/api/staff/members/${encodeURIComponent(memberId)}`;
}

/** Owner-only write gate (add/remove/role change; manager views only). */
export function canManageTeam(role: string): boolean {
  return role === 'owner';
}

async function request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new TeamApiError('Network error — please try again.', 0);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // Non-JSON body; status handling below still applies.
  }

  if (!response.ok) {
    const message =
      typeof body.error === 'string' ? body.error : `Request failed (${response.status})`;
    throw new TeamApiError(message, response.status);
  }
  return body;
}

/** First staff membership (single-restaurant MVP context), or null. */
export async function fetchStaffContext(): Promise<StaffContext | null> {
  const body = await request('/api/staff/me');
  const first = (Array.isArray(body.restaurants) ? body.restaurants : [])[0] as
    | Partial<StaffContext>
    | undefined;
  if (!first || typeof first.id !== 'string') {
    return null;
  }
  return {
    id: first.id,
    name: typeof first.name === 'string' ? first.name : '',
    slug: typeof first.slug === 'string' ? first.slug : '',
    role: typeof first.role === 'string' ? first.role : '',
  };
}

/** Coerce one untrusted member row; null when structurally invalid. */
function toMember(raw: unknown): TeamMember | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.email !== 'string' ||
    typeof candidate.role !== 'string'
  ) {
    return null;
  }
  return {
    id: candidate.id,
    name: typeof candidate.name === 'string' ? candidate.name : '',
    email: candidate.email,
    role: candidate.role,
  };
}

export async function fetchTeamMembers(restaurantId: string): Promise<TeamMember[]> {
  const body = await request(membersPath(restaurantId));
  if (!Array.isArray(body.members)) {
    throw new TeamApiError('Malformed members response', 0);
  }
  return body.members
    .map(toMember)
    .filter((member): member is TeamMember => member !== null);
}

/** Invite by email; slug/restaurant come from the path/query, role from body. */
export async function inviteMember(
  restaurantId: string,
  values: InviteFormValues,
): Promise<TeamMember> {
  const body = await request(membersPath(restaurantId), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      restaurant_id: restaurantId,
      email: values.email.trim(),
      role: values.role,
    }),
  });
  const member = toMember(body.member);
  if (!member) {
    throw new TeamApiError('Malformed member response', 0);
  }
  return member;
}

export async function updateMemberRole(memberId: string, role: string): Promise<TeamMember> {
  const body = await request(memberPath(memberId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  const member = toMember(body.member);
  if (!member) {
    throw new TeamApiError('Malformed member response', 0);
  }
  return member;
}

export async function removeMember(memberId: string): Promise<void> {
  await request(memberPath(memberId), { method: 'DELETE' });
}

/**
 * Server's invite rules mirrored client-side (inline Field/select errors):
 * a valid email and a known role, skipping people already on the team.
 */
export function validateInviteForm(
  values: InviteFormValues,
  members: TeamMember[] = [],
): InviteFieldErrors {
  const errors: InviteFieldErrors = {};
  const email = values.email.trim();

  if (!EMAIL_RE.test(email)) {
    errors.email = 'Enter a valid email address.';
  } else if (
    members.some((member) => member.email.trim().toLowerCase() === email.toLowerCase())
  ) {
    errors.email = 'That email is already on the team.';
  }

  if (!TEAM_ROLES.includes(values.role as TeamRole)) {
    errors.role = 'Choose a role.';
  }

  return errors;
}
