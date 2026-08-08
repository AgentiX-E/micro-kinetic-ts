import { describe, it, expect } from 'vitest';
import {
  WeightCalibrator,
  DEFAULT_FUSION_WEIGHTS,
  DEFAULT_COLLISION_BOOSTS,
  DEFAULT_CALIBRATOR_CONFIG,
} from '@agentix-e/micro-kinetic';
import type { TrainingExample, CalibratedWeights } from '@agentix-e/micro-kinetic';

// ── Helpers ───────────────────────────────────────────────

function makeExample(overrides: Partial<TrainingExample> = {}): TrainingExample {
  return {
    predictedService: 'svc-b',
    groundTruthService: overrides.isCorrect ? 'svc-b' : 'svc-a',
    faultType: 'CPU_HOG',
    predictedConfidence: 0.7,
    collisionType: 'chain',
    isCorrect: false,
    ...overrides,
  };
}

function sumFusion(f: CalibratedWeights['fusion']): number {
  return f.collision + f.anomaly + f.topology;
}

// ── Tests ─────────────────────────────────────────────────

describe('WeightCalibrator', () => {
  // ── Initialization ───────────────────────────────────

  describe('initialization', () => {
    it('creates with default weights', () => {
      const c = new WeightCalibrator();
      const w = c.getWeights();

      // Fusion weights should sum to 1 (softmax normalized)
      expect(sumFusion(w.fusion)).toBeCloseTo(1, 10);
      expect(w.fusion.collision).toBeCloseTo(1 / 3, 5);
      expect(w.fusion.anomaly).toBeCloseTo(1 / 3, 5);
      expect(w.fusion.topology).toBeCloseTo(1 / 3, 5);

      // Default collision boosts
      expect(w.collisionBoosts.cycle).toBe(1.5);
      expect(w.collisionBoosts.bottleneck).toBe(1.3);
      expect(w.collisionBoosts.fanIn).toBe(1.1);
      expect(w.collisionBoosts.chain).toBe(1.0);

      // Meta
      expect(w.meta.iterations).toBe(0);
      expect(w.meta.learningRate).toBe(DEFAULT_CALIBRATOR_CONFIG.learningRate);
      expect(w.meta.avgLoss).toBe(0);
      expect(w.meta.converged).toBe(false);
    });

    it('accepts custom config', () => {
      const c = new WeightCalibrator({ learningRate: 0.05, lrDecay: 0.95 });
      const w = c.getWeights();
      expect(w.meta.learningRate).toBe(0.05);
    });

    it('returns independent snapshot on each call', () => {
      const c = new WeightCalibrator();
      const w1 = c.getWeights();
      const w2 = c.getWeights();

      expect(w1).not.toBe(w2); // Different objects
      expect(w1.fusion).not.toBe(w2.fusion); // Independent copies
    });

    it('setWeights overwrites fusion and boosts but not meta', () => {
      const c = new WeightCalibrator();
      // First run some training to accumulate iterations
      c.train([makeExample({ isCorrect: true })]);
      expect(c.getWeights().meta.iterations).toBe(1);

      const customWeights: CalibratedWeights = {
        fusion: { collision: 0.5, anomaly: 0.3, topology: 0.2 },
        collisionBoosts: { cycle: 2.0, bottleneck: 1.5, fanIn: 1.2, chain: 0.8 },
        meta: { iterations: 999, learningRate: 0.5, avgLoss: 0.9, converged: true },
      };

      c.setWeights(customWeights);
      const w = c.getWeights();

      // Fusion and boosts changed
      expect(w.fusion.collision).toBe(0.5);
      expect(w.fusion.anomaly).toBe(0.3);
      expect(w.fusion.topology).toBe(0.2);
      expect(w.collisionBoosts.cycle).toBe(2.0);

      // Meta preserved from training (not overwritten by setWeights)
      expect(w.meta.iterations).toBe(1);
    });
  });

  // ── Training: basic gradient descent ──────────────────

  describe('train — basic gradient descent', () => {
    it('returns unchanged weights for empty batch', () => {
      const c = new WeightCalibrator();
      const before = c.getWeights();
      const after = c.train([]);
      expect(after.fusion).toEqual(before.fusion);
      expect(after.meta.iterations).toBe(0);
    });

    it('increases collision weight when prediction is correct', () => {
      const c = new WeightCalibrator({ learningRate: 0.1 });

      // All correct predictions → collision weight should increase
      const examples = Array.from({ length: 10 }, () =>
        makeExample({ isCorrect: true, collisionType: 'chain' }),
      );

      const w = c.train(examples);

      // Collision weight should increase (correct predictions reinforce it)
      expect(w.fusion.collision).toBeGreaterThan(DEFAULT_FUSION_WEIGHTS.collision);
      // Fusion still sums to 1
      expect(sumFusion(w.fusion)).toBeCloseTo(1, 10);
    });

    it('decreases collision weight when predictions are wrong', () => {
      const c = new WeightCalibrator({ learningRate: 0.1 });

      // All wrong predictions → collision weight should decrease
      const examples = Array.from({ length: 10 }, () =>
        makeExample({ isCorrect: false, collisionType: 'chain' }),
      );

      const w = c.train(examples);

      expect(w.fusion.collision).toBeLessThan(DEFAULT_FUSION_WEIGHTS.collision);
      expect(sumFusion(w.fusion)).toBeCloseTo(1, 10);
    });

    it('weights remain in valid range [0.05, 1] after many iterations', () => {
      const c = new WeightCalibrator({ learningRate: 0.5, lrDecay: 0.99 });
      const examples = Array.from({ length: 50 }, () =>
        makeExample({ isCorrect: Math.random() > 0.5 ? true : false }),
      );

      for (let i = 0; i < 20; i++) {
        c.train(examples);
      }

      const w = c.getWeights();
      expect(w.fusion.collision).toBeGreaterThanOrEqual(0.05);
      expect(w.fusion.anomaly).toBeGreaterThanOrEqual(0.05);
      expect(w.fusion.topology).toBeGreaterThanOrEqual(0.05);
      expect(w.fusion.collision).toBeLessThanOrEqual(1);
      expect(w.fusion.anomaly).toBeLessThanOrEqual(1);
      expect(w.fusion.topology).toBeLessThanOrEqual(1);
    });
  });

  // ── Training: collision type boosts ───────────────────

  describe('train — collision type boosts', () => {
    it('reduces cycle boost when cycle predictions are wrong', () => {
      const c = new WeightCalibrator({ learningRate: 0.2 });

      const examples = Array.from({ length: 20 }, () =>
        makeExample({ isCorrect: false, collisionType: 'cycle' }),
      );

      const w = c.train(examples);

      // Cycle boost should decrease (wrong predictions)
      expect(w.collisionBoosts.cycle).toBeLessThan(
        DEFAULT_COLLISION_BOOSTS.cycle,
      );
    });

    it('increases cycle boost when cycle predictions are correct', () => {
      const c = new WeightCalibrator({ learningRate: 0.2 });

      const examples = Array.from({ length: 20 }, () =>
        makeExample({ isCorrect: true, collisionType: 'cycle' }),
      );

      const w = c.train(examples);

      // Cycle boost should increase (correct predictions reinforce it)
      expect(w.collisionBoosts.cycle).toBeGreaterThan(
        DEFAULT_COLLISION_BOOSTS.cycle,
      );
    });

    it('boosts stay in valid range [0.5, 3.0]', () => {
      const c = new WeightCalibrator({ learningRate: 0.5 });
      const examples = Array.from({ length: 30 }, (_, i) =>
        makeExample({
          isCorrect: i % 2 === 0,
          collisionType: i % 4 === 0 ? 'cycle' : i % 4 === 1 ? 'bottleneck' : i % 4 === 2 ? 'fanIn' : 'chain',
        }),
      );

      for (let i = 0; i < 20; i++) {
        c.train(examples);
      }

      const w = c.getWeights();
      expect(w.collisionBoosts.cycle).toBeGreaterThanOrEqual(0.5);
      expect(w.collisionBoosts.cycle).toBeLessThanOrEqual(3.0);
      expect(w.collisionBoosts.bottleneck).toBeGreaterThanOrEqual(0.5);
      expect(w.collisionBoosts.bottleneck).toBeLessThanOrEqual(3.0);
      expect(w.collisionBoosts.fanIn).toBeGreaterThanOrEqual(0.5);
      expect(w.collisionBoosts.fanIn).toBeLessThanOrEqual(3.0);
      expect(w.collisionBoosts.chain).toBeGreaterThanOrEqual(0.5);
      expect(w.collisionBoosts.chain).toBeLessThanOrEqual(3.0);
    });

    it('does not crash when collisionType is undefined', () => {
      const c = new WeightCalibrator();
      const examples = Array.from({ length: 10 }, () =>
        makeExample({ collisionType: undefined }),
      );

      const w = c.train(examples);
      expect(w.collisionBoosts.cycle).toBe(DEFAULT_COLLISION_BOOSTS.cycle);
    });
  });

  // ── Meta: convergence & learning rate ─────────────────

  describe('meta — convergence & learning rate', () => {
    it('increments iterations count', () => {
      const c = new WeightCalibrator();
      expect(c.getWeights().meta.iterations).toBe(0);

      c.train([makeExample()]);
      expect(c.getWeights().meta.iterations).toBe(1);

      c.train([makeExample(), makeExample()]);
      expect(c.getWeights().meta.iterations).toBe(2);
    });

    it('updates average loss', () => {
      const c = new WeightCalibrator({ lossSmoothing: 0.5 });

      // First training sets initial loss
      c.train([makeExample({ isCorrect: true, predictedConfidence: 0.9 })]);
      const w1 = c.getWeights();
      expect(w1.meta.avgLoss).toBeGreaterThan(0);

      // Second training smooths
      c.train([makeExample({ isCorrect: false, predictedConfidence: 0.9 })]);
      const w2 = c.getWeights();
      // Loss should change after incorrect prediction
      expect(w2.meta.avgLoss).not.toBe(w1.meta.avgLoss);
    });

    it('decays learning rate over iterations', () => {
      const c = new WeightCalibrator({ learningRate: 0.1, lrDecay: 0.9 });
      const initialLR = c.getWeights().meta.learningRate;

      const examples = [makeExample()];
      for (let i = 0; i < 10; i++) {
        c.train(examples);
      }

      const finalLR = c.getWeights().meta.learningRate;
      expect(finalLR).toBeLessThan(initialLR);
      expect(finalLR).toBeGreaterThanOrEqual(DEFAULT_CALIBRATOR_CONFIG.minLearningRate);
    });

    it('does not decay below minLearningRate', () => {
      const c = new WeightCalibrator({
        learningRate: 0.01,
        lrDecay: 0.5,
        minLearningRate: 0.005,
      });

      const examples = [makeExample()];
      for (let i = 0; i < 50; i++) {
        c.train(examples);
      }

      expect(c.getWeights().meta.learningRate).toBeGreaterThanOrEqual(0.005);
    });

    it('detects convergence after many iterations with small gradients', () => {
      const c = new WeightCalibrator({
        learningRate: 0.001,
        convergenceThreshold: 1.0, // Large threshold for easy convergence
      });

      const examples = [makeExample({ isCorrect: true, predictedConfidence: 0.99 })];

      for (let i = 0; i < 10; i++) {
        c.train(examples);
      }

      // With high confidence correct predictions and high threshold, should converge
      expect(c.getWeights().meta.converged).toBe(true);
    });
  });

  // ── Per-fault-type specialization ─────────────────────

  describe('per-fault-type specialization', () => {
    it('amplifies corrections for poorly-performing fault types', () => {
      const c = new WeightCalibrator({ learningRate: 0.1 });

      // CPU_HOG has very poor accuracy (0.2)
      const perFaultType = new Map([['CPU_HOG', 0.2]]);

      const examples = Array.from({ length: 10 }, () =>
        makeExample({ isCorrect: false, faultType: 'CPU_HOG' }),
      );

      const wNoFT = new WeightCalibrator({ learningRate: 0.1 });
      wNoFT.train(examples); // No per-fault-type info

      const wWithFT = c.train(examples, perFaultType);

      // With per-fault-type amplification, weights should change more
      // (the amplify factor for accuracy=0.2 is 1+0.3=1.3)
      const noFTChange = Math.abs(
        wNoFT.fusion.collision - DEFAULT_FUSION_WEIGHTS.collision,
      );
      const ftChange = Math.abs(
        wWithFT.fusion.collision - DEFAULT_FUSION_WEIGHTS.collision,
      );
      expect(ftChange).toBeGreaterThan(noFTChange);
    });

    it('handles per-fault-type with high accuracy (no amplification)', () => {
      const c = new WeightCalibrator({ learningRate: 0.1 });
      const perFaultType = new Map([['CPU_HOG', 0.9]]); // High accuracy

      const examples = [makeExample({ isCorrect: true, faultType: 'CPU_HOG' })];
      const w = c.train(examples, perFaultType);

      // With high accuracy (0.9 > 0.5), no amplification, just normal gradient
      expect(sumFusion(w.fusion)).toBeCloseTo(1, 10);
    });
  });

  // ── Persistence ───────────────────────────────────────

  describe('persistence (toJSON / fromJSON)', () => {
    it('serializes and deserializes weights', () => {
      const c = new WeightCalibrator();

      // Train to get non-default weights
      const examples = Array.from({ length: 15 }, (_, i) =>
        makeExample({
          isCorrect: i % 3 === 0,
          collisionType: i % 4 === 0 ? 'cycle' : i % 4 === 1 ? 'bottleneck' : i % 4 === 2 ? 'fanIn' : 'chain',
          faultType: i % 2 === 0 ? 'CPU_HOG' : 'MEM_LEAK',
        }),
      );
      c.train(examples);

      const json = c.toJSON();
      expect(json).toBeTypeOf('string');
      expect(JSON.parse(json)).toBeTruthy();

      const restored = WeightCalibrator.fromJSON(json);
      expect(restored).not.toBeNull();

      const originalW = c.getWeights();
      const restoredW = restored!.getWeights();

      // Weights preserved (meta not persisted via setWeights — expected)
      expect(restoredW.fusion.collision).toBeCloseTo(originalW.fusion.collision, 10);
      expect(restoredW.fusion.anomaly).toBeCloseTo(originalW.fusion.anomaly, 10);
      expect(restoredW.fusion.topology).toBeCloseTo(originalW.fusion.topology, 10);
      expect(restoredW.collisionBoosts.cycle).toBeCloseTo(originalW.collisionBoosts.cycle, 10);
      expect(restoredW.collisionBoosts.bottleneck).toBeCloseTo(originalW.collisionBoosts.bottleneck, 10);
    });

    it('returns null for malformed JSON', () => {
      expect(WeightCalibrator.fromJSON('not json')).toBeNull();
      expect(WeightCalibrator.fromJSON('{}')).toBeNull();
      expect(WeightCalibrator.fromJSON('{"fusion": null}')).toBeNull();
    });

    it('returns null for empty string', () => {
      expect(WeightCalibrator.fromJSON('')).toBeNull();
    });

    it('restored calibrator can continue training', () => {
      const c = new WeightCalibrator({ learningRate: 0.1 });
      c.train([makeExample({ isCorrect: true })]);
      const json = c.toJSON();

      const restored = WeightCalibrator.fromJSON(json)!;
      // Continue training on the restored calibrator
      restored.train([makeExample({ isCorrect: false })]);

      expect(restored.getWeights().meta.iterations).toBe(1);
    });
  });

  // ── Reset ─────────────────────────────────────────────

  describe('reset', () => {
    it('restores default weights', () => {
      const c = new WeightCalibrator();

      // Modify weights heavily
      const examples = Array.from({ length: 30 }, () =>
        makeExample({ isCorrect: false, collisionType: 'cycle' }),
      );
      c.train(examples);

      // Verify weights changed
      expect(c.getWeights().fusion.collision).not.toBe(DEFAULT_FUSION_WEIGHTS.collision);

      c.reset();

      const w = c.getWeights();
      expect(w.fusion.collision).toBe(DEFAULT_FUSION_WEIGHTS.collision);
      expect(w.fusion.anomaly).toBe(DEFAULT_FUSION_WEIGHTS.anomaly);
      expect(w.fusion.topology).toBe(DEFAULT_FUSION_WEIGHTS.topology);
      expect(w.collisionBoosts.cycle).toBe(DEFAULT_COLLISION_BOOSTS.cycle);
      expect(w.meta.iterations).toBe(0);
      expect(w.meta.avgLoss).toBe(0);
      expect(w.meta.converged).toBe(false);
    });
  });
});
