/**
 * Model persistence: save/load GP state and meta-learner models.
 *
 * Stored as JSON in a user-configurable directory (default:
 * ~/.micro-kinetic/models/).  Versioning ensures backward compatibility:
 * each new training session creates a new versioned file.
 *
 * Format: optimizer-v{n}.json
 *   { version: n, timestamp: ISO, records: HistoricalRecord[] }
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { HistoricalRecord } from './meta-learner.js';

// ── Types ──

export interface PersistedModel {
  readonly version: number;
  readonly timestamp: string;
  readonly records: readonly HistoricalRecord[];
}

export interface PersistenceOptions {
  /** Directory for model storage */
  readonly modelDir: string;
}

// ── Defaults ──

const DEFAULTS: PersistenceOptions = {
  modelDir: resolve(homedir(), '.micro-kinetic', 'models'),
};

// ── Implementation ──

export class ModelStore {
  private readonly options: PersistenceOptions;

  constructor(options?: Partial<PersistenceOptions>) {
    this.options = { ...DEFAULTS, ...options };
  }

  /** Get the path to the latest model file */
  get latestModelPath(): string {
    return resolve(this.options.modelDir, 'optimizer-latest.json');
  }

  /** Get a versioned model path */
  versionedPath(version: number): string {
    return resolve(this.options.modelDir, `optimizer-v${version}.json`);
  }

  /** Save a model to disk */
  save(records: readonly HistoricalRecord[], version?: number): void {
    const dir = this.options.modelDir;
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const v = version ?? this.getNextVersion();
    const model: PersistedModel = {
      version: v,
      timestamp: new Date().toISOString(),
      records,
    };

    const json = JSON.stringify(model, null, 2);

    // Write versioned file
    writeFileSync(this.versionedPath(v), json, 'utf-8');

    // Write/overwrite latest symlink-equivalent
    writeFileSync(this.latestModelPath, json, 'utf-8');
  }

  /** Load the latest model from disk */
  load(): PersistedModel | null {
    try {
      const json = readFileSync(this.latestModelPath, 'utf-8');
      return JSON.parse(json) as PersistedModel;
    } catch {
      return null;
    }
  }

  /** Load a specific version */
  loadVersion(version: number): PersistedModel | null {
    try {
      const json = readFileSync(this.versionedPath(version), 'utf-8');
      return JSON.parse(json) as PersistedModel;
    } catch {
      return null;
    }
  }

  /** Merge new records into existing model and save as new version */
  mergeAndSave(newRecords: readonly HistoricalRecord[]): PersistedModel {
    const existing = this.load();
    const merged = existing ? [...existing.records, ...newRecords] : [...newRecords];
    const nextVersion = existing ? existing.version + 1 : 1;
    this.save(merged, nextVersion);
    return {
      version: nextVersion,
      timestamp: new Date().toISOString(),
      records: merged,
    };
  }

  /** Determine the next version number */
  private getNextVersion(): number {
    const existing = this.load();
    return existing ? existing.version + 1 : 1;
  }
}

/** Convenience: save optimizer models to default location */
export function saveModel(records: readonly HistoricalRecord[]): PersistedModel {
  const store = new ModelStore();
  store.save(records);
  return store.load()!;
}

/** Convenience: load optimizer models from default location */
export function loadModel(): PersistedModel | null {
  return new ModelStore().load();
}
