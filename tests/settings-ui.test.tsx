import { renderToString } from 'react-dom/server';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import StaffSettingsPage from '@/app/staff/settings/page';
import { SettingsForm } from '@/components/staff/SettingsForm';
import {
  canEditSettings,
  settingsPath,
  toSettingsPayload,
  validateSettingsForm,
  type SettingsFormValues,
} from '@/lib/settings-client';

/**
 * M10 Phase 1 render + helper tests (conventions: tests/waitlist-ui — node
 * environment, renderToString; effects do not run, so the page asserts its
 * initial loading state with useAuth mocked for the auth guard). The form
 * tests cover both states (editable for manager/owner, read-only with the
 * banner for staff role/403) plus the always-read-only slug field and the
 * /staff/hours link; validation tests cover the client mirror of the
 * settings rules (non-empty name, IANA timezone via booking's
 * isValidTimeZone).
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

const SLUG = 'bistro-42';

const VALUES: SettingsFormValues = { name: 'Bistro Forty-Two', timezone: 'America/New_York' };

const noop = () => {};

const formProps = {
  slug: SLUG,
  initialValues: VALUES,
  onSubmit: noop,
  onCancel: noop,
};

beforeEach(() => {
  authState.user = { email: 'manager@example.com' };
  authState.loading = false;
});

describe('Restaurant Settings page (initial render)', () => {
  it('renders its heading, loading state, and back link', () => {
    const html = render(<StaffSettingsPage />);
    expect(html).toContain('Restaurant Settings');
    expect(html).toContain('Loading settings');
    expect(html).toContain('Back to dashboard');
  });
});

describe('SettingsForm (editable)', () => {
  it('renders the editable fields wired to their labels with stored values', () => {
    const html = render(<SettingsForm {...formProps} />);
    for (const id of ['settings-name', 'settings-timezone', 'settings-slug']) {
      expect(html).toContain(`for="${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('value="Bistro Forty-Two"');
    expect(html).toContain('value="America/New_York"');
    expect(html).toContain('<span>Save settings</span>');
    expect(html).toContain('<span>Cancel</span>');
  });

  it('keeps the slug read-only and links operating hours to /staff/hours', () => {
    const html = render(<SettingsForm {...formProps} />);
    expect(html).toMatch(/readOnly=""[^>]*id="settings-slug"/);
    expect(html).not.toMatch(/readOnly=""[^>]*id="settings-name"/);
    expect(html).toContain('href="/staff/hours"');
    expect(html).toContain('Manage operating hours');
  });

  it('shows the inline API error as an alert', () => {
    const html = render(<SettingsForm {...formProps} error="Could not save" />);
    expect(html).toContain('Could not save');
    expect(html).toContain('role="alert"');
  });
});

describe('SettingsForm (read-only)', () => {
  it('shows the read-only banner, locks every field, and hides the actions', () => {
    const html = render(<SettingsForm {...formProps} readOnly />);
    expect(html).toContain('read-only access to restaurant settings');
    expect(html).toContain('role="status"');
    expect(html).toMatch(/readOnly=""[^>]*id="settings-name"/);
    expect(html).toMatch(/readOnly=""[^>]*id="settings-timezone"/);
    expect(html).toMatch(/readOnly=""[^>]*id="settings-slug"/);
    expect(html).not.toContain('Save settings');
    expect(html).not.toContain('>Cancel<');
    // The read-only surface keeps the values and the hours link visible.
    expect(html).toContain('value="Bistro Forty-Two"');
    expect(html).toContain('href="/staff/hours"');
  });
});

describe('validateSettingsForm', () => {
  it('rejects an empty or whitespace-only name', () => {
    expect(validateSettingsForm({ name: '', timezone: 'UTC' })).toEqual({
      name: 'Enter a name.',
    });
    expect(validateSettingsForm({ name: '   ', timezone: 'UTC' })).toEqual({
      name: 'Enter a name.',
    });
  });

  it('rejects values that are not valid IANA time zones', () => {
    for (const timezone of ['', 'Not/AZone', 'America/New York']) {
      expect(validateSettingsForm({ name: 'Bistro', timezone })).toEqual({
        timezone: 'Enter a valid time zone (for example, America/New_York).',
      });
    }
  });

  it('accepts a valid name and time zone', () => {
    expect(validateSettingsForm({ name: '  Bistro Forty-Two  ', timezone: ' America/New_York ' })).toEqual(
      {},
    );
  });
});

describe('settings helpers', () => {
  it('builds the trimmed name/timezone payload without a slug field', () => {
    const payload = toSettingsPayload({ name: '  Bistro  ', timezone: '  UTC  ' });
    expect(payload).toEqual({ name: 'Bistro', timezone: 'UTC' });
    expect(Object.keys(payload)).not.toContain('slug');
  });

  it('builds the plan route path from the slug', () => {
    expect(settingsPath(SLUG)).toBe('/api/restaurants/bistro-42');
    expect(settingsPath('a b')).toBe('/api/restaurants/a%20b');
  });

  it('gates editing on the owner/manager roles', () => {
    expect(canEditSettings('owner')).toBe(true);
    expect(canEditSettings('manager')).toBe(true);
    expect(canEditSettings('staff')).toBe(false);
    expect(canEditSettings('')).toBe(false);
  });
});
