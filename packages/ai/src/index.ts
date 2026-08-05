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
} from './interfaces/llm-provider.js';

// ── Providers ───────────────────────────────────────────
export {
  TfIdfEmbeddingProvider,
  tokenizeServiceName,
} from './providers/tfidf-embedding.js';

// ── Utils ────────────────────────────────────────────────
export {
  cosineSimilarity,
  cosineDistance,
  jaccardSimilarity,
  normalizeL2,
} from './utils/similarity.js';
