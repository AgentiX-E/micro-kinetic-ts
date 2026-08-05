// ── Interfaces ──────────────────────────────────────────
export type {
  IEmbeddingProvider,
  ServiceDescriptor,
  EntityAlignmentResult,
  AlignmentFallbackStrategy,
  EmbeddingProviderMeta,
} from './interfaces/embedding-provider.js';

export type {
  ILLMProvider,
  LlmAlignmentResult,
  IModelRouter,
  EntityAlignmentCandidate,
  SingleEntityAlignmentResult,
} from './interfaces/llm-provider.js';

// ── Providers ───────────────────────────────────────────
export {
  TfIdfEmbeddingProvider,
  tokenizeServiceName,
} from './providers/tfidf-embedding.js';

export {
  SemanticAlignmentProvider,
  DEFAULT_SEMANTIC_ALIGNMENT_CONFIG,
} from './providers/semantic-alignment.js';

export type {
  SemanticAlignmentConfig,
} from './providers/semantic-alignment.js';

export {
  ApiEmbeddingProvider,
} from './providers/api-embedding.js';

export {
  createApiEmbeddingFromEnv,
} from './providers/env-embedding.js';

export type {
  ApiEmbeddingConfig,
  ApiEmbeddingConfigInput,
  EmbeddingApiFormat,
  EmbeddingRetryConfig,
} from './providers/api-embedding-config.js';

export type {
  EnvEmbeddingConfig,
} from './providers/env-embedding.js';

export {
  resolveApiEmbeddingConfig,
  DEFAULT_RETRY_CONFIG,
} from './providers/api-embedding-config.js';

// ── Utils ────────────────────────────────────────────────
export {
  cosineSimilarity,
  cosineDistance,
  jaccardSimilarity,
  normalizeL2,
} from './utils/similarity.js';
