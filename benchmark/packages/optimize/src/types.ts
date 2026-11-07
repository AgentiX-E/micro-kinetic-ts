/**
 * System-level context features extracted from the service call graph
 * and metric data.  Used as the input vector x for meta-learning and
 * Gaussian Process surrogate modeling.
 */
export interface SystemContext {
  /** Number of services in the call graph */
  readonly serviceCount: number;

  /** Edge density: |E| / (|V| * (|V| - 1)) for directed graph */
  readonly graphDensity: number;

  /** Coefficient of variation of node out-degree distribution.
   *  High CV → hub-dominated; low CV → uniform. */
  readonly degreeCV: number;

  /** Maximum propagation depth from root to deepest leaf (BFS) */
  readonly maxDepth: number;

  /** Fraction of edges validated by trace spans (0–1).
   *  0 = RE1 (no traces), approaching 1 = RE2/RE3. */
  readonly traceCoverage: number;

  /** Average coefficient of variation of metric time series across
   *  all services.  High values indicate bursty/spiky behavior. */
  readonly metricCV: number;

  /** Fraction of services with spike-dominated metric distributions.
   *  Spike-dominated = >30% of values exceed 0.8×max. */
  readonly spikeDominanceRatio: number;

  /** Concentration of anomaly scores across services, measured as
   *  the ratio of mean anomaly to max anomaly.  Low values indicate
   *  a few services dominate; high values indicate uniform distribution. */
  readonly anomalyConcentration: number;

  /** System load factor (0–1), normalized from RCAEval metadata */
  readonly systemLoad: number;

  /** Number of distinct fault types tested (CPU, MEM, DISK, etc.) */
  readonly faultTypeCount: number;

  /** Average number of test cases per fault type */
  readonly avgCasesPerType: number;
}

/**
 * Known optimal values for context features from benchmark-verified systems.
 * Used to validate the extractor produces correct values.
 */
export interface ContextBenchmark {
  readonly system: string;
  readonly expected: SystemContext;
}
