/**
 * Availability domain (M4): pure decision logic for availability search.
 *
 * Every function here is deterministic and I/O-free so it can be unit tested
 * without a database; route handlers load the rows and pass them in. Conflict
 * semantics mirror the reservation exclusion constraint in
 * 001_initial_schema.sql: tstzrange(starts_at, ends_at) uses PostgreSQL's
 * default [starts_at, ends_at) half-open bounds, so two windows conflict if
 * and only if aStart < bEnd && bStart < aEnd.
 *
 * Operating-hours gate: computeAvailability first evaluates the search window
 * with src/server/hours.ts against the restaurant's operating_hours rows and
 * restaurants.timezone; a closed window (or fail-closed validation) yields no
 * options at all. Overnight hours remain unsupported per the schema note in
 * 001_initial_schema.sql (same-day hours only) — cross-midnight windows are
 * closed by evaluateOperatingHours.
 */

import { evaluateOperatingHours, type HoursContext } from '@/server/hours';

export class AvailabilityError extends Error {
  readonly code: 'VALIDATION';

  constructor(message: string) {
    super(message);
    this.name = 'AvailabilityError';
    this.code = 'VALIDATION';
  }
}

export interface AvailabilityParams {
  restaurantId: string;
  startsAt: string;
  endsAt: string;
  partySize: number;
}

export interface TableRecord {
  id: string;
  label: string;
  capacity: number;
}

export interface GroupRecord {
  id: string;
  name: string;
}

export interface GroupMemberRecord {
  group_id: string;
  table_id: string;
}

/** An active reservation_tables row covering part of the search window. */
export interface AssignmentRecord {
  table_id: string;
  starts_at: string;
  ends_at: string;
}

export interface AvailabilityOption {
  kind: 'table' | 'group';
  id: string;
  label: string;
  tableIds: string[];
  capacity: number;
  surplus: number;
}

export interface AvailabilityInput {
  params: AvailabilityParams;
  tables: readonly TableRecord[];
  groups: readonly GroupRecord[];
  members: readonly GroupMemberRecord[];
  assignments: readonly AssignmentRecord[];
  /** Restaurant-local opening hours: the hours gate runs before capacity/conflict work. */
  hours: HoursContext;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// ISO 8601 date-time with a mandatory timezone offset — availability windows
// are absolute instants, so naive local timestamps are rejected.
const ISO_8601_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/;
const POSITIVE_INT_RE = /^\d+$/;

function parseInstant(
  value: string | null | undefined,
  field: string,
): { raw: string; time: number } {
  if (typeof value !== 'string' || !ISO_8601_RE.test(value)) {
    throw new AvailabilityError(`${field} must be an ISO 8601 timestamp with a timezone offset`);
  }
  const time = Date.parse(value);
  if (Number.isNaN(time)) {
    throw new AvailabilityError(`${field} must be an ISO 8601 timestamp with a timezone offset`);
  }
  return { raw: value, time };
}

/**
 * Validate raw request inputs (route params + query string) and normalize
 * them. Throws AvailabilityError with code 'VALIDATION' on any invalid or
 * non-positive input.
 */
export function parseAvailabilityParams(input: {
  restaurantId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  partySize?: string | null;
}): AvailabilityParams {
  const { restaurantId, startsAt, endsAt, partySize } = input;

  if (typeof restaurantId !== 'string' || !UUID_RE.test(restaurantId)) {
    throw new AvailabilityError('restaurantId must be a valid UUID');
  }

  const starts = parseInstant(startsAt, 'starts_at');
  const ends = parseInstant(endsAt, 'ends_at');
  if (ends.time <= starts.time) {
    throw new AvailabilityError('ends_at must be after starts_at');
  }

  if (typeof partySize !== 'string' || !POSITIVE_INT_RE.test(partySize) || Number(partySize) <= 0) {
    throw new AvailabilityError('party_size must be a positive integer');
  }

  return {
    restaurantId,
    startsAt: starts.raw,
    endsAt: ends.raw,
    partySize: Number(partySize),
  };
}

/**
 * Half-open overlap test matching the exclusion constraint's tstzrange
 * semantics: windows that only touch at an endpoint do not conflict.
 */
export function overlapsHalfOpen(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function rankByKind(option: AvailabilityOption): number {
  return option.kind === 'table' ? 0 : 1;
}

/**
 * Build the ranked availability list for one search window.
 *
 * - Single tables qualify when capacity >= party_size and no active
 *   assignment overlaps the window.
 * - A group qualifies when every member table belongs to this restaurant's
 *   result set, none is busy, and the combined capacity covers the party.
 * - Ranking: smallest capacity surplus first, then single table before group,
 *   then stable id ascending.
 * - The window must fit inside the restaurant's operating hours (see hours.ts);
 *   a closed window short-circuits to an empty list.
 */
export function computeAvailability(input: AvailabilityInput): AvailabilityOption[] {
  const { params, tables, groups, members, assignments, hours } = input;

  // Hours gate first: when the restaurant is closed for this window (or hours
  // validation fails closed), there are no options regardless of capacity.
  const hoursDecision = evaluateOperatingHours({
    startsAt: params.startsAt,
    endsAt: params.endsAt,
    timeZone: hours.timeZone,
    hours: hours.hours,
  });
  if (!hoursDecision.open) {
    return [];
  }

  const startsTime = Date.parse(params.startsAt);
  const endsTime = Date.parse(params.endsAt);

  const busyTableIds = new Set<string>();
  for (const assignment of assignments) {
    const assignmentStart = Date.parse(assignment.starts_at);
    const assignmentEnd = Date.parse(assignment.ends_at);
    if (Number.isNaN(assignmentStart) || Number.isNaN(assignmentEnd)) {
      throw new Error(`Invalid assignment window for table ${assignment.table_id}`);
    }
    if (overlapsHalfOpen(assignmentStart, assignmentEnd, startsTime, endsTime)) {
      busyTableIds.add(assignment.table_id);
    }
  }

  const tablesById = new Map(tables.map((table) => [table.id, table]));
  const options: AvailabilityOption[] = [];

  for (const table of tables) {
    if (busyTableIds.has(table.id) || table.capacity < params.partySize) {
      continue;
    }
    options.push({
      kind: 'table',
      id: table.id,
      label: table.label,
      tableIds: [table.id],
      capacity: table.capacity,
      surplus: table.capacity - params.partySize,
    });
  }

  const membersByGroup = new Map<string, string[]>();
  for (const member of members) {
    const existing = membersByGroup.get(member.group_id);
    if (existing) {
      existing.push(member.table_id);
    } else {
      membersByGroup.set(member.group_id, [member.table_id]);
    }
  }

  for (const group of groups) {
    const memberTableIds = membersByGroup.get(group.id) ?? [];
    const memberTables: TableRecord[] = [];
    let allMembersValid = memberTableIds.length > 0;
    for (const tableId of memberTableIds) {
      const table = tablesById.get(tableId);
      if (!table || busyTableIds.has(tableId)) {
        // A member outside this restaurant's tables (cross-tenant data) or a
        // busy member makes the whole joined group unusable.
        allMembersValid = false;
        break;
      }
      memberTables.push(table);
    }
    if (!allMembersValid) {
      continue;
    }

    const capacity = memberTables.reduce((sum, table) => sum + table.capacity, 0);
    if (capacity < params.partySize) {
      continue;
    }
    options.push({
      kind: 'group',
      id: group.id,
      label: group.name,
      tableIds: memberTables.map((table) => table.id),
      capacity,
      surplus: capacity - params.partySize,
    });
  }

  options.sort(
    (a, b) =>
      a.surplus - b.surplus ||
      rankByKind(a) - rankByKind(b) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  return options;
}
