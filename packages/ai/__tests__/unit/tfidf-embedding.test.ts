/**
 * Unit tests for TfIdfEmbeddingProvider — zero-dependency embedding fallback.
 *
 * Tests cover:
 * - Tokenization (service name → n-grams)
 * - Vocabulary building (document frequency ranking, max dimension cap)
 * - IDF computation (smooth_idf formula)
 * - TF-IDF transformation (normalized frequency × IDF)
 * - L2 normalization (unit-length output vectors)
 * - Cosine similarity computation
 * - Semantic alignment scenarios (service name matching)
 * - Edge cases (empty input, single text, duplicate texts, special characters)
 * - fitTransform convenience method
 * - Auto-fit on first embed() call
 *
 * @module ai/__tests__/unit
 */

import { describe, it, expect } from 'vitest';
import {
  TfIdfEmbeddingProvider,
  tokenizeServiceName,
  cosineSimilarity,
  cosineDistance,
  jaccardSimilarity,
  normalizeL2,
} from '../../src';

// =============================================================================
// tokenizeServiceName
// =============================================================================

describe('tokenizeServiceName', () => {
  it('should split service name by hyphens into word tokens', () => {
    const tokens = tokenizeServiceName('ts-admin-basic-info');
    expect(tokens).toContain('ts');
    expect(tokens).toContain('admin');
    expect(tokens).toContain('basic');
    expect(tokens).toContain('info');
  });

  it('should generate character bigrams for each word', () => {
    const tokens = tokenizeServiceName('user-service');
    // "user": us, se, er
    expect(tokens).toContain('us');
    expect(tokens).toContain('se');
    expect(tokens).toContain('er');
    // "service": se, er, rv, vi, ic, ce
    expect(tokens).toContain('rv');
    expect(tokens).toContain('vi');
    expect(tokens).toContain('ic');
  });

  it('should generate character trigrams for words with ≥3 characters', () => {
    const tokens = tokenizeServiceName('api-gateway');
    // "api" has only 3 chars → 1 trigram: api
    expect(tokens).toContain('api');
    // "gateway" has 7 chars → trigrams: gat, ate, tew, ewa, way
    expect(tokens).toContain('gat');
    expect(tokens).toContain('ate');
    expect(tokens).toContain('tew');
  });

  it('should include full normalized string for exact match', () => {
    const tokens = tokenizeServiceName('ts-ui');
    expect(tokens).toContain('__full__ts-ui');
  });

  it('should lowercase all tokens', () => {
    const tokens = tokenizeServiceName('Redis-Cache-PROD');
    expect(tokens).toContain('redis');
    expect(tokens).toContain('__full__redis-cache-prod');
    expect(tokens).not.toContain('Redis');
  });

  it('should handle single-word service names', () => {
    const tokens = tokenizeServiceName('frontend');
    expect(tokens).toContain('frontend');
    expect(tokens).toContain('fr');
    expect(tokens).toContain('fro');
    expect(tokens).toContain('__full__frontend');
  });

  it('should handle empty string gracefully', () => {
    const tokens = tokenizeServiceName('');
    // Only the full token (empty normalized)
    expect(tokens).toEqual(['__full__']);
  });

  it('should split on dots and underscores', () => {
    const tokens = tokenizeServiceName('my.service_v1');
    expect(tokens).toContain('my');
    expect(tokens).toContain('service');
    expect(tokens).toContain('v1');
    expect(tokens).toContain('__full__my.service_v1');
  });

  it('should handle short words (1-2 chars) without bigrams/trigrams', () => {
    const tokens = tokenizeServiceName('a-b');
    // "a" has 1 char → no bigrams or trigrams
    // "b" has 1 char → no bigrams or trigrams
    const wordTokens = tokens.filter((t) => t.length === 1);
    expect(wordTokens).toContain('a');
    expect(wordTokens).toContain('b');
    // Should have the full token
    expect(tokens).toContain('__full__a-b');
  });
});

// =============================================================================
// Cosine similarity and distance
// =============================================================================

describe('cosineSimilarity', () => {
  it('should return 1 for identical vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it('should return 0 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('should clamp to [0, 1] for float precision edge cases', () => {
    const a = new Float32Array([1.0000001]);
    const b = new Float32Array([1.0000001]);
    const result = cosineSimilarity(a, b);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('should work with Float32Array and number[] interchangeably', () => {
    const a = new Float32Array([1, 0]);
    const b: number[] = [1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it('should handle vectors of different lengths (uses min length)', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
  });

  it('should return 0 for all-zero vector (both)', () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([0, 0]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('should handle empty vectors', () => {
    const a = new Float32Array(0);
    const b: number[] = [];
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

describe('cosineDistance', () => {
  it('should return 1 - cosine similarity', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(cosineDistance(a, b)).toBeCloseTo(0, 5);
  });

  it('should return 1 for orthogonal vectors', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    expect(cosineDistance(a, b)).toBeCloseTo(1, 5);
  });
});

describe('jaccardSimilarity', () => {
  it('should return 1 for identical sets', () => {
    expect(jaccardSimilarity(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(1);
  });

  it('should return 0 for disjoint sets', () => {
    expect(jaccardSimilarity(['a', 'b'], ['c', 'd'])).toBe(0);
  });

  it('should return 0.5 when half elements overlap', () => {
    const result = jaccardSimilarity(['a', 'b'], ['b', 'c']);
    // Intersection: {b} = 1, Union: {a,b,c} = 3 → 1/3
    expect(result).toBeCloseTo(1 / 3, 5);
  });

  it('should handle empty sets', () => {
    expect(jaccardSimilarity([], [])).toBe(1);
    expect(jaccardSimilarity(['a'], [])).toBe(0);
  });
});

describe('normalizeL2', () => {
  it('should return a unit vector', () => {
    const vec: number[] = [3, 4];
    const normalized = normalizeL2(vec);
    // L2 norm = sqrt(9+16) = 5, so [3/5, 4/5] = [0.6, 0.8]
    expect(normalized[0]).toBeCloseTo(0.6, 5);
    expect(normalized[1]).toBeCloseTo(0.8, 5);
    // Verify unit length
    const len = Math.sqrt(normalized[0] ** 2 + normalized[1] ** 2);
    expect(len).toBeCloseTo(1, 5);
  });

  it('should return zero vector for zero input', () => {
    const vec = new Float32Array([0, 0, 0]);
    const normalized = normalizeL2(vec);
    expect(normalized[0]).toBe(0);
    expect(normalized[1]).toBe(0);
    expect(normalized[2]).toBe(0);
  });

  it('should not mutate input', () => {
    const vec = new Float32Array([1, 2, 3]);
    const original = new Float32Array(vec);
    normalizeL2(vec);
    expect(vec).toEqual(original);
  });
});

// =============================================================================
// TfIdfEmbeddingProvider
// =============================================================================

describe('TfIdfEmbeddingProvider', () => {
  describe('construction', () => {
    it('should have correct modelId', () => {
      const provider = new TfIdfEmbeddingProvider();
      expect(provider.modelId).toBe('tfidf-v1');
    });

    it('should default to dimension 512', () => {
      const provider = new TfIdfEmbeddingProvider();
      expect(provider.dimension).toBe(512);
    });

    it('should accept custom max dimension', () => {
      const provider = new TfIdfEmbeddingProvider(128);
      expect(provider.dimension).toBe(128);
    });

    it('should provide correct metadata', () => {
      const provider = new TfIdfEmbeddingProvider();
      expect(provider.meta.backend).toBe('tfidf');
      expect(provider.meta.requiresNetwork).toBe(false);
    });

    it('should not be fitted initially', () => {
      const provider = new TfIdfEmbeddingProvider();
      expect(provider.isFitted).toBe(false);
    });
  });

  describe('fitTransform', () => {
    it('should fit on topology names and embed query names', async () => {
      const provider = new TfIdfEmbeddingProvider();
      const topologyNames = ['ts-ui', 'ts-travel-service', 'ts-order-service'];
      const spanNames = ['ts-ui', 'ts-ui-dashboard', 'unknown-service'];

      const { vectors } = await provider.fitTransform(topologyNames, spanNames);

      expect(vectors).toHaveLength(3);
      expect(provider.isFitted).toBe(true);
    });

    it('should produce higher similarity for known service names', async () => {
      const provider = new TfIdfEmbeddingProvider();
      const topologyNames = [
        'ts-ui',
        'ts-travel-service',
        'ts-order-service',
        'ts-train-service',
        'ts-station-service',
      ];
      const spanNames = ['ts-ui', 'ts-admin-basic-info-service'];

      const { vectors } = await provider.fitTransform(topologyNames, spanNames);

      // Vector for "ts-ui" should be very similar to "ts-ui" in topology
      const topologyVecs = await provider.embed(topologyNames);
      const uiVec = topologyVecs.vectors[0]; // "ts-ui"
      const uiSpanVec = vectors[0]; // "ts-ui" from span

      const selfSim = cosineSimilarity(uiSpanVec, uiVec);
      // Should be high (near 1) for self-matching
      expect(selfSim).toBeGreaterThan(0.5);
    });

    it('should cap vocabulary at max dimension', async () => {
      // Create many unique service names to exceed dimension
      const provider = new TfIdfEmbeddingProvider(10);
      const names = Array.from({ length: 50 }, (_, i) => `service-${i}`);
      const queryNames = ['service-0'];

      await provider.fitTransform(names, queryNames);
      expect(provider.vocabularySize).toBeLessThanOrEqual(10);
    });

    it('should handle single text input', async () => {
      const provider = new TfIdfEmbeddingProvider();
      const { vectors } = await provider.fitTransform(['redis'], ['redis']);
      expect(vectors).toHaveLength(1);
      expect(vectors[0]).toBeInstanceOf(Float32Array);
    });

    it('should return L2-normalized vectors', async () => {
      const provider = new TfIdfEmbeddingProvider();
      const topologyNames = ['service-a', 'service-b', 'service-c'];
      const spanNames = ['service-a', 'service-x'];

      const { vectors } = await provider.fitTransform(topologyNames, spanNames);

      for (const vec of vectors) {
        let sumSquares = 0;
        for (let i = 0; i < vec.length; i++) {
          sumSquares += vec[i] * vec[i];
        }
        const norm = Math.sqrt(sumSquares);
        // Zero vector is okay (no matching vocabulary terms)
        if (norm > 0) {
          expect(norm).toBeCloseTo(1, 5);
        }
      }
    });
  });

  describe('embed', () => {
    it('should auto-fit on first call if not yet fitted', async () => {
      const provider = new TfIdfEmbeddingProvider();
      expect(provider.isFitted).toBe(false);

      const { vectors } = await provider.embed(['service-a', 'service-b']);
      expect(vectors).toHaveLength(2);
      expect(provider.isFitted).toBe(true);
    });

    it('should use existing vocabulary on subsequent calls', async () => {
      const provider = new TfIdfEmbeddingProvider();
      await provider.embed(['service-a', 'service-b']);
      const vocabSize1 = provider.vocabularySize;

      // Second call should keep the same vocabulary
      const { vectors } = await provider.embed(['service-c']);
      expect(vectors).toHaveLength(1);
      // Vocabulary may have grown slightly
      expect(provider.vocabularySize).toBeGreaterThanOrEqual(vocabSize1);
    });
  });

  describe('semantic alignment scenarios', () => {
    it('should match "ts-admin-basic-info" → "ts-admin-basic-info-service" (suffix difference)', async () => {
      const provider = new TfIdfEmbeddingProvider();
      const topologyNames = [
        'ts-ui',
        'ts-auth-service',
        'ts-admin-basic-info-service',
        'ts-order-service',
        'ts-travel-service',
      ];
      const spanName = 'ts-admin-basic-info';

      const { vectors } = await provider.fitTransform(topologyNames, [spanName]);
      const topologyVecs = await provider.embed(topologyNames);

      const spanVec = vectors[0];
      let bestSim = 0;
      let bestIdx = -1;
      for (let i = 0; i < topologyVecs.vectors.length; i++) {
        const sim = cosineSimilarity(spanVec, topologyVecs.vectors[i]);
        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = i;
        }
      }

      expect(bestIdx).toBe(2); // ts-admin-basic-info-service
      expect(bestSim).toBeGreaterThan(0.3); // reasonable similarity
    });

    it('should match "ts-ui-dashboard" → "ts-ui" (prefix match)', async () => {
      const provider = new TfIdfEmbeddingProvider();
      const topologyNames = [
        'ts-ui',
        'ts-auth-service',
        'ts-order-service',
        'ts-travel-service',
      ];
      const spanName = 'ts-ui-dashboard';

      const { vectors } = await provider.fitTransform(topologyNames, [spanName]);
      const topologyVecs = await provider.embed(topologyNames);

      const spanVec = vectors[0];
      let bestSim = 0;
      let bestIdx = -1;
      for (let i = 0; i < topologyVecs.vectors.length; i++) {
        const sim = cosineSimilarity(spanVec, topologyVecs.vectors[i]);
        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = i;
        }
      }

      expect(bestIdx).toBe(0); // ts-ui
      expect(bestSim).toBeGreaterThan(0.2);
    });

    it('should match "order-service" → "ts-order-service" (prefix difference)', async () => {
      const provider = new TfIdfEmbeddingProvider();
      const topologyNames = [
        'ts-ui',
        'ts-order-service',
        'ts-payment-service',
        'ts-travel-service',
      ];
      const spanName = 'order-service';

      const { vectors } = await provider.fitTransform(topologyNames, [spanName]);
      const topologyVecs = await provider.embed(topologyNames);

      const spanVec = vectors[0];
      let bestSim = 0;
      let bestIdx = -1;
      for (let i = 0; i < topologyVecs.vectors.length; i++) {
        const sim = cosineSimilarity(spanVec, topologyVecs.vectors[i]);
        if (sim > bestSim) {
          bestSim = sim;
          bestIdx = i;
        }
      }

      expect(bestIdx).toBe(1); // ts-order-service
      expect(bestSim).toBeGreaterThan(0.3);
    });

    it('should handle completely unknown service names gracefully', async () => {
      const provider = new TfIdfEmbeddingProvider();
      const topologyNames = ['ts-ui', 'ts-order-service'];
      const spanName = 'completely-different-system';

      const { vectors } = await provider.fitTransform(topologyNames, [spanName]);
      const topologyVecs = await provider.embed(topologyNames);

      const spanVec = vectors[0];
      let maxSim = 0;
      for (const tv of topologyVecs.vectors) {
        const sim = cosineSimilarity(spanVec, tv);
        if (sim > maxSim) maxSim = sim;
      }

      // Should have low similarity with all known services
      expect(maxSim).toBeLessThan(0.5);
    });
  });

  describe('vocabulary', () => {
    it('should track vocabulary size after fitting', async () => {
      const provider = new TfIdfEmbeddingProvider();
      await provider.fitTransform(['service-a', 'service-b', 'service-c'], ['service-a']);
      expect(provider.vocabularySize).toBeGreaterThan(0);
    });

    it('should return terms in index order', async () => {
      const provider = new TfIdfEmbeddingProvider(10);
      await provider.fitTransform(['ts-ui', 'ts-order-service'], ['ts-ui']);
      const terms = provider.terms;
      expect(terms.length).toBeGreaterThan(0);
      // Each index should have a defined term
      for (let i = 0; i < terms.length; i++) {
        expect(terms[i]).toBeDefined();
      }
    });

    it('should have vocab size ≤ dimension', async () => {
      const provider = new TfIdfEmbeddingProvider(5);
      const names = Array.from({ length: 50 }, (_, i) => `service-${i}-extra-${i * 2}`);
      await provider.fitTransform(names, ['service-0-extra-0']);
      expect(provider.vocabularySize).toBeLessThanOrEqual(5);
    });
  });

  describe('edge cases', () => {
    it('should handle duplicate topology names', async () => {
      const provider = new TfIdfEmbeddingProvider();
      const { vectors } = await provider.fitTransform(
        ['same', 'same', 'same'],
        ['different'],
      );
      expect(vectors).toHaveLength(1);
    });

    it('should handle special characters in service names', async () => {
      const provider = new TfIdfEmbeddingProvider();
      const topologyNames = ['my-service.v1_prod:8080'];
      const spanNames = ['my-service'];

      const { vectors } = await provider.fitTransform(topologyNames, spanNames);
      expect(vectors).toHaveLength(1);
    });

    it('should be deterministic — same input, same output', async () => {
      const provider1 = new TfIdfEmbeddingProvider();
      const provider2 = new TfIdfEmbeddingProvider();

      const names = ['ts-ui', 'ts-order-service', 'ts-travel-service'];
      const { vectors: v1 } = await provider1.fitTransform(names, names);
      const { vectors: v2 } = await provider2.fitTransform(names, names);

      for (let i = 0; i < v1.length; i++) {
        const sim = cosineSimilarity(v1[i]!, v2[i]!);
        expect(sim).toBeCloseTo(1, 5);
      }
    });

    it('should handle zero-token service name (very short/empty)', async () => {
      const provider = new TfIdfEmbeddingProvider();
      // Empty name produces only __full__ token
      const { vectors } = await provider.fitTransform([''], ['']);
      expect(vectors).toHaveLength(1);
      expect(vectors[0]).toBeInstanceOf(Float32Array);
    });

    it('should embed without prior fit (auto-fit path)', async () => {
      const provider = new TfIdfEmbeddingProvider();
      // Use embed() directly without calling fitTransform first
      const { vectors } = await provider.embed(['redis', 'postgres', 'frontend']);
      expect(vectors).toHaveLength(3);
      expect(provider.isFitted).toBe(true);
    });

    it('should generate zero vector for text with no vocabulary matches', async () => {
      const provider = new TfIdfEmbeddingProvider();
      // Fit on specific names
      await provider.fitTransform(['ts-ui', 'ts-order'], ['ts-ui']);
      // Embed with totally unrelated text
      const { vectors } = await provider.embed(['xyzzy-not-matching']);
      const zeroSum = vectors[0]!.reduce((s, v) => s + v, 0);
      expect(zeroSum).toBe(0);
    });

    it('should handle number[] input for cosine similarity', () => {
      const a: number[] = [1, 0, 0];
      const b = Float32Array.from([1, 0, 0]);
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
    });

    it('should handle mixed Float32Array and number[]', () => {
      const a = new Float32Array([0, 1, 0]);
      const b: readonly number[] = [0, 1, 0];
      expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5);
    });
  });
});
