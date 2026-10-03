import { renderToString } from 'react-dom/server';
import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TeamPage from '@/app/team/page';
import { SiteHeader } from '@/components/layout/SiteHeader';

/**
 * Public "Our Team" surface (/team): header nav item + showcase page
 * content. Conventions follow tests/reservations-ui.test.tsx —
 * renderToString in the node environment (initial state only), a mocked
 * useAuth driving the guest header, an anchor shim for next/link, and a
 * next/navigation mock that exposes usePathname so the guarded read in
 * SiteHeader resolves (and can drive the /team active state).
 *
 * These tests pin the delivery contract: exactly one h1, semantic h2
 * sections, exact event/tech wording, the exact LinkedIn URL with
 * external-safe attributes, concise supporting cards (no invented copy),
 * and the initials fallback for the member without a photo.
 */

const navState = vi.hoisted(() => ({ pathname: '/' }));
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

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: { href: string; children: ReactNode } & ComponentPropsWithoutRef<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navState.pathname,
  useParams: () => ({}),
}));

/** Render and strip React's SSR text-node markers for readable assertions. */
function render(ui: ReactElement): string {
  return renderToString(ui).replace(/<!-- -->/g, '');
}

beforeEach(() => {
  navState.pathname = '/';
  authState.user = null;
  authState.loading = false;
});

describe('SiteHeader — public "Our Team" nav item', () => {
  it('renders the /team link beside the existing public items', () => {
    const html = render(<SiteHeader />);
    expect(html).toContain('href="/team"');
    expect(html).toContain('Our Team');
    // Existing navigation and auth behaviour preserved.
    expect(html).toContain('href="/restaurants"');
    expect(html).toContain('Log in');
    expect(html).toContain('Sign up');
    expect(html).toContain('href="/"');
    expect(html).not.toContain('My Reservations');
  });

  it('shows no active state off-route, and aria-current on /team', () => {
    const offRoute = render(<SiteHeader />);
    expect(offRoute).not.toContain('aria-current');

    navState.pathname = '/team';
    const onRoute = render(<SiteHeader />);
    expect(onRoute).toMatch(/href="\/team"[^>]*aria-current="page"/);

    navState.pathname = '/staff';
    const staffRoute = render(<SiteHeader />);
    expect(staffRoute).not.toMatch(/href="\/team"[^>]*aria-current/);
  });
});

describe('Public team page (/team)', () => {
  const html = render(<TeamPage />);

  it('renders exactly one h1 and the three semantic h2 sections', () => {
    expect(html.match(/<h1/g) ?? []).toHaveLength(1);
    expect(html).toContain('The people behind Composable Floor.');
    expect(html).toContain('Built for the hackathon');
    expect(html).toContain('Project leadership');
    expect(html).toContain('Meet the team');
    expect(html).toContain('Delivery pillars');
  });

  it('uses the exact supplied event, method, and technology wording', () => {
    expect(html).toContain(
      'Composable Floor was created for WeAreDevelopers × BAND presents: Dark Factory — Hackathon Edition.',
    );
    expect(html).toContain(
      'The project was designed and implemented in alignment with the event documentation and challenge guidance.',
    );
    expect(html).toContain('Built with Next.js, TypeScript, Tailwind CSS, and Supabase.');
  });

  it('features the team leader with description, focus badges, and exact LinkedIn action', () => {
    expect(html).toContain('Team Leader');
    expect(html).toContain('Hasnain Ahmad');
    expect(html).toContain('AI Engineer &amp; Software Engineer');
    expect(html).toContain('Hasnain led the end-to-end delivery of Composable Floor');
    for (const area of [
      'AI Engineering',
      'Full-Stack Development',
      'Backend',
      'Frontend',
      'Deployment',
      'Project Workflow',
    ]) {
      expect(html).toContain(`>${area}<`);
    }

    expect(html).toContain('href="https://www.linkedin.com/in/hasnain-ahmad-047210349/"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain('opens in a new tab');
    // The LinkedIn action is the page's only external link.
    expect(html.match(/target="_blank"/g) ?? []).toHaveLength(1);
    expect(html).toContain('alt="Hasnain Ahmad, Team Leader"');
  });

  it('keeps supporting cards to name, role, and at most one contribution', () => {
    // One leader + five supporting article cards.
    expect(html.match(/<article/g) ?? []).toHaveLength(6);
    expect(html.match(/<h3/g) ?? []).toHaveLength(10);

    for (const [name, role] of [
      ['Osama Ayub', 'Project Setup &amp; Coordination'],
      ['Sundas Arif', 'Research &amp; Presentation'],
      ['Malaika Akbar', 'Early Project Research'],
      ['Maryam Habib', 'Team Member'],
      ['Muhammad Usman', 'Team Member'],
    ]) {
      expect(html).toContain(name);
      expect(html).toContain(role);
    }

    // Exactly the three supplied contribution sentences — none for Maryam/Muhammad.
    expect(html.match(/Supported /g) ?? []).toHaveLength(3);
    expect(html).toContain(
      'Supported early project setup, research, coordination, and presentation.',
    );
    expect(html).toContain('Supported project research and presentation.');
    expect(html).toContain('Supported early project research.');
    expect(html).toContain('Team Member');
  });

  it('maps the five delivered photos and falls back to initials for the missing one', () => {
    for (const file of [
      'hasnain-ahmad.png',
      'osama-ayub.png',
      'sundas-arif.png',
      'malaika-akbar.png',
      'maryam-habib.png',
    ]) {
      expect(html).toContain(file);
    }
    expect(html).not.toContain('muhammad-usman');

    // Exactly one initials surface: Muhammad Usman, same accessible name as a photo.
    expect(html.match(/role="img"/g) ?? []).toHaveLength(1);
    expect(html).toMatch(/role="img" aria-label="Muhammad Usman"/);
    expect(html).toContain('>MU<');
    // Five real photos, each with alt text.
    expect(html.match(/<img/g) ?? []).toHaveLength(5);
  });

  it('lists the four delivery pillars', () => {
    for (const label of [
      'Product Vision',
      'Experience Design',
      'Reliable Data',
      'Live Operations',
    ]) {
      expect(html).toContain(label);
    }
    expect(html.match(/<ol/g) ?? []).toHaveLength(1);
    // 6 focus badges + 5 member cards + 4 pillar tiles.
    expect(html.match(/<li/g) ?? []).toHaveLength(15);
  });
});
