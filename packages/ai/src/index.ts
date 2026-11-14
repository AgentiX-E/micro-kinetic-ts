// ── Interfaces ──────────────────────────────────────────
export type {
  AlignmentFallbackStrategy,
  EmbeddingProviderMeta,
  EmbeddingResult,
  EntityAlignmentResult,
  IEmbeddingProvider,
  ServiceDescriptor,
} from './interfaces/embedding-provider.js';

export type {
  EntityAlignmentCandidate,
  ILLMProvider,
  IModelRouter,
  LlmAlignmentResult,
  SingleEntityAlignmentResult,
} from './interfaces/llm-provider.js';

// ── Providers ───────────────────────────────────────────
export {
  DEFAULT_SEMANTIC_ALIGNMENT_CONFIG,
  SemanticAlignmentProvider,
} from './providers/semantic-alignment.js';
export { TfIdfEmbeddingProvider, tokenizeServiceName } from './providers/tfidf-embedding.js';

export type { SemanticAlignmentConfig } from './providers/semantic-alignment.js';

export { ApiEmbeddingProvider } from './providers/api-embedding.js';

export { createApiEmbeddingFromEnv } from './providers/env-embedding.js';

export type {
  ApiEmbeddingConfig,
  ApiEmbeddingConfigInput,
  EmbeddingApiFormat,
  EmbeddingRetryConfig,
} from './providers/api-embedding-config.js';

export type { EnvEmbeddingConfig } from './providers/env-embedding.js';

export {
  DEFAULT_RETRY_CONFIG,
  resolveApiEmbeddingConfig,
} from './providers/api-embedding-config.js';

// ── Utils ────────────────────────────────────────────────
export {
  cosineDistance,
  cosineSimilarity,
  jaccardSimilarity,
  normalizeL2,
} from './utils/similarity.js';

// ── Agent ────────────────────────────────────────────────
// The bounded hypothesis space, the claim verifier and the budget ledger. `docs/agentic-layer-plan.md` owns what
// this layer may and may not do; `0d6ae609` owns why the previous one was removed.
export {
  AgentBudget,
  CLAIM_REJECTIONS,
  CLAIM_STATISTICS,
  DEEPSEEK_PRICE,
  DEFAULT_CONSULTATION_OPTIONS,
  DEFAULT_ELIMINATOR_BUDGET,
  DEFAULT_ELIMINATOR_OPTIONS,
  DEFAULT_FUSION_OPTIONS,
  DEFAULT_INVESTIGATOR_BUDGET,
  ELIMINATOR_PROTOCOL,
  FUSION_STRATEGIES,
  GATE_TRIPS,
  PROMPTABLE_STATISTICS,
  RANK_STRATEGIES,
  SKIP_REASONS,
  applyClaims,
  buildEliminatorPrompt,
  decideConsultation,
  departureOf,
  digestOf,
  formatMicroUsd,
  fuseClaims,
  fuseRanks,
  impliedOrder,
  parseBudget,
  parseEliminatorReply,
  roundCost,
  shownChannels,
  tokenCost,
  verifyClaim,
} from './agent/index.js';

export type {
  BudgetLimits,
  BudgetSpend,
  CandidateFingerprint,
  ChannelFingerprint,
  ClaimBasis,
  ClaimRejection,
  ClaimStatistic,
  ClaimVerdict,
  ConsultationDecision,
  EliminationClaim,
  EliminatorOptions,
  EliminatorPrompt,
  FusionOptions,
  FusionStrategy,
  GateTrip,
  ModelPrice,
  ParsedReply,
  RankFusionOptions,
  RankStrategy,
  RoundCost,
  SkipReason,
} from './agent/index.js';
