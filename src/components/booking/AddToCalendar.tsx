import { Button } from '@/components/ui/Button';

/**
 * Add-to-calendar (.ics) download — dependency-free, client-side Blob only
 * (plan decision: no external calendar library).
 *
 * Times are emitted as UTC instants (…Z), which every calendar accepts
 * without shipping per-timezone VTIMEZONE blocks; the receiving client
 * renders them in the user's local zone. Text values are escaped per RFC
 * 5545 (backslash, semicolon, comma, newline) and folded at 70 octets.
 */

export interface IcsEventInput {
  /** Stable event id — pass the reservation id. */
  uid?: string;
  summary: string;
  description?: string;
  startsAt: string;
  endsAt: string;
}

function icsStamp(instant: number | string): string | null {
  const ms = typeof instant === 'number' ? instant : Date.parse(instant);
  if (!Number.isFinite(ms)) {
    return null;
  }
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function icsEscape(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Fold a content line at 70 octets with CRLF + space continuations. */
function foldLine(line: string): string {
  if (line.length <= 70) {
    return line;
  }
  const chunks: string[] = [];
  let rest = line;
  let first = true;
  while (rest.length > 0) {
    const size = first ? 70 : 69;
    chunks.push((first ? '' : ' ') + rest.slice(0, size));
    rest = rest.slice(size);
    first = false;
  }
  return chunks.join('\r\n');
}

/** Build a single-VEVENT .ics document. Empty string when inputs are invalid. */
export function buildIcsEvent({ uid, summary, description, startsAt, endsAt }: IcsEventInput): string {
  const start = icsStamp(startsAt);
  const end = icsStamp(endsAt);
  if (start === null || end === null) {
    return '';
  }
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Composable Floor//Reservation//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid ?? `${start}@composable-floor`}`,
    `DTSTAMP:${icsStamp(Date.now()) ?? start}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    `SUMMARY:${icsEscape(summary)}`,
    ...(description ? [`DESCRIPTION:${icsEscape(description)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

export interface AddToCalendarProps {
  summary: string;
  description?: string;
  startsAt: string;
  endsAt: string;
  uid?: string;
}

export function AddToCalendar({ summary, description, startsAt, endsAt, uid }: AddToCalendarProps) {
  function handleDownload() {
    const ics = buildIcsEvent({ uid, summary, description, startsAt, endsAt });
    if (!ics) {
      return;
    }
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'reservation.ics';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Button variant="secondary" onClick={handleDownload}>
      Add to calendar
    </Button>
  );
}
