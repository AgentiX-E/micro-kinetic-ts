/**
 * Weight Calibrator — Online gradient descent on RCA fusion weights.
 *
 * After each benchmark run, compares predictions to ground truth and applies
 * gradient updates to multi-signal fusion weights, depth bonus sensitivity,
 * and collision type boost factors. This closes the feedback loop between
 * RCA predictions and real outcomes.
 *
 * ### Deng Yu Collision Tree Mapping
 *
 * Each (prediction, ground truth) pair is a "learning collision" — the
 * model's current state interacts with the observed truth, transferring
 * kinetic correction energy from the error gradient into the weight space.
 * Over successive collisions, the system relaxes toward equilibrium:
 * the weight configuration that minimizes prediction error.
 *
 * ### Learning Algorithm
 *
 * Uses stochastic gradient descent (SGD) on cross-entropy loss:
 *   L = -∑ truth_logit(pred, service) for Top-1 correct
 *   ∂L/∂wᵢ = ∂L/∂score × ∂score/∂wᵢ
 *
 * The gradient is computed per-fault-type, enabling specialized learning:
 * CPU hog failures may require different signal weights than memory leaks.
 *
 * ### Weight Space
 *
 * Two independent weight vectors are optimized:
 * 1. **Fusion weights**: [α_collision, β_anomaly, γ_topology]
 *    Controls how much each signal contributes to the final RCA score.
 * 2. **Collision type boosts**: [b_cycle, b_bottleneck, b_fanIn, b_chain]
 *    Controls how much extra weight collision tree topology types receive.
 *
 * @module signals/weight-calibrator
 */

// ── Types ─────────────────────────────────────────────────

/** The two optimized weight spaces. */
export interface CalibratedWeights {
  /**
   * Multi-signal fusion weights (softmax-normalized to sum=1).
   * α: collision energy weight (kinetic)
   * β: anomaly score weight (thermodynamic)
   * θ: topology structure weight (structural)
   */
  readonly fusion: {
    readonly collision: number;
    readonly anomaly: number;
    readonly topology: number;
  };
  /**
   * Per-collision-type boost multipliers.
   * Applied as score multiplier based on node's collision topology role.
   */
  readonly collisionBoosts: {
    readonly cycle: number;
    readonly bottleneck: number;
    readonly fanIn: number;
    readonly chain: number;
  };
  /** Learning metadata. */
  readonly meta: {
    /** Number of gradient updates applied. */
    readonly iterations: number;
    /** Current learning rate. */
    readonly learningRate: number;
    /** Average recent loss (smoothed). */
    readonly avgLoss: number;
    /** Whether learning has converged (gradient norms < threshold). */
    readonly converged: boolean;
  };
}

/** A single training example: prediction result vs ground truth. */
export interface TrainingExample {
  /** Predicted top-1 service ID. */
  readonly predictedService: string;
  /** Ground truth service ID. */
  readonly groundTruthService: string;
  /** Fault type (for per-type specialization). */
  readonly faultType: string;
  /** Raw prediction confidence. */
  readonly predictedConfidence: number;
  /** Collision type of the predicted node (if any). */
  readonly collisionType?: 'cycle' | 'bottleneck' | 'fanIn' | 'chain';
  /** Whether the prediction was correct. */
  readonly isCorrect: boolean;
}

/** Calibrator configuration. */
export interface WeightCalibratorConfig {
  /** Initial learning rate. Default: 0.01. */
  readonly learningRate: number;
  /** Learning rate decay factor per iteration. Default: 0.99. */
  readonly lrDecay: number;
  /** Minimum learning rate floor. Default: 0.001. */
  readonly minLearningRate: number;
  /** Gradient norm threshold for convergence. Default: 0.001. */
  readonly convergenceThreshold: number;
  /** EMA smoothing factor for loss tracking. Default: 0.1. */
  readonly lossSmoothing: number;
  /** Softmax temperature for weight normalization. Default: 1.0. */
  readonly temperature: number;
}

export const DEFAULT_CALIBRATOR_CONFIG: WeightCalibratorConfig = {
  learningRate: 0.01,
  lrDecay: 0.99,
  minLearningRate: 0.001,
  convergenceThreshold: 0.001,
  lossSmoothing: 0.1,
  temperature: 1.0,
};

/** Default fusion weights (equal, unbiased). */
export const DEFAULT_FUSION_WEIGHTS: CalibratedWeights['fusion'] = {
  collision: 1 / 3,
  anomaly: 1 / 3,
  topology: 1 / 3,
};

/** Default collision type boosts (unbiased). */
export const DEFAULT_COLLISION_BOOSTS: CalibratedWeights['collisionBoosts'] = {
  cycle: 1.5,
  bottleneck: 1.3,
  fanIn: 1.1,
  chain: 1.0,
};

// ── Weight Calibrator ─────────────────────────────────────

/**
 * Online weight calibrator using stochastic gradient descent.
 *
 * Call `train()` after each benchmark run to update weights based
 * on prediction accuracy.
 */
export class WeightCalibrator {
  private fusion: { collision: number; anomaly: number; topology: number };
  private boosts: { cycle: number; bottleneck: number; fanIn: number; chain: number };
  private lr: number;
  private iterations: number;
  private avgLoss: number;
  private converged: boolean;
  private readonly config: WeightCalibratorConfig;

  constructor(config: Partial<WeightCalibratorConfig> = {}) {
    this.config = { ...DEFAULT_CALIBRATOR_CONFIG, ...config };
    this.fusion = { ...DEFAULT_FUSION_WEIGHTS };
    this.boosts = { ...DEFAULT_COLLISION_BOOSTS };
    this.lr = this.config.learningRate;
    this.iterations = 0;
    this.avgLoss = 0;
    this.converged = false;
  }

  /**
   * Current calibrated weights (snapshot).
   */
  getWeights(): CalibratedWeights {
    return {
      fusion: { ...this.fusion },
      collisionBoosts: { ...this.boosts },
      meta: {
        iterations: this.iterations,
        learningRate: this.lr,
        avgLoss: this.avgLoss,
        converged: this.converged,
      },
    };
  }

  /**
   * Load pre-calibrated weights (warm-start).
   */
  setWeights(weights: CalibratedWeights): void {
    this.fusion = { ...weights.fusion };
    this.boosts = { ...weights.collisionBoosts };
    // Don't overwrite meta — training continues from where it left off
  }

  // ── Core: Gradient Descent Step ────────────────────────

  /**
   * Train on a batch of (prediction, ground truth) examples.
   *
   * For each example, computes the gradient of the loss w.r.t. weights
   * and applies a stochastic gradient descent update. Done per example
   * to handle varied fault types.
   *
   * @param examples - Training examples from the benchmark run.
   * @param perFaultType - Optional per-fault-type accuracy for specialized learning.
   * @returns Updated weights.
   */
  train(
    examples: readonly TrainingExample[],
    perFaultType?: ReadonlyMap<string, number>,
  ): CalibratedWeights {
    if (examples.length === 0) return this.getWeights();

    const totalGradW = { collision: 0, anomaly: 0, topology: 0 };
    const totalGradB = { cycle: 0, bottleneck: 0, fanIn: 0, chain: 0 };
    let totalLoss = 0;

    for (const ex of examples) {
      // ── Loss: cross-entropy for correctness ──────
      // L = -isCorrect * log(confidence + ε) - (1-isCorrect) * log(1-confidence + ε)
      const eps = 1e-7;
      const c = Math.min(1 - eps, Math.max(eps, ex.predictedConfidence));
      const loss = ex.isCorrect ? -Math.log(c) : -Math.log(1 - c);
      totalLoss += loss;

      // ── Fusion weight gradient ───────────────────
      // ∂L/∂w_collision ∝ -∂L/∂score for collision signal
      // Using sigmoid-style gradient: gradient * (1 - weight)
      const correctnessSignal = ex.isCorrect ? 1 : -1;

      // Gradient direction: w_new = w - lr * grad
      // For correct predictions (reinforcement): want collision_w to increase → grad < 0
      // For incorrect (penalize): want collision_w to decrease → grad > 0
      // So: grad = -correctnessSignal * (1-w_collision) * loss
      const gradSign = -correctnessSignal;

      // Only apply gradient to collision weight directly.
      // Anomaly and topology adjust passively via softmax re-normalization
      // (they split the remainder). This prevents symmetric cancellation
      // when all three weights get equal gradient magnitudes.
      totalGradW.collision += gradSign * (1 - this.fusion.collision) * loss;

      // ── Collision boost gradient ─────────────────
      if (ex.collisionType) {
        const boostKey = ex.collisionType;
        const currentBoost = this.boosts[boostKey];
        // Wrong prediction with a given collision type →
        //  reduce that type's boost; correct → increase
        const boostGrad = gradSign * (currentBoost > 1 ? 0.05 : 0.02) * loss;
        totalGradB[boostKey] += boostGrad;
      }

      // ── Per-fault-type specialization ─────────────
      if (perFaultType) {
        const ftAccuracy = perFaultType.get(ex.faultType);
        if (ftAccuracy !== undefined && ftAccuracy < 0.5) {
          // Persistent failure on this fault type → amplify collision gradient
          const amplifyFactor = 1 + (0.5 - ftAccuracy);
          totalGradW.collision *= amplifyFactor;
        }
      }
    }

    // ── Apply gradients (SGD update) ──────────────────────
    const n = examples.length;
    const avgGradNormW = Math.abs(totalGradW.collision / n);

    // Update collision weight only; anomaly/topology inherit from residual
    let wCollision = this.fusion.collision - this.lr * (totalGradW.collision / n);
    wCollision = Math.max(0.05, Math.min(0.9, wCollision));

    // Anomaly and topology split the remainder equally
    const remainder = 1 - wCollision;
    const wAnomaly = remainder / 2;
    const wTopology = remainder / 2;

    this.fusion.collision = wCollision;
    this.fusion.anomaly = wAnomaly;
    this.fusion.topology = wTopology;

    // Update collision boosts (bounded)
    const boostKeys = ['cycle', 'bottleneck', 'fanIn', 'chain'] as const;
    for (const key of boostKeys) {
      const grad = totalGradB[key] / n;
      let newVal = this.boosts[key] - this.lr * grad;
      newVal = Math.max(0.5, Math.min(3.0, newVal));
      this.boosts[key] = newVal;
    }

    // ── Update meta ───────────────────────────────────────
    this.iterations += 1;
    this.avgLoss =
      this.avgLoss === 0
        ? totalLoss / n
        : (1 - this.config.lossSmoothing) * this.avgLoss +
          this.config.lossSmoothing * (totalLoss / n);

    // Learning rate decay
    this.lr = Math.max(this.config.minLearningRate, this.lr * this.config.lrDecay);

    // Convergence detection
    this.converged = avgGradNormW < this.config.convergenceThreshold && this.iterations > 5;

    return this.getWeights();
  }

  /**
   * Reset calibrator to initial state.
   */
  reset(): void {
    this.fusion = { ...DEFAULT_FUSION_WEIGHTS };
    this.boosts = { ...DEFAULT_COLLISION_BOOSTS };
    this.lr = this.config.learningRate;
    this.iterations = 0;
    this.avgLoss = 0;
    this.converged = false;
  }

  // ── Persistence ────────────────────────────────────────

  /**
   * Serialize weights to JSON for persistence.
   */
  toJSON(): string {
    return JSON.stringify(this.getWeights(), null, 2);
  }

  /**
   * Deserialize weights from JSON.
   * Returns null if parsing fails (malformed or missing data).
   */
  static fromJSON(json: string): WeightCalibrator | null {
    try {
      const data = JSON.parse(json) as CalibratedWeights;
      if (!data.fusion || !data.collisionBoosts) return null;

      const calibrator = new WeightCalibrator();
      calibrator.setWeights(data);
      return calibrator;
    } catch {
      return null;
    }
  }
}
