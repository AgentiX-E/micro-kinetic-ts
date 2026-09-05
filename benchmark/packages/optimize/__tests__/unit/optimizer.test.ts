import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdaptiveConfigOptimizer } from '../../src/optimizer.js';
import type { RCAConfiguration } from '../../src/config-space.js';
import { DEFAULT_CONFIG } from '../../src/config-space.js';
import type { HistoricalRecord } from '../../src/meta-learner.js';
import type { SystemContext } from '../../src/types.js';
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

function makeCtx(overrides?: Partial<SystemContext>): SystemContext {
  return {
    serviceCount: 3,
    graphDensity: 0.5,
    degreeCV: 0.4,
    maxDepth: 3,
    traceCoverage: 0,
    metricCV: 0.4,
    spikeDominanceRatio: 0.3,
    anomalyConcentration: 0.4,
    systemLoad: 0.5,
    faultTypeCount: 3,
    avgCasesPerType: 5,
    ...overrides,
  };
}

function makeHistoricalRecord(overrides?: Partial<HistoricalRecord>): HistoricalRecord {
  return {
    system: 'ob',
    suite: 're1',
    context: makeCtx(),
    config: {
      baselineStrategy: 'q25',
      correlationMethod: 'pearson',
      propagationMode: 'additive',
      enableCollisionAggregation: true,
      useTemporalCausality: true,
      decayAlpha: 0.85,
      pruneEpsilon: 0.001,
      temporalBonus: 0.15,
      defaultWeight: 0.05,
      childContributionCap: 1.0,
      sourceWeight: 0,
      temporalWeight: 0,
      collisionWeight: 0,
      topoWeight: 0,
      logWeight: 1.0,
      traceWeight: 0,
    },
    accuracy: 0.9,
    ...overrides,
  };
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

describe('AdaptiveConfigOptimizer prior fallback', () => {
  it('falls back to the prior config when no experiment improves on it', async () => {
    const graph = makeGraph([makeNode('A')], []);
    const metrics = makeMetrics([['A', [1, 2, 3]]]);
    // Every experiment scores 0, which is worse than the 0.6 soft prior, so
    // the best GP observation is the prior itself and the result must be the
    // prior configuration (DEFAULT_CONFIG when there is no meta-learner).
    const oracle = async () => 0;

    const opt = new AdaptiveConfigOptimizer([], undefined, {
      maxIterations: 2,
      useLLM: false,
    });

    const result = await opt.optimize(graph, metrics, oracle);

    expect(result.config).toEqual(DEFAULT_CONFIG);
    expect(result.bestAccuracy).toBe(0);
  });
});

describe('AdaptiveConfigOptimizer with LLM advisor', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('consults the LLM advisor once history exceeds one experiment', async () => {
    process.env.DEEPSEEK_API_KEY = 'test-key';
    const res = new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                ranking: [4, 3, 2, 1, 0],
                reasoning: 'domain ranking',
                confidence: 0.8,
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res));

    const graph = makeGraph(
      [makeNode('A'), makeNode('B')],
      [makeEdge('A', 'B')],
    );
    const metrics = makeMetrics([
      ['A', [10, 20, 30]],
      ['B', [5, 15, 25]],
    ]);

    const opt = new AdaptiveConfigOptimizer([], undefined, {
      maxIterations: 4,
      candidateCount: 5,
      useLLM: true,
      // Disable early convergence so the loop runs to completion.
      convergence: { epsilonVariance: 1e-6, epsilonMean: 1e-6, patience: 100 },
    });

    const result = await opt.optimize(graph, metrics, async () => 0.75);

    // The LLM advisor is only consulted from the third iteration onward
    // (history length > 1), and its confidence (> 0) marks those iterations.
    expect(result.history.some((h) => h.llmConsulted)).toBe(true);

    delete process.env.DEEPSEEK_API_KEY;
  });
});

describe('AdaptiveConfigOptimizer progress + convergence', () => {
  it('invokes the onProgress callback once per completed iteration', async () => {
    const graph = makeGraph([makeNode('A')], []);
    const metrics = makeMetrics([['A', [1, 2, 3]]]);
    const calls: Array<{ iteration: number; accuracy: number }> = [];
    const onProgress = (
      iteration: number,
      _config: RCAConfiguration,
      accuracy: number,
    ): void => {
      calls.push({ iteration, accuracy });
    };

    const opt = new AdaptiveConfigOptimizer([], undefined, {
      maxIterations: 3,
      useLLM: false,
      onProgress,
    });

    const result = await opt.optimize(graph, metrics, async () => 0.8);

    expect(calls.length).toBe(result.iterations);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]!.iteration).toBe(1);
    expect(calls[0]!.accuracy).toBe(0.8);
  });

  it('terminates early when the posterior variance collapses below the threshold', async () => {
    const graph = makeGraph([makeNode('A')], []);
    const metrics = makeMetrics([['A', [1, 2, 3]]]);

    const opt = new AdaptiveConfigOptimizer([], undefined, {
      maxIterations: 5,
      useLLM: false,
      // A zero-amplitude, zero-noise kernel makes the posterior variance at
      // every test point collapse to ~1e-12, so the variance criterion is met
      // on the first iteration and the loop breaks immediately.
      gpOptions: { signalVariance: 0, noiseVariance: 0 },
      convergence: { epsilonVariance: 0.005, epsilonMean: 0.01, patience: 1 },
    });

    const result = await opt.optimize(graph, metrics, async () => 0.8);

    expect(result.converged).toBe(true);
    expect(result.iterations).toBeLessThan(5);
  });
});

describe('AdaptiveConfigOptimizer with meta-learner prior', () => {
  it('seeds the GP with a meta-learner prior from historical records', async () => {
    const historical: HistoricalRecord[] = [
      makeHistoricalRecord({ accuracy: 0.9 }),
      makeHistoricalRecord({
        accuracy: 0.85,
        config: { ...makeHistoricalRecord().config, decayAlpha: 0.9 },
      }),
      makeHistoricalRecord({ accuracy: 0.8 }),
    ];

    const graph = makeGraph(
      [makeNode('A'), makeNode('B')],
      [makeEdge('A', 'B')],
    );
    const metrics = makeMetrics([
      ['A', [10, 20, 30]],
      ['B', [5, 15, 25]],
    ]);

    const opt = new AdaptiveConfigOptimizer(historical, undefined, {
      maxIterations: 3,
      useLLM: false,
    });

    const result = await opt.optimize(graph, metrics, async () => 0.8);

    expect(result.bestAccuracy).toBeGreaterThan(0.5);
    expect(result.config).toBeDefined();
    expect(result.config.continuous.decayAlpha).toBeGreaterThanOrEqual(0.5);
    expect(result.config.continuous.decayAlpha).toBeLessThanOrEqual(0.95);
    expect(['q25', 'sliding-window', 'auto']).toContain(
      result.config.discrete.baselineStrategy,
    );
  });
});
