import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname) } },
  // tsconfig keeps JSX for Next ("preserve"); tests need the React 17+ runtime.
  esbuild: { jsx: 'automatic' },
  test: {
    include: ['lib/**/*.test.ts', 'components/**/*.test.ts', 'components/**/*.test.tsx', 'app/**/*.test.tsx'],
    environmentMatchGlobs: [['components/**', 'jsdom'], ['app/**', 'jsdom']],
  },
});
