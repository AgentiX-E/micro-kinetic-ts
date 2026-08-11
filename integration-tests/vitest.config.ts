import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@agentix-e/micro-kinetic-core': resolve(__dirname, '../packages/core/src/index.ts'),
      '@agentix-e/micro-kinetic-core': resolve(__dirname, '../packages/tree/src/index.ts'),
      '@agentix-e/micro-kinetic-core': resolve(__dirname, '../packages/cutting/src/index.ts'),
      '@agentix-e/micro-kinetic-core': resolve(__dirname, '../packages/noise/src/index.ts'),
      '@agentix-e/micro-kinetic-core': resolve(__dirname, '../packages/scaling/src/index.ts'),
      '@agentix-e/micro-kinetic-core': resolve(__dirname, '../packages/wave/src/index.ts'),
      '@agentix-e/micro-kinetic': resolve(__dirname, '../packages/kinetic/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['integration-tests/src/**/*.spec.ts', 'integration-tests/src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
    },
  },
});
