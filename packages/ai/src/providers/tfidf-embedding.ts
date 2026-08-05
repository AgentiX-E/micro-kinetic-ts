/**
 * Self-implemented TF-IDF embedding provider.
 *
 * Built-in fallback for the embedding layer — zero dependencies,
 * zero network calls, always available.
 *
 * When a user injects an external IEmbeddingProvider (transformers, ONNX, API),
 * the SemanticAlignmentProvider uses that instead. When no provider is injected,
 * this TF-IDF implementation serves as the default.
 *
 * The IDF formula matches sklearn's TfidfVectorizer with smooth_idf=true:
 *   idf(t) = log((1 + N) / (1 + df(t))) + 1
 *
 * where N = document count, df(t) = number of documents containing term t.
 *
 * For semantic alignment of service names, we treat each service name as a
 * "document" and n-gram tokenize it. This provides sufficient signal for
 * matching "ts-admin-basic-info" → "ts-admin-basic-info-service" while being
 * fully deterministic and offline.
 *
 * @module ai/providers
 */

import type { IEmbeddingProvider, EmbeddingProviderMeta } from '../interfaces/embedding-provider.js';
import { normalizeL2 } from '../utils/similarity.js';

/**
 * Default TF-IDF embedding dimension.
 *
 * The vocabulary size is the number of n-gram tokens across all service names.
 * We cap at 512 to keep memory bounded.
 */
const DEFAULT_MAX_DIMENSION = 512;

/**
 * N-gram tokenizer for service name tokenization.
 *
 * Generates character n-grams (n=2..4) from service names.
 * This captures both prefix patterns ("ts-") and substring patterns ("basic-info")
 * without requiring a pre-built vocabulary.
 *
 * @param text - Service name text.
 * @returns Array of n-gram tokens.
 */
export function tokenizeServiceName(text: string): string[] {
  const normalized = text.toLowerCase();
  const tokens: string[] = [];

  // Add word-level tokens (split on common separators)
  const words = normalized.split(/[-_.:\s]+/);
  for (const word of words) {
    if (word.length === 0) continue;
    tokens.push(word);

    // Character bigrams
    for (let i = 0; i < word.length - 1; i++) {
      tokens.push(word.slice(i, i + 2));
    }

    // Character trigrams
    for (let i = 0; i < word.length - 2; i++) {
      tokens.push(word.slice(i, i + 3));
    }
  }

  // Also add the full normalized string as a token for exact match
  tokens.push(`__full__${normalized}`);

  return tokens;
}

/**
 * TF-IDF based embedding provider.
 *
 * Generates sparse TF-IDF vectors from service name text.
 * Zero dependencies, zero network, always available.
 *
 * @example
 * ```typescript
 * const provider = new TfIdfEmbeddingProvider();
 * // Fit on topology service names
 * const topologyNames = topologyServices.map(s => s.name);
 * const { vectors } = await provider.fitTransform(topologyNames, spanServices);
 * ```
 */
export class TfIdfEmbeddingProvider implements IEmbeddingProvider {
  readonly modelId = 'tfidf-v1';
  private _dimension: number;
  private vocabulary: Map<string, number> = new Map();
  private idf: Float32Array = new Float32Array(0);
  private fitted = false;

  /** Provider metadata. */
  readonly meta: EmbeddingProviderMeta = {
    name: 'TF-IDF',
    backend: 'tfidf',
    requiresNetwork: false,
  };

  constructor(maxDimension: number = DEFAULT_MAX_DIMENSION) {
    this._dimension = maxDimension;
  }

  get dimension(): number {
    return this._dimension;
  }

  /**
   * Fit the TF-IDF vectorizer on a corpus and transform queries in one step.
   *
   * This is a convenience method for semantic alignment where we need to
   * fit on topology service names and then embed all span services at once.
   *
   * @param fitTexts - Topology service name texts (used to build vocabulary).
   * @param queryTexts - Span service name texts (embedded using fit vocabulary).
   * @returns L2-normalized embedding vectors for query texts.
   */
  async fitTransform(
    fitTexts: readonly string[],
    queryTexts: readonly string[],
  ): Promise<{ readonly vectors: readonly Float32Array[] }> {
    // Step 1: Build vocabulary from fit corpus
    this.buildVocabulary(fitTexts);

    // Step 2: Compute IDF from fit corpus
    this.computeIdf(fitTexts);

    // Step 3: Transform query texts using the fitted vocabulary
    const vectors = this.transformAll(queryTexts);

    // Step 4: L2-normalize
    const normalized = vectors.map((v) => normalizeL2(v));

    this.fitted = true;
    return { vectors: normalized };
  }

  async embed(texts: readonly string[]): Promise<{
    readonly vectors: readonly Float32Array[];
  }> {
    if (!this.fitted) {
      // Auto-fit on input texts if not yet fitted
      this.buildVocabulary(texts);
      this.computeIdf(texts);
      this.fitted = true;
    }

    const vectors = this.transformAll(texts);
    const normalized = vectors.map((v) => normalizeL2(v));
    return { vectors: normalized };
  }

  /**
   * Build vocabulary from a corpus of texts.
   *
   * Takes the top `maxDimension` terms by document frequency (descending)
   * to bound vocabulary size.
   */
  private buildVocabulary(texts: readonly string[]): void {
    const docFreq = new Map<string, number>();

    for (const text of texts) {
      const tokens = new Set(tokenizeServiceName(text));
      for (const token of tokens) {
        docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
      }
    }

    // Sort by descending document frequency, take top maxDimension
    const sorted = [...docFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, this._dimension);

    this.vocabulary = new Map();
    for (let i = 0; i < sorted.length; i++) {
      const entry = sorted[i] as readonly [string, number];
      this.vocabulary.set(entry[0], i);
    }
  }

  /**
   * Compute IDF values for all vocabulary terms.
   *
   * idf(t) = log((1 + N) / (1 + df(t))) + 1
   */
  private computeIdf(texts: readonly string[]): void {
    const N = texts.length;
    const vocabSize = this.vocabulary.size;
    this.idf = new Float32Array(vocabSize);

    // Count document frequency for each term in vocabulary
    const df = new Array<number>(vocabSize).fill(0);
    for (const text of texts) {
      const seenTokens = new Set<number>();
      const tokens = tokenizeServiceName(text);
      for (const token of tokens) {
        const idx = this.vocabulary.get(token);
        if (idx !== undefined && !seenTokens.has(idx) && idx < vocabSize) {
          df[idx]!++;
          seenTokens.add(idx);
        }
      }
    }

    for (let i = 0; i < vocabSize; i++) {
      this.idf[i] = Math.log((1 + N) / (1 + df[i]!)) + 1;
    }
  }

  /**
   * Transform a single text into a TF-IDF vector.
   */
  private transform(text: string): Float32Array {
    const vocabSize = this.vocabulary.size;
    const vec = new Float32Array(vocabSize);

    const tokens = tokenizeServiceName(text);
    if (tokens.length === 0) return vec;

    // Compute term frequency
    const tf = new Map<number, number>();
    for (const token of tokens) {
      const idx = this.vocabulary.get(token);
      if (idx !== undefined) {
        tf.set(idx, (tf.get(idx) ?? 0) + 1);
      }
    }

    // TF-IDF: tf × idf
    const maxTf = Math.max(...tf.values());
    for (const [idx, freq] of tf) {
      // Normalized TF (augmented): 0.5 + 0.5 × tf / max_tf
      vec[idx] = (0.5 + 0.5 * (freq / maxTf)) * this.idf[idx]!;
    }

    return vec;
  }

  /**
   * Transform all texts in a batch.
   */
  private transformAll(texts: readonly string[]): Float32Array[] {
    return texts.map((t) => this.transform(t));
  }

  /** Whether the vectorizer has been fitted on a corpus. */
  get isFitted(): boolean {
    return this.fitted;
  }

  /** Number of terms in the vocabulary. */
  get vocabularySize(): number {
    return this.vocabulary.size;
  }

  /** Sorted list of vocabulary terms. */
  get terms(): readonly string[] {
    const result = new Array<string>(this.vocabulary.size);
    for (const [term, idx] of this.vocabulary) {
      result[idx] = term;
    }
    return result;
  }
}
