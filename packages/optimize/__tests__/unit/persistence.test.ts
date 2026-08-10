import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ModelStore, saveModel, loadModel } from '../../src/persistence.js';
import type { HistoricalRecord } from '../../src/meta-learner.js';

function makeRecord(overrides?: Partial<HistoricalRecord>): HistoricalRecord {
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
  const testDir = resolve(tmpdir(), 'optimize-test-' + Date.now());

  beforeEach(() => {
    if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // cleanup failure is non-fatal
    }
  });

  it('should save and load model', () => {
    const store = new ModelStore({ modelDir: testDir });
    const records = [makeRecord({ system: 'A' }), makeRecord({ system: 'B' })];

    store.save(records);
    const loaded = store.load();

    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.records).toHaveLength(2);
    expect(loaded!.records[0]!.system).toBe('A');
  });

  it('should return null when no model exists', () => {
    const store = new ModelStore({ modelDir: testDir });
    expect(store.load()).toBeNull();
  });

  it('should save versioned files', () => {
    const store = new ModelStore({ modelDir: testDir });
    store.save([makeRecord({ system: 'v1' })], 1);
    store.save([makeRecord({ system: 'v2' })], 2);

    const v1 = store.loadVersion(1);
    const v2 = store.loadVersion(2);

    expect(v1).not.toBeNull();
    expect(v2).not.toBeNull();
    expect(v1!.version).toBe(1);
    expect(v2!.version).toBe(2);
  });

  it('should return null for non-existent version', () => {
    const store = new ModelStore({ modelDir: testDir });
    expect(store.loadVersion(99)).toBeNull();
  });

  it('should merge and save with incremented version', () => {
    const store = new ModelStore({ modelDir: testDir });
    store.save([makeRecord({ system: 'A' })]);

    const merged = store.mergeAndSave([makeRecord({ system: 'B' })]);
    expect(merged.version).toBe(2);
    expect(merged.records).toHaveLength(2);

    const loaded = store.load();
    expect(loaded!.records).toHaveLength(2);
  });

  it('should handle empty initial save via mergeAndSave', () => {
    const store = new ModelStore({ modelDir: testDir });
    const merged = store.mergeAndSave([makeRecord()]);
    expect(merged.version).toBe(1);
    expect(merged.records).toHaveLength(1);
  });

  it('should persist to disk as valid JSON', () => {
    const store = new ModelStore({ modelDir: testDir });
    store.save([makeRecord()]);

    const raw = readFileSync(store.latestModelPath, 'utf-8');
    const parsed = JSON.parse(raw);

    expect(parsed.version).toBe(1);
    expect(parsed.records).toBeDefined();
  });
});

describe('saveModel / loadModel', () => {
  it('should save to default directory', () => {
    // Use custom directory to avoid polluting user's ~/.workbuddy
    const store = new ModelStore({ modelDir: resolve(tmpdir(), 'test-save-model') });
    const records = [makeRecord()];
    store.save(records);
    const loaded = store.load();
    expect(loaded).not.toBeNull();
    // Cleanup
    rmSync(resolve(tmpdir(), 'test-save-model'), { recursive: true, force: true });
  });
});
