/**
 * Default configuration constants for @agentix-e/micro-kinetic.
 *
 * These constants are used across the umbrella package for
 * pipeline configuration, DI wiring, and CLI defaults.
 *
 * @module di/defaults
 */

export const DEFAULTS = {
  /** Epsilon threshold for collision tree cycle pruning */
  PRUNE_EPSILON: 0.001,

  /** Critical system load below which Σw(C) → 0 */
  CRITICAL_LOAD_THRESHOLD: 0.7,

  /** Default Top-K value for root cause ranking */
  DEFAULT_TOP_K: 5,

  /** Maximum propagation depth for fault traversal */
  MAX_PROPAGATION_DEPTH: 10,

  /** Coupling sparsity threshold for Stosszahlansatz satisfaction */
  COUPLING_SPARSITY_THRESHOLD: 0.7,

  /** BBGKY hierarchy truncation threshold η */
  BBGKY_TRUNCATION_ETA: 0.01,

  /** Wave decay time constant τ (1 minute in ms) */
  WAVE_DECAY_TIME_CONSTANT: 60000,

  /** Alert intensity threshold for cascade initiation */
  WAVE_CASCADE_THRESHOLD: 0.3,
} as const;
