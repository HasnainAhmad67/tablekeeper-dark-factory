import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

import { AuthProvider } from '@/components/auth/AuthProvider';
import { PageShell } from '@/components/layout/PageShell';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SkipLink } from '@/components/layout/SkipLink';

export const metadata: Metadata = {
  title: 'Composable Floor',
  description:
    'A restaurant reservation system with dynamically joinable table groups and strict double-booking prevention.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <SkipLink />
        <AuthProvider>
          <SiteHeader />
          {/* PageShell must nest inside AuthProvider: every page below it
              calls useAuth(), and a context provider emits no DOM, so the
              rendered markup and styling are unchanged. */}
          <PageShell>{children}</PageShell>
        </AuthProvider>
        <SiteFooter />
      </body>
    </html>
  );
}
