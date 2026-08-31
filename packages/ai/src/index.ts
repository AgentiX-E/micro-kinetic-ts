// ── Interfaces ──────────────────────────────────────────
export type {
  AlignmentFallbackStrategy,
  EmbeddingProviderMeta,
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

export type {
  CandidateEvidence,
  IRootCauseReranker,
  RerankRequest,
  RerankResult,
} from './interfaces/reranker.js';

// ── Providers ───────────────────────────────────────────
export {
  DEFAULT_SEMANTIC_ALIGNMENT_CONFIG,
  SemanticAlignmentProvider,
} from './providers/semantic-alignment.js';
export { TfIdfEmbeddingProvider, tokenizeServiceName } from './providers/tfidf-embedding.js';

export type { SemanticAlignmentConfig } from './providers/semantic-alignment.js';

export { ApiEmbeddingProvider } from './providers/api-embedding.js';

export { ApiChatProvider } from './providers/api-llm.js';
export type { ChatCompletionOptions, ChatMessage, IChatProvider } from './providers/api-llm.js';

export { EvidenceGroundedReranker } from './providers/evidence-reranker.js';

export { createEvidenceRerankerFromEnv } from './providers/env-reranker.js';
export type { EnvRerankerConfig } from './providers/env-reranker.js';

export {
  MAX_RERANK_CANDIDATES,
  buildRerankPrompt,
  parseRerankOrder,
  shouldRerank,
} from './providers/reranker-core.js';

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

// ── Agent (GALA+ phase-III) ─────────────────────────────
export {
  GraphInvestigatorToolkit,
  buildAdjacency,
  buildCandidateEvidence,
} from './agent/investigator-toolkit.js';
export type { InvestigatorToolkit } from './agent/investigator-toolkit.js';
