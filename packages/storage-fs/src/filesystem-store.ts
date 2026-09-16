/**
 * FileSystemStore — IKeyValueStore backed by Node.js fs/promises.
 *
 * One key = one .json file under a configurable base directory.
 * Atomic writes use temp-file + rename to prevent corruption on crash.
 * ENOENT is treated as "key not found" (null return, never throw).
 *
 * Base directory, in precedence order: the `baseDir` option, the
 * `MICRO_KINETIC_STORE_DIR` environment variable, then ~/.micro-kinetic/store/.
 *
 * Thread-safety: The store is safe for concurrent reads but concurrent
 * writes to the same key may interleave. For single-writer workloads
 * (the common case in RCA optimization), this is sufficient.
 *
 * @packageDocumentation
 */

import type { IKeyValueStore } from '@agentix-e/micro-kinetic-core';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

// ── Options ──

export interface FileSystemStoreOptions {
  /** Base directory for all .json files. Default: the `MICRO_KINETIC_STORE_DIR`, else ~/.micro-kinetic/store/ */
  readonly baseDir?: string;
}

/**
 * Environment variable that relocates the default store.
 *
 * Read once per construction, never at module load: a value captured at import time is frozen by
 * whichever module happened to import this one first, so nothing afterwards — not a test, not a
 * CLI that sets the variable before running — could point the store anywhere else.
 */
export const STORE_DIR_ENV = 'MICRO_KINETIC_STORE_DIR';

/**
 * Resolve the base directory: explicit option, then environment variable, then the home default.
 *
 * An empty string counts as unset in both places. The one thing it must never mean is "the current
 * working directory", which would scatter store files into whatever repository the process ran in.
 */
function resolveBaseDir(explicit: string | undefined): string {
  const chosen = explicit ?? process.env[STORE_DIR_ENV] ?? '';
  return chosen === '' ? resolve(homedir(), '.micro-kinetic', 'store') : resolve(chosen);
}

// ── Implementation ──

export class FileSystemStore implements IKeyValueStore {
  /** The resolved directory this store reads and writes. */
  readonly baseDir: string;
  private initialized = false;

  constructor(options?: FileSystemStoreOptions) {
    this.baseDir = resolveBaseDir(options?.baseDir);
  }

  private ensureDir(): void {
    if (this.initialized) return;
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
    this.initialized = true;
  }

  /**
   * Map a logical key to a safe filesystem path.
   *
   * `encodeURIComponent` escapes the path separator, so every key becomes exactly one path
   * segment: no key can name a directory, and the parent of every key file is the base directory
   * that {@link ensureDir} has already created.
   */
  private keyToPath(key: string): string {
    return join(this.baseDir, `${encodeURIComponent(key)}.json`);
  }

  /** Reverse map a filename to the original key. */
  private pathToKey(filePath: string): string {
    const name = basename(filePath, '.json');
    return decodeURIComponent(name);
  }

  async get<T>(key: string): Promise<T | null> {
    const filePath = this.keyToPath(key);
    try {
      const raw = await readFile(filePath, 'utf-8');
      return JSON.parse(raw) as T;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.ensureDir();
    const filePath = this.keyToPath(key);

    const json = JSON.stringify(value, null, 2);
    // Atomic write: write to temp file, then rename. Both halves are guarded, because a failure
    // in either leaves the temp file as garbage: nothing will ever rename it, and `keys()` filters
    // to `.json` and so will never list it. Unguarded, every failed write leaks one file into the
    // store directory permanently — which is also why no test may assert the atomic-write property
    // through `keys()`.
    const tmpPath = `${filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmpPath, json, 'utf-8');
      await rename(tmpPath, filePath);
    } catch (err) {
      await rm(tmpPath, { force: true });
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = this.keyToPath(key);
    try {
      await unlink(filePath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  async has(key: string): Promise<boolean> {
    const filePath = this.keyToPath(key);
    try {
      await readFile(filePath, 'utf-8');
      return true;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw err;
    }
  }

  async keys(prefix?: string): Promise<string[]> {
    try {
      // `withFileTypes` so a DIRECTORY whose name happens to end in `.json` is not reported as a
      // key. `keys()` answers "which keys exist", and a directory is not a key — reporting one
      // would hand callers a key that `get` then refuses to read.
      const entries = await readdir(this.baseDir, { recursive: true, withFileTypes: true });
      const allKeys = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => this.pathToKey(entry.name));

      if (!prefix) return allKeys;
      return allKeys.filter((k) => k.startsWith(prefix));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async clear(): Promise<void> {
    // No try/catch: `force` already swallows ENOENT, so the only errors `rm` can raise here are
    // real ones, and rethrowing them is what the method must do anyway. A catch whose condition is
    // always true is a branch no test can reach and no reader can act on.
    await rm(this.baseDir, { recursive: true, force: true });
    this.initialized = false;
  }

  async close(): Promise<void> {
    // No persistent connections to close.  The filesystem is stateless.
  }
}
