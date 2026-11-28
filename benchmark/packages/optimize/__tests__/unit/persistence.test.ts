import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemStore, STORE_DIR_ENV } from '@agentix-e/micro-kinetic-storage-fs';
import type { IKeyValueStore } from '@agentix-e/micro-kinetic-core';
import {
  ModelStore,
  saveModel,
  loadModel,
} from '../../src/persistence.js';
import type { HistoricalRecord } from '../../src/meta-learner.js';

function makeRecord(
  overrides?: Partial<HistoricalRecord>,
): HistoricalRecord {
  return {
    system: 'test',
    suite: 'RE1',
    context: {
      serviceCount: 10,
      graphDensity: 0.2,
      degreeCV: 0.5,
      maxDepth: 3,
      traceCoverage: 0,
      metricCV: 0.4,
      spikeDominanceRatio: 0.3,
      anomalyConcentration: 0.4,
      systemLoad: 0.5,
      faultTypeCount: 5,
      avgCasesPerType: 10,
    },
    config: {
      baselineStrategy: 'auto',
      correlationMethod: 'pearson',
      propagationMode: 'additive',
      enableCollisionAggregation: true,
      useTemporalCausality: true,
      decayAlpha: 0.8,
      pruneEpsilon: 0.001,
      temporalBonus: 0.15,
      defaultWeight: 0.05,
      childContributionCap: 1.0,
      sourceWeight: 0,
      temporalWeight: 0,
      collisionWeight: 0,
      topoWeight: 0,
      logWeight: 0,
    },
    accuracy: 0.8,
    ...overrides,
  };
}

describe('ModelStore', () => {
  let tmpDir: string;
  let store: ModelStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'model-store-'));
    store = new ModelStore(new FileSystemStore({ baseDir: tmpDir }));
  });

  afterEach(async () => {
    try {
      await store.load(); // no-op, just for cleanup reference
      rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* cleanup non-fatal */ }
  });

  it('should save and load model', async () => {
    const records = [
      makeRecord({ system: 'A' }),
      makeRecord({ system: 'B' }),
    ];

    await store.save(records);
    const loaded = await store.load();

    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.records).toHaveLength(2);
    expect(loaded!.records[0]!.system).toBe('A');
  });

  it('should return null when no model exists', async () => {
    expect(await store.load()).toBeNull();
  });

  it('should save and load versioned models', async () => {
    await store.save([makeRecord({ system: 'v1' })], 1);
    await store.save([makeRecord({ system: 'v2' })], 2);

    const v1 = await store.loadVersion(1);
    const v2 = await store.loadVersion(2);

    expect(v1).not.toBeNull();
    expect(v2).not.toBeNull();
    expect(v1!.version).toBe(1);
    expect(v2!.version).toBe(2);
  });

  it('should return null for non-existent version', async () => {
    expect(await store.loadVersion(99)).toBeNull();
  });

  it('should merge and save with incremented version', async () => {
    await store.save([makeRecord({ system: 'A' })]);

    const merged = await store.mergeAndSave([
      makeRecord({ system: 'B' }),
    ]);
    expect(merged.version).toBe(2);
    expect(merged.records).toHaveLength(2);

    const loaded = await store.load();
    expect(loaded!.records).toHaveLength(2);
  });

  it('should handle empty initial save via mergeAndSave', async () => {
    const merged = await store.mergeAndSave([makeRecord()]);
    expect(merged.version).toBe(1);
    expect(merged.records).toHaveLength(1);
  });

  it('should work with FileSystemStore (round-trip)', async () => {
    const fsStore = new FileSystemStore({ baseDir: tmpDir });
    const ms = new ModelStore(fsStore);
    await ms.save([makeRecord()]);

    const loaded = await ms.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
  });

  it('should work with any IKeyValueStore (injectable)', async () => {
    const map = new Map<string, string>();
    const memStore: IKeyValueStore = {
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
    const ms = new ModelStore(memStore);
    await ms.save([makeRecord()]);
    expect((await ms.load())!.version).toBe(1);
  });

  it('should default to a FileSystemStore when none is provided', () => {
    // The `?? new FileSystemStore()` fallback in the constructor.
    const ms = new ModelStore();
    expect(ms).toBeInstanceOf(ModelStore);
  });

  it('should increment the version on a second unnamed save', async () => {
    await store.save([makeRecord({ system: 'A' })]); // version 1
    await store.save([makeRecord({ system: 'B' })]); // version 2 (existing + 1)

    const v2 = await store.loadVersion(2);
    expect(v2).not.toBeNull();
    expect(v2!.version).toBe(2);
    expect(v2!.records[0]!.system).toBe('B');
  });
});

describe('saveModel / loadModel', () => {
  let tmpDir: string;
  let savedEnv: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'save-model-'));
    savedEnv = process.env[STORE_DIR_ENV];
  });

  afterEach(() => {
    if (savedEnv === undefined) delete process.env[STORE_DIR_ENV];
    else process.env[STORE_DIR_ENV] = savedEnv;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should round-trip through an injected store', async () => {
    const injected = new FileSystemStore({ baseDir: join(tmpDir, 'injected') });
    const model = await saveModel([makeRecord({ system: 'injected' })], injected);

    expect(model.version).toBe(1);
    expect(existsSync(join(tmpDir, 'injected', 'optimizer-latest.json'))).toBe(true);

    const loaded = await loadModel(injected);
    expect(loaded).not.toBeNull();
    expect(loaded!.records[0]!.system).toBe('injected');
  });

  it('should round-trip through the default store, inside the root the default resolves to', async () => {
    // This test used to call the wrappers with no store at all, which meant it wrote into the
    // developer's real `~/.micro-kinetic/store` — and then deleted `optimizer-latest` from it,
    // destroying a trained model on any machine that had one. The default store is now
    // relocatable, so the shipped default path is still measured, but nothing outside this
    // temporary directory is touched.
    const root = join(tmpDir, 'default');
    process.env[STORE_DIR_ENV] = root;

    const model = await saveModel([makeRecord({ system: 'saveModel-test' })]);
    expect(model.version).toBe(1);

    // If the wrappers ever go back to hard-coding a store of their own, this is the assertion
    // that fails: the model would land outside `root`.
    expect(existsSync(join(root, 'optimizer-latest.json'))).toBe(true);

    const loaded = await loadModel();
    expect(loaded).not.toBeNull();
    expect(loaded!.records).toHaveLength(1);
    expect(loaded!.records[0]!.system).toBe('saveModel-test');
  });
});
