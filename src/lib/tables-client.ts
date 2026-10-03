/**
 * Client-side table CRUD helpers and form validation (M7 Phase 2,
 * plan screen 25 "Table Management").
 *
 * Thin fetch wrappers over the existing M4 routes (plan's `/api/tables`
 * shorthand maps to the nested routes that actually shipped):
 *   GET    /api/restaurants/[restaurantId]/tables          -> { tables }
 *   POST   /api/restaurants/[restaurantId]/tables          -> 201 { table }
 *   PATCH  /api/restaurants/[restaurantId]/tables/[tableId] -> { table }
 *   DELETE /api/restaurants/[restaurantId]/tables/[tableId] -> { deleted: true }
 *   GET    /api/restaurants/[restaurantId]/floor            -> { sections }
 *   GET    /api/staff/me                                    -> { restaurants }
 *
 * Every non-2xx response throws TableApiError carrying the HTTP status, so
 * callers can implement the plan's states without re-parsing bodies:
 * 401 -> session redirect, 403 -> read-only (Manager/Owner write gate).
 *
 * validateTableForm/toTablePayload mirror the server's validateTableInput
 * (src/server/floor-writes.ts): non-empty label, positive-integer capacity,
 * optional numeric geometry (blank = omit, so create falls back to the
 * server defaults and edit leaves the field unchanged), shape enum, and a
 * section id or null.
 */

import { fetchStaffContext as fetchStaffContextShared } from '@/lib/fetchStaffContext';

export type TableShape = 'round' | 'square' | 'rect' | 'booth';

export const TABLE_SHAPES: readonly TableShape[] = ['round', 'square', 'rect', 'booth'];

export interface StaffTable {
  id: string;
  restaurant_id: string;
  label: string;
  capacity: number;
  section_id: string | null;
  position_x: number;
  position_y: number;
  width: number;
  depth: number;
  shape: TableShape;
}

export interface TableSection {
  id: string;
  name: string;
}

/** Staff membership from GET /api/staff/me — selected restaurant, else first. */
export interface StaffContext {
  id: string;
  name: string;
  slug: string;
  role: string;
}

/** Raw form state — numbers stay strings until validated. */
export interface TableFormValues {
  label: string;
  capacity: string;
  /** '' means "no section" (payload: null). */
  sectionId: string;
  shape: TableShape;
  positionX: string;
  positionY: string;
  width: string;
  depth: string;
}

export interface TableFieldErrors {
  label?: string;
  capacity?: string;
  positionX?: string;
  positionY?: string;
  width?: string;
  depth?: string;
}

export class TableApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'TableApiError';
    this.status = status;
  }
}

async function request(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new TableApiError('Network error — please try again.', 0);
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
    throw new TableApiError(message, response.status);
  }
  return body;
}

/**
 * Selected staff membership (stored restaurant id from the Restaurant
 * Switcher, falling back to the first membership), or null.
 */
export async function fetchStaffContext(): Promise<StaffContext | null> {
  return fetchStaffContextShared(request);
}

export async function fetchTables(restaurantId: string): Promise<StaffTable[]> {
  const body = await request(`/api/restaurants/${encodeURIComponent(restaurantId)}/tables`);
  return Array.isArray(body.tables) ? (body.tables as StaffTable[]) : [];
}

export async function fetchSections(restaurantId: string): Promise<TableSection[]> {
  const body = await request(`/api/restaurants/${encodeURIComponent(restaurantId)}/floor`);
  return Array.isArray(body.sections) ? (body.sections as TableSection[]) : [];
}

function jsonInit(method: string, payload?: unknown): RequestInit {
  return {
    method,
    headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  };
}

export async function createTable(
  restaurantId: string,
  values: TableFormValues,
): Promise<StaffTable> {
  const body = await request(`/api/restaurants/${encodeURIComponent(restaurantId)}/tables`, {
    ...jsonInit('POST', toTablePayload(values)),
  });
  return body.table as StaffTable;
}

export async function updateTable(
  restaurantId: string,
  tableId: string,
  values: TableFormValues,
): Promise<StaffTable> {
  const path =
    `/api/restaurants/${encodeURIComponent(restaurantId)}/tables/${encodeURIComponent(tableId)}`;
  const body = await request(path, jsonInit('PATCH', toTablePayload(values)));
  return body.table as StaffTable;
}

export async function deleteTable(restaurantId: string, tableId: string): Promise<void> {
  const path =
    `/api/restaurants/${encodeURIComponent(restaurantId)}/tables/${encodeURIComponent(tableId)}`;
  await request(path, jsonInit('DELETE'));
}

/** Client mirror of the server's validateTableInput boundary rules. */
export function validateTableForm(values: TableFormValues): TableFieldErrors {
  const errors: TableFieldErrors = {};

  if (values.label.trim().length === 0) {
    errors.label = 'Enter a label for this table.';
  }

  const capacity = Number(values.capacity);
  if (
    values.capacity.trim().length === 0 ||
    !Number.isInteger(capacity) ||
    capacity <= 0
  ) {
    errors.capacity = 'Capacity must be a positive whole number.';
  }

  for (const key of ['positionX', 'positionY', 'width', 'depth'] as const) {
    const raw = values[key].trim();
    if (raw.length > 0 && !Number.isFinite(Number(raw))) {
      errors[key] = 'Enter a number, or leave blank for the default.';
    }
  }

  return errors;
}

type TablePayload = {
  label: string;
  capacity: number;
  section_id: string | null;
  shape: TableShape;
} & Partial<Record<'position_x' | 'position_y' | 'width' | 'depth', number>>;

/**
 * Build the POST/PATCH body. Geometry is omitted when blank: create falls
 * back to the server defaults (0/0/1/1) and edit leaves the stored value
 * untouched; section_id and shape are always explicit so "No section" and
 * the chosen shape round-trip on edit.
 */
export function toTablePayload(values: TableFormValues): TablePayload {
  const payload: TablePayload = {
    label: values.label.trim(),
    capacity: Number(values.capacity),
    section_id: values.sectionId === '' ? null : values.sectionId,
    shape: values.shape,
  };

  const geometry: Record<'positionX' | 'positionY' | 'width' | 'depth', string> = {
    positionX: values.positionX,
    positionY: values.positionY,
    width: values.width,
    depth: values.depth,
  };
  const payloadKeys = {
    positionX: 'position_x',
    positionY: 'position_y',
    width: 'width',
    depth: 'depth',
  } as const;
  for (const key of Object.keys(geometry) as Array<keyof typeof geometry>) {
    const raw = geometry[key].trim();
    if (raw.length > 0) {
      payload[payloadKeys[key]] = Number(raw);
    }
  }

  return payload;
}
