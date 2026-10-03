import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Membership reads/writes for team management (M10 Phase 2, plan screen
 * 30) plus the shared role gate the settings PUT uses.
 *
 * Dual-layer authorization, mirroring src/server/floor-writes.ts: every
 * function checks the caller's role app-side (clean 403 instead of a
 * policy error) and then performs writes on the caller's cookie client,
 * so the owner-only RLS policies from 002 (memberships_insert_owner,
 * memberships_update_owner, memberships_delete_owner) remain an active
 * backstop. Reads that RLS scopes away from staff (memberships_select_own
 * hides other members from a staff-role caller) run on the service client
 * only after that explicit membership check — the service key never
 * reaches the browser.
 *
 * Account lookup is unavoidable server-side: `public.profiles` carries no
 * email column and `auth.users` is not queryable from PostgREST, so
 * email → user resolution goes through the auth admin API
 * (listUsers paging / getUserById / createUser).
 *
 * Invite semantics (judgment call — plan has no invite wording): an
 * unknown email gets an account created via admin createUser with
 * email_confirm and a random password. Plan line 180 keeps email
 * delivery "stub only [FUTURE]", so no invite/confirmation mail is sent;
 * when SMTP ships this becomes inviteUserByEmail. Existing emails attach
 * to their current account. Duplicate memberships are a 409 using the
 * team client's own copy, and last-owner protection keeps the final
 * owner from being demoted or removed (409).
 *
 * Error contract: MembershipError codes map to 403 / 404 / 400 / 409 in
 * each route's errorStatus helper; anything else is an unexpected
 * failure and stays an opaque 500.
 */

export class MembershipError extends Error {
  readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION' | 'CONFLICT';

  constructor(code: 'FORBIDDEN' | 'NOT_FOUND' | 'VALIDATION' | 'CONFLICT', message: string) {
    super(message);
    this.name = 'MembershipError';
    this.code = code;
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mirrors team-client's EMAIL_RE (invite form rule). */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 001_initial_schema CHECK values; same order as team-client TEAM_ROLES. */
const MEMBER_ROLES = ['owner', 'manager', 'staff'];

/** listUsers page size (supported per auth-js docs example). */
const USERS_PAGE_SIZE = 1000;
/** Safety cap on email-lookup paging (10 pages x 1000 accounts). */
const MAX_USER_PAGES = 10;

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Service client for admin/RLS-free reads; server-side only. */
function createServiceClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error('Missing Supabase server configuration');
  }
  return createSupabaseClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** One team row as the client contract shapes it (membership id + profile name). */
export interface MemberRecord {
  id: string;
  name: string;
  email: string;
  role: string;
}

/**
 * Throws unless the caller holds one of `roles` on the restaurant —
 * the floor-writes requireManagerOrOwner check generalized over the role
 * set, with the message supplied by the caller.
 */
export async function requireRole(
  client: SupabaseClient,
  userId: string,
  restaurantId: string,
  roles: string[],
  message: string,
): Promise<void> {
  const { data, error } = await client
    .from('restaurant_memberships')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('user_id', userId)
    .in('role', roles)
    .limit(1);

  if (error) {
    throw new Error(`Membership check failed: ${error.message}`);
  }
  if (!data || data.length === 0) {
    throw new MembershipError('FORBIDDEN', message);
  }
}

async function countOwners(client: SupabaseClient, restaurantId: string): Promise<number> {
  const { count, error } = await client
    .from('restaurant_memberships')
    .select('id', { count: 'exact', head: true })
    .eq('restaurant_id', restaurantId)
    .eq('role', 'owner');
  if (error) {
    throw new Error(`Owner count failed: ${error.message}`);
  }
  return count ?? 0;
}

/** Display names for member accounts (profiles trigger-populated). */
async function profileNames(
  service: SupabaseClient,
  userIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (userIds.length === 0) {
    return names;
  }
  const { data, error } = await service
    .from('profiles')
    .select('id, full_name')
    .in('id', userIds);
  if (error) {
    throw new Error(`Failed to load profiles: ${error.message}`);
  }
  for (const row of data ?? []) {
    names.set(row.id, row.full_name ?? '');
  }
  return names;
}

/** Account email for one user via the auth admin API (no email in profiles). */
async function memberEmail(service: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await service.auth.admin.getUserById(userId);
  if (error) {
    throw new Error(`Failed to load member account: ${error.message}`);
  }
  return data.user?.email ?? '';
}

/**
 * Resolve an email to an auth account, creating a confirmed account with
 * a random password when the address is unregistered (see the module
 * docblock for the no-SMTP rationale). Lookup pages listUsers until the
 * address matches or pages run out.
 */
async function resolveUserByEmail(
  service: SupabaseClient,
  email: string,
): Promise<{ id: string; email: string }> {
  const normalized = email.toLowerCase();
  let page = 1;
  for (let visited = 0; visited < MAX_USER_PAGES; visited += 1) {
    const { data, error } = await service.auth.admin.listUsers({
      page,
      perPage: USERS_PAGE_SIZE,
    });
    if (error) {
      throw new Error(`Failed to look up account: ${error.message}`);
    }
    const users = data.users;
    const match = users.find(
      (candidate) => candidate.email && candidate.email.toLowerCase() === normalized,
    );
    if (match && match.email) {
      return { id: match.id, email: match.email };
    }
    if (users.length < USERS_PAGE_SIZE || data.nextPage === null) {
      break;
    }
    page = data.nextPage;
  }

  const password = `Tmp-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError || !created.user) {
    throw new Error(
      `Failed to create member account: ${createError?.message ?? 'unknown error'}`,
    );
  }
  return { id: created.user.id, email: created.user.email ?? email };
}

/**
 * Every member of the restaurant as { id, name, email, role }, ordered by
 * join date. The caller must hold any membership (staff included — plan
 * row 30's screen is readable by non-owners); the email hydration is one
 * admin call per member, which is fine at MVP team sizes and avoids
 * paging the whole user table.
 */
export async function listMembers(
  client: SupabaseClient,
  userId: string,
  restaurantId: string,
): Promise<MemberRecord[]> {
  if (!isValidUuid(restaurantId)) {
    throw new MembershipError('VALIDATION', 'restaurant_id must be a valid uuid');
  }
  await requireRole(
    client,
    userId,
    restaurantId,
    MEMBER_ROLES,
    'Membership required for this restaurant',
  );

  const service = createServiceClient();
  const { data: memberships, error } = await service
    .from('restaurant_memberships')
    .select('id, user_id, role')
    .eq('restaurant_id', restaurantId)
    .order('created_at', { ascending: true });
  if (error) {
    throw new Error(`Failed to load members: ${error.message}`);
  }

  const rows = memberships ?? [];
  const names = await profileNames(
    service,
    rows.map((row) => row.user_id),
  );
  const members: MemberRecord[] = [];
  for (const row of rows) {
    members.push({
      id: row.id,
      name: names.get(row.user_id) ?? '',
      email: await memberEmail(service, row.user_id),
      role: row.role,
    });
  }
  return members;
}

/**
 * Add a member by email (owner-only). The email resolves to an auth
 * account (created when unregistered — module docblock), existing
 * memberships 409 with the team client's duplicate copy, and the insert
 * runs on the cookie client so memberships_insert_owner backstops the
 * app-side owner check.
 */
export async function addMember(
  client: SupabaseClient,
  userId: string,
  body: unknown,
): Promise<MemberRecord> {
  const record =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const restaurantId = record.restaurant_id;
  const email = typeof record.email === 'string' ? record.email.trim() : '';
  const role = record.role;

  if (!isValidUuid(restaurantId)) {
    throw new MembershipError('VALIDATION', 'restaurant_id must be a valid uuid');
  }
  if (!EMAIL_RE.test(email)) {
    throw new MembershipError('VALIDATION', 'email must be a valid email address');
  }
  if (typeof role !== 'string' || !MEMBER_ROLES.includes(role)) {
    throw new MembershipError(
      'VALIDATION',
      `role must be one of: ${MEMBER_ROLES.join(', ')}`,
    );
  }

  const { data: restaurant, error: restaurantError } = await client
    .from('restaurants')
    .select('id')
    .eq('id', restaurantId)
    .maybeSingle();
  if (restaurantError) {
    throw new Error(`Restaurant lookup failed: ${restaurantError.message}`);
  }
  if (!restaurant) {
    throw new MembershipError('NOT_FOUND', 'Restaurant not found');
  }

  await requireRole(
    client,
    userId,
    restaurantId,
    ['owner'],
    'Owner role required for this restaurant',
  );

  const service = createServiceClient();
  const account = await resolveUserByEmail(service, email);

  const { data: existing, error: existingError } = await client
    .from('restaurant_memberships')
    .select('id')
    .eq('restaurant_id', restaurantId)
    .eq('user_id', account.id)
    .maybeSingle();
  if (existingError) {
    throw new Error(`Membership lookup failed: ${existingError.message}`);
  }
  if (existing) {
    throw new MembershipError('CONFLICT', 'That email is already on the team.');
  }

  const { data: inserted, error: insertError } = await client
    .from('restaurant_memberships')
    .insert({ restaurant_id: restaurantId, user_id: account.id, role })
    .select('id, role')
    .single();
  if (insertError) {
    // UNIQUE(restaurant_id, user_id) — a concurrent add of the same email.
    if (insertError.code === '23505') {
      throw new MembershipError('CONFLICT', 'That email is already on the team.');
    }
    throw new Error(`Failed to add member: ${insertError.message}`);
  }

  const names = await profileNames(service, [account.id]);
  return {
    id: inserted.id,
    name: names.get(account.id) ?? '',
    email: account.email,
    role: inserted.role,
  };
}

/**
 * Change a member's role (owner-only). The membership row is fetched on
 * the cookie client first (RLS-scoped), so a caller who cannot see the
 * row gets 404 without leaking its existence; demoting the final owner
 * is a 409.
 */
export async function changeMemberRole(
  client: SupabaseClient,
  userId: string,
  memberId: string,
  body: unknown,
): Promise<MemberRecord> {
  if (!isValidUuid(memberId)) {
    throw new MembershipError('NOT_FOUND', 'Member not found');
  }
  const record =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const role = record.role;
  if (typeof role !== 'string' || !MEMBER_ROLES.includes(role)) {
    throw new MembershipError(
      'VALIDATION',
      `role must be one of: ${MEMBER_ROLES.join(', ')}`,
    );
  }

  const { data: membership, error } = await client
    .from('restaurant_memberships')
    .select('id, restaurant_id, user_id, role')
    .eq('id', memberId)
    .maybeSingle();
  if (error) {
    throw new Error(`Member lookup failed: ${error.message}`);
  }
  if (!membership) {
    throw new MembershipError('NOT_FOUND', 'Member not found');
  }

  await requireRole(
    client,
    userId,
    membership.restaurant_id,
    ['owner'],
    'Owner role required for this restaurant',
  );

  if (membership.role === 'owner' && role !== 'owner') {
    if ((await countOwners(client, membership.restaurant_id)) <= 1) {
      throw new MembershipError(
        'CONFLICT',
        'Cannot demote the last owner — promote another owner first.',
      );
    }
  }

  const { data: updated, error: updateError } = await client
    .from('restaurant_memberships')
    .update({ role })
    .eq('id', membership.id)
    .select('id, role')
    .maybeSingle();
  if (updateError) {
    throw new Error(`Failed to update member role: ${updateError.message}`);
  }
  if (!updated) {
    throw new MembershipError('NOT_FOUND', 'Member not found');
  }

  const service = createServiceClient();
  const names = await profileNames(service, [membership.user_id]);
  return {
    id: updated.id,
    name: names.get(membership.user_id) ?? '',
    email: await memberEmail(service, membership.user_id),
    role: updated.role,
  };
}

/**
 * Remove a member (owner-only), protecting the final owner (409). The
 * row is fetched RLS-scoped first, so invisible rows are 404.
 */
export async function removeMember(
  client: SupabaseClient,
  userId: string,
  memberId: string,
): Promise<void> {
  if (!isValidUuid(memberId)) {
    throw new MembershipError('NOT_FOUND', 'Member not found');
  }

  const { data: membership, error } = await client
    .from('restaurant_memberships')
    .select('id, restaurant_id, role')
    .eq('id', memberId)
    .maybeSingle();
  if (error) {
    throw new Error(`Member lookup failed: ${error.message}`);
  }
  if (!membership) {
    throw new MembershipError('NOT_FOUND', 'Member not found');
  }

  await requireRole(
    client,
    userId,
    membership.restaurant_id,
    ['owner'],
    'Owner role required for this restaurant',
  );

  if (membership.role === 'owner') {
    if ((await countOwners(client, membership.restaurant_id)) <= 1) {
      throw new MembershipError(
        'CONFLICT',
        'Cannot remove the last owner — promote another owner first.',
      );
    }
  }

  const { data: deleted, error: deleteError } = await client
    .from('restaurant_memberships')
    .delete()
    .eq('id', membership.id)
    .select('id');
  if (deleteError) {
    throw new Error(`Failed to remove member: ${deleteError.message}`);
  }
  if (!deleted || deleted.length === 0) {
    throw new MembershipError('NOT_FOUND', 'Member not found');
  }
}
