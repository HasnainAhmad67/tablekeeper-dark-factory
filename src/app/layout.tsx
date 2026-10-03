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
        </AuthProvider>
        <PageShell>{children}</PageShell>
        <SiteFooter />
      </body>
    </html>
  );
}
