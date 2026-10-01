/**
 * Pipeline Factory — scenario-based RCA pipeline assembly.
 *
 * Provides factory functions to create tailored pipelines for
 * different AIOps scenarios:
 *
 *   Scenario        Stages                                Use Case
 *   ─────────       ──────                                ────────
 *   'acute'         Tree RCA only                         Rapid incident triage
 *   'chronic'       Tree RCA + Cutting                    Memory leaks, slow degradation
 *   'alert-storm'   Tree RCA + Denoising                  High-volume alert floods
 *   'full'          All stages                            Comprehensive postmortem
 *
 * These presets optimize for both speed and accuracy by
 * only running the computationally relevant stages.
 *
 * @module pipeline/pipeline-factory
 */

import type { IContainer } from '@agentix-e/micro-kinetic-core';

import { DEFAULTS } from '../di/defaults.js';
import { RCAPipeline, type RCAPipelineConfig } from './rca-pipeline.js';

/** Pipeline scenario presets. */
export type PipelineScenario = 'acute' | 'chronic' | 'alert-storm' | 'full';

/** Result of pipeline factory creation. */
export interface PipelineFactoryResult {
  /** The constructed pipeline instance */
  readonly pipeline: RCAPipeline;
  /** Scenario that was applied */
  readonly scenario: PipelineScenario;
  /** Configuration used */
  readonly config: RCAPipelineConfig;
}

/**
 * Create a pipeline configured for a specific scenario.
 *
 * @param container - DI container with registered engines
 * @param scenario - Scenario preset to apply
 * @returns Configured pipeline instance
 *
 * @example
 * ```typescript
 * const container = createDefaultContainer();
 * const { pipeline } = createPipeline(container, 'acute');
 * const result = await pipeline.execute(callGraph, metrics);
 * ```
 */
export function createPipeline(
  container: IContainer,
  scenario: PipelineScenario = 'full',
): PipelineFactoryResult {
  const config = getScenarioConfig(scenario);
  const pipeline = new RCAPipeline(container, config);

  return { pipeline, scenario, config };
}

/**
 * Create an acute-only pipeline (Tree RCA only).
 *
 * Fastest variant — only runs collision tree RCA.
 * Suitable for real-time incident response with tight SLAs.
 */
export function createAcutePipeline(container: IContainer): PipelineFactoryResult {
  return createPipeline(container, 'acute');
}

/**
 * Create a chronic-detection pipeline (Tree RCA + Cutting).
 *
 * Runs tree RCA and then cutting analysis to detect slow-degrading
 * faults like memory leaks and connection pool exhaustion.
 */
export function createChronicPipeline(container: IContainer): PipelineFactoryResult {
  return createPipeline(container, 'chronic');
}

/**
 * Create an alert-storm pipeline (Tree RCA + Denoising).
 *
 * Runs tree RCA and then Stosszahlansatz-based denoising to
 * separate true alarms from coincidental noise in alert floods.
 */
export function createAlertStormPipeline(container: IContainer): PipelineFactoryResult {
  return createPipeline(container, 'alert-storm');
}

/**
 * Create a full pipeline (all stages).
 *
 * Most comprehensive analysis — runs all five computational stages.
 * Suitable for postmortems, root cause verification, and benchmarking.
 */
export function createFullPipeline(container: IContainer): PipelineFactoryResult {
  return createPipeline(container, 'full');
}

// ── Scenario Configuration ────────────────────────────────

/**
 * Get the pipeline configuration for a given scenario.
 */
function getScenarioConfig(scenario: PipelineScenario): RCAPipelineConfig {
  const base: RCAPipelineConfig = {
    pruneEpsilon: DEFAULTS.PRUNE_EPSILON,
    criticalLoadThreshold: DEFAULTS.CRITICAL_LOAD_THRESHOLD,
    topK: DEFAULTS.DEFAULT_TOP_K,
    maxPropagationDepth: DEFAULTS.MAX_PROPAGATION_DEPTH,
    enableChronic: false,
    enableDenoising: false,
    enableScaling: false,
    enableWave: false,
  };

  switch (scenario) {
    case 'acute':
      // Tree RCA only — nothing else enabled
      return { ...base };

    case 'chronic':
      return {
        ...base,
        enableChronic: true,
        topK: 3,
        maxPropagationDepth: 20,
      };

    case 'alert-storm':
      return {
        ...base,
        enableDenoising: true,
      };

    case 'full':
      return {
        ...base,
        enableChronic: true,
        enableDenoising: true,
        enableScaling: true,
        enableWave: true,
      };
  }
}
