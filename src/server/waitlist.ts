import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Waitlist queue reads and writes (plan screen 23 backend).
 *
 * Follows the floor.ts / floor-writes.ts conventions: explicit role
 * checks server-side so failures are a clean 403 rather than an RLS
 * policy error, validation at the boundary, and tenant scope checked on
 * every query — all through the caller's cookie client, so the 009 RLS
 * policies (is_staff read, owner/manager CRUD) still apply as the
 * backstop. Contract mirrors src/lib/waitlist-client.ts:
 *
 *   GET    /api/waitlist?restaurant_id=<uuid>  -> { entries } (ordered)
 *   POST   /api/waitlist      { restaurant_id, name, party_size, phone,
 *                               notes } -> 201 { entry }  (appends)
 *   PATCH  /api/waitlist/[id] { position?, status? } -> { entry }
 *   DELETE /api/waitlist/[id] -> { deleted: true }
 *
 * Position math: every move reassigns the whole restaurant's queue to
 * distinct 1..N integers in (position, created_at) order — the same
 * ordering sortWaitlist applies client-side — by updating only the rows
 * whose position actually changed (an adjacent move costs two updates).
 * Reindexing keeps concurrent moves conflict-free without a uniqueness
 * constraint; ties are healed by the next move. Item routes resolve the
 * entry first (RLS-scoped), so a non-member sees 404 — existence is not
 * leaked — while a member with the wrong role sees 403.
 */

export class WaitlistError extends Error {
  readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION';

  constructor(code: 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION', message: string) {
    super(message);
    this.name = 'WaitlistError';
    this.code = code;
  }
}

export const WAITLIST_STATUSES = ['waiting', 'seated', 'cancelled', 'no_show'] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNS =
  'id, restaurant_id, name, party_size, phone, notes, status, position, created_at';

function isStatus(value: unknown): value is WaitlistStatus {
  return WAITLIST_STATUSES.includes(value as WaitlistStatus);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Throws unless the caller holds any membership on the restaurant. */
async function requireMembership(
  client: SupabaseClient,
  userId: string,
  restaurantId: string,
): Promise<void> {
  const { data, error } = await client
    .from('restaurant_memberships')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('user_id', userId)
    .limit(1);

  if (error) {
    throw new Error(`Membership check failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new WaitlistError('FORBIDDEN', 'Not a member of this restaurant');
  }
}

/** Throws unless the caller holds owner or manager on the restaurant. */
async function requireManagerOrOwner(
  client: SupabaseClient,
  userId: string,
  restaurantId: string,
): Promise<void> {
  const { data, error } = await client
    .from('restaurant_memberships')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('user_id', userId)
    .in('role', ['owner', 'manager'])
    .limit(1);

  if (error) {
    throw new Error(`Membership check failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new WaitlistError(
      'FORBIDDEN',
      'Owner or manager role required for this restaurant',
    );
  }
}

/** Queue order — must stay aligned with the client's sortWaitlist. */
async function listQueue(
  client: SupabaseClient,
  restaurantId: string,
): Promise<{ id: string; position: number }[]> {
  const { data, error } = await client
    .from('waitlist')
    .select('id, position, created_at')
    .eq('restaurant_id', restaurantId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load waitlist: ${error.message}`);
  }
  return data ?? [];
}

/**
 * Reassign this restaurant's queue to distinct 1..N positions in queue
 * order, with `entryId` moved to `targetPosition` (1-based, clamped).
 * Only rows whose position changes are written.
 */
async function reindexQueue(
  client: SupabaseClient,
  restaurantId: string,
  entryId: string,
  targetPosition: number,
): Promise<number> {
  const rows = await listQueue(client, restaurantId);
  const withoutTarget = rows.filter((row) => row.id !== entryId);
  const index = Math.min(Math.max(targetPosition, 1), withoutTarget.length + 1) - 1;
  const reordered = [
    ...withoutTarget.slice(0, index),
    { id: entryId },
    ...withoutTarget.slice(index),
  ];

  for (const [offset, row] of reordered.entries()) {
    const nextPosition = offset + 1;
    if ('position' in row && row.position === nextPosition) {
      continue;
    }
    const { error } = await client
      .from('waitlist')
      .update({ position: nextPosition })
      .eq('id', row.id)
      .eq('restaurant_id', restaurantId);
    if (error) {
      throw new Error(`Failed to reindex waitlist: ${error.message}`);
    }
  }

  return index + 1;
}

/** POST body — mirrors validateWaitlistForm/toWaitlistPayload. */
function parseCreateInput(input: unknown): {
  restaurantId: string;
  name: string;
  partySize: number;
  phone: string | null;
  notes: string | null;
} {
  if (!isRecord(input)) {
    throw new WaitlistError('VALIDATION', 'Invalid JSON body');
  }
  if (typeof input.restaurant_id !== 'string' || !UUID_RE.test(input.restaurant_id)) {
    throw new WaitlistError('VALIDATION', 'restaurant_id must be a valid uuid');
  }
  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    throw new WaitlistError('VALIDATION', 'name must be a non-empty string');
  }
  if (
    typeof input.party_size !== 'number' ||
    !Number.isInteger(input.party_size) ||
    input.party_size < 1
  ) {
    throw new WaitlistError('VALIDATION', 'party_size must be an integer of 1 or more');
  }
  if (
    input.phone !== undefined &&
    input.phone !== null &&
    typeof input.phone !== 'string'
  ) {
    throw new WaitlistError('VALIDATION', 'phone must be a string or null');
  }
  if (
    input.notes !== undefined &&
    input.notes !== null &&
    typeof input.notes !== 'string'
  ) {
    throw new WaitlistError('VALIDATION', 'notes must be a string or null');
  }

  return {
    restaurantId: input.restaurant_id,
    name: input.name.trim(),
    partySize: input.party_size,
    phone:
      typeof input.phone === 'string' && input.phone.trim().length > 0
        ? input.phone.trim()
        : null,
    notes:
      typeof input.notes === 'string' && input.notes.trim().length > 0
        ? input.notes.trim()
        : null,
  };
}

/** PATCH body — at least one of position/status, both strictly typed. */
function parsePatchInput(patch: unknown): { position?: number; status?: WaitlistStatus } {
  if (!isRecord(patch)) {
    throw new WaitlistError('VALIDATION', 'Invalid JSON body');
  }
  const hasPosition = patch.position !== undefined;
  const hasStatus = patch.status !== undefined;
  if (!hasPosition && !hasStatus) {
    throw new WaitlistError('VALIDATION', 'position or status is required');
  }
  if (
    hasPosition &&
    (typeof patch.position !== 'number' ||
      !Number.isInteger(patch.position) ||
      patch.position < 1)
  ) {
    throw new WaitlistError('VALIDATION', 'position must be an integer of 1 or more');
  }
  if (hasStatus && !isStatus(patch.status)) {
    throw new WaitlistError(
      'VALIDATION',
      `status must be one of: ${WAITLIST_STATUSES.join(', ')}`,
    );
  }
  return {
    position: hasPosition ? (patch.position as number) : undefined,
    status: hasStatus ? (patch.status as WaitlistStatus) : undefined,
  };
}

/** All entries for a restaurant the caller belongs to, in queue order. */
export async function listWaitlist(
  client: SupabaseClient,
  userId: string,
  restaurantId: string,
): Promise<Record<string, unknown>[]> {
  if (!UUID_RE.test(restaurantId)) {
    throw new WaitlistError('VALIDATION', 'restaurant_id must be a valid uuid');
  }
  await requireMembership(client, userId, restaurantId);

  const { data, error } = await client
    .from('waitlist')
    .select(COLUMNS)
    .eq('restaurant_id', restaurantId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load waitlist: ${error.message}`);
  }
  return data ?? [];
}

/** Add a party to the end of the queue; returns the stored row. */
export async function createWaitlistEntry(
  client: SupabaseClient,
  userId: string,
  input: unknown,
): Promise<Record<string, unknown>> {
  const parsed = parseCreateInput(input);
  await requireManagerOrOwner(client, userId, parsed.restaurantId);

  const { data: last, error: lastError } = await client
    .from('waitlist')
    .select('position')
    .eq('restaurant_id', parsed.restaurantId)
    .order('position', { ascending: false })
    .limit(1);
  if (lastError) {
    throw new Error(`Failed to read queue position: ${lastError.message}`);
  }
  const nextPosition = last && last.length > 0 ? (last[0].position as number) + 1 : 1;

  const { data, error } = await client
    .from('waitlist')
    .insert({
      restaurant_id: parsed.restaurantId,
      name: parsed.name,
      party_size: parsed.partySize,
      phone: parsed.phone,
      notes: parsed.notes,
      position: nextPosition,
    })
    .select(COLUMNS)
    .single();

  if (error) {
    throw new Error(`Failed to create waitlist entry: ${error.message}`);
  }
  return data;
}

/** Update a queue position and/or status; returns the stored row. */
export async function updateWaitlistEntry(
  client: SupabaseClient,
  userId: string,
  entryId: string,
  patch: unknown,
): Promise<Record<string, unknown>> {
  // A malformed identifier cannot name a row: treat it as not found
  // rather than a validation error (the client only ever sends uuids).
  if (!UUID_RE.test(entryId)) {
    throw new WaitlistError('NOT_FOUND', 'Waitlist entry not found');
  }
  const parsed = parsePatchInput(patch);

  // RLS scopes this read to memberships; a non-member gets null -> 404,
  // a member gets the row and is then gated on role below.
  const { data: existing, error } = await client
    .from('waitlist')
    .select(COLUMNS)
    .eq('id', entryId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load waitlist entry: ${error.message}`);
  }
  if (!existing) {
    throw new WaitlistError('NOT_FOUND', 'Waitlist entry not found');
  }

  const restaurantId = existing.restaurant_id as string;
  await requireManagerOrOwner(client, userId, restaurantId);

  if (parsed.status !== undefined) {
    const { data, error: statusError } = await client
      .from('waitlist')
      .update({ status: parsed.status })
      .eq('id', entryId)
      .eq('restaurant_id', restaurantId)
      .select(COLUMNS)
      .single();
    if (statusError) {
      throw new Error(`Failed to update waitlist entry: ${statusError.message}`);
    }
    if (parsed.position === undefined) {
      return data;
    }
  }

  if (parsed.position !== undefined) {
    await reindexQueue(client, restaurantId, entryId, parsed.position);
    const { data, error: rowError } = await client
      .from('waitlist')
      .select(COLUMNS)
      .eq('id', entryId)
      .single();
    if (rowError) {
      throw new Error(`Failed to reload waitlist entry: ${rowError.message}`);
    }
    return data;
  }

  // Status-only path already returned above; this branch is unreachable
  // because parsePatchInput requires at least one field.
  throw new WaitlistError('VALIDATION', 'position or status is required');
}

/** Remove an entry from the queue. */
export async function deleteWaitlistEntry(
  client: SupabaseClient,
  userId: string,
  entryId: string,
): Promise<void> {
  if (!UUID_RE.test(entryId)) {
    throw new WaitlistError('NOT_FOUND', 'Waitlist entry not found');
  }

  const { data: existing, error } = await client
    .from('waitlist')
    .select('id, restaurant_id')
    .eq('id', entryId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to load waitlist entry: ${error.message}`);
  }
  if (!existing) {
    throw new WaitlistError('NOT_FOUND', 'Waitlist entry not found');
  }

  const restaurantId = existing.restaurant_id as string;
  await requireManagerOrOwner(client, userId, restaurantId);

  const { error: deleteError } = await client
    .from('waitlist')
    .delete()
    .eq('id', entryId)
    .eq('restaurant_id', restaurantId);
  if (deleteError) {
    throw new Error(`Failed to delete waitlist entry: ${deleteError.message}`);
  }
}
