import { renderToString } from 'react-dom/server';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StaffFloorPage from '@/app/staff/floor/page';
import { Floor3D, computeSceneLayout } from '@/components/staff/Floor3D';
import type { FloorSection } from '@/lib/floor-client';
import type { StaffTable } from '@/lib/tables-client';
import { isWebGLAvailable } from '@/lib/webgl';

/**
 * M8 Phase 2 render + scene-math tests (conventions: tests/floor-ui —
 * node environment, renderToString; effects do not run, so the page and
 * the 3D component assert their initial states, with useAuth mocked for
 * the page's auth guard). The Canvas is never constructed under SSR (the
 * ready gate keeps it client-only), so scene coverage comes from
 * computeSceneLayout's exact numbers plus the loader/ARIA-list markup —
 * the established tables/groups/floor limitation for effect-driven UI.
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

const SECTIONS: FloorSection[] = [
  {
    id: 'section-1',
    restaurant_id: 'restaurant-1',
    name: 'Window Side',
    color: '#ff6600',
    sort_order: 1,
  },
  {
    id: 'section-2',
    restaurant_id: 'restaurant-1',
    name: 'Back',
    color: '#0066ff',
    sort_order: 0,
  },
];

const TABLES: StaffTable[] = [
  {
    id: 'table-1',
    restaurant_id: 'restaurant-1',
    label: 'Window 1',
    capacity: 4,
    section_id: 'section-1',
    position_x: 1,
    position_y: 2,
    width: 1,
    depth: 1,
    shape: 'round',
  },
  {
    id: 'table-2',
    restaurant_id: 'restaurant-1',
    label: 'Back 1',
    capacity: 2,
    section_id: 'section-2',
    position_x: 3,
    position_y: 2,
    width: 2,
    depth: 1,
    shape: 'rect',
  },
  {
    id: 'table-3',
    restaurant_id: 'restaurant-1',
    label: 'Center 1',
    capacity: 6,
    section_id: null,
    position_x: 5,
    position_y: 4,
    width: 1,
    depth: 1,
    shape: 'booth',
  },
];

const noop = () => {};

const floor3dProps = {
  tables: TABLES,
  sections: SECTIONS,
  selectedId: null,
  onSelect: noop,
};

beforeEach(() => {
  authState.user = { email: 'manager@example.com' };
  authState.loading = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Live 3D Floor page (initial render)', () => {
  it('renders its heading, loading state, and back link', () => {
    const html = render(<StaffFloorPage />);
    expect(html).toContain('Live 3D Floor');
    expect(html).toContain('Loading floor');
    expect(html).toContain('role="status"');
    expect(html).toContain('Back to dashboard');
  });
});

describe('Floor3D (initial render)', () => {
  it('shows the 3D loader before the scene mounts (no canvas under SSR)', () => {
    const html = render(<Floor3D {...floor3dProps} />);
    expect(html).toContain('Loading 3D view');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('<canvas');
  });

  it('documents the keyboard controls from the interaction matrix', () => {
    const html = render(<Floor3D {...floor3dProps} />);
    expect(html).toContain('W, A, S, D');
    expect(html).toContain('scroll to zoom');
    expect(html).toContain('press V');
  });

  it('mirrors every table in the ARIA list with section and capacity', () => {
    const html = render(<Floor3D {...floor3dProps} />);
    expect(html.match(/<button/g) ?? []).toHaveLength(3);
    expect(html).toContain('4 seats · Window Side');
    expect(html).toContain('6 seats · No section');
    expect(html).toContain('aria-live="polite"');
  });

  it('reports the selected table through the list', () => {
    const html = render(<Floor3D {...floor3dProps} selectedId="table-1" />);
    expect(html.match(/aria-pressed="true"/g) ?? []).toHaveLength(1);
    expect(html).toContain('aria-pressed="false"');
  });
});

describe('computeSceneLayout', () => {
  it('frames the ground and camera around the table bounds', () => {
    const layout = computeSceneLayout(TABLES, SECTIONS);
    expect(layout.ground).toEqual({ x: 3, z: 3, width: 7, depth: 5 });
    expect(layout.camera).toEqual({ position: [3, 5.85, 9.5], target: [3, 0, 3] });
  });

  it('maps round tables to cylinders, other shapes to boxes, with section colours', () => {
    const layout = computeSceneLayout(TABLES, SECTIONS);
    expect(layout.tables.map((table) => table.kind)).toEqual(['cylinder', 'box', 'box']);
    expect(layout.tables[0]).toMatchObject({ x: 1, z: 2, radius: 0.5, color: '#ff6600' });
    expect(layout.tables[1]).toMatchObject({ width: 2, depth: 1, color: '#0066ff' });
    expect(layout.tables[2].color).toBe('#2a3242');
  });

  it('falls back to a default stage when no tables exist', () => {
    expect(computeSceneLayout([], SECTIONS)).toEqual({
      tables: [],
      ground: { x: 0, z: 0, width: 10, depth: 10 },
      camera: { position: [0, 7.5, 8], target: [0, 0, 0] },
    });
  });
});

describe('isWebGLAvailable', () => {
  it('returns true when a WebGL context can be created', () => {
    const context = {};
    const canvas = {
      getContext: vi.fn((type: string) => (type === 'webgl' ? context : null)),
    };
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
    vi.stubGlobal('window', { WebGLRenderingContext: class {} });
    expect(isWebGLAvailable()).toBe(true);
  });

  it('returns false when no WebGL context is available', () => {
    const canvas = { getContext: vi.fn(() => null) };
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
    vi.stubGlobal('window', { WebGLRenderingContext: class {} });
    expect(isWebGLAvailable()).toBe(false);
  });

  it('returns false when window/document are unavailable (SSR-safe)', () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('window', undefined);
    expect(isWebGLAvailable()).toBe(false);
  });
});
