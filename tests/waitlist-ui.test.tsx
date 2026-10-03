import { renderToString } from 'react-dom/server';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StaffWaitlistPage from '@/app/staff/waitlist/page';
import { WaitlistForm } from '@/components/staff/WaitlistForm';
import { WaitlistItem } from '@/components/staff/WaitlistItem';
import { WaitlistList } from '@/components/staff/WaitlistList';
import {
  buildSeatingRequest,
  seatingNotes,
  sortWaitlist,
  toWaitlistPayload,
  validateWaitlistForm,
  waitlistEntryPath,
  waitlistPath,
  type WaitlistEntry,
} from '@/lib/waitlist-client';
import type { StaffTable } from '@/lib/tables-client';

/**
 * M9 Phase 1 render + helper tests (conventions: tests/groups-ui — node
 * environment, renderToString; effects do not run, so the page and list
 * assert their initial loading states, with useAuth mocked for the page's
 * auth guard). The seating tests cover the pure request builder against
 * the real M5a contract (POST /api/reservations with an Idempotency-Key
 * in header and body, the fixed two-hour window, walk-in identity in
 * notes), and the validation tests cover the client mirror of the
 * add-party rules (non-empty name, integer party size >= 1).
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

function entry(overrides: Partial<WaitlistEntry>): WaitlistEntry {
  return {
    id: 'entry-1',
    restaurant_id: 'restaurant-1',
    name: 'Kim party',
    party_size: 4,
    phone: null,
    notes: null,
    status: 'waiting',
    position: 1,
    created_at: '2026-06-01T17:00:00.000Z',
    ...overrides,
  };
}

const WAITING: WaitlistEntry = entry({
  phone: '555-0101',
  notes: 'Birthday cake',
});

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

const noop = () => {};

const itemProps = {
  entry: WAITING,
  onMove: noop,
  onSeat: noop,
  onCancelSeat: noop,
  onConfirmSeat: noop,
  onStatus: noop,
  onAskRemove: noop,
  onConfirmRemove: noop,
  onCancelRemove: noop,
};

beforeEach(() => {
  authState.user = { email: 'staff@example.com' };
  authState.loading = false;
});

describe('Waitlist page (initial render)', () => {
  it('renders its heading, loading state, and back link', () => {
    const html = render(<StaffWaitlistPage />);
    expect(html).toContain('Waitlist');
    expect(html).toContain('Loading waitlist');
    expect(html).toContain('Back to dashboard');
  });
});

describe('WaitlistList (initial render)', () => {
  it('shows the loading skeleton before data resolves', () => {
    const html = render(<WaitlistList restaurantId="restaurant-1" />);
    expect(html).toContain('Loading waitlist');
    expect(html).toContain('role="status"');
  });
});

describe('WaitlistForm', () => {
  it('renders the four add-party fields wired to their labels', () => {
    const html = render(<WaitlistForm onSubmit={noop} onCancel={noop} />);
    expect(html).toContain('Add party');
    for (const id of ['waitlist-name', 'waitlist-party-size', 'waitlist-phone', 'waitlist-notes']) {
      expect(html).toContain(`for="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('type="number"');
    expect(html).toContain('type="tel"');
  });

  it('offers submit and cancel buttons', () => {
    const html = render(<WaitlistForm onSubmit={noop} onCancel={noop} />);
    expect(html).toContain('<span>Add party</span>');
    expect(html).toContain('<span>Cancel</span>');
  });

  it('shows the inline API error as an alert', () => {
    const html = render(<WaitlistForm error="Could not add the party" onSubmit={noop} onCancel={noop} />);
    expect(html).toContain('Could not add the party');
    expect(html).toContain('role="alert"');
  });
});

describe('WaitlistItem', () => {
  it('renders a waiting party with queue position, badge, and all actions', () => {
    const html = render(<WaitlistItem {...itemProps} canMoveUp canMoveDown />);
    expect(html).toContain('Kim party');
    expect(html).toContain('#1 in line');
    expect(html).toContain('Party of 4');
    expect(html).toContain('href="tel:555-0101"');
    expect(html).toContain('Birthday cake');
    expect(html).toContain('Waiting');
    expect(html).toContain('<span>Seat</span>');
    expect(html).toContain('<span>Move up</span>');
    expect(html).toContain('<span>Move down</span>');
    expect(html).toContain('<span>Cancel</span>');
    expect(html).toContain('<span>Mark no-show</span>');
    expect(html).toContain('<span>Remove</span>');
    expect(html).toContain('aria-label="Seat Kim party"');
    expect(html).toContain('aria-label="Move Kim party up"');
  });

  it('disables a move at the queue boundary', () => {
    const html = render(<WaitlistItem {...itemProps} canMoveDown />);
    expect(html).toContain('aria-label="Move Kim party down"');
    // canMoveUp omitted -> the up button renders disabled.
    expect(html).toMatch(/aria-label="Move Kim party up"[^>]*disabled/);
  });

  it('renders a finished entry with its badge and only the Remove action', () => {
    const html = render(
      <WaitlistItem {...itemProps} entry={entry({ id: 'entry-2', name: 'Ahmad party', status: 'seated', position: 2 })} />,
    );
    expect(html).toContain('Ahmad party');
    expect(html).toContain('Seated');
    expect(html).not.toContain('#2 in line');
    expect(html).not.toContain('<span>Seat</span>');
    expect(html).not.toContain('<span>Move up</span>');
    expect(html).toContain('<span>Remove</span>');
  });

  it('hides every write affordance in read-only state', () => {
    const html = render(<WaitlistItem {...itemProps} readOnly />);
    expect(html).toContain('Kim party');
    expect(html).toContain('Waiting');
    expect(html).not.toContain('aria-label="Seat Kim party"');
    expect(html).not.toContain('<span>Remove</span>');
    expect(html).not.toContain('<span>Move up</span>');
  });

  it('renders the remove confirmation with a safe default', () => {
    const html = render(<WaitlistItem {...itemProps} confirming />);
    expect(html).toContain('aria-label="Confirm removal of Kim party"');
    expect(html).toContain('Remove “Kim party” from the waitlist? This cannot be undone.');
    expect(html).toContain('Keep entry');
    expect(html).toContain('Yes, remove it');
    expect(html).not.toContain('<span>Seat</span>');
  });

  it('renders the seating panel with the table checklist', () => {
    const html = render(<WaitlistItem {...itemProps} seating tables={TABLES} />);
    expect(html).toContain('aria-label="Seat Kim party"');
    expect(html).toContain('Seat “Kim party” — party of 4');
    expect(html).toContain('party of 4');
    expect(html).toContain('Tables');
    expect(html.match(/type="checkbox"/g) ?? []).toHaveLength(3);
    expect(html).toContain('Window 1');
    expect(html).toContain('<span>Confirm seating</span>');
    expect(html).toContain('<span>Cancel</span>');
  });

  it('shows a hint instead of an empty checklist when there are no tables', () => {
    const html = render(<WaitlistItem {...itemProps} seating tables={[]} />);
    expect(html).toContain('No tables available yet');
    expect(html).not.toContain('type="checkbox"');
  });
});

describe('validateWaitlistForm', () => {
  it('rejects empty and whitespace-only names', () => {
    expect(validateWaitlistForm({ name: '', partySize: '4', phone: '', notes: '' })).toEqual({
      name: 'Enter a name.',
    });
    expect(validateWaitlistForm({ name: '   ', partySize: '4', phone: '', notes: '' })).toEqual({
      name: 'Enter a name.',
    });
  });

  it('rejects missing, zero, and fractional party sizes', () => {
    for (const partySize of ['', '0', '2.5', 'four']) {
      expect(validateWaitlistForm({ name: 'Alex', partySize, phone: '', notes: '' })).toEqual({
        partySize: 'Enter a party size of 1 or more.',
      });
    }
  });

  it('accepts a valid party', () => {
    expect(
      validateWaitlistForm({ name: '  Alex Kim  ', partySize: ' 4 ', phone: '555', notes: '' }),
    ).toEqual({});
  });
});

describe('waitlist helpers', () => {
  it('builds the trimmed payload with nulls for empty contact fields', () => {
    expect(
      toWaitlistPayload({
        name: '  Alex Kim  ',
        partySize: ' 4 ',
        phone: '   ',
        notes: '  by the window  ',
      }),
    ).toEqual({
      name: 'Alex Kim',
      party_size: 4,
      phone: null,
      notes: 'by the window',
    });
  });

  it('builds the list and entry routes', () => {
    expect(waitlistPath('restaurant-1')).toBe('/api/waitlist?restaurant_id=restaurant-1');
    expect(waitlistEntryPath('entry-9')).toBe('/api/waitlist/entry-9');
  });

  it('orders entries by position, then first-come first-served', () => {
    const a = entry({ id: 'a', position: 2, created_at: '2026-06-01T17:00:00.000Z' });
    const b = entry({ id: 'b', position: 1, created_at: '2026-06-01T18:00:00.000Z' });
    const c = entry({ id: 'c', position: 2, created_at: '2026-06-01T19:00:00.000Z' });
    expect(sortWaitlist([a, b, c]).map((row) => row.id)).toEqual(['b', 'a', 'c']);
  });
});

describe('buildSeatingRequest', () => {
  const NOW = Date.parse('2026-06-01T18:00:00Z');

  it('posts to /api/reservations with the M5a idempotency contract', () => {
    const request = buildSeatingRequest(WAITING, ['table-1', 'table-2'], 'key-123', NOW);
    expect(request.path).toBe('/api/reservations');
    expect(request.init.method).toBe('POST');
    const headers = request.init.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('key-123');
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(request.init.body as string)).toEqual({
      restaurant_id: 'restaurant-1',
      table_ids: ['table-1', 'table-2'],
      party_size: 4,
      starts_at: '2026-06-01T18:00:00.000Z',
      ends_at: '2026-06-01T20:00:00.000Z',
      notes: 'Walk-in: Kim party · 555-0101 — Birthday cake',
      idempotency_key: 'key-123',
    });
  });

  it('carries the walk-in identity in notes, with or without contact details', () => {
    expect(seatingNotes(WAITING)).toBe('Walk-in: Kim party · 555-0101 — Birthday cake');
    expect(seatingNotes(entry({ name: 'Plain party' }))).toBe('Walk-in: Plain party');
    expect(
      seatingNotes(entry({ name: 'Plain party', phone: '555-0202', notes: null })),
    ).toBe('Walk-in: Plain party · 555-0202');
  });
});
