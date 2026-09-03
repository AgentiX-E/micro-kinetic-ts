import { describe, expect, it } from 'vitest';
import { createBenchmarkOracle } from '../../src/benchmark-oracle.js';
import type { RCAConfiguration } from '../../src/config-space.js';
import { DEFAULT_CONFIG } from '../../src/config-space.js';
import type {
  CallEdge,
  MetricMap,
  ServiceCallGraph,
  ServiceNode,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';

function makeCfg(overrides?: {
  continuous?: Partial<RCAConfiguration['continuous']>;
  discrete?: Partial<RCAConfiguration['discrete']>;
}): RCAConfiguration {
  return {
    continuous: {
      decayAlpha: 0.8,
      pruneEpsilon: 0.001,
      temporalBonus: 0.15,
      defaultWeight: 0.05,
      childContributionCap: 1.0,
      ...overrides?.continuous,
    },
    ranking: {
      sourceWeight: 0,
      temporalWeight: 0,
      collisionWeight: 0,
      topoWeight: 0,
      logWeight: 1.0,
      traceWeight: 0,
    },
    discrete: {
      baselineStrategy: 'auto',
      correlationMethod: 'pearson',
      propagationMode: 'additive',
      enableCollisionAggregation: true,
      useTemporalCausality: true,
      ...overrides?.discrete,
    },
  };
}

/** A config that receives no heuristic bonus: synthetic score 0.6. */
function baseCfg(): RCAConfiguration {
  return makeCfg({
    continuous: { decayAlpha: 0.6 },
    discrete: {
      baselineStrategy: 'auto',
      correlationMethod: 'spearman',
      propagationMode: 'multiplicative',
      enableCollisionAggregation: false,
      useTemporalCausality: false,
    },
  });
}

function makeNode(id: string): ServiceNode {
  return { id, name: id, namespace: 'test', labels: {} };
}

function makeEdge(from: string, to: string): CallEdge {
  return { from, to, type: 'REST', callRate: 0, p99Latency: 0, errorRate: 0 };
}

function makeGraph(nodes: string[], edges: Array<[string, string]>): ServiceCallGraph {
  const m = new Map<string, ServiceNode>();
  for (const id of nodes) m.set(id, makeNode(id));
  return {
    nodes: m,
    edges: edges.map(([from, to]) => makeEdge(from, to)),
    systemLoad: 0.5,
  };
}

function makeFaultMetrics(nodeIds: string[], fault: string): MetricMap {
  const m = new Map<string, readonly TimeSeries[]>();
  const timestamps = new Float64Array([0, 60000, 120000, 180000, 240000]);
  for (const id of nodeIds) {
    // The faulting service spikes to 100 in the final sample; the others stay
    // low (30) so the engine has a clear root-cause signal.
    const values = new Float64Array(
      id === fault ? [10, 11, 12, 10, 100] : [10, 11, 12, 10, 30],
    );
    m.set(id, [{ label: 'cpu', values, timestamps }]);
  }
  return m;
}

describe('createBenchmarkOracle', () => {
  it('returns the synthetic oracle when benchmarkData is null', async () => {
    const oracle = createBenchmarkOracle(null);
    const score = await oracle(baseCfg());
    expect(score).toBeCloseTo(0.6);
  });

  it('returns a full oracle when benchmarkData is provided', () => {
    const data = {
      callGraph: makeGraph(['A', 'B'], [['A', 'B']]),
      metrics: makeFaultMetrics(['A', 'B'], 'A'),
      groundTruth: [{ serviceId: 'A' }],
    };
    const oracle = createBenchmarkOracle(data);
    expect(typeof oracle).toBe('function');
  });
});

describe('synthetic oracle scoring', () => {
  // Every isolated test starts from baseCfg() (auto / spearman / multiplicative
  // / no collision / no temporal / decayAlpha 0.6 = score 0.6) and flips a
  // single lever, so each assertion is exactly one heuristic bonus.
  const withDiscrete = (
    patch: Partial<RCAConfiguration['discrete']>,
  ): RCAConfiguration => ({ ...baseCfg(), discrete: { ...baseCfg().discrete, ...patch } });

  it('returns the base score with no heuristic bonuses', async () => {
    const oracle = createBenchmarkOracle(null);
    expect(await oracle(baseCfg())).toBeCloseTo(0.6);
  });

  it('adds 0.15 for q25 baseline strategy', async () => {
    const oracle = createBenchmarkOracle(null);
    expect(await oracle(withDiscrete({ baselineStrategy: 'q25' }))).toBeCloseTo(0.75);
  });

  it('adds 0.05 for sliding-window baseline strategy', async () => {
    const oracle = createBenchmarkOracle(null);
    expect(await oracle(withDiscrete({ baselineStrategy: 'sliding-window' }))).toBeCloseTo(0.65);
  });

  it('adds 0.05 for pearson correlation', async () => {
    const oracle = createBenchmarkOracle(null);
    expect(await oracle(withDiscrete({ correlationMethod: 'pearson' }))).toBeCloseTo(0.65);
  });

  it('adds 0.03 for collision aggregation', async () => {
    const oracle = createBenchmarkOracle(null);
    expect(await oracle(withDiscrete({ enableCollisionAggregation: true }))).toBeCloseTo(0.63);
  });

  it('adds 0.02 for temporal causality', async () => {
    const oracle = createBenchmarkOracle(null);
    expect(await oracle(withDiscrete({ useTemporalCausality: true }))).toBeCloseTo(0.62);
  });

  it('adds 0.03 for additive propagation mode', async () => {
    const oracle = createBenchmarkOracle(null);
    expect(await oracle(withDiscrete({ propagationMode: 'additive' }))).toBeCloseTo(0.63);
  });

  it('adds 0.08 when decayAlpha exceeds 0.75', async () => {
    const oracle = createBenchmarkOracle(null);
    const cfg: RCAConfiguration = {
      ...baseCfg(),
      continuous: { ...baseCfg().continuous, decayAlpha: 0.8 },
    };
    expect(await oracle(cfg)).toBeCloseTo(0.68);
  });

  it('adds 0.04 when decayAlpha is in (0.65, 0.75]', async () => {
    const oracle = createBenchmarkOracle(null);
    const cfg: RCAConfiguration = {
      ...baseCfg(),
      continuous: { ...baseCfg().continuous, decayAlpha: 0.7 },
    };
    expect(await oracle(cfg)).toBeCloseTo(0.64);
  });

  it('sums all bonuses and stays below the 1.0 ceiling', async () => {
    const oracle = createBenchmarkOracle(null);
    const cfg: RCAConfiguration = {
      ...baseCfg(),
      continuous: { ...baseCfg().continuous, decayAlpha: 0.85 },
      discrete: {
        baselineStrategy: 'q25',
        correlationMethod: 'pearson',
        propagationMode: 'additive',
        enableCollisionAggregation: true,
        useTemporalCausality: true,
      },
    };
    // 0.6 + 0.15 + 0.05 + 0.08 + 0.03 + 0.02 + 0.03 = 0.96 (< 1.0)
    expect(await oracle(cfg)).toBeCloseTo(0.96);
  });
});

describe('full oracle', () => {
  it('runs the real engine and scores ground-truth matches', async () => {
    const nodes = ['A', 'B', 'C'];
    const data = {
      callGraph: makeGraph(nodes, [['A', 'B'], ['B', 'C']]),
      metrics: makeFaultMetrics(nodes, 'A'),
      // Every node is in the ground truth, so a non-empty engine result must
      // match at least one entry (exercising the correct++ / break path).
      groundTruth: [{ serviceId: 'A' }, { serviceId: 'B' }, { serviceId: 'C' }],
    };
    const oracle = createBenchmarkOracle(data);
    const accuracy = await oracle(DEFAULT_CONFIG);
    expect(accuracy).toBeGreaterThan(0);
    expect(accuracy).toBeLessThanOrEqual(1);
  });

  it('returns 0 for an empty ground-truth set', async () => {
    const nodes = ['A', 'B'];
    const data = {
      callGraph: makeGraph(nodes, [['A', 'B']]),
      metrics: makeFaultMetrics(nodes, 'A'),
      groundTruth: [],
    };
    const oracle = createBenchmarkOracle(data);
    expect(await oracle(DEFAULT_CONFIG)).toBe(0);
  });

  it('returns 0 when the engine throws (invalid graph)', async () => {
    // An empty call graph violates the engine's invariant and throws, which
    // the oracle catches and converts into a zero score.
    const data = {
      callGraph: {
        nodes: new Map<string, ServiceNode>(),
        edges: [] as CallEdge[],
        systemLoad: 0.5,
      },
      metrics: makeFaultMetrics(['A'], 'A'),
      groundTruth: [{ serviceId: 'A' }],
    };
    const oracle = createBenchmarkOracle(data);
    expect(await oracle(DEFAULT_CONFIG)).toBe(0);
  });
});
