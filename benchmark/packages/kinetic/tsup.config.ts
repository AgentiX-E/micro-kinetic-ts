import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  dts: process.env.CI === 'true' ? false : true,
  clean: true,
  sourcemap: true,
  treeshake: true,
});
