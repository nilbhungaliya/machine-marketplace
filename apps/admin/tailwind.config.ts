import type { Config } from 'tailwindcss';

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
      },
      colors: {
        // Indigo — the dye of the trade. Shared with apps/user-app (lib/ThemeContext.tsx primary).
        brand: {
          50: '#EEF2FF',
          100: '#E0E7FF',
          200: '#C7D2FE',
          300: '#A5B4FC',
          400: '#818CF8', // active nav marker, focus rings
          500: '#6366F1',
          600: '#4F46E5', // filled buttons / CTAs (white text)
          700: '#4338CA', // hover
          800: '#3730A3',
          900: '#312E81',
        },
        side: {
          DEFAULT: '#1E1F2B',
          hover: '#2A2C3B',
          line: '#33354A',
          text: '#C9CBD8',
          dim: '#8A8DA3',
        },
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
};

export default config;
