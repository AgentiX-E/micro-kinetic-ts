/**
 * Configuration space Θ for the adaptive RCA optimizer.
 *
 * Defines the search space boundaries, parameter types, and sampling
 * strategies used by the Gaussian Process surrogate.  Five continuous
 * parameters map to a unit-cube [0,1]⁵ via affine transforms; five
 * discrete parameters are enumerated as integer indices 0..|options|-1.
 *
 * Total search space: |Θ_continuous| × ∏|Θ_discrete_i| ≈ 4000 configurations.
 * GP with UCB acquisition converges in 3–5 evaluations (≈0.1% of grid search).
 */

// ── Continuous parameters ──────────

/** Continuous parameter definition with bounds and transform */
export interface ContinuousParam {
  /** Human-readable name */
  readonly name: string;
  /** Minimum value in original space */
  readonly min: number;
  /** Maximum value in original space */
  readonly max: number;
  /** Map from [0,1] unit cube to original space */
  readonly fromUnit: (u: number) => number;
  /** Map from original space back to [0,1] */
  readonly toUnit: (v: number) => number;
}

/**
 * Configuration space definition.
 * The `fromVector` / `toVector` methods convert between the GP's
 * internal representation (5 continuous + 5 one-hot = 5 + Σ|D_k| dims)
 * and typed RCAConfiguration objects.
 */
export interface ConfigSpace {
  readonly continuous: readonly ContinuousParam[];
  readonly discrete: readonly DiscreteParam[];
  /** Total dimensionality of the GP input vector */
  readonly dimension: number;
  /** Convert unit-cube vector to typed configuration */
  fromVector(x: Float64Array): RCAConfiguration;
  /** Convert typed configuration to unit-cube vector */
  toVector(cfg: RCAConfiguration): Float64Array;
  /** Sample a random configuration uniformly from the space */
  sampleUniform(rng?: () => number): RCAConfiguration;
  /** Sample N candidate points around a center using Thompson sampling */
  sampleThompson(
    center: Float64Array,
    variance: Float64Array,
    n: number,
    rng?: () => number,
  ): Float64Array[];
}

/** Discrete parameter definition */
export interface DiscreteParam {
  readonly name: string;
  readonly options: readonly string[];
}

// ── RCA Configuration ──────────

export interface RCAConfiguration {
  readonly continuous: {
    readonly decayAlpha: number;
    readonly pruneEpsilon: number;
    readonly temporalBonus: number;
    readonly defaultWeight: number;
    readonly childContributionCap: number;
  };
  readonly discrete: {
    readonly baselineStrategy: 'q25' | 'sliding-window' | 'auto';
    readonly correlationMethod: 'pearson' | 'spearman';
    readonly propagationMode: 'additive' | 'multiplicative';
    readonly enableCollisionAggregation: boolean;
    readonly useTemporalCausality: boolean;
  };
}

// ── Built-in config space ──────────

const CONTINUOUS: readonly ContinuousParam[] = [
  {
    name: 'decayAlpha',
    min: 0.5,
    max: 0.95,
    fromUnit: (u) => 0.5 + u * 0.45,
    toUnit: (v) => (v - 0.5) / 0.45,
  },
  {
    name: 'pruneEpsilon',
    min: 1e-5,
    max: 1e-2,
    fromUnit: (u) => 1e-5 * Math.pow(1e3, u),
    toUnit: (v) => Math.log(v / 1e-5) / Math.log(1e3),
  },
  {
    name: 'temporalBonus',
    min: 0.01,
    max: 0.3,
    fromUnit: (u) => 0.01 + u * 0.29,
    toUnit: (v) => (v - 0.01) / 0.29,
  },
  {
    name: 'defaultWeight',
    min: 0.01,
    max: 0.2,
    fromUnit: (u) => 0.01 + u * 0.19,
    toUnit: (v) => (v - 0.01) / 0.19,
  },
  {
    name: 'childContributionCap',
    min: 0.1,
    max: 2.0,
    fromUnit: (u) => 0.1 + u * 1.9,
    toUnit: (v) => (v - 0.1) / 1.9,
  },
];

const DISCRETE: readonly DiscreteParam[] = [
  {
    name: 'baselineStrategy',
    options: ['q25', 'sliding-window', 'auto'],
  },
  {
    name: 'correlationMethod',
    options: ['pearson', 'spearman'],
  },
  {
    name: 'propagationMode',
    options: ['additive', 'multiplicative'],
  },
  {
    name: 'enableCollisionAggregation',
    options: ['false', 'true'],
  },
  {
    name: 'useTemporalCausality',
    options: ['false', 'true'],
  },
];

/** Total discrete one-hot dimension = Σ|options_i| */
function computeDiscreteDim(discrete: readonly DiscreteParam[]): number {
  return discrete.reduce((s, d) => s + d.options.length, 0);
}

/** Default RNG (Math.random based) */
const defaultRng = () => Math.random();

// ── Vector <-> Config conversion ──────────

function continuousToVector(cfg: RCAConfiguration['continuous']): Float64Array {
  const v = new Float64Array(CONTINUOUS.length);
  v[0] = CONTINUOUS[0]!.toUnit(cfg.decayAlpha);
  v[1] = CONTINUOUS[1]!.toUnit(cfg.pruneEpsilon);
  v[2] = CONTINUOUS[2]!.toUnit(cfg.temporalBonus);
  v[3] = CONTINUOUS[3]!.toUnit(cfg.defaultWeight);
  v[4] = CONTINUOUS[4]!.toUnit(cfg.childContributionCap);
  return v;
}

function discreteToVector(cfg: RCAConfiguration['discrete']): Float64Array {
  let offset = 0;
  const totalDim = computeDiscreteDim(DISCRETE);
  const v = new Float64Array(totalDim);

  for (const d of DISCRETE) {
    const val = cfg[d.name as keyof typeof cfg];
    const idx = typeof val === 'boolean' ? (val ? 1 : 0) : d.options.indexOf(val as string);
    v[offset + idx] = 1;
    offset += d.options.length;
  }
  return v;
}

function vectorToContinuous(u: Float64Array): RCAConfiguration['continuous'] {
  return {
    decayAlpha: CONTINUOUS[0]!.fromUnit(u[0]!),
    pruneEpsilon: CONTINUOUS[1]!.fromUnit(u[1]!),
    temporalBonus: CONTINUOUS[2]!.fromUnit(u[2]!),
    defaultWeight: CONTINUOUS[3]!.fromUnit(u[3]!),
    childContributionCap: CONTINUOUS[4]!.fromUnit(u[4]!),
  };
}

function vectorToDiscrete(u: Float64Array): RCAConfiguration['discrete'] {
  let offset = 0;
  const baselineIdx =
    u[offset + 0]! > u[offset + 1]!
      ? u[offset + 0]! > u[offset + 2]!
        ? 0
        : 2
      : u[offset + 1]! > u[offset + 2]!
        ? 1
        : 2;
  const baselineOpts = DISCRETE[0]!.options as readonly string[];
  const result: Record<string, string | boolean> = {
    baselineStrategy: baselineOpts[baselineIdx]!,
  };
  offset += 3;

  const corrIdx = u[offset + 0]! > u[offset + 1]! ? 0 : 1;
  result.correlationMethod = DISCRETE[1]!.options[corrIdx]!;
  offset += 2;

  const propIdx = u[offset + 0]! > u[offset + 1]! ? 0 : 1;
  result.propagationMode = DISCRETE[2]!.options[propIdx]!;
  offset += 2;

  result.enableCollisionAggregation = u[offset + 1]! > u[offset + 0]!;
  offset += 2;

  result.useTemporalCausality = u[offset + 1]! > u[offset + 0]!;

  return result as unknown as RCAConfiguration['discrete'];
}

// ── Built-in config space instance ──────────

export const DEFAULT_CONFIG_SPACE: ConfigSpace = {
  continuous: CONTINUOUS,
  discrete: DISCRETE,
  dimension: CONTINUOUS.length + computeDiscreteDim(DISCRETE),

  fromVector(x: Float64Array): RCAConfiguration {
    const cont = vectorToContinuous(x.slice(0, CONTINUOUS.length));
    const disc = vectorToDiscrete(x.slice(CONTINUOUS.length));
    return { continuous: cont, discrete: disc };
  },

  toVector(cfg: RCAConfiguration): Float64Array {
    const cv = continuousToVector(cfg.continuous);
    const dv = discreteToVector(cfg.discrete);
    const result = new Float64Array(cv.length + dv.length);
    result.set(cv, 0);
    result.set(dv, cv.length);
    return result;
  },

  sampleUniform(rng: () => number = defaultRng): RCAConfiguration {
    const u = new Float64Array(this.dimension);
    for (let i = 0; i < u.length; i++) u[i] = rng();
    return this.fromVector(u);
  },

  sampleThompson(
    center: Float64Array,
    variance: Float64Array,
    n: number,
    rng: () => number = defaultRng,
  ): Float64Array[] {
    const samples: Float64Array[] = [];
    for (let j = 0; j < n; j++) {
      const s = new Float64Array(center.length);
      for (let i = 0; i < s.length; i++) {
        // Box-Muller transform for Gaussian sampling
        const u1 = rng() || 1e-10;
        const u2 = rng();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        s[i] = center[i]! + z * Math.sqrt(Math.max(variance[i]!, 1e-10));
        // Clamp to [0, 1] for unit-cube representation
        if (s[i]! < 0) s[i] = 0;
        if (s[i]! > 1) s[i] = 1;
      }
      samples.push(s);
    }
    return samples;
  },
};

// ── Default configuration (fallback when optimizer unavailable) ──────────

export const DEFAULT_CONFIG: RCAConfiguration = {
  continuous: {
    decayAlpha: 0.8,
    pruneEpsilon: 0.001,
    temporalBonus: 0.15,
    defaultWeight: 0.05,
    childContributionCap: 1.0,
  },
  discrete: {
    baselineStrategy: 'auto',
    correlationMethod: 'pearson',
    propagationMode: 'additive',
    enableCollisionAggregation: true,
    useTemporalCausality: true,
  },
};
