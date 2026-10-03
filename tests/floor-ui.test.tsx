import { renderToString } from 'react-dom/server';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StaffFloor2DPage from '@/app/staff/floor-2d/page';
import { FloorLegend } from '@/components/staff/FloorLegend';
import { FloorMap, computeViewBox } from '@/components/staff/FloorMap';
import { floorPath, type FloorSection } from '@/lib/floor-client';
import type { StaffTable } from '@/lib/tables-client';

/**
 * M8 Phase 1 render + geometry tests (conventions: tests/tables-ui —
 * node environment, renderToString; effects do not run, so the page and
 * map assert their initial states, with useAuth mocked for the page's
 * auth guard). computeViewBox covers the view-box math with exact
 * strings. Keyboard handling lives in client-side handlers that SSR
 * cannot execute — the established tables/groups limitation — so the
 * markers assert their roving tabindex, roles, and labels instead.
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

const DEFAULT_TABLE: StaffTable = {
  id: 'table-default',
  restaurant_id: 'restaurant-1',
  label: 'Default 1',
  capacity: 2,
  section_id: null,
  position_x: 0,
  position_y: 0,
  width: 1,
  depth: 1,
  shape: 'round',
};

const noop = () => {};

const mapProps = {
  tables: TABLES,
  sections: SECTIONS,
  selectedId: null,
  onSelect: noop,
};

beforeEach(() => {
  authState.user = { email: 'manager@example.com' };
  authState.loading = false;
});

describe('2D Floor page (initial render)', () => {
  it('renders its heading, loading state, and back link', () => {
    const html = render(<StaffFloor2DPage />);
    expect(html).toContain('2D Floor Map');
    expect(html).toContain('Loading floor');
    expect(html).toContain('role="status"');
    expect(html).toContain('Back to dashboard');
  });
});

describe('FloorMap (render)', () => {
  it('renders a labelled SVG with one marker per table and the computed view box', () => {
    const html = render(<FloorMap {...mapProps} />);
    expect(html).toContain('role="group"');
    expect(html).toContain('Floor plan with 3 tables');
    expect(html).toContain('viewBox="-0.5 0.5 7 5"');
    expect(html.match(/data-table-marker/g) ?? []).toHaveLength(3);
  });

  it('draws round tables as circles and the other shapes as rectangles', () => {
    const html = render(<FloorMap {...mapProps} />);
    expect(html.match(/<circle/g) ?? []).toHaveLength(1);
    expect(html.match(/<rect/g) ?? []).toHaveLength(2);
  });

  it('labels every marker with capacity and section, with a tooltip', () => {
    const html = render(<FloorMap {...mapProps} />);
    expect(html).toContain('Window 1, 4 seats, Window Side');
    expect(html).toContain('Back 1, 2 seats, Back');
    expect(html).toContain('Center 1, 6 seats, No section');
    expect(html).toContain('<title');
  });

  it('keeps a single tab stop across markers (roving tabindex)', () => {
    const html = render(<FloorMap {...mapProps} />);
    expect(html.match(/tabindex="0"/g) ?? []).toHaveLength(1);
    expect(html.match(/tabindex="-1"/g) ?? []).toHaveLength(2);
    expect(html.match(/role="button"/g) ?? []).toHaveLength(3);
  });

  it('marks the selected marker with aria-pressed and a primary stroke', () => {
    const selected = render(<FloorMap {...mapProps} selectedId="table-1" />);
    // Marker and its ARIA-list button both report the selection.
    expect(selected.match(/aria-pressed="true"/g) ?? []).toHaveLength(2);
    expect(selected).toContain('stroke-primary');

    const none = render(<FloorMap {...mapProps} />);
    expect(none).not.toContain('aria-pressed="true"');
    expect(none).not.toContain('stroke-primary');
    expect(none).toContain('stroke-border');
  });

  it('mirrors every table in the ARIA list with section and capacity', () => {
    const html = render(<FloorMap {...mapProps} />);
    expect(html.match(/<button/g) ?? []).toHaveLength(3);
    expect(html).toContain('4 seats · Window Side');
    expect(html).toContain('6 seats · No section');
    expect(html).toContain('aria-live="polite"');
  });

  it('shows the plan empty state when no tables are placed', () => {
    const html = render(<FloorMap {...mapProps} tables={[]} />);
    expect(html).toContain('No layout');
    expect(html).toContain('<h3');
    expect(html).not.toContain('data-table-marker');
  });
});

describe('FloorLegend', () => {
  it('lists sections with table counts plus an unsectioned row', () => {
    const html = render(<FloorLegend sections={SECTIONS} tables={TABLES} />);
    expect(html).toContain('Sections');
    expect(html).toContain('Window Side');
    expect(html).toContain('No section');
    // One table in each section and one without.
    expect(html.match(/1 table(?!s)/g) ?? []).toHaveLength(3);
    expect(html).toContain('style="background-color:#ff6600"');
  });

  it('renders zero counts when sections exist but no tables do', () => {
    const html = render(<FloorLegend sections={SECTIONS} tables={[]} />);
    expect(html).toContain('0 tables');
    expect(html).not.toContain('No section');
  });

  it('renders nothing without sections or unsectioned tables', () => {
    expect(render(<FloorLegend sections={[]} tables={[]} />)).toBe('');
  });
});

describe('computeViewBox', () => {
  it('covers all table extents plus padded bounds', () => {
    expect(computeViewBox(TABLES)).toBe('-0.5 0.5 7 5');
  });

  it('pads a single default-positioned table', () => {
    expect(computeViewBox([DEFAULT_TABLE])).toBe('-1.5 -1.5 3 3');
  });

  it('falls back to a fixed square when there are no tables', () => {
    expect(computeViewBox([])).toBe('0 0 10 10');
  });
});

describe('floor path', () => {
  it('maps the plan /api/floor shorthand to the nested route', () => {
    expect(floorPath('restaurant-1')).toBe('/api/restaurants/restaurant-1/floor');
  });

  it('encodes the restaurant id', () => {
    expect(floorPath('a/b')).toContain('%2F');
  });
});
