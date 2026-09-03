/**
 * Unit tests for Vendor-Agnostic EmbeddingProvider implementations.
 *
 * Tests cover:
 * - ApiEmbeddingConfig resolution with defaults
 * - ApiEmbeddingProvider construction, meta, dimension
 * - ApiEmbeddingProvider: empty input, batch chunking, error handling
 * - createApiEmbeddingFromEnv factory
 * - Custom format request/response mappers
 * - Retry behavior (mocked)
 * - normalize toggle
 *
 * Uses vi.fn() for fetch mocking via _setFetch() injection.
 *
 * @module ai/__tests__/unit/api-embedding
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  resolveApiEmbeddingConfig,
  DEFAULT_RETRY_CONFIG,
} from '../../src/providers/api-embedding-config.js';
import type {
  ApiEmbeddingConfigInput,
} from '../../src/providers/api-embedding-config.js';
import { ApiEmbeddingProvider } from '../../src/providers/api-embedding.js';
import { createApiEmbeddingFromEnv } from '../../src/providers/env-embedding.js';

// ── Helpers ───────────────────────────────────────────────

function mockEmbeddingResponse(vectors: number[][]): object {
  return {
    object: 'list',
    data: vectors.map((embedding, index) => ({ object: 'embedding', embedding, index })),
    model: 'test-model',
    usage: { prompt_tokens: 10, total_tokens: 10 },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const DIM_4_CONFIG: ApiEmbeddingConfigInput = {
  endpoint: 'https://api.example.com/v1/embeddings',
  model: 'test-model',
  dimension: 4,
};

// ── ApiEmbeddingConfig ────────────────────────────────────

describe('ApiEmbeddingConfig', () => {
  it('should resolve partial config with defaults', () => {
    const resolved = resolveApiEmbeddingConfig(DIM_4_CONFIG);
    expect(resolved.endpoint).toBe('https://api.example.com/v1/embeddings');
    expect(resolved.model).toBe('test-model');
    expect(resolved.dimension).toBe(4);
    expect(resolved.format).toBe('openai-compatible');
    expect(resolved.timeoutMs).toBe(30000);
    expect(resolved.retry).toEqual(DEFAULT_RETRY_CONFIG);
    expect(resolved.normalize).toBe(true);
    expect(resolved.maxBatchSize).toBe(32);
  });

  it('should preserve explicit overrides', () => {
    const resolved = resolveApiEmbeddingConfig({
      ...DIM_4_CONFIG,
      format: 'custom',
      timeoutMs: 5000,
      normalize: false,
      maxBatchSize: 8,
    });
    expect(resolved.format).toBe('custom');
    expect(resolved.timeoutMs).toBe(5000);
    expect(resolved.normalize).toBe(false);
    expect(resolved.maxBatchSize).toBe(8);
  });

  it('should preserve custom headers', () => {
    const resolved = resolveApiEmbeddingConfig({
      ...DIM_4_CONFIG,
      headers: { 'X-Custom': 'value', Authorization: 'Bearer token' },
    });
    expect(resolved.headers).toEqual({
      'X-Custom': 'value',
      'Authorization': 'Bearer token',
    });
  });
});

// ── ApiEmbeddingProvider ──────────────────────────────────

describe('ApiEmbeddingProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('construction and metadata', () => {
    it('should expose modelId and dimension from config', () => {
      const p = new ApiEmbeddingProvider(DIM_4_CONFIG);
      expect(p.modelId).toBe('test-model');
      expect(p.dimension).toBe(4);
    });

    it('should expose meta information', () => {
      const p = new ApiEmbeddingProvider(DIM_4_CONFIG);
      expect(p.meta.name).toBe('api-embedding:test-model');
      expect(p.meta.backend).toBe('api');
      expect(p.meta.requiresNetwork).toBe(true);
    });
  });

  describe('embed — empty input', () => {
    it('should return empty vectors for empty input', async () => {
      const p = new ApiEmbeddingProvider(DIM_4_CONFIG);
      const result = await p.embed([]);
      expect(result.vectors).toHaveLength(0);
    });
  });

  describe('embed — basic response', () => {
    it('should parse embeddings and normalize by default', async () => {
      const p = new ApiEmbeddingProvider(DIM_4_CONFIG);
      const mockFetch = vi.fn().mockResolvedValue(
        jsonResponse(mockEmbeddingResponse([[1, 0, 0, 0], [0, 1, 0, 0]])),
      );
      p._setFetch(mockFetch);

      const result = await p.embed(['service-a', 'service-b']);
      expect(result.vectors).toHaveLength(2);
      expect(result.vectors[0]![0]).toBeCloseTo(1, 5);
      expect(result.vectors[0]![1]).toBeCloseTo(0, 5);
      expect(result.vectors[1]![0]).toBeCloseTo(0, 5);
      expect(result.vectors[1]![1]).toBeCloseTo(1, 5);
    });

    it('should normalize non-unit vectors', async () => {
      const p = new ApiEmbeddingProvider(DIM_4_CONFIG);
      p._setFetch(vi.fn().mockResolvedValue(
        jsonResponse(mockEmbeddingResponse([[3, 4, 0, 0]])),
      ));

      const result = await p.embed(['service-a']);
      expect(result.vectors[0]![0]).toBeCloseTo(0.6, 5);
      expect(result.vectors[0]![1]).toBeCloseTo(0.8, 5);
    });

    it('should skip normalization when normalize=false', async () => {
      const p = new ApiEmbeddingProvider({ ...DIM_4_CONFIG, normalize: false });
      p._setFetch(vi.fn().mockResolvedValue(
        jsonResponse(mockEmbeddingResponse([[3, 4, 0, 0]])),
      ));

      const result = await p.embed(['service-a']);
      expect(result.vectors[0]![0]).toBeCloseTo(3, 5);
      expect(result.vectors[0]![1]).toBeCloseTo(4, 5);
    });
  });

  describe('batch chunking', () => {
    it('should split large batches by maxBatchSize', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation((_url, init: RequestInit) => {
        callCount++;
        // Return embeddings matching the chunk size
        const reqBody = JSON.parse(init.body as string);
        const inputLen = Array.isArray(reqBody.input) ? reqBody.input.length : 1;
        return Promise.resolve(
          jsonResponse(
            mockEmbeddingResponse(
              Array.from({ length: inputLen }, () => [1, 0, 0, 0]),
            ),
          ),
        );
      });

      const p = new ApiEmbeddingProvider({ ...DIM_4_CONFIG, maxBatchSize: 2 });
      p._setFetch(mockFetch);

      const result = await p.embed(['a', 'b', 'c', 'd']);
      expect(callCount).toBe(2);
      expect(result.vectors).toHaveLength(4);
    });

    it('should handle single chunk when input ≤ maxBatchSize', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(
          jsonResponse(mockEmbeddingResponse([[1, 0, 0, 0], [0, 1, 0, 0]])),
        );
      });

      const p = new ApiEmbeddingProvider({ ...DIM_4_CONFIG, maxBatchSize: 32 });
      p._setFetch(mockFetch);

      const result = await p.embed(['a', 'b']);
      expect(callCount).toBe(1);
      expect(result.vectors).toHaveLength(2);
    });
  });

  describe('error handling', () => {
    it('should throw on non-200 response', async () => {
      const p = new ApiEmbeddingProvider({
        ...DIM_4_CONFIG,
        retry: {
          maxAttempts: 1,
          initialDelayMs: 10,
          backoffMultiplier: 2.0,
          retryableStatuses: [429, 502, 503],
        },
      });
      p._setFetch(vi.fn().mockResolvedValue(
        new Response('Unauthorized', { status: 401 }),
      ));

      await expect(p.embed(['service-a'])).rejects.toThrow(
        'Embedding API error 401',
      );
    });

    it('should throw on invalid response shape', async () => {
      const p = new ApiEmbeddingProvider(DIM_4_CONFIG);
      p._setFetch(vi.fn().mockResolvedValue(
        jsonResponse({ error: 'something went wrong' }),
      ));

      await expect(p.embed(['service-a'])).rejects.toThrow(
        'Invalid embedding API response',
      );
    });

    it('should throw on dimension mismatch', async () => {
      const p = new ApiEmbeddingProvider(DIM_4_CONFIG);
      p._setFetch(vi.fn().mockResolvedValue(
        jsonResponse(mockEmbeddingResponse([[1, 0, 0, 0, 0, 0, 0, 0]])),
      ));

      await expect(p.embed(['service-a'])).rejects.toThrow(
        'Embedding dimension mismatch',
      );
    });
  });

  describe('custom format', () => {
    it('should use custom request mapper', async () => {
      let capturedBody: unknown = null;
      const mockFetch = vi.fn().mockImplementation((_url, init: RequestInit) => {
        capturedBody = JSON.parse(init.body as string);
        return Promise.resolve(
          jsonResponse({ vectors: [[1, 0, 0, 0], [0, 1, 0, 0]] }),
        );
      });

      const p = new ApiEmbeddingProvider({
        ...DIM_4_CONFIG,
        format: 'custom',
        mapRequest: (texts) => ({ texts, model: 'custom-model', encoding: 'float' }),
        mapResponse: (data) => {
          const typed = data as { vectors: number[][] };
          return typed.vectors.map((v) => new Float32Array(v));
        },
      });
      p._setFetch(mockFetch);

      const result = await p.embed(['a', 'b']);
      expect(capturedBody).toEqual({
        texts: ['a', 'b'],
        model: 'custom-model',
        encoding: 'float',
      });
      expect(result.vectors).toHaveLength(2);
    });

    it('should throw without custom response mapper in custom format', async () => {
      const p = new ApiEmbeddingProvider({ ...DIM_4_CONFIG, format: 'custom' });
      p._setFetch(vi.fn().mockResolvedValue(
        jsonResponse({ vectors: [[1, 0, 0, 0]] }),
      ));

      await expect(p.embed(['a'])).rejects.toThrow(
        'Invalid embedding API response',
      );
    });
  });

  describe('retry behavior', () => {
    it('should retry on 429 with exponential backoff', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.resolve(
            new Response('Rate limited', { status: 429 }),
          );
        }
        return Promise.resolve(
          jsonResponse(mockEmbeddingResponse([[1, 0, 0, 0]])),
        );
      });

      const p = new ApiEmbeddingProvider({
        ...DIM_4_CONFIG,
        retry: {
          maxAttempts: 5,
          initialDelayMs: 10,
          backoffMultiplier: 2.0,
          retryableStatuses: [429],
        },
      });
      p._setFetch(mockFetch);

      const result = await p.embed(['service-a']);
      expect(callCount).toBe(3);
      expect(result.vectors).toHaveLength(1);
    });

    it('should throw after exhausting retries', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        new Response('Server error', { status: 502 }),
      );

      const p = new ApiEmbeddingProvider({
        ...DIM_4_CONFIG,
        retry: {
          maxAttempts: 2,
          initialDelayMs: 10,
          backoffMultiplier: 2.0,
          retryableStatuses: [502],
        },
      });
      p._setFetch(mockFetch);

      // Last retry attempt with retryable status → throws with "(retries exhausted)"
      await expect(p.embed(['service-a'])).rejects.toThrow(
        /Embedding API error 502/,
      );
    });

    it('should retry on transient network errors before succeeding', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          // Reject with a network error (not an HTTP response)
          return Promise.reject(new Error('connection reset'));
        }
        return Promise.resolve(
          jsonResponse(mockEmbeddingResponse([[1, 0, 0, 0]])),
        );
      });

      const p = new ApiEmbeddingProvider({
        ...DIM_4_CONFIG,
        retry: {
          maxAttempts: 5,
          initialDelayMs: 10,
          backoffMultiplier: 2.0,
          retryableStatuses: [429, 502, 503],
        },
      });
      p._setFetch(mockFetch);

      const result = await p.embed(['service-a']);
      expect(callCount).toBe(3);
      expect(result.vectors).toHaveLength(1);
    });

    it('should throw the last network error after retries are exhausted', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('DNS lookup failed'));

      const p = new ApiEmbeddingProvider({
        ...DIM_4_CONFIG,
        retry: {
          maxAttempts: 2,
          initialDelayMs: 10,
          backoffMultiplier: 2.0,
          retryableStatuses: [429, 502, 503],
        },
      });
      p._setFetch(mockFetch);

      // Both attempts reject → the final (non-abort) error is re-thrown on the last attempt
      await expect(p.embed(['service-a'])).rejects.toThrow('DNS lookup failed');
    });

    it('should throw immediately on abort (timeout) without retrying', async () => {
      const abortError = Object.assign(new Error('The operation was aborted.'), {
        name: 'AbortError',
      });
      const mockFetch = vi.fn().mockRejectedValue(abortError);

      const p = new ApiEmbeddingProvider({
        ...DIM_4_CONFIG,
        timeoutMs: 1234,
        retry: {
          maxAttempts: 5,
          initialDelayMs: 10,
          backoffMultiplier: 2.0,
          retryableStatuses: [429, 502, 503],
        },
      });
      p._setFetch(mockFetch);

      // AbortError is detected and re-thrown as a timeout on the first attempt
      await expect(p.embed(['service-a'])).rejects.toThrow(
        'Embedding API timeout after 1234ms',
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should normalize a non-Error rejection into an Error', async () => {
      // Fetch rejects with a plain string (not an Error instance)
      const mockFetch = vi.fn().mockRejectedValue('malformed response');

      const p = new ApiEmbeddingProvider({
        ...DIM_4_CONFIG,
        retry: {
          maxAttempts: 1,
          initialDelayMs: 10,
          backoffMultiplier: 2.0,
          retryableStatuses: [429, 502, 503],
        },
      });
      p._setFetch(mockFetch);

      // Non-Error rejection → wrapped via `new Error(String(err))` → re-thrown
      await expect(p.embed(['service-a'])).rejects.toThrow('malformed response');
    });
  });
});

// ── createApiEmbeddingFromEnv ─────────────────────────────

describe('createApiEmbeddingFromEnv', () => {
  afterEach(() => {
    delete process.env.TEST_VENDOR_API_KEY;
  });

  it('should create provider from env variables', () => {
    process.env.TEST_VENDOR_API_KEY = 'test-key-123';
    const provider = createApiEmbeddingFromEnv({
      vendorPrefix: 'TEST_VENDOR',
      endpoint: 'https://api.test.com/v1/embeddings',
      model: 'test-embedding',
      dimension: 128,
    });
    expect(provider.modelId).toBe('test-embedding');
    expect(provider.dimension).toBe(128);
  });

  it('should return null without API key (no auth header)', () => {
    const provider = createApiEmbeddingFromEnv({
      vendorPrefix: 'MISSING_VENDOR',
      endpoint: 'https://api.test.com/v1/embeddings',
      model: 'test-embedding',
      dimension: 128,
    });
    expect(provider).toBeNull();
  });

  it('should merge extra headers', () => {
    process.env.TEST_VENDOR_API_KEY = 'test-key';
    const provider = createApiEmbeddingFromEnv({
      vendorPrefix: 'TEST_VENDOR',
      endpoint: 'https://api.test.com/v1/embeddings',
      model: 'test-embedding',
      dimension: 128,
      extraHeaders: { 'X-App': 'micro-kinetic' },
    });
    expect(provider.modelId).toBe('test-embedding');
  });
});

// ── DEFAULT_RETRY_CONFIG ──────────────────────────────────

describe('DEFAULT_RETRY_CONFIG', () => {
  it('should have expected default values', () => {
    expect(DEFAULT_RETRY_CONFIG.maxAttempts).toBe(3);
    expect(DEFAULT_RETRY_CONFIG.initialDelayMs).toBe(1000);
    expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).toBe(2.0);
    expect(DEFAULT_RETRY_CONFIG.retryableStatuses).toContain(429);
    expect(DEFAULT_RETRY_CONFIG.retryableStatuses).toContain(502);
    expect(DEFAULT_RETRY_CONFIG.retryableStatuses).toContain(503);
  });
});
