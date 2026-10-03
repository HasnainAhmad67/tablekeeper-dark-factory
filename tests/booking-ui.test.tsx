import { renderToString } from 'react-dom/server';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';

import RestaurantDetailPage from '@/app/restaurants/[slug]/page';
import BookPage from '@/app/restaurants/[slug]/book/page';
import SelectPage from '@/app/restaurants/[slug]/select/page';
import ConfirmPage from '@/app/restaurants/[slug]/confirm/page';
import ConfirmedPage from '@/app/reservations/[id]/confirmed/page';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { AddToCalendar, buildIcsEvent } from '@/components/booking/AddToCalendar';
import { BookingSummary } from '@/components/booking/BookingSummary';
import { OptionCard } from '@/components/booking/OptionCard';
import { SlotPicker } from '@/components/booking/SlotPicker';
import type { AvailabilityOption, TimeSlot } from '@/lib/booking';

/**
 * Render tests for the M6 Phase 3 booking UI (conventions: vitest,
 * renderToString in the node environment — effects do not run, so pages
 * assert their initial loading states and the components assert their
 * static markup: labels, fieldsets, radio groups, live regions).
 */

vi.mock('next/navigation', () => ({
  useParams: () => ({ slug: 'test-restaurant', id: 'reservation-id' }),
}));

function renderWithAuth(ui: ReactElement): string {
  return renderToString(<AuthProvider>{ui}</AuthProvider>);
}

const SLOTS: TimeSlot[] = [
  {
    startsAt: '2026-06-01T15:00:00.000Z', // 11:00 EDT
    endsAt: '2026-06-01T17:00:00.000Z',
    dateKey: '2026-06-01',
  },
  {
    startsAt: '2026-06-01T15:30:00.000Z', // 11:30 EDT
    endsAt: '2026-06-01T17:30:00.000Z',
    dateKey: '2026-06-01',
  },
];

describe('SlotPicker', () => {
  it('renders an accessible radio group with timezone-formatted labels', () => {
    const html = renderToString(
      <SlotPicker
        legend="Time"
        slots={SLOTS}
        timeZone="America/New_York"
        value={SLOTS[0].startsAt}
        onChange={() => {}}
      />,
    );
    expect(html).toContain('<fieldset');
    expect(html).toContain('<legend');
    expect(html).toContain('Time');
    expect(html).toContain('11:00 AM');
    expect(html).toContain('11:30 AM');
    expect(html).toContain('type="radio"');
    expect(html).toContain('name="booking-slot"');
    expect(html).toContain('checked');
  });

  it('shows the empty message when the day has no slots', () => {
    const html = renderToString(
      <SlotPicker
        legend="Time"
        slots={[]}
        timeZone="America/New_York"
        value={null}
        onChange={() => {}}
        emptyMessage="No times on this date."
      />,
    );
    expect(html).toContain('No times on this date.');
    expect(html).not.toContain('type="radio"');
  });
});

describe('OptionCard', () => {
  const tableOption: AvailabilityOption = {
    kind: 'table',
    id: '00000000-0000-4000-8000-000000000001',
    label: 'T1 · Window',
    tableIds: ['00000000-0000-4000-8000-000000000001'],
    capacity: 4,
    surplus: 1,
  };

  it('renders a labeled radio with kind, seats, and fit as text', () => {
    // React SSR interleaves <!-- --> between adjacent text nodes; strip the
    // markers so assertions read like the text a user actually sees.
    const html = renderToString(
      <OptionCard option={tableOption} checked onChange={() => {}} />,
    ).replace(/<!-- -->/g, '');
    expect(html).toContain('type="radio"');
    expect(html).toContain('checked');
    expect(html).toContain('Table');
    expect(html).toContain('T1 · Window');
    expect(html).toContain('Seats 4');
    expect(html).toContain('1 spare seat');
  });

  it('labels group options and perfect fits', () => {
    const groupOption: AvailabilityOption = {
      ...tableOption,
      kind: 'group',
      label: 'Family table',
      capacity: 6,
      surplus: 0,
    };
    const html = renderToString(
      <OptionCard option={groupOption} checked={false} onChange={() => {}} />,
    );
    expect(html).toContain('Group');
    expect(html).toContain('Family table');
    expect(html).toContain('Perfect fit');
  });
});

describe('BookingSummary', () => {
  it('renders label/value pairs as a definition list', () => {
    const html = renderToString(
      <BookingSummary
        heading="Reservation summary"
        items={[
          { term: 'When', value: 'Mon, Jun 1, 2026 · 11:00 AM – 1:00 PM' },
          { term: 'Party size', value: '4' },
        ]}
      />,
    );
    expect(html).toContain('<dl');
    expect(html).toContain('Reservation summary');
    expect(html).toContain('When');
    expect(html).toContain('Mon, Jun 1, 2026 · 11:00 AM – 1:00 PM');
    expect(html).toContain('Party size');
  });
});

describe('AddToCalendar', () => {
  it('renders a button with an accessible name', () => {
    const html = renderToString(
      <AddToCalendar
        summary="Reservation"
        startsAt="2026-06-01T15:00:00.000Z"
        endsAt="2026-06-01T17:00:00.000Z"
      />,
    );
    expect(html).toContain('<button');
    expect(html).toContain('Add to calendar');
  });

  it('builds a dependency-free .ics document with escaped UTC times', () => {
    const ics = buildIcsEvent({
      uid: 'reservation-id',
      summary: 'Dinner, 2 guests',
      description: 'Special requests welcome',
      startsAt: '2026-06-01T15:00:00.000Z',
      endsAt: '2026-06-01T17:00:00.000Z',
    });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('UID:reservation-id');
    expect(ics).toContain('DTSTART:20260601T150000Z');
    expect(ics).toContain('DTEND:20260601T170000Z');
    expect(ics).toContain('SUMMARY:Dinner\\, 2 guests');
    expect(ics).toContain('END:VCALENDAR');
    expect(ics.endsWith('\r\n')).toBe(true);
  });

  it('returns an empty document for invalid instants', () => {
    expect(
      buildIcsEvent({ summary: 'x', startsAt: 'not-a-date', endsAt: 'also-bad' }),
    ).toBe('');
  });
});

describe('booking pages (initial render)', () => {
  it('screen 3: detail page shows its loading state first', () => {
    const html = renderWithAuth(<RestaurantDetailPage />);
    expect(html).toContain('Loading restaurant');
  });

  it('screen 5: book page renders its heading and loading state', () => {
    const html = renderWithAuth(<BookPage />);
    expect(html).toContain('Book a table');
    expect(html).toContain('Loading booking form');
  });

  it('screen 6: select page renders its heading and loading state', () => {
    const html = renderWithAuth(<SelectPage />);
    expect(html).toContain('Select a table');
    expect(html).toContain('Loading selection');
  });

  it('screen 7: confirm page renders its heading and loading state', () => {
    const html = renderWithAuth(<ConfirmPage />);
    expect(html).toContain('Confirm your reservation');
    expect(html).toContain('Loading confirmation');
  });

  it('screen 10: confirmed page renders its focusable heading and loading state', () => {
    const html = renderWithAuth(<ConfirmedPage />);
    expect(html).toContain('Reservation confirmed');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('Loading reservation');
  });
});
