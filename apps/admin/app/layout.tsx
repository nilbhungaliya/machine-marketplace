import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { JetBrains_Mono, Manrope } from 'next/font/google';
import { AuthProvider } from '@/lib/auth-context';
import './globals.css';

// Periwinkle v2 type (spec §5.1, §10.1): Manrope for everything, JetBrains Mono for keys, slugs and codes (`font-mono`).
const sans = Manrope({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  title: 'MPM Admin',
  description: 'Machine Parts Marketplace — Admin Panel',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
