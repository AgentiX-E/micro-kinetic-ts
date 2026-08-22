import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileSystemStore } from '@agentix-e/micro-kinetic-storage-fs';
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
});

describe('saveModel / loadModel', () => {
  it('should save and load to default FileSystemStore', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'save-model-'));
    const fs = new FileSystemStore({ baseDir: tmpDir });
    const ms = new ModelStore(fs);
    await ms.save([makeRecord()]);
    const loaded = await ms.load();
    expect(loaded).not.toBeNull();
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
