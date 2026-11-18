'use client';

import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const button = cva(
  // Periwinkle v2 pills (spec §10.2; the mockup's `.btn`).
  'inline-flex items-center justify-center gap-1.5 rounded-full font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-brand-600 text-white hover:bg-brand-700',
        secondary: 'border-[1.5px] border-gray-200 bg-white text-gray-900 hover:bg-gray-50',
        danger: 'border-[1.5px] border-red-200 bg-white text-red-600 hover:bg-red-50',
        ghost: 'text-gray-600 hover:bg-gray-100 hover:text-gray-900',
      },
      size: {
        sm: 'h-8 px-3 text-[12.5px]',
        md: 'h-10 px-[18px] text-[13.5px]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

type ButtonVariants = VariantProps<typeof button>;

export function buttonClasses(opts: ButtonVariants & { className?: string } = {}) {
  return cn(button({ variant: opts.variant, size: opts.size }), opts.className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonVariants {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, loading, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={buttonClasses({ variant, size, className })}
      {...rest}
    >
      {loading && <Loader2 size={14} className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
