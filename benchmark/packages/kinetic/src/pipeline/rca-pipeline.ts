/**
 * Full RCA Pipeline — orchestrates all 6 engines in sequence.
 *
 * This module implements the complete AIOps-Kinetic analysis pipeline,
 * routing data through all kinetic theory computation stages:
 *
 *   ServiceGraph + Metrics
 *        │
 *   ┌────▼─────────────────────────────────┐
 *   │  1. Tree RCA (collision tree pruning) │
 *   │     → Root cause candidates            │
 *   └────┬─────────────────────────────────┘
 *        │
 *   ┌────▼─────────────────────────────────┐
 *   │  2. Cutting Analysis (chronic check)  │
 *   │     → If chronic → convergence proof   │
 *   └────┬─────────────────────────────────┘
 *        │
 *   ┌────▼─────────────────────────────────┐
 *   │  3. Alert Denoising (Stosszahlansatz) │
 *   │     → True alarms vs coincidental      │
 *   └────┬─────────────────────────────────┘
 *        │
 *   ┌────▼─────────────────────────────────┐
 *   │  4. Scaling Analysis (BBGKY + BG)      │
 *   │     → Fault probability asymptotics     │
 *   └────┬─────────────────────────────────┘
 *        │
 *   ┌────▼─────────────────────────────────┐
 *   │  5. Wave Simulation (cascade prop.)    │
 *   │     → Alert propagation trajectories    │
 *   └────┬─────────────────────────────────┘
 *        │
 *   ┌────▼────┐
 *   │  Result  │
 *   └──────────┘
 *
 * === Deng Yu Kinetic Theory Flow ===
 *
 *   Collision Tree  →  Cutting Algorithm  →  Stosszahlansatz
 *        ↓                    ↓                     ↓
 *   Cycle Pruning    Convergent Segments    Alert Independence
 *
 *   BBGKY Hierarchy  →  Boltzmann-Grad  →  Wave Kinetics
 *        ↓                    ↓                  ↓
 *   k-Service Corr.    P_fault(N→∞)        Cascade Sim.
 *
 * @module pipeline/rca-pipeline
 */

import {
  DI_TOKENS,
  type AlertRecord,
  type BoltzmannGradResult,
  type CascadeResult,
  type DenoiseResult,
  type IContainer,
  type IConvergenceProver,
  type ICuttingEngine,
  type IDenoiseEngine,
  type IRCAEngine,
  type IScalingAnalyzer,
  type IWavePropagationModel,
  type MetricMap,
  type RootCauseResult,
  type ServiceCallGraph,
} from '@agentix-e/micro-kinetic-core';

import { DEFAULTS } from '../di/defaults.js';

// ── Pipeline Result Types ─────────────────────────────────

/** Individual stage result in the pipeline. */
export interface StageResult {
  /** Stage name for logging/diagnostics */
  readonly stage: string;
  /** Whether the stage completed successfully */
  readonly success: boolean;
  /** Execution time in milliseconds */
  readonly durationMs: number;
  /** Stage-specific result data */
  readonly data?: unknown;
  /** Error message if stage failed */
  readonly error?: string;
}

/** Complete RCA pipeline output. */
export interface RCAPipelineResult {
  /** Root cause analysis results (Stage 1) */
  readonly rootCauses: readonly RootCauseResult[];
  /** Whether chronic fault indicators were detected */
  readonly chronicDetected: boolean;
  /** Denoising result (if Stage 3 ran) */
  readonly denoiseResult?: DenoiseResult;
  /** Scaling analysis result (if Stage 4 ran) */
  readonly scalingResult?: BoltzmannGradResult;
  /** Cascade simulation result (if Stage 5 ran) */
  readonly cascadeResult?: CascadeResult;
  /** Per-stage execution timeline */
  readonly stages: readonly StageResult[];
  /** Total execution time in milliseconds */
  readonly totalDurationMs: number;
}

/** Configuration for the RCA pipeline. */
export interface RCAPipelineConfig {
  /** Prune epsilon for collision tree */
  readonly pruneEpsilon: number;
  /** Critical load threshold */
  readonly criticalLoadThreshold: number;
  /** Top-K root causes to return */
  readonly topK: number;
  /** Maximum propagation depth */
  readonly maxPropagationDepth: number;
  /** Whether chronic fault detection is enabled */
  readonly enableChronic: boolean;
  /** Whether alert denoising is enabled */
  readonly enableDenoising: boolean;
  /** Whether scaling analysis is enabled */
  readonly enableScaling: boolean;
  /** Whether wave simulation is enabled */
  readonly enableWave: boolean;
}

/** Default pipeline configuration. */
export const DEFAULT_PIPELINE_CONFIG: RCAPipelineConfig = {
  pruneEpsilon: DEFAULTS.PRUNE_EPSILON,
  criticalLoadThreshold: DEFAULTS.CRITICAL_LOAD_THRESHOLD,
  topK: DEFAULTS.DEFAULT_TOP_K,
  maxPropagationDepth: DEFAULTS.MAX_PROPAGATION_DEPTH,
  enableChronic: true,
  enableDenoising: true,
  enableScaling: true,
  enableWave: true,
};

// ── Pipeline Implementation ───────────────────────────────

/**
 * Full RCA Pipeline — orchestrates all analysis stages.
 *
 * Associates the DI token RCA_PIPELINE in the container.
 */
export class RCAPipeline {
  private readonly container: IContainer;
  private readonly config: RCAPipelineConfig;

  constructor(container: IContainer, config?: Partial<RCAPipelineConfig>) {
    this.container = container;
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };
  }

  /**
   * Execute the complete RCA pipeline.
   *
   * @param callGraph - Service call graph describing topology
   * @param metrics - Time-series metrics per service
   * @returns Complete pipeline result with all stage outputs
   */
  async execute(callGraph: ServiceCallGraph, metrics: MetricMap): Promise<RCAPipelineResult> {
    const startTime = Date.now();
    const stages: StageResult[] = [];

    // ── Stage 1: Tree RCA ────────────────────────────────
    const rcaEngine = this.container.resolve<IRCAEngine>(DI_TOKENS.RCA_ENGINE);
    const faultGraph = rcaEngine.buildFaultGraph(callGraph, metrics);
    const topK = this.config.topK;

    const rootCauses = await this.runStage(
      'Collision Tree RCA',
      async () => rcaEngine.analyze(faultGraph, topK),
      stages,
    );

    // ── Stage 2: Chronic Fault Detection ─────────────────
    let chronicDetected = false;
    if (this.config.enableChronic) {
      const cuttingEngine = this.container.resolve<ICuttingEngine>(DI_TOKENS.CUTTING_ENGINE);

      // Check if any metrics show chronic degradation patterns
      for (const [, serviceMetrics] of metrics) {
        for (const ts of serviceMetrics) {
          if (ts.values.length < 2) continue;

          const windows = await this.runStage(
            'Chronic Cutting (segmenting)',
            () => cuttingEngine.segment(ts),
            stages,
          );

          if (windows.length > 1) {
            const bounds = await this.runStage(
              'Chronic Cutting (bounds)',
              () => cuttingEngine.estimateLocalBounds(windows, ts.label),
              stages,
            );

            const prover = this.container.resolve<IConvergenceProver>(DI_TOKENS.CONVERGENCE_PROVER);
            const convergence = await this.runStage(
              'Convergence Proof',
              () =>
                prover.prove(
                  bounds.map((b) => b.errorBound),
                  this.config.pruneEpsilon,
                ),
              stages,
            );

            if (!convergence.converged) {
              chronicDetected = true;
            }
          }
        }
        if (chronicDetected) break;
      }
    }

    // ── Stage 3: Alert Denoising ─────────────────────────
    let denoiseResult: DenoiseResult | undefined;
    if (this.config.enableDenoising) {
      const denoiseEngine = this.container.resolve<IDenoiseEngine>(DI_TOKENS.DENOISE_ENGINE);
      denoiseResult = await this.runStage(
        'Stosszahlansatz Denoising',
        async () => {
          // MOCK: Construct alert records from anomaly signals and graph topology.
          // In production, alert records come from the monitoring system.
          const mockAlerts = this.buildMockAlerts(faultGraph, metrics);
          const coupling = denoiseEngine.computeCouplingSparsity(mockAlerts, callGraph);
          return denoiseEngine.denoise(mockAlerts, coupling);
        },
        stages,
      );
    }

    // ── Stage 4: Scaling Analysis ────────────────────────
    let scalingResult: BoltzmannGradResult | undefined;
    if (this.config.enableScaling) {
      const scalingAnalyzer = this.container.resolve<IScalingAnalyzer>(DI_TOKENS.SCALING_ANALYZER);

      scalingResult = await this.runStage(
        'BBGKY + Boltzmann-Grad Scaling',
        () => {
          return scalingAnalyzer.estimateFaultProbability(
            callGraph.nodes.size,
            0.1, // default impact radius
          );
        },
        stages,
      );
    }

    // ── Stage 5: Wave Simulation ─────────────────────────
    let cascadeResult: CascadeResult | undefined;
    if (this.config.enableWave && rootCauses.length > 0) {
      const waveModel = this.container.resolve<IWavePropagationModel>(
        DI_TOKENS.WAVE_PROPAGATION_MODEL,
      );

      const topCause = rootCauses[0];
      if (topCause) {
        cascadeResult = await this.runStage(
          'Wave Cascade Simulation',
          async () =>
            waveModel.simulateCascade(topCause.serviceId, callGraph, {
              couplingStrength: 0.5,
              propagationSpeed: 1.0,
              decayTimeConstant: DEFAULTS.WAVE_DECAY_TIME_CONSTANT,
              cascadeThreshold: DEFAULTS.WAVE_CASCADE_THRESHOLD,
              timeHorizon: DEFAULTS.WAVE_DECAY_TIME_CONSTANT * 5,
            }),
          stages,
        );
      }
    }

    const totalDurationMs = Date.now() - startTime;

    return {
      rootCauses,
      chronicDetected,
      denoiseResult,
      scalingResult,
      cascadeResult,
      stages,
      totalDurationMs,
    };
  }

  // ── Helpers ─────────────────────────────────────────────

  /**
   * Run a pipeline stage, timing its execution.
   */
  private async runStage<T>(
    stage: string,
    fn: () => T | Promise<T>,
    stages: StageResult[],
  ): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      stages.push({
        stage,
        success: true,
        durationMs: Date.now() - start,
        data: result,
      });
      return result;
    } catch (err) {
      stages.push({
        stage,
        success: false,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /**
   * Build mock alert records from fault graph structure.
   * In production, real alert records would be passed in.
   */
  private buildMockAlerts(_faultGraph: unknown, _metrics: MetricMap): AlertRecord[] {
    return [];
  }
}

/**
 * Factory function to create the RCA Pipeline DI registration.
 *
 * Registers RCAPipeline as a singleton under DI_TOKENS.RCA_PIPELINE.
 *
 * @param container - DI container to register into
 */
export function registerRCAPipeline(container: IContainer): void {
  container.register(DI_TOKENS.RCA_PIPELINE, (c) => new RCAPipeline(c));
}
