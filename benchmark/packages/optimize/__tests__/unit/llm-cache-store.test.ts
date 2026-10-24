import { describe, expect, it, beforeEach } from 'vitest';
import { LLMCacheStore } from '../../src/llm-cache-store.js';
import type { IKeyValueStore } from '@agentix-e/micro-kinetic-core';

function makeMemoryStore(): IKeyValueStore {
  const map = new Map<string, string>();
  return {
    get: async <T>(k: string) => {
      const v = map.get(k);
      return v === undefined ? null : (JSON.parse(v) as T);
    },
    set: async <T>(k: string, v: T) => {
      map.set(k, JSON.stringify(v));
    },
    delete: async (k: string) => {
      map.delete(k);
    },
    has: async (k: string) => map.has(k),
    keys: async (p?: string) => {
      const all = [...map.keys()];
      return p ? all.filter((k) => k.startsWith(p)) : all;
    },
    clear: async () => map.clear(),
    close: async () => map.clear(),
  };
}

describe('LLMCacheStore', () => {
  let store: LLMCacheStore;

  beforeEach(() => {
    store = new LLMCacheStore(makeMemoryStore());
  });

  it('should cache and retrieve LLM result', async () => {
    await store.set('key1', 'result1');
    const result = await store.get('key1');
    expect(result).toBe('result1');
  });

  it('should return null for missing cache entry', async () => {
    expect(await store.get('missing')).toBeNull();
  });

  it('should return null for expired entry', async () => {
    await store.set('key', 'value');
    // Sleep to make entry older than 1ms TTL
    await new Promise((r) => setTimeout(r, 10));
    const result = await store.get('key', 1);
    expect(result).toBeNull();
  });

  it('should return value for non-expired entry', async () => {
    await store.set('key', 'value');
    // TTL of 1 hour (3600000ms) — should not be expired
    const result = await store.get('key', 3600000);
    expect(result).toBe('value');
  });

  it('should evict expired entries', async () => {
    await store.set('old', 'old-value');
    await store.set('new', 'new-value');

    // Make old entry expired by sleeping
    await new Promise((r) => setTimeout(r, 10));
    await store.evictOlderThan(5); // evict keys older than 5ms

    expect(await store.get('old')).toBeNull();
    expect(await store.get('new')).toBeNull(); // both evicted since both > 5ms old
  });

  it('should clear all cached entries', async () => {
    await store.set('a', '1');
    await store.set('b', '2');
    await store.clear();

    expect(await store.get('a')).toBeNull();
    expect(await store.get('b')).toBeNull();
  });
});
