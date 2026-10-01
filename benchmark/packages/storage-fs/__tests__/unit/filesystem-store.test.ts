import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defineStoreTests } from '../../../core/src/storage/abstract-store-test.js';
import { FileSystemStore, STORE_DIR_ENV } from '../../src/filesystem-store.js';

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

  it('should store a key containing the path separator as one segment, not as directories', async () => {
    const dir = join(tmpDir, 'nested');
    const store = new FileSystemStore({ baseDir: dir });

    await store.set('ns/sub/k1', 'v1');
    await store.set('ns/sub/k2', 'v2');
    await store.set('ns/other', 'v3');

    // The separator is escaped, so all three keys are files directly under the base directory.
    // This is the assertion that makes the absence of a parent-directory step in `set` honest: a
    // key can never name a directory, so there is no parent left to create.
    expect(readdirSync(dir).sort()).toEqual([
      'ns%2Fother.json',
      'ns%2Fsub%2Fk1.json',
      'ns%2Fsub%2Fk2.json',
    ]);

    const keys = (await store.keys('ns/sub/')).sort();
    expect(keys).toEqual(['ns/sub/k1', 'ns/sub/k2']);

    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('should not report a directory as a key, even when its name ends in .json', async () => {
    const dir = join(tmpDir, 'dir-not-key');
    const store = new FileSystemStore({ baseDir: dir });

    await store.set('real', 1);
    mkdirSync(join(dir, 'impostor.json'), { recursive: true });

    // `keys()` answers "which keys exist". A directory is not a key, and reporting one would hand
    // the caller a name that `get` then refuses to read.
    expect(await store.keys()).toEqual(['real']);

    await store.close();
    await rm(dir, { recursive: true, force: true });
  });
});

// ── Error propagation ──

describe('FileSystemStore error propagation', () => {
  // A store must tell "the key is not there" apart from "the store is broken". Only ENOENT means
  // absent; every other failure is real and has to reach the caller instead of being reported as
  // an empty value. Each case below produces a real error code from the real filesystem.
  let dir: string;
  let store: FileSystemStore;

  beforeEach(() => {
    dir = join(tmpDir, 'propagation');
    store = new FileSystemStore({ baseDir: dir });
  });

  afterEach(async () => {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('get should propagate a read failure that is not ENOENT', async () => {
    mkdirSync(join(dir, 'k.json'), { recursive: true }); // a directory where the key's file belongs

    await expect(store.get('k')).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it('has should propagate a read failure that is not ENOENT', async () => {
    mkdirSync(join(dir, 'k.json'), { recursive: true });

    await expect(store.has('k')).rejects.toMatchObject({ code: 'EISDIR' });
  });

  it('delete should propagate an unlink failure that is not ENOENT', async () => {
    // A non-empty directory cannot be unlinked. The exact code is platform-dependent (EPERM on
    // macOS, EISDIR on Linux), so the assertion is the part that is portable: it failed, and it
    // did not fail as "absent".
    mkdirSync(join(dir, 'k.json'), { recursive: true });
    writeFileSync(join(dir, 'k.json', 'inner'), 'x');

    const error = await store.delete('k').then(
      () => null,
      (err: NodeJS.ErrnoException) => err,
    );
    expect(error).not.toBeNull();
    expect(error!.code).not.toBe('ENOENT');
  });

  it('keys should propagate a readdir failure that is not ENOENT', async () => {
    // A file where the base directory belongs: the directory is unreadable, which is not the same
    // statement as "the store is empty".
    writeFileSync(dir, 'not a directory');

    await expect(store.keys()).rejects.toMatchObject({ code: 'ENOTDIR' });
  });
});

describe('FileSystemStore write safety', () => {
  it('should write atomically — no partial file on crash', async () => {
    const dir = join(tmpDir, 'atomic');
    const store = new FileSystemStore({ baseDir: dir });
    await store.set('atomic', 'value');

    // The measure is the DIRECTORY, not `keys()`. `keys()` filters to `.json` by construction, so
    // it cannot see a leftover temp file — the previous version of this test asserted the file
    // count through `keys()` while its comment claimed there were no temp files.
    expect(readdirSync(dir)).toEqual(['atomic.json']);

    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('should leave no temp file behind when the atomic write cannot complete', async () => {
    const dir = join(tmpDir, 'atomic-failure');
    const store = new FileSystemStore({ baseDir: dir });

    // A DIRECTORY occupies the path the key's file must take, so the final rename — the second
    // half of the atomic write — cannot succeed. `rename(file, dir)` is EISDIR on every platform
    // Node supports, which makes the failure deterministic without mocking the filesystem.
    mkdirSync(join(dir, 'blocked.json'), { recursive: true });

    await expect(store.set('blocked', { v: 1 })).rejects.toThrow();

    // The temp file is garbage the moment the rename fails: nothing will ever rename it, and
    // `keys()` will never list it. Left alone it accumulates in the store directory forever.
    expect(readdirSync(dir)).toEqual(['blocked.json']);

    await store.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('should handle read-only directory gracefully', async () => {
    const dir = join(tmpDir, 'readonly');
    const store = new FileSystemStore({ baseDir: dir });
    await store.set('k', 1); // creates dir

    // Make directory read-only. Whether the second write SUCCEEDS is platform- and
    // permission-dependent: overwriting an existing file needs only the file's permission, but
    // replacing it needs the directory's. Both outcomes are legitimate, so the assertions below
    // are the contract that must hold either way — a test that accepted both outcomes silently
    // would be a test that could not fail.
    chmodSync(dir, 0o555);
    try {
      await store.set('k', 2);
    } catch {
      // Expected on this platform: the rename needs directory write permission.
    }
    chmodSync(dir, 0o755);

    expect([1, 2]).toContain(await store.get<number>('k'));
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);

    await store.close();
    await rm(dir, { recursive: true, force: true });
  });
});

// ── Base directory resolution ──

describe('FileSystemStore base directory', () => {
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env[STORE_DIR_ENV];
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[STORE_DIR_ENV];
    else process.env[STORE_DIR_ENV] = savedEnv;
  });

  it('should default to ~/.micro-kinetic/store', () => {
    // Read, never written: the resolved directory is a configuration value, and a test that
    // exercised this default by writing to it would be writing to the user's real store.
    delete process.env[STORE_DIR_ENV];
    expect(new FileSystemStore().baseDir).toBe(resolve(homedir(), '.micro-kinetic', 'store'));
  });

  it('should relocate the default store when the environment variable is set', async () => {
    const envDir = join(tmpDir, 'env-root');
    process.env[STORE_DIR_ENV] = envDir;

    const store = new FileSystemStore();
    expect(store.baseDir).toBe(resolve(envDir));

    await store.set('k', 1);
    expect(existsSync(join(envDir, 'k.json'))).toBe(true);

    await store.close();
    await rm(envDir, { recursive: true, force: true });
  });

  it('should treat an empty environment variable as unset, not as the current directory', () => {
    // An empty value is another configuration, and the one it must not mean is "". A base
    // directory of "" would resolve to the process's working directory and scatter store files
    // into the repository.
    process.env[STORE_DIR_ENV] = '';
    expect(new FileSystemStore().baseDir).toBe(resolve(homedir(), '.micro-kinetic', 'store'));
  });

  it('should prefer an explicit baseDir over the environment variable', async () => {
    const explicit = join(tmpDir, 'explicit');
    const envDir = join(tmpDir, 'env-shadowed');
    process.env[STORE_DIR_ENV] = envDir;

    const store = new FileSystemStore({ baseDir: explicit });
    await store.set('k', 1);

    expect(existsSync(join(explicit, 'k.json'))).toBe(true);
    expect(existsSync(envDir)).toBe(false);

    await store.close();
    await rm(explicit, { recursive: true, force: true });
  });

  it('should resolve the environment variable relative to the process working directory', async () => {
    // A relative path in the environment is a real configuration, and it must be resolved once,
    // at construction, into one absolute directory — not re-interpreted later.
    const relative = join('..', basename(tmpDir), 'env-relative');
    process.env[STORE_DIR_ENV] = relative;

    const store = new FileSystemStore();
    expect(store.baseDir).toBe(resolve(relative));
    await store.close();
  });
});
