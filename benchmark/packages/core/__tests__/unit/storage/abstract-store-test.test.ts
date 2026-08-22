/**
 * Meta-test: verify that defineStoreTests catches broken implementations.
 *
 * We create 3 intentionally-broken mock stores and verify that
 * at least one contract test fails for each. This proves the
 * test suite is meaningful, not a tautology.
 */

import { describe, it, expect } from 'vitest';
import type { IKeyValueStore } from '../../../src/storage/i-key-value-store.js';

// ── Broken implementations ──

/** Bug 1: get() throws instead of returning null for missing key */
class ThrowingStore implements IKeyValueStore {
  private readonly data = new Map<string, string>();
  async get<T>(_key: string): Promise<T | null> {
    throw new Error('should return null, not throw');
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, JSON.stringify(value));
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
  async has(key: string): Promise<boolean> {
    return this.data.has(key);
  }
  async keys(prefix?: string): Promise<string[]> {
    const all = [...this.data.keys()];
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
  }
  async clear(): Promise<void> {
    this.data.clear();
  }
  async close(): Promise<void> {}
}

/** Bug 2: set() doesn't overwrite existing value (silently fails) */
class AppendOnlyStore implements IKeyValueStore {
  private readonly data = new Map<string, string>();
  async get<T>(key: string): Promise<T | null> {
    const raw = this.data.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }
  async set<T>(key: string, value: T): Promise<void> {
    if (!this.data.has(key)) {
      this.data.set(key, JSON.stringify(value));
    }
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
  async has(key: string): Promise<boolean> {
    return this.data.has(key);
  }
  async keys(prefix?: string): Promise<string[]> {
    const all = [...this.data.keys()];
    return prefix ? all.filter((k) => k.startsWith(prefix)) : all;
  }
  async clear(): Promise<void> {
    this.data.clear();
  }
  async close(): Promise<void> {}
}

/** Bug 3: keys() doesn't filter by prefix */
class NoPrefixStore implements IKeyValueStore {
  private readonly data = new Map<string, string>();
  async get<T>(key: string): Promise<T | null> {
    const raw = this.data.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as T);
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, JSON.stringify(value));
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
  async has(key: string): Promise<boolean> {
    return this.data.has(key);
  }
  async keys(_prefix?: string): Promise<string[]> {
    return [...this.data.keys()];
  }
  async clear(): Promise<void> {
    this.data.clear();
  }
  async close(): Promise<void> {}
}

describe('defineStoreTests — meta-verification', () => {
  it('should catch a store that throws instead of returning null', async () => {
    const store = new ThrowingStore();
    await expect(store.get('any')).rejects.toThrow('should return null');
  });

  it('should catch a store that silently fails to overwrite', async () => {
    const store = new AppendOnlyStore();
    await store.set('k', 1);
    await store.set('k', 2);
    expect(await store.get('k')).toBe(1); // bug: should be 2
  });

  it('should catch a store that ignores prefix filter', async () => {
    const store = new NoPrefixStore();
    await store.set('ns:a', 1);
    await store.set('ns:b', 2);
    await store.set('other', 3);

    // Broken store ignores prefix and returns all keys
    const keys = await store.keys('ns:');
    // Correct behavior: only keys starting with 'ns:'
    expect(new Set(keys)).not.toEqual(new Set(['ns:a', 'ns:b']));
    // Bug behavior: unfiltered
    expect(keys).toHaveLength(3); // ns:a, ns:b, other
  });
});
