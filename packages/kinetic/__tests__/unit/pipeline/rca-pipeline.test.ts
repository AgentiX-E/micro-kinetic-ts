import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container, DI_TOKENS } from '@agentix-e/micro-kinetic-core';
import type { IContainer } from '@agentix-e/micro-kinetic-core';

import {
  RCAPipeline,
  registerRCAPipeline,
  DEFAULT_PIPELINE_CONFIG,
} from '../../../src/pipeline/rca-pipeline.js';

// ── Helpers ───────────────────────────────────────────────

function createMockContainer(): IContainer {
  const container = new Container();

  const mockEngine = {
    buildFaultGraph: vi.fn(() => ({
      callGraph: { nodes: new Map(), edges: [], systemLoad: 0 },
      anomalyScores: new Map(),
    })),
    analyze: vi.fn(() => Promise.resolve([])),
  };

  const mockCutting = {
    segment: vi.fn(() => Promise.resolve([])),
    estimateLocalBounds: vi.fn(() => Promise.resolve([])),
  };

  const mockProver = {
    prove: vi.fn(() => Promise.resolve({ converged: true })),
  };

  const mockDenoise = {
    computeCouplingSparsity: vi.fn(() => ({})),
    denoise: vi.fn(() => Promise.resolve({
      trueAlarms: [],
      coincidentalAlarms: [],
      groupedAlarms: [],
      sparsityScore: 0,
      falsePositiveReduction: 0,
    })),
  };

  const mockScaling = {
    estimateFaultProbability: vi.fn(() => Promise.resolve({ limitProbability: 0.5, scalingExponent: 0.3 })),
  };

  const mockWave = {
    simulateCascade: vi.fn(() => Promise.resolve({ trajectories: [], totalPropagationTime: 0 })),
  };

  container.register(DI_TOKENS.RCA_ENGINE, () => mockEngine);
  container.register(DI_TOKENS.CUTTING_ENGINE, () => mockCutting);
  container.register(DI_TOKENS.CONVERGENCE_PROVER, () => mockProver);
  container.register(DI_TOKENS.DENOISE_ENGINE, () => mockDenoise);
  container.register(DI_TOKENS.SCALING_ANALYZER, () => mockScaling);
  container.register(DI_TOKENS.WAVE_PROPAGATION_MODEL, () => mockWave);

  return container;
}

function makeCallGraph() {
  return {
    nodes: new Map([
      ['svc_a', { serviceId: 'svc_a', dependencies: [] }],
      ['svc_b', { serviceId: 'svc_b', dependencies: ['svc_a'] }],
    ]),
    edges: [{ from: 'svc_b', to: 'svc_a', weight: 1 }],
    systemLoad: 0.5,
  };
}

function makeMetrics(): Map<string, Array<{ label: string; values: number[]; timestamps: number[] }>> {
  return new Map([
    ['svc_a', [{ label: 'cpu', values: [0.9, 0.95, 0.92], timestamps: [1, 2, 3] }]],
    ['svc_b', [{ label: 'cpu', values: [0.3, 0.4, 0.35], timestamps: [1, 2, 3] }]],
  ]);
}

// ── Tests — RCAPipeline Object Structure ──────────────────

describe('RCAPipeline', () => {
  describe('object structure', () => {
    it('should be a class constructor', () => {
      expect(typeof RCAPipeline).toBe('function');
    });

    it('should have an execute method on instances', () => {
      const container = createMockContainer();
      const pipeline = new RCAPipeline(container);
      expect(typeof pipeline.execute).toBe('function');
    });

    it('should accept container as first argument', () => {
      const container = createMockContainer();
      const pipeline = new RCAPipeline(container);
      expect(pipeline).toBeDefined();
    });

    it('should accept optional config as second argument', () => {
      const container = createMockContainer();
      const pipeline = new RCAPipeline(container, { topK: 3 });
      expect(pipeline).toBeDefined();
    });

    it('should accept empty config', () => {
      const container = createMockContainer();
      const pipeline = new RCAPipeline(container, {});
      expect(pipeline).toBeDefined();
    });
  });

  // ── Stage Definitions ───────────────────────────────────

  describe('execute — success path (full config)', () => {
    it('should return a promise from execute', () => {
      const container = createMockContainer();
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableChronic: false,
        enableDenoising: false,
        enableScaling: false,
        enableWave: false,
      });
      const result = pipeline.execute(makeCallGraph(), makeMetrics());
      expect(result).toBeInstanceOf(Promise);
    });

    it('should return rootCauses array in result', async () => {
      const container = createMockContainer();
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableChronic: false,
        enableDenoising: false,
        enableScaling: false,
        enableWave: false,
      });
      const result = await pipeline.execute(makeCallGraph(), makeMetrics());
      expect(Array.isArray(result.rootCauses)).toBe(true);
    });

    it('should return chronicDetected as boolean', async () => {
      const container = createMockContainer();
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableChronic: false,
        enableDenoising: false,
        enableScaling: false,
        enableWave: false,
      });
      const result = await pipeline.execute(makeCallGraph(), makeMetrics());
      expect(typeof result.chronicDetected).toBe('boolean');
    });

    it('should return stages array in result', async () => {
      const container = createMockContainer();
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableChronic: false,
        enableDenoising: false,
        enableScaling: false,
        enableWave: false,
      });
      const result = await pipeline.execute(makeCallGraph(), makeMetrics());
      expect(Array.isArray(result.stages)).toBe(true);
    });

    it('should include Collision Tree RCA stage', async () => {
      const container = createMockContainer();
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableChronic: false,
        enableDenoising: false,
        enableScaling: false,
        enableWave: false,
      });
      const result = await pipeline.execute(makeCallGraph(), makeMetrics());
      const stageNames = result.stages.map((s) => s.stage);
      expect(stageNames).toContain('Collision Tree RCA');
    });

    it('should have every stage marked as success', async () => {
      const container = createMockContainer();
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableChronic: false,
        enableDenoising: false,
        enableScaling: false,
        enableWave: false,
      });
      const result = await pipeline.execute(makeCallGraph(), makeMetrics());
      for (const stage of result.stages) {
        expect(stage.success).toBe(true);
      }
    });

    it('should have positive total duration', async () => {
      const container = createMockContainer();
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableChronic: false,
        enableDenoising: false,
        enableScaling: false,
        enableWave: false,
      });
      const result = await pipeline.execute(makeCallGraph(), makeMetrics());
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Empty Inputs ────────────────────────────────────────

  describe('execute — empty inputs', () => {
    it('should handle empty call graph', async () => {
      const container = createMockContainer();
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableChronic: false,
        enableDenoising: false,
        enableScaling: false,
        enableWave: false,
      });
      const emptyGraph = { nodes: new Map(), edges: [], systemLoad: 0 };
      const result = await pipeline.execute(emptyGraph, makeMetrics());
      expect(result.rootCauses).toBeDefined();
    });

    it('should handle empty metrics', async () => {
      const container = createMockContainer();
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableChronic: false,
        enableDenoising: false,
        enableScaling: false,
        enableWave: false,
      });
      const result = await pipeline.execute(makeCallGraph(), new Map());
      expect(result.rootCauses).toBeDefined();
    });

    it('should handle both empty graph and empty metrics', async () => {
      const container = createMockContainer();
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableChronic: false,
        enableDenoising: false,
        enableScaling: false,
        enableWave: false,
      });
      const result = await pipeline.execute(
        { nodes: new Map(), edges: [], systemLoad: 0 },
        new Map(),
      );
      expect(result.chronicDetected).toBe(false);
    });
  });
});

// ── DEFAULT_PIPELINE_CONFIG ───────────────────────────────

describe('DEFAULT_PIPELINE_CONFIG', () => {
  it('should have pruneEpsilon as number', () => {
    expect(typeof DEFAULT_PIPELINE_CONFIG.pruneEpsilon).toBe('number');
  });

  it('should have criticalLoadThreshold as number', () => {
    expect(typeof DEFAULT_PIPELINE_CONFIG.criticalLoadThreshold).toBe('number');
  });

  it('should have topK as positive integer', () => {
    expect(DEFAULT_PIPELINE_CONFIG.topK).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_PIPELINE_CONFIG.topK)).toBe(true);
  });

  it('should have maxPropagationDepth as positive', () => {
    expect(DEFAULT_PIPELINE_CONFIG.maxPropagationDepth).toBeGreaterThan(0);
  });

  it('should have enableChronic as true by default', () => {
    expect(DEFAULT_PIPELINE_CONFIG.enableChronic).toBe(true);
  });

  it('should have enableDenoising as true by default', () => {
    expect(DEFAULT_PIPELINE_CONFIG.enableDenoising).toBe(true);
  });

  it('should have enableScaling as true by default', () => {
    expect(DEFAULT_PIPELINE_CONFIG.enableScaling).toBe(true);
  });

  it('should have enableWave as true by default', () => {
    expect(DEFAULT_PIPELINE_CONFIG.enableWave).toBe(true);
  });
});

// ── registerRCAPipeline ───────────────────────────────────

describe('registerRCAPipeline', () => {
  it('should register RCA_PIPELINE token in container', () => {
    const container = new Container();
    registerRCAPipeline(container);
    expect(container.has(DI_TOKENS.RCA_PIPELINE)).toBe(true);
  });

  it('should resolve to an RCAPipeline instance', () => {
    const container = new Container();
    registerRCAPipeline(container);
    const resolved = container.resolve(DI_TOKENS.RCA_PIPELINE);
    expect(resolved).toBeInstanceOf(RCAPipeline);
  });
});
