import { describe, it, expect } from 'vitest';
import {
  createPipeline,
  createAcutePipeline,
  createChronicPipeline,
  createAlertStormPipeline,
  createFullPipeline,
} from '../../../src/pipeline/pipeline-factory.js';
import { Container } from '@agentix-e/micro-kinetic-core';

describe('PipelineFactory', () => {
  let container: Container;

  beforeEach(() => {
    container = new Container();
    // Register minimal required tokens
    container.register(Symbol.for('micro-kinetic:RCAEngine'), () => ({ analyze: () => [] }), false);
    container.register(Symbol.for('micro-kinetic:CuttingEngine'), () => ({ segment: () => [], estimateLocalBounds: () => [] }), false);
    container.register(Symbol.for('micro-kinetic:ConvergenceProver'), () => ({ prove: () => ({ converged: true }) }), false);
    container.register(Symbol.for('micro-kinetic:DenoiseEngine'), () => ({ computeCouplingSparsity: () => ({}), denoise: () => ({}) }), false);
    container.register(Symbol.for('micro-kinetic:ScalingAnalyzer'), () => ({ estimateFaultProbability: () => ({}) }), false);
    container.register(Symbol.for('micro-kinetic:WavePropagationModel'), () => ({ simulateCascade: () => ({}) }), false);
  });

  describe('createPipeline', () => {
    it('should create pipeline for acute scenario', () => {
      const result = createPipeline(container, 'acute');
      expect(result.pipeline).toBeDefined();
      expect(result.scenario).toBe('acute');
    });

    it('should create pipeline for chronic scenario', () => {
      const result = createPipeline(container, 'chronic');
      expect(result.pipeline).toBeDefined();
      expect(result.scenario).toBe('chronic');
    });

    it('should create pipeline for alert-storm scenario', () => {
      const result = createPipeline(container, 'alert-storm');
      expect(result.pipeline).toBeDefined();
      expect(result.scenario).toBe('alert-storm');
    });

    it('should create pipeline for full scenario', () => {
      const result = createPipeline(container, 'full');
      expect(result.pipeline).toBeDefined();
      expect(result.scenario).toBe('full');
    });

    it('should include config in result', () => {
      const result = createPipeline(container, 'acute');
      expect(result.config).toBeDefined();
      expect(result.config.pruneEpsilon).toBeDefined();
    });

    it('should disable non-RCA stages for acute scenario', () => {
      const result = createPipeline(container, 'acute');
      expect(result.config.enableChronic).toBe(false);
      expect(result.config.enableDenoising).toBe(false);
    });

    it('should enable all stages for full scenario', () => {
      const result = createPipeline(container, 'full');
      expect(result.config.enableChronic).toBe(true);
      expect(result.config.enableDenoising).toBe(true);
      expect(result.config.enableScaling).toBe(true);
      expect(result.config.enableWave).toBe(true);
    });
  });

  describe('createAcutePipeline', () => {
    it('should create acute pipeline', () => {
      const result = createAcutePipeline(container);
      expect(result.scenario).toBe('acute');
    });
  });

  describe('createChronicPipeline', () => {
    it('should create chronic pipeline', () => {
      const result = createChronicPipeline(container);
      expect(result.scenario).toBe('chronic');
    });
  });

  describe('createAlertStormPipeline', () => {
    it('should create alert-storm pipeline', () => {
      const result = createAlertStormPipeline(container);
      expect(result.scenario).toBe('alert-storm');
    });
  });

  describe('createFullPipeline', () => {
    it('should create full pipeline', () => {
      const result = createFullPipeline(container);
      expect(result.scenario).toBe('full');
    });
  });
});
