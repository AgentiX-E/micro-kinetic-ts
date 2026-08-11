import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@agentix-e/micro-kinetic-optimize': resolve(__dirname, 'src/index.ts'),
      '@agentix-e/micro-kinetic-core': resolve(__dirname, '../core/src/index.ts'),
      '@agentix-e/micro-kinetic-tree': resolve(__dirname, '../tree/src/index.ts'),
      '@agentix-e/micro-kinetic-storage-fs': resolve(
        __dirname,
        '../storage-fs/src/index.ts',
      ),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts', '__tests__/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
});
