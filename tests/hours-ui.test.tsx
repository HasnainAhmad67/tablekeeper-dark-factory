import { renderToString } from 'react-dom/server';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StaffHoursPage from '@/app/staff/hours/page';
import { HoursForm, HoursPreview } from '@/components/staff/HoursForm';
import {
  defaultHours,
  normalizeTime,
  validateHoursForm,
  type OperatingHour,
} from '@/lib/hours-client';

/**
 * M7 Phase 4 render + validation tests (conventions: tests/tables-ui —
 * node environment, renderToString; effects do not run, so the page
 * asserts its initial loading state, with useAuth mocked for the page's
 * auth guard). The validation tests cover the client mirror of the
 * server's hours boundary rules (closes_at > opens_at, no overnight).
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

const HOURS: OperatingHour[] = [
  { day_of_week: 0, opens_at: '11:00', closes_at: '22:00', is_closed: false },
  { day_of_week: 1, opens_at: '09:00', closes_at: '17:00', is_closed: false },
  { day_of_week: 2, opens_at: '10:30', closes_at: '23:00', is_closed: false },
  { day_of_week: 3, opens_at: '09:00', closes_at: '17:00', is_closed: false },
  { day_of_week: 4, opens_at: '09:00', closes_at: '17:00', is_closed: false },
  { day_of_week: 5, opens_at: '12:00', closes_at: '23:00', is_closed: false },
  { day_of_week: 6, opens_at: '12:00', closes_at: '23:00', is_closed: true },
];

const noop = () => {};

beforeEach(() => {
  authState.user = { email: 'manager@example.com' };
  authState.loading = false;
});

describe('Operating hours page (initial render)', () => {
  it('renders its heading and loading state', () => {
    const html = render(<StaffHoursPage />);
    expect(html).toContain('Operating Hours');
    expect(html).toContain('Loading hours');
    expect(html).toContain('Back to dashboard');
  });
});

describe('HoursForm', () => {
  it('renders all seven day rows with labelled controls', () => {
    const html = render(<HoursForm initialHours={HOURS} onSubmit={noop} />);
    expect(html).toContain('Edit hours');
    expect(html).toContain('Save hours');
    for (const day of ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']) {
      expect(html).toContain(`>${day}</legend>`);
    }
    expect(html.match(/Opens/g)).toHaveLength(7);
    expect(html.match(/Closes/g)).toHaveLength(7);
    expect(html.match(/type="checkbox"/g)).toHaveLength(7);
    expect(html).toContain('Closed');
  });

  it('wires each input to its label (Form labels a11y)', () => {
    const html = render(<HoursForm initialHours={HOURS} onSubmit={noop} />);
    for (const input of ['hours-sun-opens', 'hours-sun-closes', 'hours-sun-closed', 'hours-sat-opens']) {
      expect(html).toContain(`for="${input}"`);
      expect(html).toContain(`id="${input}"`);
    }
  });

  it('shows the inline API error as an alert', () => {
    const html = render(<HoursForm initialHours={HOURS} error="Could not save" onSubmit={noop} />);
    expect(html).toContain('Could not save');
    expect(html).toContain('role="alert"');
  });
});

describe('HoursPreview', () => {
  it('renders the current hours table with open/closed status', () => {
    const html = render(<HoursPreview hours={HOURS} />);
    expect(html).toContain('Current hours');
    expect(html).toContain('Sunday');
    expect(html).toContain('11:00');
    expect(html).toContain('Open');
    expect(html).toContain('Closed');
    expect(html).toContain('<table');
    expect(html).toContain('scope="col"');
  });

  it('shows an empty state when no hours are set', () => {
    const html = render(<HoursPreview hours={[]} />);
    expect(html).toContain('No operating hours');
  });
});

describe('validateHoursForm', () => {
  it('accepts a valid week', () => {
    expect(validateHoursForm(HOURS)).toEqual({});
  });

  it('rejects a closing time before the opening time', () => {
    const errors = validateHoursForm([
      { day_of_week: 0, opens_at: '18:00', closes_at: '09:00', is_closed: false },
    ]);
    expect(errors['sun-closes']).toMatch(/later than opening time/);
    expect(errors['sun-closes']).toMatch(/overnight/);
  });

  it('rejects equal opening and closing times (strictly greater)', () => {
    const errors = validateHoursForm([
      { day_of_week: 3, opens_at: '09:00', closes_at: '09:00', is_closed: false },
    ]);
    expect(errors['wed-closes']).toMatch(/later than opening time/);
  });

  it('rejects missing times even on closed days', () => {
    const errors = validateHoursForm([
      { day_of_week: 6, opens_at: '', closes_at: '23:00', is_closed: true },
    ]);
    expect(errors['sat-opens']).toBe('Enter an opening time.');
  });
});

describe('hours helpers', () => {
  it('normalizes database time strings to HH:MM', () => {
    expect(normalizeTime('11:00:00')).toBe('11:00');
    expect(normalizeTime('09:30')).toBe('09:30');
    expect(normalizeTime('bogus')).toBe('');
    expect(normalizeTime('')).toBe('');
  });

  it('defaults a restaurant with no hours to all days closed', () => {
    const defaults = defaultHours();
    expect(defaults).toHaveLength(7);
    expect(defaults.map((day) => day.day_of_week)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(defaults.every((day) => day.is_closed)).toBe(true);
    expect(validateHoursForm(defaults)).toEqual({});
  });
});
