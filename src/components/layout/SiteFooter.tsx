/**
 * Site footer — extracted verbatim from the original landing markup so
 * every screen shares it through the root layout.
 */
export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-6 text-sm text-foreground-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>Team HJ — Composable Floor</p>
        <p>Next.js · TypeScript · Tailwind CSS · Supabase</p>
      </div>
    </footer>
  );
}
