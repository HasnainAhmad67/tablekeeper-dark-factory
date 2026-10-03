"use client";

import Image from 'next/image';
import { useState, type ReactNode } from 'react';

import { Badge } from '@/components/ui/Badge';

/**
 * Public "Our Team" project-credit page (`/team`) — a hackathon showcase,
 * unrelated to the staff team-management screen (/staff/team).
 *
 * Grounding: plan.md carries no public team page, so this follows the
 * product's established visual language — the premium discovery hero
 * (eyebrow + h1 + token glow blobs), the section header pattern
 * (h2 + border-b), and the discovery card treatment (rounded-[20px]
 * border, hover lift + gold rim) — with static, user-supplied copy only.
 *
 * Constraints honoured here:
 * - Local images only (`public/images/team`, .png as delivered); a failed
 *   or missing photo degrades to a `role="img"` initials surface with the
 *   same accessible name (never a broken-image icon).
 * - Depth is CSS-only (perspective, layered plates, translateZ/rotateX,
 *   warm gold rim + muted blue glow) — no new dependency, no canvas.
 * - Motion is decorative only: every hover/tilt effect is disabled under
 *   prefers-reduced-motion (global rule + per-element motion-reduce).
 * - Exactly one h1; h2 sections for leadership, team, and pillars;
 *   meaningful alt text; visible focus from the global outline.
 * - Supporting cards render only portrait, name, role, and (where
 *   supplied) one contribution sentence — no invented content.
 */

/* ---------------------------------- copy --------------------------------- */

const EVENT_LINE =
  'Composable Floor was created for WeAreDevelopers × BAND presents: Dark Factory — Hackathon Edition.';
const METHOD_LINE =
  'The project was designed and implemented in alignment with the event documentation and challenge guidance.';
const TECH_LINE = 'Built with Next.js, TypeScript, Tailwind CSS, and Supabase.';

/* ---------------------------------- data --------------------------------- */

const LEADER = {
  name: 'Hasnain Ahmad',
  title: 'AI Engineer & Software Engineer',
  badge: 'Team Leader',
  description:
    'Hasnain led the end-to-end delivery of Composable Floor, guiding product direction, system architecture, and project execution. He led backend and frontend development, API and database integration, deployment readiness, testing, workflow management, and overall team coordination to transform the concept into a polished hackathon product.',
  focus: [
    'AI Engineering',
    'Full-Stack Development',
    'Backend',
    'Frontend',
    'Deployment',
    'Project Workflow',
  ],
  linkedin: 'https://www.linkedin.com/in/hasnain-ahmad-047210349/',
  src: '/images/team/hasnain-ahmad.png',
  initials: 'HA',
} as const;

interface Member {
  readonly name: string;
  readonly role: string;
  readonly contribution?: string;
  readonly src: string | null;
  readonly initials: string;
}

/** Five supporting members — contribution only where explicitly supplied. */
const MEMBERS: readonly Member[] = [
  {
    name: 'Osama Ayub',
    role: 'Project Setup & Coordination',
    contribution: 'Supported early project setup, research, coordination, and presentation.',
    src: '/images/team/osama-ayub.png',
    initials: 'OA',
  },
  {
    name: 'Sundas Arif',
    role: 'Research & Presentation',
    contribution: 'Supported project research and presentation.',
    src: '/images/team/sundas-arif.png',
    initials: 'SA',
  },
  {
    name: 'Malaika Akbar',
    role: 'Early Project Research',
    contribution: 'Supported early project research.',
    src: '/images/team/malaika-akbar.png',
    initials: 'MA',
  },
  { name: 'Maryam Habib', role: 'Team Member', src: '/images/team/maryam-habib.png', initials: 'MH' },
  // No photo delivered yet — renders the initials surface without a network request.
  { name: 'Muhammad Usman', role: 'Team Member', src: null, initials: 'MU' },
];

/* ---------------------------------- icons -------------------------------- */

function LinkedInGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" className="size-4">
      <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.47-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29ZM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12ZM7.12 20.45H3.56V9h3.56v11.45ZM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0Z" />
    </svg>
  );
}

function ExternalArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="size-3.5"
    >
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </svg>
  );
}

/* ---------------------------- delivery pillars ---------------------------- */

interface Pillar {
  readonly step: string;
  readonly label: string;
  readonly icon: ReactNode;
}

const PILLARS: readonly Pillar[] = [
  {
    step: '01',
    label: 'Product Vision',
    icon: (
      <>
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  {
    step: '02',
    label: 'Experience Design',
    icon: (
      <>
        <path d="M4 20l4-1L18.5 8.5a2.47 2.47 0 0 0-3.5-3.5L4.5 15.5 4 20Z" />
        <path d="M13.5 6.5l4 4" />
      </>
    ),
  },
  {
    step: '03',
    label: 'Reliable Data',
    icon: (
      <>
        <ellipse cx="12" cy="6" rx="8" ry="3" />
        <path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" />
        <path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
      </>
    ),
  },
  {
    step: '04',
    label: 'Live Operations',
    icon: <path d="M3 12h4l2.5-6 4 12L16 12h5" />,
  },
];

/* ------------------------------- team photos ------------------------------ */

/**
 * Portrait with graceful fallback: a missing source or a failed load swaps
 * to a token-gradient surface carrying the same accessible name as the
 * photo would, plus decorative initials — never a broken-image icon.
 */
function TeamPhoto({
  src,
  alt,
  initials,
  sizes,
  imgClassName,
  initialsClassName,
}: {
  src: string | null;
  alt: string;
  initials: string;
  sizes: string;
  imgClassName?: string;
  initialsClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const active = src !== null && !failed ? src : null;

  if (active === null) {
    return (
      <div
        role="img"
        aria-label={alt}
        className={`flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,var(--surface-raised),var(--surface))] font-semibold tracking-wide text-primary/70 ${initialsClassName ?? ''}`}
      >
        <span aria-hidden="true">{initials}</span>
      </div>
    );
  }

  return (
    <Image
      src={active}
      alt={alt}
      fill
      sizes={sizes}
      className={`object-cover ${imgClassName ?? ''}`}
      onError={() => setFailed(true)}
    />
  );
}

/* ------------------------------- leader card ------------------------------ */

const LEADER_SIZES = '(min-width: 1024px) 42vw, 100vw';
const MEMBER_SIZES = '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw';

function LeaderCard() {
  return (
    <div className="group relative">
      {/* Layered rear plate — static depth beneath the featured card. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-5 -bottom-2.5 top-3 rounded-[28px] border border-border bg-surface-raised/60"
      />
      <article className="relative overflow-hidden rounded-[24px] border border-primary/30 bg-surface shadow-lg transition-all duration-300 hover:-translate-y-1 hover:border-primary/50 hover:shadow-[0_28px_70px_-30px_rgba(226,179,74,0.45)] motion-reduce:transition-none motion-reduce:hover:translate-y-0 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        {/* Gold rim light + warm/cool ambience. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20 rounded-[24px] ring-1 ring-inset ring-primary/25"
        />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-10">
          <div className="absolute -left-24 -top-28 size-64 rounded-full bg-primary/15 blur-3xl" />
          <div className="absolute -bottom-32 -right-24 size-72 rounded-full bg-info/10 blur-3xl" />
        </div>

        <div className="relative min-h-[17rem] sm:min-h-[21rem] lg:min-h-[27rem]">
          <TeamPhoto
            src={LEADER.src}
            alt="Hasnain Ahmad, Team Leader"
            initials={LEADER.initials}
            sizes={LEADER_SIZES}
            imgClassName="transition-transform duration-500 ease-out group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
            initialsClassName="text-5xl"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-background/85 via-background/10 to-transparent lg:bg-gradient-to-r lg:from-background/40 lg:via-background/5 lg:to-transparent"
          />
          <div className="absolute bottom-4 left-4 z-20">
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/50 bg-background/85 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-primary backdrop-blur-sm">
              <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
              {LEADER.badge}
            </span>
          </div>
        </div>

        <div className="relative z-20 flex flex-col gap-5 p-6 sm:p-8">
          <div>
            <h3 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{LEADER.name}</h3>
            <p className="mt-1.5 text-base text-foreground-muted">{LEADER.title}</p>
          </div>

          <p className="text-sm leading-relaxed text-foreground-muted sm:text-base">{LEADER.description}</p>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-foreground-muted">
              Areas of focus
            </p>
            <ul className="mt-2.5 flex flex-wrap gap-2">
              {LEADER.focus.map((area) => (
                <li key={area}>
                  <Badge variant="info">{area}</Badge>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-auto pt-1">
            <a
              href={LEADER.linkedin}
              target="_blank"
              rel="noreferrer"
              aria-label={`${LEADER.name} on LinkedIn (opens in a new tab)`}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              <LinkedInGlyph />
              LinkedIn
              <ExternalArrow />
            </a>
          </div>
        </div>
      </article>
    </div>
  );
}

/* ------------------------------- member card ------------------------------ */

function MemberCard({ member }: { member: Member }) {
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-[20px] border border-border bg-surface shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-primary/40 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-surface-raised">
        <TeamPhoto
          src={member.src}
          alt={member.name}
          initials={member.initials}
          sizes={MEMBER_SIZES}
          imgClassName="transition-transform duration-500 ease-out group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          initialsClassName="text-3xl"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background/65"
        />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-5">
        <h3 className="text-lg font-semibold leading-snug tracking-tight text-foreground">{member.name}</h3>
        <p className="text-sm font-medium text-primary">{member.role}</p>
        {member.contribution ? (
          <p className="mt-1 text-sm leading-relaxed text-foreground-muted">{member.contribution}</p>
        ) : null}
      </div>
    </article>
  );
}

/* ----------------------------- pillars visual ----------------------------- */

/**
 * Non-interactive delivery map: an architectural grid stage with a
 * perspective deck, stacked surface plates behind each pillar, gold→blue
 * flow line, and restrained glow. Depth is decorative — content stays
 * readable flat, and reduced motion flattens the deck entirely.
 */
function PillarsVisual() {
  return (
    <div className="relative mt-6 overflow-hidden rounded-[20px] border border-border bg-surface px-5 py-8 sm:px-9 sm:py-10">
      {/* Architectural grid + ambience (decorative). */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [background-size:44px_44px] opacity-40 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_75%)]"
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 size-60 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-28 -right-20 size-64 rounded-full bg-info/10 blur-3xl" />
      </div>

      {/* Flow line visible between tiles on wide screens. */}
      <div
        aria-hidden="true"
        className="absolute left-10 right-10 top-[5.75rem] hidden h-px bg-gradient-to-r from-primary/50 via-info/40 to-primary/50 lg:block"
      />

      <div className="relative [perspective:1400px]">
        <ol className="grid list-none grid-cols-1 gap-6 p-0 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5 lg:[transform-style:preserve-3d] lg:motion-safe:[transform:rotateX(7deg)] lg:[transform-origin:center_top]">
          {PILLARS.map((pillar) => (
            <li key={pillar.label} className="group relative list-none">
              {/* Two stacked plates create the layered-surface depth. */}
              <span
                aria-hidden="true"
                className="absolute inset-x-1.5 -bottom-1.5 top-2 rounded-xl border border-border/70 bg-surface-raised/50"
              />
              <span
                aria-hidden="true"
                className="absolute inset-x-3 -bottom-2.5 top-4 rounded-xl border border-border/40 bg-surface-raised/30"
              />
              <div className="relative flex flex-col gap-3 rounded-xl border border-border bg-surface-raised p-5 shadow-md transition-all duration-300 group-hover:-translate-y-1.5 group-hover:border-primary/40 group-hover:shadow-[0_20px_45px_-20px_rgba(226,179,74,0.4)] motion-reduce:transition-none motion-reduce:group-hover:translate-y-0 lg:motion-safe:[transform:translateZ(34px)]">
                <div className="flex items-center justify-between">
                  <span className="flex size-9 items-center justify-center rounded-lg border border-border bg-surface text-primary">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.75}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      focusable="false"
                      className="size-4.5"
                    >
                      {pillar.icon}
                    </svg>
                  </span>
                  <span className="font-mono text-[11px] tracking-[0.2em] text-primary/80">{pillar.step}</span>
                </div>
                <h3 className="text-base font-semibold leading-snug tracking-tight text-foreground">
                  {pillar.label}
                </h3>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

export default function TeamPage() {
  return (
    <>
      {/* Hero */}
      <section
        aria-labelledby="team-hero-heading"
        className="relative overflow-hidden rounded-[20px] border border-border bg-surface px-6 py-14 sm:px-10 sm:py-16"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-28 size-72 rounded-full bg-primary/15 blur-3xl" />
          <div className="absolute -bottom-32 -right-28 size-80 rounded-full bg-info/10 blur-3xl" />
        </div>

        <div className="relative z-10 mx-auto flex max-w-3xl flex-col items-center text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
            Built for the hackathon
          </p>
          <h1
            id="team-hero-heading"
            className="mt-5 text-4xl font-bold leading-[1.1] tracking-tight text-foreground sm:text-5xl"
          >
            The people behind Composable Floor.
          </h1>
          <p className="mt-5 max-w-2xl text-base text-foreground-muted sm:text-lg">{EVENT_LINE}</p>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-foreground-muted">{METHOD_LINE}</p>
          <p className="mt-7 inline-flex items-center gap-2 rounded-full border border-border bg-surface-raised/70 px-4 py-1.5 text-xs font-medium text-foreground-muted">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
            {TECH_LINE}
          </p>
        </div>
      </section>

      {/* Leadership */}
      <section aria-labelledby="leadership-heading" className="mt-14">
        <div className="border-b border-border pb-4">
          <h2 id="leadership-heading" className="text-2xl font-bold tracking-tight text-foreground">
            Project leadership
          </h2>
        </div>
        <div className="mt-6">
          <LeaderCard />
        </div>
      </section>

      {/* Meet the team */}
      <section aria-labelledby="team-members-heading" className="mt-14">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
          <h2 id="team-members-heading" className="text-2xl font-bold tracking-tight text-foreground">
            Meet the team
          </h2>
          <p className="text-sm text-foreground-muted">
            <span className="font-semibold text-foreground">{MEMBERS.length}</span> contributors
          </p>
        </div>
        <ul className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {MEMBERS.map((member) => (
            <li key={member.name} className="h-full">
              <MemberCard member={member} />
            </li>
          ))}
        </ul>
      </section>

      {/* Delivery pillars */}
      <section aria-labelledby="pillars-heading" className="mt-14">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
          <h2 id="pillars-heading" className="text-2xl font-bold tracking-tight text-foreground">
            Delivery pillars
          </h2>
          <p className="text-sm text-foreground-muted">How the product comes together</p>
        </div>
        <PillarsVisual />
      </section>
    </>
  );
}
