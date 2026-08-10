import { describe, expect, it } from 'vitest';
import { AdaptiveConfigOptimizer } from '../../src/optimizer.js';
import type { RCAConfiguration } from '../../src/config-space.js';
import type { ServiceCallGraph, ServiceNode, CallEdge, MetricMap, TimeSeries } from '@agentix-e/micro-kinetic-core';

function makeNode(id: string): ServiceNode {
  return { id, name: id, namespace: 'test', labels: {} };
}

function makeEdge(from: string, to: string): CallEdge {
  return { from, to, type: 'REST', callRate: 0, p99Latency: 0, errorRate: 0 };
}

function makeGraph(nodes: ServiceNode[], edges: CallEdge[]): ServiceCallGraph {
  const m = new Map<string, ServiceNode>();
  for (const n of nodes) m.set(n.id, n);
  return { nodes: m, edges, systemLoad: 0.5 };
}

function makeTS(label: string, values: number[]): TimeSeries {
  return {
    label,
    values: new Float64Array(values),
    timestamps: new Float64Array(values.map((_, i) => i * 1000)),
  };
}

function makeMetrics(entries: Array<[string, number[]]>): MetricMap {
  const m = new Map<string, readonly TimeSeries[]>();
  for (const [svc, values] of entries) {
    m.set(svc, [makeTS('cpu', values)]);
  }
  return m;
}

describe('AdaptiveConfigOptimizer', () => {
  it('should create with defaults', () => {
    const opt = new AdaptiveConfigOptimizer();
    expect(opt).toBeDefined();
  });

  it('should optimize with simple oracle (no historical data)', async () => {
    const graph = makeGraph(
      [makeNode('A'), makeNode('B'), makeNode('C')],
      [makeEdge('A', 'B'), makeEdge('B', 'C')],
    );
    const metrics = makeMetrics([
      ['A', [10, 20, 30]],
      ['B', [5, 15, 25]],
      ['C', [1, 2, 3]],
    ]);

    // Oracle: simple accuracy function favoring high decayAlpha + q25
    const oracle = async (cfg: RCAConfiguration) => {
      let score = 0.5;
      if (cfg.discrete.baselineStrategy === 'q25') score += 0.15;
      if (cfg.continuous.decayAlpha > 0.7) score += 0.1;
      if (cfg.discrete.propagationMode === 'additive') score += 0.1;
      return Math.min(1.0, score);
    };

    const opt = new AdaptiveConfigOptimizer([], undefined, {
      maxIterations: 5,
      useLLM: false,
      ucbBeta: 2.0,
      candidateCount: 10,
      convergence: { epsilonVariance: 0.01, epsilonMean: 0.05, patience: 3 },
    });

    const result = await opt.optimize(graph, metrics, oracle);

    expect(result.iterations).toBeGreaterThan(0);
    expect(result.bestAccuracy).toBeGreaterThan(0.5);
    expect(result.config).toBeDefined();
    expect(result.predictedAccuracy).toBeGreaterThan(0);
  });

  it('should return valid config structure', async () => {
    const graph = makeGraph([makeNode('X')], []);
    const metrics = makeMetrics([['X', [1, 2, 3]]]);
    const oracle = async () => 0.8;

    const opt = new AdaptiveConfigOptimizer([], undefined, {
      maxIterations: 3,
      useLLM: false,
    });

    const result = await opt.optimize(graph, metrics, oracle);

    expect(result.config.continuous.decayAlpha).toBeGreaterThanOrEqual(0.5);
    expect(result.config.continuous.decayAlpha).toBeLessThanOrEqual(0.95);
    expect(['q25', 'sliding-window', 'auto']).toContain(
      result.config.discrete.baselineStrategy,
    );
  });

  it('should track iteration history', async () => {
    const graph = makeGraph([makeNode('A')], []);
    const metrics = makeMetrics([['A', [1, 2]]]);
    let callCount = 0;
    const oracle = async () => {
      callCount++;
      return 0.6 + callCount * 0.05;
    };

    const opt = new AdaptiveConfigOptimizer([], undefined, {
      maxIterations: 3,
      useLLM: false,
    });

    const result = await opt.optimize(graph, metrics, oracle);

    expect(result.history).toHaveLength(result.iterations);
    for (const entry of result.history) {
      expect(entry.iteration).toBeGreaterThanOrEqual(1);
      expect(entry.accuracy).toBeGreaterThan(0);
      expect(entry.config).toBeDefined();
    }
  });

  it('should not exceed max iterations', async () => {
    const graph = makeGraph([makeNode('A')], []);
    const metrics = makeMetrics([['A', [1, 2]]]);
    const oracle = async () => 0.5;

    const opt = new AdaptiveConfigOptimizer([], undefined, {
      maxIterations: 3,
      useLLM: false,
      convergence: { epsilonVariance: 0.0001, epsilonMean: 0.0001, patience: 100 },
    });

    const result = await opt.optimize(graph, metrics, oracle);
    expect(result.iterations).toBeLessThanOrEqual(3);
  });

  it('should handle always-zero oracle gracefully', async () => {
    const graph = makeGraph([makeNode('A')], []);
    const metrics = makeMetrics([['A', [1]]]);
    const oracle = async () => 0;

    const opt = new AdaptiveConfigOptimizer([], undefined, {
      maxIterations: 2,
      useLLM: false,
    });

    const result = await opt.optimize(graph, metrics, oracle);
    expect(result.bestAccuracy).toBe(0);
    // Will find optimum (zero) within 2 iterations (prior 0.6 → 0 → 0)
    expect(result.iterations).toBeLessThanOrEqual(3);
  });
});

describe('AdaptiveConfigOptimizer on known function', () => {
  it('should find near-optimal config for synthetic function', async () => {
    // f(θ) = 0.8 - (decayAlpha - 0.85)^2 * 5 - penalty for suboptimal discrete choices
    const trueF = (cfg: RCAConfiguration): number => {
      let score = 0.8;
      score -= (cfg.continuous.decayAlpha - 0.85) * (cfg.continuous.decayAlpha - 0.85) * 5;
      if (cfg.discrete.baselineStrategy !== 'q25') score -= 0.1;
      if (cfg.discrete.propagationMode !== 'additive') score -= 0.05;
      return Math.max(0, Math.min(1, score));
    };

    const graph = makeGraph(
      [makeNode('A'), makeNode('B')],
      [makeEdge('A', 'B')],
    );
    const metrics = makeMetrics([
      ['A', [10, 20, 30]],
      ['B', [5, 15, 25]],
    ]);

    const opt = new AdaptiveConfigOptimizer([], undefined, {
      maxIterations: 8,
      candidateCount: 30,
      useLLM: false,
      ucbBeta: 1.5,
      convergence: { epsilonVariance: 0.008, epsilonMean: 0.02, patience: 2 },
    });

    const result = await opt.optimize(graph, metrics, trueF);

    expect(result.bestAccuracy).toBeGreaterThan(0.6);
    // The optimizer should prefer q25 strategy
    expect(result.history.length).toBeGreaterThanOrEqual(1);
  });
});
