import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import {
  HELD_AT_ENGINE_DEFAULT,
  UNPASSED_SECOND_ARGUMENT,
  configToPrunerOptions,
  configToTopologyConfig,
  createEngineWithConfig,
  createDefaultEngine,
  formatEngineConfigLine,
} from '../../src/integration.js';
import { RANKING_AXES } from '../../src/config-space.js';
import type { RCAConfiguration } from '../../src/config-space.js';
import { DEFAULT_CONFIG } from '../../src/config-space.js';

describe('configToPrunerOptions', () => {
  it('should map decayAlpha', () => {
    const cfg: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      continuous: { ...DEFAULT_CONFIG.continuous, decayAlpha: 0.9 },
    };
    const opts = configToPrunerOptions(cfg);
    expect(opts.decayAlpha).toBe(0.9);
  });

  it('should map pruneEpsilon', () => {
    const cfg: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      continuous: { ...DEFAULT_CONFIG.continuous, pruneEpsilon: 0.005 },
    };
    const opts = configToPrunerOptions(cfg);
    expect(opts.pruneEpsilon).toBe(0.005);
  });

  it('should map enableCollisionAggregation', () => {
    const cfg: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      discrete: { ...DEFAULT_CONFIG.discrete, enableCollisionAggregation: false },
    };
    const opts = configToPrunerOptions(cfg);
    expect(opts.enableCollisionAggregation).toBe(false);
  });

  it('should set criticalLoadThreshold to 0.7', () => {
    const opts = configToPrunerOptions(DEFAULT_CONFIG);
    expect(opts.criticalLoadThreshold).toBe(0.7);
  });

  it('should default missing riseWeight, traceWeight and prismWeight to 0', () => {
    const cfg: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      ranking: {
        sourceWeight: 0,
        temporalWeight: 0,
        collisionWeight: 0,
        topoWeight: 0,
        logWeight: 1.0,
      },
    };
    const opts = configToPrunerOptions(cfg);
    expect(opts.riseWeight).toBe(0);
    expect(opts.traceWeight).toBe(0);
    expect(opts.prismWeight).toBe(0);
  });
});

describe('configToTopologyConfig', () => {
  it('should map temporalBonus', () => {
    const cfg: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      continuous: { ...DEFAULT_CONFIG.continuous, temporalBonus: 0.25 },
    };
    const tc = configToTopologyConfig(cfg);
    expect(tc.temporalBonus).toBe(0.25);
  });

  it('should map defaultWeight', () => {
    const cfg: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      continuous: { ...DEFAULT_CONFIG.continuous, defaultWeight: 0.1 },
    };
    const tc = configToTopologyConfig(cfg);
    expect(tc.defaultWeight).toBe(0.1);
  });

  it('should map baselineStrategy', () => {
    const cfg: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      discrete: { ...DEFAULT_CONFIG.discrete, baselineStrategy: 'q25' },
    };
    const tc = configToTopologyConfig(cfg);
    expect(tc.baselineStrategy).toBe('q25');
  });

  it('should map correlationMethod', () => {
    const cfg: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      discrete: { ...DEFAULT_CONFIG.discrete, correlationMethod: 'spearman' },
    };
    const tc = configToTopologyConfig(cfg);
    expect(tc.correlationMethod).toBe('spearman');
  });

  it('should map useTemporalCausality', () => {
    const cfg: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      discrete: { ...DEFAULT_CONFIG.discrete, useTemporalCausality: false },
    };
    const tc = configToTopologyConfig(cfg);
    expect(tc.useTemporalCausality).toBe(false);
  });

  it('should always set minDataPoints to 3', () => {
    const tc = configToTopologyConfig(DEFAULT_CONFIG);
    expect(tc.minDataPoints).toBe(3);
  });

  it('should always set adaptiveDecay to true', () => {
    const tc = configToTopologyConfig(DEFAULT_CONFIG);
    expect(tc.adaptiveDecay).toBe(true);
  });
});

describe('createEngineWithConfig', () => {
  it('should create a TreePruner with custom config', () => {
    const cfg: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      continuous: {
        ...DEFAULT_CONFIG.continuous,
        decayAlpha: 0.92,
        pruneEpsilon: 0.0001,
      },
    };
    const engine = createEngineWithConfig(cfg);
    expect(engine).toBeDefined();
    // Should not throw
    expect(() => engine).not.toThrow();
  });

  it('should create with DEFAULT_CONFIG', () => {
    const engine = createEngineWithConfig(DEFAULT_CONFIG);
    expect(engine).toBeDefined();
  });
});

describe('createDefaultEngine', () => {
  it('should create engine without throwing', () => {
    const engine = createDefaultEngine();
    expect(engine).toBeDefined();
  });
});

/**
 * The members of `TreePrunerOptions`, read from the engine's own source.
 *
 * LOCAL, and the duplication is named rather than hidden: the benchmark guards in this repository parse the
 * same interface to hold THEIR forwarded sets to it, and this one parses it to hold the OPTIMIZER's mapping
 * to it. Three readers of one declaration is a smell, and the durable answer is a shared test module — which
 * this monorepo has no home for, because the boundary it would cross is a package one. Until then the
 * alternative is worse: a hand-maintained list of the engine's options inside a test, which is exactly what
 * the shipped-declaration census was written to delete.
 *
 * @returns The engine's first-argument field names, own and inherited.
 */
function engineOptionMembers(): string[] {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
  const read = (path: string, name: string): { own: string[]; base?: string } => {
    const text = readFileSync(resolve(root, path), 'utf8');
    const m = new RegExp(
      `export interface ${name}\\s*(?:extends\\s+([A-Za-z]+))?\\s*\\{([\\s\\S]*?)\\n\\}`,
    ).exec(text);
    expect(m, `${name} is declared in ${path}`).not.toBeNull();
    return {
      own: [...m![2]!.matchAll(/^\s{2}(?:readonly\s+)?([A-Za-z][A-Za-z0-9]*)\??:\s*[^;]+;/gm)].map(
        (mm) => mm[1]!,
      ),
      base: m![1],
    };
  };
  const derived = read('packages/tree/src/pruning/pruner.ts', 'TreePrunerOptions');
  expect(derived.base, 'the engine option type extends the core one').toBe('RCAEngineOptions');
  const core = read('packages/core/src/types/faults.ts', derived.base!);
  const all = [...derived.own, ...core.own];
  expect(all.length, 'the option surface is populated').toBeGreaterThan(20);
  return all;
}

describe('the optimizer mapping states what it does NOT set', () => {
  it('maps only fields the engine declares, and accounts for every other one', () => {
    // The defect this guards: a field the mapping does not set is not absent from the run, it INHERITS the
    // engine's default — and the artifact that read this mapping's result named seven of the twenty-seven
    // options the engine was built with. The partition below is what makes that impossible to repeat
    // silently: a field is either mapped, or named here with a reason.
    const mapped = Object.keys(configToPrunerOptions(DEFAULT_CONFIG));
    const held = Object.keys(HELD_AT_ENGINE_DEFAULT);
    const all = engineOptionMembers();
    for (const key of mapped) {
      expect(all, `${key} is not a TreePrunerOptions member`).toContain(key);
    }
    for (const key of held) {
      expect(all, `${key} is not a TreePrunerOptions member`).toContain(key);
      expect(mapped, `${key} is both mapped and held`).not.toContain(key);
    }
    // The partition, both directions: nothing mapped is unaccounted for, and nothing the engine declares is
    // left neither mapped nor held.
    expect([...mapped, ...held].sort()).toEqual([...all].sort());
    // Non-vacuity on both sides, because a partition of one empty set against everything else passes while
    // classifying nothing.
    expect(mapped.length).toBeGreaterThan(8);
    expect(held.length).toBeGreaterThan(8);
  });

  it('gives every held field a reason, and asserts the exact set', () => {
    // The exact set is asserted so a field that starts being searched — or stops — has to be moved here on
    // purpose, and the reason floor keeps "held" from being a synonym for "forgotten".
    for (const [field, reason] of Object.entries(HELD_AT_ENGINE_DEFAULT)) {
      expect(reason.length, `${field}'s reason`).toBeGreaterThan(40);
    }
    expect(Object.keys(HELD_AT_ENGINE_DEFAULT).sort()).toEqual([
      'decayBeta',
      'defaultTopK',
      'edgeLatency',
      'failedEdgeMinRecords',
      'failedEdgeMode',
      'failedEdgeWeight',
      'latMinRise',
      'latWeight',
      'logSignalMode',
      'maxCycles',
      'maxPropagationDepth',
      'onsetShape',
      'poolMetricPenaltyWeight',
      'stabilityWeight',
      'useTwoHopDecay',
    ]);
  });

  it('records that the engine\u2019s second argument is never passed, and that it differs from the golden', () => {
    // `TreePruner(options, topologyConfig)`: this mapping supplies ONE argument, so the fault graph uses its
    // own defaults, where `rankNormalization` is `false` — while the golden sets it TRUE. The search and the
    // published numbers are therefore different configurations in a term this repository measured and keeps
    // ON, and nothing in either artifact said so until this line existed.
    const text = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../src/integration.ts'),
      'utf8',
    );
    expect(UNPASSED_SECOND_ARGUMENT).toBe(true);
    expect(text, 'the engine is built with ONE argument').toMatch(/new TreePruner\(options\)/);
    expect(text, 'and not two').not.toMatch(/new TreePruner\(\s*options\s*,/);
    // The consequence, asserted against the engine's own defaults rather than described: the topology
    // default is `false` and the RCAEval parser's default is `true`.
    const topology = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../../../tree/src/causal/topology-fault-graph.ts'),
      'utf8',
    );
    expect(topology).toMatch(/rankNormalization:\s*false/);
  });
});

describe('the engine configuration line the search artifact carries', () => {
  it('names what the search sets, what it holds, and the argument it never passes', () => {
    // The three parts, each of which the artifact lacked. The held part is the point: four terms that
    // dominate the shipped ranking are ON in every candidate this search evaluates.
    const line = formatEngineConfigLine(DEFAULT_CONFIG);
    expect(line).toContain('sourceWeight=0');
    expect(line).toContain('logWeight=1');
    expect(line).toContain('held at the engine default:');
    expect(line).toContain('latWeight=0.561495');
    expect(line).toContain('latMinRise=10.3');
    expect(line).toContain('poolMetricPenaltyWeight=0.0679');
    expect(line).toContain('stabilityWeight=0.007352');
    expect(line).toContain('second constructor argument NOT PASSED');
    expect(line).toContain('topology default (false)');
    expect(line).toContain('the golden sets it true');
    // The held part is a RECORD, and the line says so rather than claiming to be exhaustive: a reader who
    // needs the rest has a place to look, and the count beside it is derived so it cannot go stale.
    expect(line).toContain('see HELD_AT_ENGINE_DEFAULT');
  });

  it('is a pure function of the configuration, so the artifact and the engine cannot diverge', () => {
    // A line that read ambient state would describe a configuration nobody ran; a line that ignored its
    // argument would describe the default one whatever was searched.
    expect(formatEngineConfigLine(DEFAULT_CONFIG)).toBe(formatEngineConfigLine({ ...DEFAULT_CONFIG }));
    const tuned: RCAConfiguration = {
      ...DEFAULT_CONFIG,
      ranking: { ...DEFAULT_CONFIG.ranking, collisionWeight: 2.5 },
    };
    expect(formatEngineConfigLine(tuned)).toContain('collisionWeight=2.5');
    expect(formatEngineConfigLine(tuned)).not.toBe(formatEngineConfigLine(DEFAULT_CONFIG));
  });

  it('names the search space with the same count the space itself has', () => {
    // The space is seven axes and the engine runs twenty-seven options; stating the first without the second
    // is what made "tuned weights" read as a claim about the whole configuration.
    expect(RANKING_AXES.length).toBe(7);
    for (const axis of RANKING_AXES) {
      expect(Object.keys(configToPrunerOptions(DEFAULT_CONFIG))).toContain(axis);
    }
    expect(Object.keys(HELD_AT_ENGINE_DEFAULT).length).toBeGreaterThan(RANKING_AXES.length);
  });
});

