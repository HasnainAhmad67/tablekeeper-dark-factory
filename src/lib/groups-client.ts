/**
 * Client-side table-group helpers (M7 Phase 5, plan screen 26
 * "Table-Group Builder").
 *
 * Thin fetch wrappers over the existing M4 group routes (plan's
 * `/api/groups` shorthand maps to the nested routes that actually shipped):
 *   GET    /api/restaurants/[restaurantId]/groups           -> { groups }
 *   POST   /api/restaurants/[restaurantId]/groups           -> 201 { group }
 *   PATCH  /api/restaurants/[restaurantId]/groups/[groupId] -> { group }
 *   DELETE /api/restaurants/[restaurantId]/groups/[groupId] -> { deleted: true }
 *   GET    /api/staff/me                                    -> { restaurants }
 *
 * Every non-2xx response throws GroupsApiError carrying the HTTP status, so
 * callers can implement the plan's states without re-parsing bodies:
 * 401 -> session redirect, 403 -> read-only (Manager/Owner write gate).
 *
 * validateGroupForm/toGroupPayload mirror the server's createGroup/
 * updateGroup boundary rules (src/server/floor-writes.ts): a non-empty
 * trimmed name and a uuid array. The form does not edit `description`
 * (plan decision: name + table assignment), so the edit payload omits it
 * and PATCH leaves the stored value untouched.
 */

import { fetchStaffContext as fetchStaffContextShared } from '@/lib/fetchStaffContext';

export interface StaffGroup {
  id: string;
  restaurant_id: string;
  name: string;
  description: string | null;
  table_ids: string[];
}

export interface GroupFormValues {
  name: string;
  tableIds: string[];
}

export interface GroupFieldErrors {
  name?: string;
}

/** Payload shape accepted by POST/PATCH (description intentionally omitted). */
export interface GroupPayload {
  name: string;
  table_ids: string[];
}

/** Staff membership from GET /api/staff/me — selected restaurant, else first. */
export interface StaffContext {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export class GroupsApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'GroupsApiError';
    this.status = status;
  }
}

export function groupsPath(restaurantId: string): string {
  return `/api/restaurants/${encodeURIComponent(restaurantId)}/groups`;
}

export function groupPath(restaurantId: string, groupId: string): string {
  return `${groupsPath(restaurantId)}/${encodeURIComponent(groupId)}`;
}

async function request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new GroupsApiError('Network error — please try again.', 0);
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
    throw new GroupsApiError(message, response.status);
  }
  return body;
}

function jsonInit(method: string, payload: GroupPayload): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

/**
 * Selected staff membership (stored restaurant id from the Restaurant
 * Switcher, falling back to the first membership), or null.
 */
export async function fetchStaffContext(): Promise<StaffContext | null> {
  return fetchStaffContextShared(request);
}

/** Coerce an untrusted group row; null when structurally unusable. */
function toGroup(raw: unknown): StaffGroup | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string') {
    return null;
  }
  const tableIds = Array.isArray(candidate.table_ids)
    ? [...new Set(candidate.table_ids.filter((id): id is string => typeof id === 'string'))]
    : [];
  return {
    id: candidate.id,
    restaurant_id: typeof candidate.restaurant_id === 'string' ? candidate.restaurant_id : '',
    name: candidate.name,
    description: typeof candidate.description === 'string' ? candidate.description : null,
    table_ids: tableIds,
  };
}

function byName(a: StaffGroup, b: StaffGroup): number {
  return a.name.localeCompare(b.name);
}

/** All groups for a restaurant, sorted by name (server order, kept client-side). */
export async function fetchGroups(restaurantId: string): Promise<StaffGroup[]> {
  const body = await request(groupsPath(restaurantId));
  const groups = (Array.isArray(body.groups) ? body.groups : [])
    .map(toGroup)
    .filter((group): group is StaffGroup => group !== null);
  return groups.sort(byName);
}

/** Create a group with its table assignment; returns the stored row. */
export async function createGroup(
  restaurantId: string,
  values: GroupFormValues,
): Promise<StaffGroup> {
  const body = await request(groupsPath(restaurantId), jsonInit('POST', toGroupPayload(values)));
  const group = toGroup(body.group);
  if (!group) {
    throw new GroupsApiError('Malformed group response', 0);
  }
  return group;
}

/**
 * Patch a group's name and table assignment. `description` is omitted on
 * purpose: PATCH only updates provided fields, so the stored description
 * survives an edit.
 */
export async function updateGroup(
  restaurantId: string,
  groupId: string,
  values: GroupFormValues,
): Promise<StaffGroup> {
  const body = await request(
    groupPath(restaurantId, groupId),
    jsonInit('PATCH', toGroupPayload(values)),
  );
  const group = toGroup(body.group);
  if (!group) {
    throw new GroupsApiError('Malformed group response', 0);
  }
  return group;
}

export async function deleteGroup(restaurantId: string, groupId: string): Promise<void> {
  await request(groupPath(restaurantId, groupId), { method: 'DELETE' });
}

/** Client mirror of the server's name rule (non-empty after trim). */
export function validateGroupForm(values: GroupFormValues): GroupFieldErrors {
  if (values.name.trim().length === 0) {
    return { name: 'Enter a group name.' };
  }
  return {};
}

export function toGroupPayload(values: GroupFormValues): GroupPayload {
  return {
    name: values.name.trim(),
    table_ids: [...values.tableIds],
  };
}
