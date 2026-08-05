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

// ── Utils ────────────────────────────────────────────────
export {
  cosineSimilarity,
  cosineDistance,
  jaccardSimilarity,
  normalizeL2,
} from './utils/similarity.js';
