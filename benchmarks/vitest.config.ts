import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@agentix-e/micro-kinetic': resolve(__dirname, '../packages/kinetic/src/index.ts'),
      '@agentix-e/micro-kinetic-core': resolve(__dirname, '../packages/core/src/index.ts'),
      '@agentix-e/micro-kinetic-tree': resolve(__dirname, '../packages/tree/src/index.ts'),
      '@agentix-e/micro-kinetic-cutting': resolve(__dirname, '../packages/cutting/src/index.ts'),
      '@agentix-e/micro-kinetic-noise': resolve(__dirname, '../packages/noise/src/index.ts'),
      '@agentix-e/micro-kinetic-scaling': resolve(__dirname, '../packages/scaling/src/index.ts'),
      '@agentix-e/micro-kinetic-wave': resolve(__dirname, '../packages/wave/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.spec.ts'],
  },
});
