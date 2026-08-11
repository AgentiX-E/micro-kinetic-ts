/**
 * Abstract test suite for IKeyValueStore implementations.
 *
 * Every storage backend (fs, browser, remote) MUST pass these 12
 * contract assertions.  Usage in backend test files:
 *
 * ```typescript
 * import { defineStoreTests } from '@agentix-e/micro-kinetic-core/storage/abstract-store-test';
 *
 * describe('FileSystemStore', () => {
 *   defineStoreTests(
 *     async () => new FileSystemStore({ baseDir: tmpdir() }),
 *     async () => { /* cleanup tmpdir *&#47; },
 *   );
 * });
 * ```
 *
 * The factory pattern allows each backend to provide its own
 * setup/teardown (e.g., tmpdir for fs, Playwright page for browser,
 * echo server for remote).
 */

import { afterEach, beforeEach, expect, it } from 'vitest';
import type { IKeyValueStore } from './i-key-value-store.js';

export function defineStoreTests(
  createStore: () => Promise<IKeyValueStore>,
  cleanup?: () => Promise<void>,
): void {
  let store: IKeyValueStore;

  beforeEach(async () => {
    store = await createStore();
  });

  afterEach(async () => {
    await store.clear();
    await store.close();
    await cleanup?.();
  });

  it('[get] returns null for missing key', async () => {
    expect(await store.get<number>('nonexistent')).toBeNull();
  });

  it('[set+get] round-trips values of all JSON types', async () => {
    await store.set('num', 42);
    await store.set('str', 'hello');
    await store.set('bool', true);
    await store.set('obj', { a: 1, b: [2, 3] });
    await store.set('arr', [1, 2, 3]);

    expect(await store.get<number>('num')).toBe(42);
    expect(await store.get<string>('str')).toBe('hello');
    expect(await store.get<boolean>('bool')).toBe(true);
    expect(await store.get<{ a: number; b: number[] }>('obj')).toEqual({
      a: 1,
      b: [2, 3],
    });
    expect(await store.get<number[]>('arr')).toEqual([1, 2, 3]);
  });

  it('[set] overwrites existing value', async () => {
    await store.set('k', 1);
    await store.set('k', 2);
    expect(await store.get<number>('k')).toBe(2);
  });

  it('[delete] removes value', async () => {
    await store.set('k', 1);
    await store.delete('k');
    expect(await store.get('k')).toBeNull();
  });

  it('[delete] is no-op for missing key', async () => {
    await expect(store.delete('nonexistent')).resolves.not.toThrow();
  });

  it('[has] returns true/false correctly', async () => {
    expect(await store.has('k')).toBe(false);
    await store.set('k', 1);
    expect(await store.has('k')).toBe(true);
    await store.delete('k');
    expect(await store.has('k')).toBe(false);
  });

  it('[keys] lists all keys', async () => {
    await store.set('a', 1);
    await store.set('b', 2);
    await store.set('c', 3);

    const keys = (await store.keys()).sort();
    expect(keys).toEqual(['a', 'b', 'c']);
  });

  it('[keys] filters by prefix', async () => {
    await store.set('ns:a', 1);
    await store.set('ns:b', 2);
    await store.set('other', 3);

    const keys = (await store.keys('ns:')).sort();
    expect(keys).toEqual(['ns:a', 'ns:b']);
  });

  it('[clear] removes all keys', async () => {
    await store.set('a', 1);
    await store.set('b', 2);
    await store.clear();

    expect(await store.keys()).toEqual([]);
  });

  it('[concurrent] handles parallel writes safely', async () => {
    const writes = Array.from({ length: 10 }, (_, i) => store.set(`k${i}`, i));
    await Promise.all(writes);

    const keys = await store.keys();
    expect(keys).toHaveLength(10);
  });

  it('[large] handles values over 100KB', async () => {
    const large = { data: 'x'.repeat(100 * 1024) };
    await store.set('large', large);

    const retrieved = await store.get<{ data: string }>('large');
    expect(retrieved).toEqual(large);
  });

  it('[special-chars] handles special characters in keys', async () => {
    const key = 'namespace/with:special@chars#123';
    await store.set(key, 42);

    expect(await store.get<number>(key)).toBe(42);
    expect(await store.has(key)).toBe(true);
  });
}
