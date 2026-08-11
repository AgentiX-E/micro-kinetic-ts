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
});
