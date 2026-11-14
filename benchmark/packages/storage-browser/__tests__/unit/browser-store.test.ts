import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { defineStoreTests } from '../../../core/src/storage/abstract-store-test.js';
import { BrowserStore } from '../../src/browser-store.js';

// ── Contract tests ──

describe('BrowserStore contract', () => {
  defineStoreTests(
    async () => new BrowserStore({ namespace: 'test-contract' }),
    async () => {
      // localStorage cleanup
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('test-contract:')) toRemove.push(k);
      }
      for (const k of toRemove) localStorage.removeItem(k);
    },
  );
});

// ── Browser-specific tests ──

describe('BrowserStore specifics', () => {
  let store: BrowserStore;

  beforeEach(() => {
    store = new BrowserStore({ namespace: 'test-specific' });
  });

  afterEach(async () => {
    await store.clear();
    await store.close();
  });

  it('should store small values (<5KB) in localStorage', async () => {
    const smallValue = { a: 1 };
    await store.set('small', smallValue);

    // Verify localStorage has it under the namespaced key
    const raw = localStorage.getItem('test-specific:small');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual(smallValue);
  });

  it('should store large values (>5KB) in memory', async () => {
    const largeValue = { data: 'x'.repeat(10 * 1024) };
    await store.set('large', largeValue);

    // localStorage should NOT have it (too large)
    const raw = localStorage.getItem('test-specific:large');
    expect(raw).toBeNull();

    // But get() should retrieve it from memory
    const retrieved = await store.get<typeof largeValue>('large');
    expect(retrieved).toEqual(largeValue);
  });

  it('should not leak keys across namespaces', async () => {
    const storeA = new BrowserStore({ namespace: 'ns-a' });
    const storeB = new BrowserStore({ namespace: 'ns-b' });

    await storeA.set('shared-key', 1);
    await storeB.set('shared-key', 2);

    expect(await storeA.get<number>('shared-key')).toBe(1);
    expect(await storeB.get<number>('shared-key')).toBe(2);

    expect(await storeA.keys()).not.toContain('test-specific:shared-key');

    await storeA.close();
    await storeB.close();
  });

  it('should survive clear() followed by fresh writes', async () => {
    await store.set('k', 1);
    await store.clear();
    expect(await store.get('k')).toBeNull();

    await store.set('k', 2);
    expect(await store.get<number>('k')).toBe(2);
  });

  it('should handle keys with special characters', async () => {
    const key = 'ns/sub:key@with#special%chars';
    await store.set(key, 'value');
    expect(await store.get<string>(key)).toBe('value');
    expect(await store.has(key)).toBe(true);
    await store.delete(key);
    expect(await store.has(key)).toBe(false);
  });

  it('should list a key that lives only in the in-memory tier', async () => {
    const largeValue = { data: 'x'.repeat(10 * 1024) };
    await store.set('large', largeValue);
    await store.set('large-other', largeValue);

    // `keys()` has two sources. A large value never reaches localStorage, so it exists only in the
    // in-memory tier — and that is the tier whose listing has to work, with and without a prefix.
    expect((await store.keys()).sort()).toEqual(['large', 'large-other']);
    expect((await store.keys('large-')).sort()).toEqual(['large-other']);
    expect((await store.keys('large')).sort()).toEqual(['large', 'large-other']);
    expect(await store.keys('nothing-matches-')).toEqual([]);
    expect(await store.has('large')).toBe(true);

    await store.delete('large');
    await store.delete('large-other');
  });

  it('should use its documented defaults when constructed without options', async () => {
    const bare = new BrowserStore();
    await bare.set('k', 1);

    expect(localStorage.getItem('micro-kinetic:k')).toBe('1');
    await bare.close();
  });
});

// ── Degraded browser storage ──

/** A real `Storage` implementation with a real byte limit, so `setItem` rejects on its own. */
class QuotaStorage implements Storage {
  private readonly items = new Map<string, string>();

  constructor(private readonly maxBytes: number) {}

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    const used = [...this.items.entries()].reduce((n, [k, v]) => n + k.length + v.length, 0);
    if (used + key.length + value.length > this.maxBytes) {
      const error = new Error('QuotaExceededError: the storage quota has been exceeded');
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.items.set(key, value);
  }
}

describe('BrowserStore with degraded localStorage', () => {
  // Browsers do not always hand over a working Storage: the property can throw on access (storage
  // blocked by policy, a cross-origin iframe), be absent entirely, or reject a write once the quota
  // is full. Each case is reproduced by arranging the real condition rather than by stubbing the
  // store, and the contract is the same in all of them: the in-memory tier still serves the value.
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  afterEach(() => {
    if (original === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
    else Object.defineProperty(globalThis, 'localStorage', original);
  });

  it('should work when reading localStorage throws', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('access to storage is not allowed from this context');
      },
    });

    const store = new BrowserStore({ namespace: 'blocked' });
    await store.set('k', { a: 1 });
    expect(await store.get<{ a: number }>('k')).toEqual({ a: 1 });
    expect(await store.has('k')).toBe(true);
    expect(await store.keys()).toEqual(['k']);

    await store.delete('k');
    expect(await store.has('k')).toBe(false);
    await store.close();
  });

  it('should work when localStorage is absent', async () => {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: undefined });

    const store = new BrowserStore({ namespace: 'absent' });
    await store.set('k', 'v');
    expect(await store.get<string>('k')).toBe('v');
    expect(await store.keys()).toEqual(['k']);
    await store.clear();
    expect(await store.keys()).toEqual([]);
    await store.close();
  });

  it('should fall back to the in-memory tier when localStorage rejects the write', async () => {
    // 8 bytes is already too small for a namespaced key plus a value, so every write is refused by
    // the real quota — the case a small-value write hits on a full origin.
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: new QuotaStorage(8),
    });

    const store = new BrowserStore({ namespace: 'full' });
    await store.set('k', 'value');

    // Rejected by localStorage, kept in memory: readable, listed, and removable.
    expect(await store.get<string>('k')).toBe('value');
    expect(await store.keys()).toEqual(['k']);
    await store.delete('k');
    expect(await store.get('k')).toBeNull();
    await store.close();
  });
});
