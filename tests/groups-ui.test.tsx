import { renderToString } from 'react-dom/server';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StaffGroupsPage from '@/app/staff/groups/page';
import { GroupForm } from '@/components/staff/GroupForm';
import { GroupItem } from '@/components/staff/GroupItem';
import { GroupList } from '@/components/staff/GroupList';
import {
  groupPath,
  groupsPath,
  toGroupPayload,
  validateGroupForm,
  type GroupFormValues,
  type StaffGroup,
} from '@/lib/groups-client';
import type { StaffTable } from '@/lib/tables-client';

/**
 * M7 Phase 5 render + validation tests (conventions: tests/tables-ui —
 * node environment, renderToString; effects do not run, so the page and
 * list assert their initial loading states, with useAuth mocked for the
 * page's auth guard). The validation/payload tests cover the client
 * mirror of the server's group boundary rules (non-empty name, uuid
 * table_ids, description omitted so PATCH preserves it).
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

const TABLES: StaffTable[] = [
  {
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
  },
  {
    id: 'table-2',
    restaurant_id: 'restaurant-1',
    label: 'Window 3',
    capacity: 2,
    section_id: null,
    position_x: 3,
    position_y: 2,
    width: 1,
    depth: 1,
    shape: 'square',
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
    shape: 'rect',
  },
];

const GROUP: StaffGroup = {
  id: 'group-1',
  restaurant_id: 'restaurant-1',
  name: 'Section A',
  description: 'Window side',
  table_ids: ['table-1', 'table-2'],
};

const EDIT_VALUES: GroupFormValues = { name: 'VIP Area', tableIds: ['table-3'] };

const noop = () => {};

const itemProps = {
  group: GROUP,
  tableLabels: ['Window 1', 'Window 3'],
  onEdit: noop,
  onAskDelete: noop,
  onConfirmDelete: noop,
  onCancelDelete: noop,
};

beforeEach(() => {
  authState.user = { email: 'manager@example.com' };
  authState.loading = false;
});

describe('Groups page (initial render)', () => {
  it('renders its heading and loading state', () => {
    const html = render(<StaffGroupsPage />);
    expect(html).toContain('Table-Group Builder');
    expect(html).toContain('Loading groups');
    expect(html).toContain('Back to dashboard');
  });
});

describe('GroupList (initial render)', () => {
  it('shows the loading skeleton before data resolves', () => {
    const html = render(<GroupList restaurantId="restaurant-1" />);
    expect(html).toContain('Loading groups');
    expect(html).toContain('role="status"');
  });
});

describe('GroupForm', () => {
  it('renders create mode with name field and table checklist', () => {
    const html = render(<GroupForm mode="create" tables={TABLES} onSubmit={noop} onCancel={noop} />);
    expect(html).toContain('Create group');
    expect(html).toContain('Cancel');
    expect(html).toContain('Tables');
    expect(html).toContain('Window 1');
    expect(html).toContain('· 4 seats');
    expect(html.match(/type="checkbox"/g)).toHaveLength(3);
    expect(html).not.toContain('checked=""');
  });

  it('pre-fills edit mode from initialValues and offers Save changes', () => {
    const html = render(
      <GroupForm mode="edit" tables={TABLES} initialValues={EDIT_VALUES} onSubmit={noop} onCancel={noop} />,
    );
    expect(html).toContain('Edit group');
    expect(html).toContain('value="VIP Area"');
    expect(html).toContain('Save changes');
    // Only table-3 is assigned in the initial values.
    expect(html).toMatch(/id="group-table-table-3"[^>]*checked/);
    expect(html).not.toMatch(/id="group-table-table-1"[^>]*checked/);
  });

  it('wires the name field to its label (Form labels a11y)', () => {
    const html = render(<GroupForm mode="create" tables={TABLES} onSubmit={noop} onCancel={noop} />);
    expect(html).toContain('for="group-name"');
    expect(html).toContain('id="group-name"');
    expect(html).toContain('for="group-table-table-1"');
    expect(html).toContain('id="group-table-table-1"');
  });

  it('shows a hint instead of an empty checklist when there are no tables', () => {
    const html = render(<GroupForm mode="create" tables={[]} onSubmit={noop} onCancel={noop} />);
    expect(html).toContain('No tables available yet');
    expect(html).not.toContain('type="checkbox"');
  });

  it('shows the inline API error as an alert', () => {
    const html = render(
      <GroupForm mode="create" tables={TABLES} error="Could not save" onSubmit={noop} onCancel={noop} />,
    );
    expect(html).toContain('Could not save');
    expect(html).toContain('role="alert"');
  });
});

describe('GroupItem', () => {
  it('renders the group with its table badges and actions', () => {
    const html = render(<GroupItem {...itemProps} />);
    expect(html).toContain('Section A');
    expect(html).toContain('Window side');
    expect(html).toContain('Window 1');
    expect(html).toContain('Window 3');
    expect(html).toContain('<span>Edit</span>');
    expect(html).toContain('<span>Delete</span>');
    // No confirmation until asked.
    expect(html).not.toContain('Keep group');
  });

  it('shows an empty-assignment note when no tables belong to the group', () => {
    const html = render(<GroupItem {...itemProps} tableLabels={[]} />);
    expect(html).toContain('No tables assigned');
  });

  it('hides the write affordances in read-only state', () => {
    const html = render(<GroupItem {...itemProps} readOnly />);
    expect(html).not.toContain('<span>Edit</span>');
    expect(html).not.toContain('<span>Delete</span>');
  });

  it('renders the inline confirmation panel with a safe default', () => {
    const html = render(<GroupItem {...itemProps} confirming />);
    expect(html).toContain('Confirm deletion of Section A');
    expect(html).toContain('This cannot be undone');
    expect(html).toContain('Keep group');
    expect(html).toContain('Yes, delete it');
    expect(html).not.toContain('<span>Edit</span>');
  });
});

describe('validateGroupForm', () => {
  it('accepts a non-empty name', () => {
    expect(validateGroupForm({ name: 'VIP Area', tableIds: [] })).toEqual({});
    expect(validateGroupForm({ name: '  VIP Area  ', tableIds: [] })).toEqual({});
  });

  it('rejects empty and whitespace-only names', () => {
    expect(validateGroupForm({ name: '', tableIds: [] })).toEqual({
      name: 'Enter a group name.',
    });
    expect(validateGroupForm({ name: '   ', tableIds: [] })).toEqual({
      name: 'Enter a group name.',
    });
  });
});

describe('group helpers', () => {
  it('builds the trimmed payload without a description field', () => {
    const payload = toGroupPayload({ name: '  Section A  ', tableIds: ['table-2', 'table-1'] });
    expect(payload).toEqual({
      name: 'Section A',
      table_ids: ['table-2', 'table-1'],
    });
    expect(Object.keys(payload)).not.toContain('description');
  });

  it('builds the nested route paths', () => {
    expect(groupsPath('restaurant-1')).toBe('/api/restaurants/restaurant-1/groups');
    expect(groupPath('restaurant-1', 'group-9')).toBe(
      '/api/restaurants/restaurant-1/groups/group-9',
    );
  });
});
