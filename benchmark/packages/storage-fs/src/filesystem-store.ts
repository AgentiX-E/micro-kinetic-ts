/**
 * FileSystemStore — IKeyValueStore backed by Node.js fs/promises.
 *
 * One key = one .json file under a configurable base directory.
 * Atomic writes use temp-file + rename to prevent corruption on crash.
 * ENOENT is treated as "key not found" (null return, never throw).
 *
 * Default base directory: ~/.micro-kinetic/store/
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
import { basename, dirname, join, resolve } from 'node:path';

// ── Options ──

export interface FileSystemStoreOptions {
  /** Base directory for all .json files. Default: ~/.micro-kinetic/store/ */
  readonly baseDir?: string;
}

const DEFAULT_BASE_DIR = resolve(homedir(), '.micro-kinetic', 'store');

// ── Implementation ──

export class FileSystemStore implements IKeyValueStore {
  private readonly baseDir: string;
  private initialized = false;

  constructor(options?: FileSystemStoreOptions) {
    this.baseDir = options?.baseDir ?? DEFAULT_BASE_DIR;
  }

  private ensureDir(): void {
    if (this.initialized) return;
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
    this.initialized = true;
  }

  /** Map a logical key to a safe filesystem path. */
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
    const dir = dirname(filePath);

    // Ensure parent directories exist (nested keys like ns/sub/key)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const json = JSON.stringify(value, null, 2);
    // Atomic write: write to temp file, then rename
    const tmpPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(tmpPath, json, 'utf-8');
    await rename(tmpPath, filePath);
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
      const files = await readdir(this.baseDir, { recursive: true });
      const jsonFiles = files.filter((f) => f.endsWith('.json'));
      const allKeys = jsonFiles.map((f) => this.pathToKey(f));

      if (!prefix) return allKeys;
      return allKeys.filter((k) => k.startsWith(prefix));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async clear(): Promise<void> {
    try {
      await rm(this.baseDir, { recursive: true, force: true });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    this.initialized = false;
  }

  async close(): Promise<void> {
    // No persistent connections to close.  The filesystem is stateless.
  }
}
