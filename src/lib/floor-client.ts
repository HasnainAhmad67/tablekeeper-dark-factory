/**
 * Client-side floor data helpers for the 2D Floor Map (plan screen 19,
 * /staff/floor-2d — M8 Phase 1).
 *
 * Thin fetch wrappers over the existing M4 routes (the plan's `/api/floor`
 * shorthand maps to the nested route that actually shipped):
 *   GET /api/restaurants/[restaurantId]/floor  -> { sections }
 *   GET /api/restaurants/[restaurantId]/tables -> { tables }
 *   GET /api/staff/me                          -> { restaurants }
 *
 * Every non-2xx response throws FloorApiError carrying the HTTP status, so
 * the page can implement the plan's states without re-parsing bodies: 401
 * -> session redirect. Tables come from the shared tables-client helper
 * and are re-thrown as FloorApiError so callers handle a single error
 * type. Section rows are normalized (missing colour falls back to the
 * migration default, sort order to 0) and returned in sort order.
 */

import { fetchStaffContext as fetchStaffContextShared } from '@/lib/fetchStaffContext';
import { fetchTables, TableApiError, type StaffTable } from '@/lib/tables-client';

export interface FloorSection {
  id: string;
  restaurant_id: string;
  name: string;
  color: string;
  sort_order: number;
}

export interface FloorData {
  sections: FloorSection[];
  tables: StaffTable[];
}

/** Staff membership from GET /api/staff/me — selected restaurant, else first. */
export interface StaffContext {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export class FloorApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'FloorApiError';
    this.status = status;
  }
}

/** Path helper (plan's `/api/floor` shorthand -> nested route that shipped). */
export function floorPath(restaurantId: string): string {
  return `/api/restaurants/${encodeURIComponent(restaurantId)}/floor`;
}

async function request(path: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(path);
  } catch {
    throw new FloorApiError('Network error — please try again.', 0);
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
    throw new FloorApiError(message, response.status);
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

/** Floor sections, normalized and ordered by sort_order (then name). */
export async function fetchSections(restaurantId: string): Promise<FloorSection[]> {
  const body = await request(floorPath(restaurantId));
  const rows = Array.isArray(body.sections) ? body.sections : [];

  const sections: FloorSection[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) {
      continue;
    }
    const section = row as Record<string, unknown>;
    if (typeof section.id !== 'string' || typeof section.name !== 'string') {
      continue;
    }
    sections.push({
      id: section.id,
      restaurant_id: typeof section.restaurant_id === 'string' ? section.restaurant_id : '',
      name: section.name,
      color:
        typeof section.color === 'string' && section.color.length > 0
          ? section.color
          : '#3b82f6',
      sort_order: typeof section.sort_order === 'number' ? section.sort_order : 0,
    });
  }

  sections.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  return sections;
}

/** Sections and tables for the map, fetched together in one round trip. */
export async function fetchFloorData(restaurantId: string): Promise<FloorData> {
  try {
    const [sections, tables] = await Promise.all([
      fetchSections(restaurantId),
      fetchTables(restaurantId),
    ]);
    return { sections, tables };
  } catch (err) {
    if (err instanceof TableApiError) {
      throw new FloorApiError(err.message, err.status);
    }
    throw err;
  }
}
