/**
 * Model persistence: save/load optimizer models via IKeyValueStore.
 *
 * Uses any IKeyValueStore backend (fs, browser, remote). Defaults to
 * FileSystemStore for backward compatibility.
 *
 * Format: optimizer-latest and optimizer-v{n} keys store PersistedModel.
 *
 * @packageDocumentation
 */

import type { IKeyValueStore } from '@agentix-e/micro-kinetic-core';
import { FileSystemStore } from '@agentix-e/micro-kinetic-storage-fs';
import type { HistoricalRecord } from './meta-learner.js';

export interface PersistedModel {
  readonly version: number;
  readonly timestamp: string;
  readonly records: readonly HistoricalRecord[];
}

export class ModelStore {
  private readonly store: IKeyValueStore;

  /**
   * @param store - Backing store. Omit for the default FileSystemStore, which resolves its
   *   directory from `MICRO_KINETIC_STORE_DIR` and otherwise `~/.micro-kinetic/store/`.
   */
  constructor(store?: IKeyValueStore) {
    this.store = store ?? new FileSystemStore();
  }

  async save(records: readonly HistoricalRecord[], version?: number): Promise<void> {
    const v = version ?? (await this.getNextVersion());
    const model: PersistedModel = {
      version: v,
      timestamp: new Date().toISOString(),
      records,
    };
    await this.store.set('optimizer-latest', model);
    await this.store.set(`optimizer-v${v}`, model);
  }

  async load(): Promise<PersistedModel | null> {
    return this.store.get<PersistedModel>('optimizer-latest');
  }

  async loadVersion(version: number): Promise<PersistedModel | null> {
    return this.store.get<PersistedModel>(`optimizer-v${version}`);
  }

  async mergeAndSave(newRecords: readonly HistoricalRecord[]): Promise<PersistedModel> {
    const existing = await this.load();
    const merged = existing ? [...existing.records, ...newRecords] : [...newRecords];
    const nextVersion = existing ? existing.version + 1 : 1;
    await this.save(merged, nextVersion);
    return { version: nextVersion, timestamp: new Date().toISOString(), records: merged };
  }

  private async getNextVersion(): Promise<number> {
    const existing = await this.load();
    return existing ? existing.version + 1 : 1;
  }
}

/**
 * Convenience: save to a store, defaulting to the library's FileSystemStore.
 *
 * @param records - Historical records to persist.
 * @param store - Where to persist them. Omit for the default FileSystemStore, whose directory is
 *   resolved by `MICRO_KINETIC_STORE_DIR` and otherwise `~/.micro-kinetic/store/`. Passing one is
 *   what makes this function reachable by a test that does not write to the user's home directory.
 */
export async function saveModel(
  records: readonly HistoricalRecord[],
  store?: IKeyValueStore,
): Promise<PersistedModel> {
  const modelStore = new ModelStore(store);
  await modelStore.save(records);
  return (await modelStore.load())!;
}

/**
 * Convenience: load from a store, defaulting to the library's FileSystemStore.
 *
 * @param store - Where to read from; see {@link saveModel}.
 */
export async function loadModel(store?: IKeyValueStore): Promise<PersistedModel | null> {
  return new ModelStore(store).load();
}
