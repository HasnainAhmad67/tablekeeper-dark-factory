import { RESERVATION_DURATION_MINUTES } from '@/lib/booking';

/**
 * Client-side waitlist helpers (M9 Phase 1, plan screen 23 "Waitlist").
 *
 * Thin fetch wrappers over the plan's `GET/POST /api/waitlist` contract.
 * The waitlist API and table do not exist in this codebase yet — plan
 * labels waitlist "Not in MVP / must be labelled as planned" and the
 * migrations (001-008) are frozen with no waitlist table — so this module
 * defines the client half of the contract a backend must implement:
 *   GET    /api/waitlist?restaurant_id=<uuid> -> { entries }
 *   POST   /api/waitlist                      -> 201 { entry }
 *   PATCH  /api/waitlist/[id]                 -> { entry } (position/status)
 *   DELETE /api/waitlist/[id]                 -> { deleted: true }
 *   GET    /api/staff/me                      -> { restaurants }
 * Until it lands, GET fails with 404 and the page shows the plan's Retry
 * error state; nothing here invents local persistence.
 *
 * Seating is the exception: it converts a party through the REAL M5a
 * endpoint, `POST /api/reservations`, whose idempotency contract (header
 * + body key, non-empty table_ids, explicit window) is honored here. The
 * reservation always carries the walk-in's identity in `notes` because
 * reservations belong to the session user. Conversion is two steps —
 * create the reservation, then mark the entry seated — and is therefore
 * non-atomic; seatWaitlistEntry reports that case explicitly rather than
 * pretending the queue update succeeded.
 *
 * Every non-2xx response throws WaitlistApiError carrying the HTTP status
 * so callers can implement the plan's states without re-parsing bodies:
 * 401 -> session redirect, 403 -> read-only (write gate), else inline.
 */

export type WaitlistStatus = 'waiting' | 'seated' | 'cancelled' | 'no_show';

export const WAITLIST_STATUS_LABELS: Record<WaitlistStatus, string> = {
  waiting: 'Waiting',
  seated: 'Seated',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};

export interface WaitlistEntry {
  id: string;
  restaurant_id: string;
  name: string;
  party_size: number;
  phone: string | null;
  notes: string | null;
  status: WaitlistStatus;
  /** 1-based queue position; the server reindexes on every move. */
  position: number;
  created_at: string;
}

/** Form state — party size stays a string until validation coerces it. */
export interface WaitlistFormValues {
  name: string;
  partySize: string;
  phone: string;
  notes: string;
}

export interface WaitlistFieldErrors {
  name?: string;
  partySize?: string;
}

/** Payload accepted by POST /api/waitlist. */
export interface WaitlistPayload {
  name: string;
  party_size: number;
  phone: string | null;
  notes: string | null;
}

/** First membership from GET /api/staff/me (single-restaurant MVP). */
export interface StaffContext {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export class WaitlistApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'WaitlistApiError';
    this.status = status;
  }
}

export function waitlistPath(restaurantId: string): string {
  return `/api/waitlist?restaurant_id=${encodeURIComponent(restaurantId)}`;
}

export function waitlistEntryPath(entryId: string): string {
  return `/api/waitlist/${encodeURIComponent(entryId)}`;
}

async function request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new WaitlistApiError('Network error — please try again.', 0);
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
    throw new WaitlistApiError(message, response.status);
  }
  return body;
}

function jsonInit(method: string, payload: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
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

function isWaitlistStatus(value: unknown): value is WaitlistStatus {
  return (
    value === 'waiting' || value === 'seated' || value === 'cancelled' || value === 'no_show'
  );
}

/** Coerce an untrusted row; null when structurally unusable. */
function toEntry(raw: unknown): WaitlistEntry | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.name !== 'string' ||
    typeof candidate.party_size !== 'number' ||
    typeof candidate.position !== 'number' ||
    !isWaitlistStatus(candidate.status)
  ) {
    return null;
  }
  return {
    id: candidate.id,
    restaurant_id: typeof candidate.restaurant_id === 'string' ? candidate.restaurant_id : '',
    name: candidate.name,
    party_size: candidate.party_size,
    phone: typeof candidate.phone === 'string' ? candidate.phone : null,
    notes: typeof candidate.notes === 'string' ? candidate.notes : null,
    status: candidate.status,
    position: candidate.position,
    created_at: typeof candidate.created_at === 'string' ? candidate.created_at : '',
  };
}

/** Queue order: position first, then first-come first-served on ties. */
export function sortWaitlist(entries: WaitlistEntry[]): WaitlistEntry[] {
  return [...entries].sort(
    (a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at),
  );
}

/** All waitlist entries for a restaurant, in queue order. */
export async function fetchWaitlist(restaurantId: string): Promise<WaitlistEntry[]> {
  const body = await request(waitlistPath(restaurantId));
  const entries = (Array.isArray(body.entries) ? body.entries : [])
    .map(toEntry)
    .filter((entry): entry is WaitlistEntry => entry !== null);
  return sortWaitlist(entries);
}

/** Add a party to the end of the queue; returns the stored row. */
export async function addWaitlistEntry(
  restaurantId: string,
  values: WaitlistFormValues,
): Promise<WaitlistEntry> {
  const body = await request('/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ restaurant_id: restaurantId, ...toWaitlistPayload(values) }),
  });
  const entry = toEntry(body.entry);
  if (!entry) {
    throw new WaitlistApiError('Malformed waitlist response', 0);
  }
  return entry;
}

/** Update a queue position and/or status; returns the stored row. */
export async function updateWaitlistEntry(
  entryId: string,
  patch: { position?: number; status?: WaitlistStatus },
): Promise<WaitlistEntry> {
  const body = await request(waitlistEntryPath(entryId), jsonInit('PATCH', patch));
  const entry = toEntry(body.entry);
  if (!entry) {
    throw new WaitlistApiError('Malformed waitlist response', 0);
  }
  return entry;
}

export async function removeWaitlistEntry(entryId: string): Promise<void> {
  await request(waitlistEntryPath(entryId), { method: 'DELETE' });
}

/** Server's add-party rules mirrored client-side (inline Field errors). */
export function validateWaitlistForm(values: WaitlistFormValues): WaitlistFieldErrors {
  const errors: WaitlistFieldErrors = {};
  if (values.name.trim().length === 0) {
    errors.name = 'Enter a name.';
  }
  const trimmedSize = values.partySize.trim();
  if (!/^\d+$/.test(trimmedSize) || Number(trimmedSize) < 1) {
    errors.partySize = 'Enter a party size of 1 or more.';
  }
  return errors;
}

export function toWaitlistPayload(values: WaitlistFormValues): WaitlistPayload {
  return {
    name: values.name.trim(),
    party_size: Number(values.partySize.trim()),
    phone: values.phone.trim() || null,
    notes: values.notes.trim() || null,
  };
}

/** Seating target — the existing M5a booking endpoint. */
export const SEATING_PATH = '/api/reservations';

export interface SeatingRequest {
  path: string;
  init: RequestInit;
}

/**
 * Preserve the walk-in's identity on the reservation: identity always
 * comes from the session, so name/phone ride along in `notes`.
 */
export function seatingNotes(entry: WaitlistEntry): string {
  const contact = entry.phone ? ` · ${entry.phone}` : '';
  const detail = entry.notes ? ` — ${entry.notes}` : '';
  return `Walk-in: ${entry.name}${contact}${detail}`;
}

/**
 * Build the POST /api/reservations request that seats a waitlist party:
 * the plan's fixed two-hour reservation window from `now`, the selected
 * tables, and an idempotency key in both header and body (M5a contract).
 * Pure and deterministic — the focused tests assert exact values.
 */
export function buildSeatingRequest(
  entry: WaitlistEntry,
  tableIds: string[],
  idempotencyKey: string,
  nowMs: number,
): SeatingRequest {
  const startsAt = new Date(nowMs).toISOString();
  const endsAt = new Date(nowMs + RESERVATION_DURATION_MINUTES * 60_000).toISOString();
  return {
    path: SEATING_PATH,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({
        restaurant_id: entry.restaurant_id,
        table_ids: [...tableIds],
        party_size: entry.party_size,
        starts_at: startsAt,
        ends_at: endsAt,
        notes: seatingNotes(entry),
        idempotency_key: idempotencyKey,
      }),
    },
  };
}

/**
 * Convert a waitlist entry to a reservation: POST /api/reservations, then
 * mark the entry seated. The steps are not atomic — if the queue update
 * fails after a successful booking, the error says so explicitly so staff
 * can refresh instead of double-seating.
 */
export async function seatWaitlistEntry(
  entry: WaitlistEntry,
  tableIds: string[],
): Promise<WaitlistEntry> {
  const seating = buildSeatingRequest(
    entry,
    tableIds,
    globalThis.crypto.randomUUID(),
    Date.now(),
  );
  await request(seating.path, seating.init);
  try {
    return await updateWaitlistEntry(entry.id, { status: 'seated' });
  } catch (err) {
    if (err instanceof WaitlistApiError) {
      throw new WaitlistApiError(
        'Reservation created, but the waitlist could not be updated — refresh the list.',
        err.status,
      );
    }
    throw err;
  }
}
