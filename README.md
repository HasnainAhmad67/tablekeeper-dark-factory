# Composable Floor

Team HJ's Tablekeeper project — a restaurant reservation system with dynamically joinable
table groups and strict double-booking prevention.

## Status

M1 (Repository Foundation and Design System) is implemented: Next.js 15 with strict
TypeScript, Tailwind CSS 4 design tokens, ESLint + Prettier, Vitest, Playwright
configuration, Supabase client structure, a CI pipeline, and a minimal responsive home
page that renders without Supabase credentials.

## Tech stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript (strict)
- **Styling:** Tailwind CSS 4 + CSS variable design tokens
- **Backend:** Supabase (PostgreSQL, Auth, RLS) — client structure only in M1
- **Testing:** Vitest (unit/smoke), Playwright (E2E, configured)
- **CI:** GitHub Actions

## Getting started

### Prerequisites

- Node.js 22.12+ (24.x recommended)
- npm 10+

### Setup

```bash
npm install
cp .env.example .env.local   # then fill in values from your Supabase project
npm run dev
```

Open http://localhost:3000 — the home page renders without Supabase credentials.

### Environment variables

| Variable                               | Required | Description                            |
| -------------------------------------- | -------- | -------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`             | Yes      | Supabase project URL (public)          |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes      | Supabase publishable/anon key (public) |
| `SUPABASE_SECRET_KEY`                  | Yes      | Supabase secret key (server-only)      |

The app runs locally without these values; the Supabase clients throw a clear error only
when invoked without them. Never commit real credentials — `.env` files are gitignored.

## Scripts

| Command                 | Description                    |
| ----------------------- | ------------------------------ |
| `npm run dev`           | Start the dev server           |
| `npm run build`         | Build for production           |
| `npm run start`         | Start the production server    |
| `npm run typecheck`     | Type-check with `tsc --noEmit` |
| `npm test`              | Run tests once (Vitest)        |
| `npm run test:watch`    | Run tests in watch mode        |
| `npm run lint`          | Lint with ESLint               |
| `npm run format`        | Format with Prettier           |
| `npm run format:check`  | Check formatting               |
| `npm run security:scan` | Scan for hardcoded secrets     |

## Project structure

```
src/
  app/            # Next.js App Router (pages, API routes)
    api/          # API route handlers
  lib/            # Shared utilities (design tokens, Supabase clients)
  components/     # UI components (added in later milestones)
  domain/         # Domain logic (availability, reservations — later milestones)
  stores/         # Client state (later milestones)
tests/            # Vitest tests and Playwright E2E specs
scripts/          # Node-based tooling (security scan)
```

## Testing

- `npm test` — Vitest smoke tests: design-token contract, health route, home page render,
  and project configuration.
- `npx playwright test` — E2E (configuration in place; specs arrive with later
  milestones). Install browsers once with `npx playwright install` — free and
  open-source, no paid service required.

## CI

GitHub Actions runs on every push and pull request: typecheck, tests, lint, format
check, and the security scan.
