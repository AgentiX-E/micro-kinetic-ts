/**
 * BrowserStore — IKeyValueStore backed by browser Web Storage APIs.
 *
 * Tiered: values ≤ 5KB use localStorage for fast synchronous access.
 * Larger values are stored in-memory (or IndexedDB in real browsers).
 *
 * Namespace prefix prevents collision with other data in the same origin.
 * Designed to work in browsers AND Node.js test environments where
 * localStorage is polyfilled by jsdom/happy-dom.
 *
 * @packageDocumentation
 */

import type { IKeyValueStore } from '@agentix-e/micro-kinetic-core';

// ── Options ──

export interface BrowserStoreOptions {
  /** Namespace prefix for all keys. Default: 'micro-kinetic' */
  readonly namespace?: string;
  /** Maximum bytes for localStorage items. Default: 5120 (5KB) */
  readonly localStorageMaxBytes?: number;
}

const DEFAULT_NAMESPACE = 'micro-kinetic';
const DEFAULT_LS_MAX = 5120;

// ── Implementation ──

export class BrowserStore implements IKeyValueStore {
  private readonly namespace: string;
  private readonly lsMaxBytes: number;
  private readonly largeStore = new Map<string, string>();

  constructor(options?: BrowserStoreOptions) {
    this.namespace = options?.namespace ?? DEFAULT_NAMESPACE;
    this.lsMaxBytes = options?.localStorageMaxBytes ?? DEFAULT_LS_MAX;
  }

  /** Prefix a logical key with namespace for localStorage. */
  private nsKey(key: string): string {
    return `${this.namespace}:${key}`;
  }

  private get ls(): Storage | null {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const nsKey = this.nsKey(key);

    // Try large store first (IndexedDB-equivalent)
    const largeRaw = this.largeStore.get(nsKey);
    if (largeRaw !== undefined) {
      return JSON.parse(largeRaw) as T;
    }

    // Try localStorage
    const ls = this.ls;
    if (ls) {
      const raw = ls.getItem(nsKey);
      if (raw !== null) return JSON.parse(raw) as T;
    }

    return null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    const nsKey = this.nsKey(key);
    const json = JSON.stringify(value);
    const bytes = new TextEncoder().encode(json).length;

    if (bytes <= this.lsMaxBytes) {
      const ls = this.ls;
      if (ls) {
        try {
          ls.setItem(nsKey, json);
          this.largeStore.delete(nsKey); // remove from large if downsized
          return;
        } catch {
          // localStorage full or unavailable — fall through to large store
        }
      }
    }

    this.largeStore.set(nsKey, json);
    // Also remove from ls if it exists
    const ls = this.ls;
    if (ls) ls.removeItem(nsKey);
  }

  async delete(key: string): Promise<void> {
    const nsKey = this.nsKey(key);
    this.largeStore.delete(nsKey);
    const ls = this.ls;
    if (ls) ls.removeItem(nsKey);
  }

  async has(key: string): Promise<boolean> {
    const nsKey = this.nsKey(key);
    if (this.largeStore.has(nsKey)) return true;
    const ls = this.ls;
    if (ls && ls.getItem(nsKey) !== null) return true;
    return false;
  }

  async keys(prefix?: string): Promise<string[]> {
    const result = new Set<string>();

    // From large store
    for (const nsKey of this.largeStore.keys()) {
      if (nsKey.startsWith(this.namespace + ':')) {
        const k = nsKey.slice(this.namespace.length + 1);
        if (!prefix || k.startsWith(prefix)) result.add(k);
      }
    }

    // From localStorage
    const ls = this.ls;
    if (ls) {
      for (let i = 0; i < ls.length; i++) {
        const nsKey = ls.key(i);
        if (nsKey && nsKey.startsWith(this.namespace + ':')) {
          const k = nsKey.slice(this.namespace.length + 1);
          if (!prefix || k.startsWith(prefix)) result.add(k);
        }
      }
    }

    return [...result];
  }

  async clear(): Promise<void> {
    this.largeStore.clear();
    const ls = this.ls;
    if (ls) {
      const toRemove: string[] = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k && k.startsWith(this.namespace + ':')) {
          toRemove.push(k);
        }
      }
      for (const k of toRemove) ls.removeItem(k);
    }
  }

  async close(): Promise<void> {
    this.largeStore.clear();
  }
}
