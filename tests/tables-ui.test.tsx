import { renderToString } from 'react-dom/server';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StaffTablesPage from '@/app/staff/tables/page';
import { TableForm } from '@/components/staff/TableForm';
import { TableItem } from '@/components/staff/TableItem';
import { TableList } from '@/components/staff/TableList';
import {
  validateTableForm,
  type StaffTable,
  type TableFormValues,
} from '@/lib/tables-client';

/**
 * M7 Phase 2 render + validation tests (conventions: tests/staff-ui — node
 * environment, renderToString; effects do not run, so the page and list
 * assert their initial loading states, with useAuth mocked for the page's
 * auth guard). The validation tests cover the client mirror of the server's
 * table-input boundary rules.
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

const TABLE: StaffTable = {
  id: 'table-1',
  restaurant_id: 'restaurant-1',
  label: 'Window 1',
  capacity: 4,
  section_id: null,
  position_x: 1,
  position_y: 2,
  width: 1,
  depth: 1,
  shape: 'round',
};

const EDIT_VALUES: TableFormValues = {
  label: 'Window 1',
  capacity: '4',
  sectionId: '',
  shape: 'round',
  positionX: '1',
  positionY: '2',
  width: '1',
  depth: '1',
};

const noop = () => {};

beforeEach(() => {
  authState.user = { email: 'manager@example.com' };
  authState.loading = false;
});

describe('Table management page (initial render)', () => {
  it('renders its heading and loading state', () => {
    const html = render(<StaffTablesPage />);
    expect(html).toContain('Table Management');
    expect(html).toContain('Loading tables');
    expect(html).toContain('Back to dashboard');
  });
});

describe('TableList (initial render)', () => {
  it('shows its skeleton loading state first', () => {
    const html = render(<TableList restaurantId="restaurant-1" />);
    expect(html).toContain('Loading tables');
  });
});

describe('TableForm', () => {
  it('renders all labelled controls in create mode', () => {
    const html = render(
      <TableForm
        mode="create"
        sections={[{ id: 'section-1', name: 'Main room' }]}
        onSubmit={noop}
        onCancel={noop}
      />,
    );
    expect(html).toContain('Add table');
    expect(html).toContain('Label');
    expect(html).toContain('Capacity');
    expect(html).toContain('Section');
    expect(html).toContain('No section');
    expect(html).toContain('Main room');
    expect(html).toContain('Shape');
    expect(html).toContain('Position X');
    expect(html).toContain('Position Y');
    expect(html).toContain('Width');
    expect(html).toContain('Depth');
    expect(html).toContain('type="radio"');
    expect(html).toContain('Create table');
    expect(html).toContain('Cancel');
  });

  it('prefills values and switches its action label in edit mode', () => {
    const html = render(
      <TableForm
        mode="edit"
        sections={[]}
        initialValues={EDIT_VALUES}
        onSubmit={noop}
        onCancel={noop}
      />,
    );
    expect(html).toContain('Edit table');
    expect(html).toContain('value="Window 1"');
    expect(html).toContain('Save changes');
  });
});

describe('TableItem', () => {
  it('renders the table details with edit and delete affordances', () => {
    const html = render(
      <TableItem
        table={TABLE}
        sectionName={null}
        onEdit={noop}
        onAskDelete={noop}
        onConfirmDelete={noop}
        onCancelDelete={noop}
      />,
    );
    expect(html).toContain('Window 1');
    expect(html).toContain('4 seats');
    expect(html).toContain('No section');
    expect(html).toContain('Edit');
    expect(html).toContain('Delete');
  });

  it('hides the write affordances in read-only state', () => {
    const html = render(
      <TableItem
        table={TABLE}
        readOnly
        onEdit={noop}
        onAskDelete={noop}
        onConfirmDelete={noop}
        onCancelDelete={noop}
      />,
    );
    expect(html).toContain('Window 1');
    expect(html).not.toContain('Edit');
    expect(html).not.toContain('Delete');
  });
});

describe('validateTableForm', () => {
  it('accepts a complete form with blank optional geometry', () => {
    expect(
      validateTableForm({
        label: 'Window 1',
        capacity: '4',
        sectionId: '',
        shape: 'round',
        positionX: '',
        positionY: '',
        width: '',
        depth: '',
      }),
    ).toEqual({});
  });

  it('rejects a blank label', () => {
    const errors = validateTableForm({ ...EDIT_VALUES, label: '   ' });
    expect(errors).toMatchObject({ label: expect.any(String) });
    expect(Object.keys(errors)).toHaveLength(1);
  });

  it.each([
    ['blank', ''],
    ['zero', '0'],
    ['negative', '-2'],
    ['fractional', '2.5'],
  ])('rejects a %s capacity', (_case, capacity) => {
    const errors = validateTableForm({ ...EDIT_VALUES, capacity });
    expect(errors).toMatchObject({ capacity: expect.any(String) });
  });

  it('flags non-numeric geometry but allows blank and fractional values', () => {
    expect(
      validateTableForm({
        ...EDIT_VALUES,
        positionX: 'abc',
        width: '',
        depth: '1.5',
      }),
    ).toMatchObject({ positionX: expect.any(String) });
    expect(
      validateTableForm({ ...EDIT_VALUES, positionX: '', width: '', depth: '' }),
    ).toEqual({});
  });
});
