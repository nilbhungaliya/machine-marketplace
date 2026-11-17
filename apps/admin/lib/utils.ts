import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return `₹${amount.toLocaleString('en-IN')}`;
}

export function formatDate(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateTime(date: string | Date): string {
  return new Date(date).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Render an Indian phone number for display: `+91 9876543210`.
 *
 * Every table stores the number WITH its country code (`+919876543212`), but
 * the admin pages were rendering `` `+91 ${phone}` ``, producing
 * `+91 +919876543212`. Six pages did this. A seventh, jobs/[id]/view.tsx,
 * printed the right thing only because it stripped `+91` on one line and added
 * it back on another — correct, but two rules where there should be one.
 *
 * Accepts a number with or without the country code so it stays right whichever
 * shape a future endpoint returns.
 */
export function formatPhone(phone?: string | null): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');           // '+91 98765 43210' -> '919876543210'
  // Only strip a leading 91 when what follows can be a real number, so a short
  // number that happens to begin with 91 is left alone.
  const local = digits.startsWith('91') && digits.length > 10
    ? digits.slice(2)
    : digits;
  // '+91' with no number behind it would otherwise render as '+91 91'.
  if (!local || local === '91') return '—';
  return `+91 ${local}`;
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.slice(0, length) + '...';
}
