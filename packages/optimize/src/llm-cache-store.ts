/**
 * LLMCacheStore — persistent LLM result cache with TTL eviction.
 *
 * Extends the in-memory cache in LLMAdvisor with persistent storage,
 * reducing API costs across process restarts.
 *
 * @packageDocumentation
 */

import type { IKeyValueStore } from '@agentix-e/micro-kinetic-core';

export interface LlmCacheEntry {
  readonly key: string;
  readonly result: string;
  readonly timestamp: number;
}

export class LLMCacheStore {
  private readonly store: IKeyValueStore;

  constructor(store: IKeyValueStore) {
    this.store = store;
  }

  /** Get a cached LLM result if it exists and has not expired. */
  async get(key: string, ttlMs?: number): Promise<string | null> {
    const entry = await this.store.get<LlmCacheEntry>(
      `llm-cache:${key}`,
    );
    if (!entry) return null;
    if (ttlMs && Date.now() - entry.timestamp > ttlMs) {
      await this.delete(key);
      return null;
    }
    return entry.result;
  }

  /** Store an LLM result in the cache. */
  async set(key: string, result: string): Promise<void> {
    await this.store.set(`llm-cache:${key}`, {
      key,
      result,
      timestamp: Date.now(),
    });
  }

  /** Delete a cached entry. */
  async delete(key: string): Promise<void> {
    await this.store.delete(`llm-cache:${key}`);
  }

  /** Evict all entries older than the given TTL. */
  async evictOlderThan(ttlMs: number): Promise<void> {
    const all = await this.store.keys('llm-cache:');
    const now = Date.now();
    for (const k of all) {
      const entry = await this.store.get<LlmCacheEntry>(k);
      if (entry && now - entry.timestamp > ttlMs) {
        await this.store.delete(k);
      }
    }
  }

  /** Clear all cached entries. */
  async clear(): Promise<void> {
    const all = await this.store.keys('llm-cache:');
    for (const k of all) {
      await this.store.delete(k);
    }
  }
}
