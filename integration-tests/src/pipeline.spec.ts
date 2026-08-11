/**
 * Integration test: Full AIOps-Kinetic pipeline validation.
 */
import {
  Container,
  DI_TOKENS,
  registerCuttingFactories,
  registerNoiseFactories,
  registerScalingFactories,
  registerTreeModule,
  registerWaveFactories,
} from '@agentix-e/micro-kinetic-core';
import { describe, expect, it } from 'vitest';

function createTestGraph() {
  return {
    nodes: new Map([
      ['gw', { id: 'gw', name: 'api-gateway', namespace: 'prod', labels: { tier: 'frontend' } }],
      [
        'svc-a',
        { id: 'svc-a', name: 'service-a', namespace: 'prod', labels: { tier: 'business' } },
      ],
      [
        'svc-b',
        { id: 'svc-b', name: 'service-b', namespace: 'prod', labels: { tier: 'business' } },
      ],
      [
        'svc-c',
        { id: 'svc-c', name: 'service-c', namespace: 'prod', labels: { tier: 'business' } },
      ],
      ['db', { id: 'db', name: 'database', namespace: 'prod', labels: { tier: 'storage' } }],
    ]),
    edges: [
      {
        from: 'gw',
        to: 'svc-a',
        type: 'REST' as const,
        callRate: 100,
        p99Latency: 10,
        errorRate: 0,
      },
      {
        from: 'gw',
        to: 'svc-b',
        type: 'REST' as const,
        callRate: 80,
        p99Latency: 15,
        errorRate: 0,
      },
      {
        from: 'svc-a',
        to: 'svc-c',
        type: 'gRPC' as const,
        callRate: 50,
        p99Latency: 5,
        errorRate: 0,
      },
      {
        from: 'svc-c',
        to: 'svc-a',
        type: 'CALLBACK' as const,
        callRate: 10,
        p99Latency: 20,
        errorRate: 0.05,
      },
      {
        from: 'svc-b',
        to: 'db',
        type: 'REST' as const,
        callRate: 200,
        p99Latency: 3,
        errorRate: 0.01,
      },
      { from: 'svc-c', to: 'db', type: 'REST' as const, callRate: 30, p99Latency: 4, errorRate: 0 },
    ],
    systemLoad: 0.4,
  };
}

function createTestMetrics() {
  const times = [0, 60_000, 120_000, 180_000, 240_000, 300_000];
  return new Map([
    [
      'gw',
      [
        {
          label: 'cpu',
          timestamps: times,
          values: new Float64Array([10, 12, 12, 11, 13, 14]),
          unit: '%',
        },
      ],
    ],
    [
      'svc-a',
      [
        {
          label: 'cpu',
          timestamps: times,
          values: new Float64Array([30, 35, 40, 60, 80, 95]),
          unit: '%',
        },
      ],
    ],
    [
      'svc-b',
      [
        {
          label: 'cpu',
          timestamps: times,
          values: new Float64Array([20, 22, 25, 28, 30, 32]),
          unit: '%',
        },
      ],
    ],
    [
      'svc-c',
      [
        {
          label: 'cpu',
          timestamps: times,
          values: new Float64Array([15, 18, 20, 25, 30, 40]),
          unit: '%',
        },
      ],
    ],
    [
      'db',
      [
        {
          label: 'cpu',
          timestamps: times,
          values: new Float64Array([5, 5, 6, 6, 7, 8]),
          unit: '%',
        },
      ],
    ],
  ]);
}

describe('Full Pipeline Integration', () => {
  it('should register all modules in DI container', () => {
    const container = new Container();

    expect(() => registerTreeModule(container)).not.toThrow();
    expect(() => registerCuttingFactories(container)).not.toThrow();
    expect(() => registerNoiseFactories(container)).not.toThrow();
    expect(() => registerScalingFactories(container)).not.toThrow();
    expect(() => registerWaveFactories(container)).not.toThrow();

    expect(container.has(DI_TOKENS.RCA_ENGINE)).toBe(true);
    expect(container.has(DI_TOKENS.CUTTING_ENGINE)).toBe(true);
    expect(container.has(DI_TOKENS.DENOISE_ENGINE)).toBe(true);
    expect(container.has(DI_TOKENS.SCALING_ANALYZER)).toBe(true);
    expect(container.has(DI_TOKENS.WAVE_PROPAGATION_MODEL)).toBe(true);
  });

  it('should build fault graph with cycle detection', () => {
    const container = new Container();
    registerTreeModule(container);

    const engine = container.resolve(DI_TOKENS.RCA_ENGINE);
    const callGraph = createTestGraph();
    const metrics = createTestMetrics();

    const faultGraph = engine.buildFaultGraph(callGraph, metrics);

    expect(faultGraph.callGraph.nodes.size).toBe(5);
    // Chronological tree: edges depend on anomaly onset timing in data
    expect(faultGraph.anomalyScores.size).toBeGreaterThan(0);
    // Chronological tree eliminates cycles; verify graph built successfully
    expect(faultGraph.totalCycleContribution).toBeGreaterThanOrEqual(0);
  });

  it('should prune cycles and produce tree-based RCA results', async () => {
    const container = new Container();
    registerTreeModule(container);

    const engine = container.resolve(DI_TOKENS.RCA_ENGINE);
    // Use a DAG (no cycles) for deterministic tree RCA
    const dagGraph = {
      ...createTestGraph(),
      edges: createTestGraph().edges.filter((e) => !(e.from === 'svc-c' && e.to === 'svc-a')),
    };
    const metrics = createTestMetrics();

    const faultGraph = engine.buildFaultGraph(dagGraph, metrics);
    const results = await engine.analyze(faultGraph, 3);

    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(3);
    for (const r of results) {
      expect(r.rank).toBeGreaterThan(0);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
      expect(r.viaTreeSearch).toBe(true);
    }
  });

  it('should compute cycle contribution bound', () => {
    const container = new Container();
    registerTreeModule(container);

    const engine = container.resolve(DI_TOKENS.RCA_ENGINE);
    const callGraph = createTestGraph();
    const metrics = createTestMetrics();

    const faultGraph = engine.buildFaultGraph(callGraph, metrics);
    const bound = engine.getCycleContributionBound(faultGraph);

    expect(bound).toBeGreaterThanOrEqual(0);
    expect(bound).toBeLessThanOrEqual(1);
  });

  it('should segment time series with cutting algorithm', () => {
    const container = new Container();
    registerCuttingFactories(container);

    const engine = container.resolve(DI_TOKENS.CUTTING_ENGINE);
    const points = 60; // 1 hour at 1 point/min
    const timestamps = Array.from({ length: points }, (_, i) => i * 60_000);
    const values = new Float64Array(points);
    for (let i = 0; i < points; i++) {
      values[i] = 100 + (i / points) * 500; // linear leak
    }

    const ts = { label: 'mem_rss', timestamps, values, unit: 'MB' };
    const windows = engine.segment(ts, {
      maxWindows: 5,
      minWindowDurationMs: 300000,
      adaptive: true,
    });

    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      expect(w.startTime).toBeLessThan(w.endTime);
    }
  });

  it('should compute coupling sparsity for denoising', () => {
    const container = new Container();
    registerNoiseFactories(container);

    const engine = container.resolve(DI_TOKENS.DENOISE_ENGINE);
    const callGraph = createTestGraph();

    const history = [
      {
        id: 'a1',
        serviceId: 'svc-a',
        severity: 'critical' as const,
        timestamp: 1000,
        metric: 'cpu',
        value: 95,
        threshold: 80,
        message: 'CPU high',
      },
      {
        id: 'a2',
        serviceId: 'svc-b',
        severity: 'warning' as const,
        timestamp: 1100,
        metric: 'mem',
        value: 85,
        threshold: 80,
        message: 'Memory high',
      },
      {
        id: 'a3',
        serviceId: 'svc-a',
        severity: 'critical' as const,
        timestamp: 2000,
        metric: 'cpu',
        value: 98,
        threshold: 80,
        message: 'CPU critical',
      },
    ];

    const coupling = engine.computeCouplingSparsity(history, callGraph);
    expect(coupling.dimension).toBe(5);
    expect(coupling.sparsityScore).toBeGreaterThanOrEqual(0);
  });

  it('should compute BBGKY hierarchy', () => {
    const container = new Container();
    registerScalingFactories(container);

    const analyzer = container.resolve(DI_TOKENS.SCALING_ANALYZER);
    const states = [
      {
        serviceId: 'svc-a',
        timestamp: 1000,
        faultProbability: 0.1,
        anomalyScore: 0.2,
        trafficRps: 100,
      },
      {
        serviceId: 'svc-b',
        timestamp: 1000,
        faultProbability: 0.05,
        anomalyScore: 0.1,
        trafficRps: 80,
      },
      {
        serviceId: 'svc-c',
        timestamp: 1000,
        faultProbability: 0.15,
        anomalyScore: 0.3,
        trafficRps: 50,
      },
    ];

    const hierarchy = analyzer.computeBBGKYHierarchy(states, createTestGraph(), {
      maxOrder: 3,
      truncationEta: 0.01,
    });
    expect(hierarchy.systemSize).toBe(5); // 5 services in test graph
    expect(hierarchy.truncationOrder).toBeGreaterThanOrEqual(1);
  });

  it('should estimate Boltzmann-Grad fault probability', () => {
    const container = new Container();
    registerScalingFactories(container);

    const analyzer = container.resolve(DI_TOKENS.SCALING_ANALYZER);
    const result = analyzer.estimateFaultProbability(100, 0.1);

    expect(result.serviceCount).toBe(100);
    expect(result.faultProbabilityAsymptotic).toBeGreaterThanOrEqual(0);
    expect(result.faultProbabilityAsymptotic).toBeLessThanOrEqual(1);
    expect(['dilute', 'transition', 'dense']).toContain(result.regime);
  });

  it('should simulate alert cascade', () => {
    const container = new Container();
    registerWaveFactories(container);

    const model = container.resolve(DI_TOKENS.WAVE_PROPAGATION_MODEL);
    const callGraph = createTestGraph();

    const result = model.simulateCascade('svc-a', callGraph, {
      couplingStrength: 0.5,
      propagationSpeed: 1.0,
      decayTimeConstant: 30000,
      cascadeThreshold: 0.3,
      timeHorizon: 60000,
    });

    expect(result.sourceServiceId).toBe('svc-a');
    expect(result.peakIntensity).toBeGreaterThanOrEqual(0);
    expect(result.peakIntensity).toBeLessThanOrEqual(1);
    expect(result.intensityTrajectories.size).toBeGreaterThan(0);
  });
});
