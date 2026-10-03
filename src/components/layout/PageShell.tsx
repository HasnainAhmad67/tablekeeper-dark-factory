import type { ReactNode } from 'react';

/**
 * Shared main landmark for every screen: `id="main-content"` is the
 * skip-link target and `flex-1` keeps the footer pinned in the root
 * flex-column body. The max width mirrors the original landing shell;
 * full-bleed screens (e.g. M8 floor view) may need a later adjustment.
 */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <main id="main-content" className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6">
      {children}
    </main>
  );
}
