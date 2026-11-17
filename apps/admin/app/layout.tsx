import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Onest } from 'next/font/google';
import { AuthProvider } from '@/lib/auth-context';
import './globals.css';

const sans = Onest({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'MPM Admin',
  description: 'Machine Parts Marketplace — Admin Panel',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
