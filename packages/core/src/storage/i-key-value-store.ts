/**
 * IKeyValueStore — type-safe persistent key-value storage interface.
 *
 * All storage backends (fs, browser, remote) implement this interface.
 * Domain code depends ONLY on this interface, never on concrete backends.
 *
 * Values are JSON-serialized internally by each backend implementation.
 * Callers get/set typed objects directly via generics.
 *
 * Design principles:
 * - Zero runtime dependencies (pure TypeScript interface)
 * - All methods are async (filesystem, network, IndexedDB are all async)
 * - Keys are plain strings with namespace prefix convention (`ns:key`)
 * - get() returns null for missing keys (never throws)
 * - close() is always safe to call (idempotent, no-op for stateless backends)
 */
export interface IKeyValueStore {
  /** Retrieve a typed value by key. Returns null if key does not exist. */
  get<T>(key: string): Promise<T | null>;

  /** Store a typed value under a key. Overwrites if key exists. */
  set<T>(key: string, value: T): Promise<void>;

  /** Delete a key. No-op if key does not exist (must not throw). */
  delete(key: string): Promise<void>;

  /** Check whether a key exists. */
  has(key: string): Promise<boolean>;

  /** List all stored keys, optionally filtered by prefix. */
  keys(prefix?: string): Promise<string[]>;

  /** Remove all keys. */
  clear(): Promise<void>;

  /** Release any held resources (connections, file handles, worker threads). */
  close(): Promise<void>;
}
