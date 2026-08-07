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
export { GrangerCausalityProvider } from './providers/granger-causality.js';
export { LogTimingProvider } from './providers/log-timing.js';
export { StaticDirectionProvider } from './providers/static-direction.js';
export { StaticTopologyProvider } from './providers/static-topology.js';
export { TraceTimingProvider } from './providers/trace-timing.js';

// ── Orchestrators ────────────────────────────────────────
export { CausalDirectionFusion } from './orchestrators/causal-direction-fusion.js';
export {
  DEFAULT_TOPOLOGY_FUSION_CONFIG,
  TopologyFusion,
  createDefaultTopologyFusion,
} from './orchestrators/topology-fusion.js';
export type {
  FusedEdge,
  TopologyFusionConfig,
  TopologyFusionResult,
} from './orchestrators/topology-fusion.js';
