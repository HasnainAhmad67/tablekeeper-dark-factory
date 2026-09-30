const tokenSwatches = [
  { name: 'Background', className: 'bg-background', textClass: 'text-foreground' },
  { name: 'Surface', className: 'bg-surface', textClass: 'text-foreground' },
  { name: 'Primary', className: 'bg-primary', textClass: 'text-primary-foreground' },
  { name: 'Success', className: 'bg-success', textClass: 'text-background' },
  { name: 'Warning', className: 'bg-warning', textClass: 'text-background' },
  { name: 'Danger', className: 'bg-danger', textClass: 'text-background' },
];

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        Skip to main content
      </a>

      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <span className="text-lg font-semibold tracking-tight">Composable Floor</span>
          <nav aria-label="Primary">
            <a
              href="/api/health"
              className="rounded-md px-3 py-2 text-sm text-foreground-muted transition-colors hover:bg-surface-raised hover:text-foreground"
            >
              Health check
            </a>
          </nav>
        </div>
      </header>

      <main id="main-content" className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
        <section aria-labelledby="hero-heading">
          <p className="text-sm font-medium uppercase tracking-widest text-primary">Tablekeeper</p>
          <h1
            id="hero-heading"
            className="mt-2 text-4xl font-bold tracking-tight text-foreground sm:text-5xl"
          >
            Composable Floor
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-foreground-muted">
            A restaurant reservation system with dynamically joinable table groups and strict
            double-booking prevention.
          </p>
          <p className="mt-6 inline-block rounded-full border border-border bg-surface px-4 py-1.5 text-sm text-foreground-muted">
            M1 — Repository Foundation and Design System
          </p>
        </section>

        <section aria-labelledby="tokens-heading" className="mt-14">
          <h2 id="tokens-heading" className="text-2xl font-semibold tracking-tight text-foreground">
            Design tokens
          </h2>
          <p className="mt-2 text-foreground-muted">
            The Composable Floor design system — dark-first with light-theme support.
          </p>
          <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
            {tokenSwatches.map((token) => (
              <li
                key={token.name}
                className={`rounded-lg border border-border p-4 ${token.className}`}
              >
                <span className={`text-sm font-medium ${token.textClass}`}>{token.name}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-6 text-sm text-foreground-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>Team HJ — Composable Floor</p>
          <p>Next.js · TypeScript · Tailwind CSS · Supabase</p>
        </div>
      </footer>
    </div>
  );
}
