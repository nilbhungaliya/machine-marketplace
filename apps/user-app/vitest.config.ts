import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      // lucide-react-native uses react-native-svg, which cannot run in Node.
      'lucide-react-native': path.resolve(__dirname, '__mocks__/lucide-react-native.ts'),
    },
  },
  test: {
    include: ['lib/**/*.test.ts', 'screens/**/*.test.ts', 'components/**/*.test.ts', 'store/**/*.test.ts', 'hooks/**/*.test.ts'],
    environment: 'node',
    // Forces UTC before workers fork — see vitest.global-setup.ts.
    globalSetup: ['./vitest.global-setup.ts'],
  },
});
