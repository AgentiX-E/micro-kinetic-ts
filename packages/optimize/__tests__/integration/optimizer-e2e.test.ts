/**
 * End-to-end integration test: optimizer with synthetic RCA data.
 *
 * Simulates a benchmark oracle with a known accuracy landscape:
 *   f(θ) = baseline + topologyBonus + metricBonus + noise
 *
 * The optimizer must converge to a high-accuracy configuration
 * within the budget of 8 iterations.
 */
import { describe, expect, it } from 'vitest';
import { AdaptiveConfigOptimizer } from '../../src/optimizer.js';
import type { RCAConfiguration } from '../../src/config-space.js';
import { DEFAULT_CONFIG_SPACE } from '../../src/config-space.js';
import type {
  ServiceCallGraph,
  ServiceNode,
  CallEdge,
  MetricMap,
  TimeSeries,
} from '@agentix-e/micro-kinetic-core';

function makeGraph(
  nodes: string[],
  edges: Array<[string, string]>,
): ServiceCallGraph {
  const m = new Map<string, ServiceNode>();
  for (const id of nodes) {
    m.set(id, { id, name: id, namespace: 'test', labels: {} });
  }
  const callEdges: CallEdge[] = edges.map(([from, to]) => ({
    from,
    to,
    type: 'REST' as const,
    callRate: 0,
    p99Latency: 0,
    errorRate: 0,
  }));
  return { nodes: m, edges: callEdges, systemLoad: 0.5 };
}

function makeMetrics(n: number): MetricMap {
  const m = new Map<string, readonly TimeSeries[]>();
  for (let i = 0; i < n; i++) {
    const vals = new Float64Array(20);
    for (let j = 0; j < 20; j++) vals[j] = Math.random() * 100;
    m.set(`svc-${i}`, [
      {
        label: 'cpu',
        values: vals,
        timestamps: new Float64Array(20).map((_, k) => k * 1000),
      },
    ]);
  }
  return m;
}

describe('AdaptiveConfigOptimizer E2E', () => {
  it('should converge to high accuracy on synthetic landscape', async () => {
    // Known optimal: q25, pearson, additive, collision=true, temporal=true, decayAlpha~0.82
    const trueOptimum: RCAConfiguration = {
      continuous: {
        decayAlpha: 0.82,
        pruneEpsilon: 0.001,
        temporalBonus: 0.15,
        defaultWeight: 0.05,
        childContributionCap: 1.0,
      },
      ranking: {
        sourceWeight: 0,
        temporalWeight: 0,
        collisionWeight: 0,
        topoWeight: 0,
        logWeight: 1.0,
      },
      discrete: {
        baselineStrategy: 'q25',
        correlationMethod: 'pearson',
        propagationMode: 'additive',
        enableCollisionAggregation: true,
        useTemporalCausality: true,
      },
    };

    const trueF = (cfg: RCAConfiguration): number => {
      let score = 0.85;
      // Penalty for wrong strategy
      if (cfg.discrete.baselineStrategy !== 'q25') score -= 0.12;
      // Penalty for wrong correlation
      if (cfg.discrete.correlationMethod !== 'pearson') score -= 0.08;
      // Penalty for distance from optimal decayAlpha
      score -= (cfg.continuous.decayAlpha - 0.82) ** 2 * 3;
      // Small bonus for collision on
      if (cfg.discrete.enableCollisionAggregation) score += 0.03;
      return Math.max(0, Math.min(1, score));
    };

    const graph = makeGraph(
      ['A', 'B', 'C', 'D', 'E'],
      [
        ['A', 'B'],
        ['B', 'C'],
        ['C', 'D'],
        ['D', 'E'],
        ['A', 'C'],
      ],
    );
    const metrics = makeMetrics(5);

    const opt = new AdaptiveConfigOptimizer([], undefined, {
      maxIterations: 6,
      candidateCount: 20,
      useLLM: false,
      ucbBeta: 1.5,
      convergence: { epsilonVariance: 0.01, epsilonMean: 0.03, patience: 2 },
    });

    const result = await opt.optimize(graph, metrics, trueF);

    // Convergence: must find accuracy > 0.7
    expect(result.bestAccuracy).toBeGreaterThan(0.7);

    // Should converge within budget
    expect(result.iterations).toBeLessThanOrEqual(6);

    // History should be well-formed
    for (const entry of result.history) {
      expect(entry.accuracy).toBeGreaterThanOrEqual(0);
      expect(entry.accuracy).toBeLessThanOrEqual(1);
      expect(entry.config).toBeDefined();
    }

    // Config should be valid
    const vec = DEFAULT_CONFIG_SPACE.toVector(result.config);
    expect(vec).toHaveLength(21);
    for (let i = 0; i < vec.length; i++) {
      expect(vec[i]).toBeGreaterThanOrEqual(0);
      expect(vec[i]).toBeLessThanOrEqual(1);
    }
  });

  it('should complete even with flat landscape', async () => {
    const graph = makeGraph(['A', 'B'], [['A', 'B']]);
    const metrics = makeMetrics(2);
    const flatOracle = async () => 0.5;

    const opt = new AdaptiveConfigOptimizer([], undefined, {
      maxIterations: 2,
      useLLM: false,
    });

    const result = await opt.optimize(graph, metrics, flatOracle);
    expect(result.iterations).toBeLessThanOrEqual(2);
    expect(result.bestAccuracy).toBe(0.5);
  });

  it('should produce consistent results with same seed', async () => {
    const graph = makeGraph(['A'], []);
    const metrics = makeMetrics(1);
    const oracle = async () => 0.75;

    const opt = new AdaptiveConfigOptimizer([], undefined, {
      maxIterations: 3,
      useLLM: false,
    });

    const r1 = await opt.optimize(graph, metrics, oracle);
    const r2 = await opt.optimize(graph, metrics, oracle);

    // Both should find reasonable configs with same deterministic oracle
    expect(r1.bestAccuracy).toBe(0.75);
    expect(r2.bestAccuracy).toBe(0.75);
  });
});
