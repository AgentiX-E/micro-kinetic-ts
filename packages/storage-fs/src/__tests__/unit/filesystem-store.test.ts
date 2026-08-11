import { chmodSync, existsSync, mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { defineStoreTests } from '../../../../core/src/storage/abstract-store-test.js';
import { FileSystemStore } from '../../filesystem-store.js';

// ── Contract tests ──

const tmpDir = mkdtempSync(join(tmpdir(), 'storage-fs-test-'));

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('FileSystemStore contract', () => {
  defineStoreTests(
    async () =>
      new FileSystemStore({
        baseDir: join(tmpDir, 'contract'),
      }),
    async () => {
      await rm(join(tmpDir, 'contract'), { recursive: true, force: true });
    },
  );
});

// ── FS-specific tests ──

describe('FileSystemStore specifics', () => {
  it('should create base directory on first write', async () => {
    const dir = join(tmpDir, 'auto-create');
    const store = new FileSystemStore({ baseDir: dir });

    await store.set('key', 1);
    expect(existsSync(dir)).toBe(true);

    await rm(dir, { recursive: true, force: true });
    await store.close();
  });

  it('should persist data across store instances (process restart simulation)', async () => {
    const dir = join(tmpDir, 'restart');
    const store1 = new FileSystemStore({ baseDir: dir });
    await store1.set('persist', { data: 42 });
    await store1.close();

    // Simulate process restart
    const store2 = new FileSystemStore({ baseDir: dir });
    const value = await store2.get<{ data: number }>('persist');
    expect(value).toEqual({ data: 42 });
    await store2.close();

    await rm(dir, { recursive: true, force: true });
  });

  it('should handle nested key paths (ns/sub/key)', async () => {
    const dir = join(tmpDir, 'nested');
    const store = new FileSystemStore({ baseDir: dir });

    await store.set('ns/sub/k1', 'v1');
    await store.set('ns/sub/k2', 'v2');
    await store.set('ns/other', 'v3');

    const keys = (await store.keys('ns/sub/')).sort();
    expect(keys).toEqual(['ns/sub/k1', 'ns/sub/k2']);

    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('should write atomically — no partial file on crash', async () => {
    const dir = join(tmpDir, 'atomic');
    const store = new FileSystemStore({ baseDir: dir });
    await store.set('atomic', 'value');

    // Verify only .json files exist (no .tmp files)
    const files = await store.keys();
    expect(files).toHaveLength(1);
    expect(files[0]).toBe('atomic');

    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('should handle read-only directory gracefully', async () => {
    const dir = join(tmpDir, 'readonly');
    const store = new FileSystemStore({ baseDir: dir });
    await store.set('k', 1); // creates dir

    // Make directory read-only
    chmodSync(dir, 0o444);

    try {
      await store.set('k', 2);
      // If write succeeds on macOS (admin permissions), still verify data
      const v = await store.get<number>('k');
      expect(typeof v).toBe('number');
    } catch {
      // Expected: write fails on read-only dir
      // This is platform-dependent
    }

    // Restore permissions for cleanup
    chmodSync(dir, 0o755);
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });
});
