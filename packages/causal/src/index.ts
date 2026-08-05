// ── Types ────────────────────────────────────────────────
export type {
  ExtractedServiceTiming,
  FusionResult,
  GrangerConfig,
  GrangerTestResult,
  LogAnomalyPoint,
  ProviderTierResult,
  SpanTiming,
} from './types/index.js';

export { DEFAULT_GRANGER_CONFIG } from './types/index.js';

// ── Providers ────────────────────────────────────────────
export { TraceTimingProvider } from './providers/trace-timing.js';
export { LogTimingProvider } from './providers/log-timing.js';
export { GrangerCausalityProvider } from './providers/granger-causality.js';
export { StaticDirectionProvider } from './providers/static-direction.js';
export { StaticTopologyProvider } from './providers/static-topology.js';

// ── Orchestrators ────────────────────────────────────────
export { CausalDirectionFusion } from './orchestrators/causal-direction-fusion.js';
