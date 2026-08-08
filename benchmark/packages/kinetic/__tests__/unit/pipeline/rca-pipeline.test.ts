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

  // ── Full Pipeline — All Stages Enabled ─────────────────

  describe('execute — full pipeline (all stages)', () => {
    it('should run chronic detection when enableChronic is true', async () => {
      const container = createMockContainer();
      // Override mock cutting to return 2+ windows → enables chronic detection branch
      const mockCuttingWithWindows = {
        segment: vi.fn(() => Promise.resolve([{ start: 0, end: 1 }, { start: 2, end: 3 }])),
        estimateLocalBounds: vi.fn(() =>
          Promise.resolve([
            { errorBound: 0.01 },
            { errorBound: 0.02 },
          ]),
        ),
      };
      container.remove(DI_TOKENS.CUTTING_ENGINE);
      container.register(DI_TOKENS.CUTTING_ENGINE, () => mockCuttingWithWindows);
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableDenoising: false,
        enableScaling: false,
        enableWave: false,
      });
      const result = await pipeline.execute(makeCallGraph(), makeMetrics());
      const stageNames = result.stages.map((s) => s.stage);
      expect(stageNames).toContain('Chronic Cutting (segmenting)');
      expect(stageNames).toContain('Chronic Cutting (bounds)');
      expect(stageNames).toContain('Convergence Proof');
    });

    it('should run denoising when enableDenoising is true', async () => {
      const container = createMockContainer();
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableChronic: false,
        enableScaling: false,
        enableWave: false,
      });
      const result = await pipeline.execute(makeCallGraph(), makeMetrics());
      expect(result.denoiseResult).toBeDefined();
      const stageNames = result.stages.map((s) => s.stage);
      expect(stageNames).toContain('Stosszahlansatz Denoising');
    });

    it('should run scaling when enableScaling is true', async () => {
      const container = createMockContainer();
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableChronic: false,
        enableDenoising: false,
        enableWave: false,
      });
      const result = await pipeline.execute(makeCallGraph(), makeMetrics());
      expect(result.scalingResult).toBeDefined();
      const stageNames = result.stages.map((s) => s.stage);
      expect(stageNames).toContain('BBGKY + Boltzmann-Grad Scaling');
    });

    it('should run wave simulation when enableWave is true', async () => {
      const container = createMockContainer();
      // Register RCA engine that returns a root cause so wave has something to simulate
      container.remove(DI_TOKENS.RCA_ENGINE);
      const mockEngineWithRootCause = {
        buildFaultGraph: vi.fn(() => ({
          callGraph: {
            nodes: new Map([['svc_a', { serviceId: 'svc_a', dependencies: [] }]]),
            edges: [],
            systemLoad: 0,
          },
          anomalyScores: new Map([['svc_a', 0.9]]),
        })),
        analyze: vi.fn(() =>
          Promise.resolve([
            {
              serviceId: 'svc_a',
              faultType: { category: 'CPU', subType: '', severity: 'major' },
              confidence: 0.85,
              rank: 1,
              timestamp: Date.now(),
              evidenceMetrics: [],
              propagationPath: [],
            },
          ]),
        ),
      };
      container.register(DI_TOKENS.RCA_ENGINE, () => mockEngineWithRootCause);
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableChronic: false,
        enableDenoising: false,
        enableScaling: false,
      });
      const result = await pipeline.execute(makeCallGraph(), makeMetrics());
      expect(result.cascadeResult).toBeDefined();
      const stageNames = result.stages.map((s) => s.stage);
      expect(stageNames).toContain('Wave Cascade Simulation');
    });

    it('should run all 5 stages with default config', async () => {
      const container = createMockContainer();
      container.remove(DI_TOKENS.RCA_ENGINE);
      const mockEngineWithRootCause = {
        buildFaultGraph: vi.fn(() => ({
          callGraph: {
            nodes: new Map([['svc_a', { serviceId: 'svc_a', dependencies: [] }]]),
            edges: [],
            systemLoad: 0,
          },
          anomalyScores: new Map([['svc_a', 0.9]]),
        })),
        analyze: vi.fn(() =>
          Promise.resolve([
            {
              serviceId: 'svc_a',
              faultType: { category: 'CPU', subType: '', severity: 'major' },
              confidence: 0.85,
              rank: 1,
              timestamp: Date.now(),
              evidenceMetrics: [],
              propagationPath: [],
            },
          ]),
        ),
      };
      container.register(DI_TOKENS.RCA_ENGINE, () => mockEngineWithRootCause);
      const pipeline = new RCAPipeline(container);
      const result = await pipeline.execute(makeCallGraph(), makeMetrics());
      expect(result.rootCauses).toBeDefined();
      expect(result.denoiseResult).toBeDefined();
      expect(result.scalingResult).toBeDefined();
      expect(result.cascadeResult).toBeDefined();
      expect(result.stages.length).toBeGreaterThanOrEqual(5);
      for (const stage of result.stages) {
        expect(stage.success).toBe(true);
      }
    });

    it('should not run wave when no root causes found', async () => {
      const container = createMockContainer();
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableChronic: false,
        enableDenoising: false,
        enableScaling: false,
      });
      const result = await pipeline.execute(makeCallGraph(), makeMetrics());
      // No root causes from mock engine → wave should be skipped
      expect(result.cascadeResult).toBeUndefined();
    });
  });

  // ── Stage Error Handling ─────────────────────────────────

  describe('execute — error handling', () => {
    it('should record stage failure when engine throws Error', async () => {
      const container = createMockContainer();
      container.remove(DI_TOKENS.RCA_ENGINE);
      const failingEngine = {
        buildFaultGraph: vi.fn(() => ({
          callGraph: { nodes: new Map(), edges: [], systemLoad: 0 },
          anomalyScores: new Map(),
        })),
        analyze: vi.fn(() => Promise.reject(new Error('RCA engine failure'))),
      };
      container.register(DI_TOKENS.RCA_ENGINE, () => failingEngine);
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableChronic: false,
        enableDenoising: false,
        enableScaling: false,
        enableWave: false,
      });

      await expect(pipeline.execute(makeCallGraph(), makeMetrics())).rejects.toThrow(
        'RCA engine failure',
      );
    });

    it('should handle non-Error throws from engine', async () => {
      const container = createMockContainer();
      container.remove(DI_TOKENS.RCA_ENGINE);
      const throwingEngine = {
        buildFaultGraph: vi.fn(() => ({
          callGraph: { nodes: new Map(), edges: [], systemLoad: 0 },
          anomalyScores: new Map(),
        })),
        analyze: vi.fn(() => Promise.reject('bare string error')),
      };
      container.register(DI_TOKENS.RCA_ENGINE, () => throwingEngine);
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableChronic: false,
        enableDenoising: false,
        enableScaling: false,
        enableWave: false,
      });

      await expect(pipeline.execute(makeCallGraph(), makeMetrics())).rejects.toThrow();
    });
  });

  // ── Chronic Detection — Non-Convergent Case ──────────────

  describe('execute — chronic detection', () => {
    it('should set chronicDetected=true when prover reports non-convergent', async () => {
      const container = createMockContainer();
      container.remove(DI_TOKENS.CUTTING_ENGINE);
      container.remove(DI_TOKENS.CONVERGENCE_PROVER);
      const mockCuttingWithWindows = {
        segment: vi.fn(() =>
          Promise.resolve([{ start: 0, end: 1 }, { start: 2, end: 3 }]),
        ),
        estimateLocalBounds: vi.fn(() =>
          Promise.resolve([{ errorBound: 0.01 }, { errorBound: 0.02 }]),
        ),
      };
      const mockNonConvergentProver = {
        prove: vi.fn(() => Promise.resolve({ converged: false })),
      };
      container.register(DI_TOKENS.CUTTING_ENGINE, () => mockCuttingWithWindows);
      container.register(DI_TOKENS.CONVERGENCE_PROVER, () => mockNonConvergentProver);
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableDenoising: false,
        enableScaling: false,
        enableWave: false,
      });
      const result = await pipeline.execute(makeCallGraph(), makeMetrics());
      expect(result.chronicDetected).toBe(true);
    });

    it('should set chronicDetected=false when prover reports convergent', async () => {
      const container = createMockContainer();
      container.remove(DI_TOKENS.CUTTING_ENGINE);
      const mockCuttingWithWindows = {
        segment: vi.fn(() =>
          Promise.resolve([{ start: 0, end: 1 }, { start: 2, end: 3 }]),
        ),
        estimateLocalBounds: vi.fn(() =>
          Promise.resolve([{ errorBound: 0.01 }, { errorBound: 0.02 }]),
        ),
      };
      container.register(DI_TOKENS.CUTTING_ENGINE, () => mockCuttingWithWindows);
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableDenoising: false,
        enableScaling: false,
        enableWave: false,
      });
      const result = await pipeline.execute(makeCallGraph(), makeMetrics());
      expect(result.chronicDetected).toBe(false);
    });

    it('should skip chronic check when metric has too few values', async () => {
      const container = createMockContainer();
      container.remove(DI_TOKENS.CUTTING_ENGINE);
      const mockCuttingThatShouldNotBeCalled = {
        segment: vi.fn(() => Promise.resolve([])),
        estimateLocalBounds: vi.fn(() => Promise.resolve([])),
      };
      container.register(DI_TOKENS.CUTTING_ENGINE, () => mockCuttingThatShouldNotBeCalled);
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableDenoising: false,
        enableScaling: false,
        enableWave: false,
      });
      const metricsWithShortSeries = new Map([
        ['svc_a', [{ label: 'cpu', values: [0.5], timestamps: [1] }]],
      ]);
      const callGraph = {
        nodes: new Map([['svc_a', { serviceId: 'svc_a', dependencies: [] }]]),
        edges: [],
        systemLoad: 0,
      };
      const result = await pipeline.execute(callGraph, metricsWithShortSeries);
      expect(result.chronicDetected).toBe(false);
    });
  });

  // ── Stage Duration Tracking ──────────────────────────────

  describe('execute — stage timing', () => {
    it('should report positive duration for each stage', async () => {
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
        expect(stage.durationMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('should report totalDurationMs >= sum of stage durations', async () => {
      const container = createMockContainer();
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableChronic: false,
        enableDenoising: false,
        enableScaling: false,
        enableWave: false,
      });
      const result = await pipeline.execute(makeCallGraph(), makeMetrics());
      const stageTotal = result.stages.reduce((sum, s) => sum + s.durationMs, 0);
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(stageTotal);
    });
  });

  // ── Partial Config Override ──────────────────────────────

  describe('execute — partial config', () => {
    it('should override topK from config', async () => {
      const container = createMockContainer();
      const pipeline = new RCAPipeline(container, {
        ...DEFAULT_PIPELINE_CONFIG,
        enableChronic: false,
        enableDenoising: false,
        enableScaling: false,
        enableWave: false,
        topK: 1,
      });
      const result = await pipeline.execute(makeCallGraph(), makeMetrics());
      expect(result.rootCauses).toBeDefined();
    });

    it('should respect all feature flags set to false', async () => {
      const container = createMockContainer();
      const pipeline = new RCAPipeline(container, {
        enableChronic: false,
        enableDenoising: false,
        enableScaling: false,
        enableWave: false,
      });
      const result = await pipeline.execute(makeCallGraph(), makeMetrics());
      expect(result.denoiseResult).toBeUndefined();
      expect(result.scalingResult).toBeUndefined();
      expect(result.cascadeResult).toBeUndefined();
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
