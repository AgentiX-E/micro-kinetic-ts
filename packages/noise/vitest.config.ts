import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  resolve: {
    alias: {
      '@agentix-e/micro-kinetic-noise': resolve(__dirname, 'src/index.ts'),
      '@agentix-e/micro-kinetic-core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
  test: {
    globals: true, environment: 'node',
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.spec.ts'],
    coverage: {
      provider: 'v8', reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'], exclude: ['src/index.ts', 'src/**/index.ts'], all: true,
      thresholds: { statements: 95, branches: 90, functions: 95, lines: 95 },
    },
  },
});
