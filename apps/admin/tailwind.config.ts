import type { Config } from 'tailwindcss';
import { colors } from './lib/palette';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'Consolas', 'monospace'],
      },
      // Periwinkle v2 (spec §4.4, R3): remaps gray / red / amber / green, defines brand, sun, photo, scrim.
      colors,
    },
  },
  plugins: [require('@tailwindcss/forms')],
};

export default config;
