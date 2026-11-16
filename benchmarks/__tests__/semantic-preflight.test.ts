/**
 * The provider is asked once, before the corpus walk, and its refusal is never converted into a number.
 *
 * @module benchmarks/__tests__/semantic-preflight.test
 */

import type { IEmbeddingProvider } from '@agentix-e/micro-kinetic-ai';
import { describe, expect, it } from 'vitest';

import {
  formatTopologyLine,
  parseEmbeddingFallback,
  preflightSemanticConfig,
  PROBE_TEXTS,
} from '../src/semantic-preflight.js';

/** The refusal the Zhipu account gave on run 43901259774, abbreviated as it appears in the log. */
const QUOTA =
  'Embedding API error 429 (retries exhausted): {"error":{"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}}';

/** An API provider that refuses, for a reason the test supplies. */
function refusingApiProvider(reason = QUOTA): IEmbeddingProvider & { calls: number } {
  const provider = {
    modelId: 'embedding-3',
    dimension: 2048,
    meta: { name: 'api-embedding:embedding-3', backend: 'api', requiresNetwork: true },
    calls: 0,
    async embed(): Promise<{ vectors: readonly Float32Array[] }> {
      provider.calls++;
      throw new Error(reason);
    },
  };
  return provider;
}

/** An API provider that answers. */
function answeringApiProvider(): IEmbeddingProvider & { calls: number } {
  const provider = {
    modelId: 'embedding-3',
    dimension: 2048,
    meta: { name: 'api-embedding:embedding-3', backend: 'api', requiresNetwork: true },
    calls: 0,
    async embed(texts: readonly string[]): Promise<{ vectors: readonly Float32Array[] }> {
      provider.calls++;
      return { vectors: texts.map(() => new Float32Array(2048).fill(0.1)) };
    },
  };
  return provider;
}

/** A local provider, which no policy may probe or replace. */
function localProvider(): IEmbeddingProvider & { calls: number } {
  const provider = {
    modelId: 'tfidf',
    dimension: 1024,
    meta: { name: 'tfidf', backend: 'tfidf', requiresNetwork: false },
    calls: 0,
    async embed(texts: readonly string[]): Promise<{ vectors: readonly Float32Array[] }> {
      provider.calls++;
      return { vectors: texts.map(() => new Float32Array(1024).fill(0.05)) };
    },
  };
  return provider;
}

/** A local factory that reports whether it was called at all. */
function localFactory(): { calls: number; make: () => Promise<IEmbeddingProvider> } {
  const state = {
    calls: 0,
    async make(): Promise<IEmbeddingProvider> {
      state.calls++;
      return localProvider();
    },
  };
  return state;
}

describe('embedding fallback policy', () => {
  it('defaults to abort when the variable is unset or empty', () => {
    expect(parseEmbeddingFallback(undefined)).toBe('abort');
    expect(parseEmbeddingFallback('')).toBe('abort');
  });

  it('accepts the two members it names, and refuses any other value', () => {
    expect(parseEmbeddingFallback('abort')).toBe('abort');
    expect(parseEmbeddingFallback('local')).toBe('local');
    expect(() => parseEmbeddingFallback('tfidf')).toThrow(/abort or local/);
    expect(() => parseEmbeddingFallback('TRUE')).toThrow(/abort or local/);
  });
});

describe('semantic preflight', () => {
  it('runs the configured provider unchanged when it answers the probe', async () => {
    const provider = answeringApiProvider();
    const result = await preflightSemanticConfig({ embeddingProvider: provider });
    expect(result.backend).toBe('api');
    expect(result.degradation).toBeUndefined();
    expect(result.config.embeddingProvider).toBe(provider);
    expect(provider.calls).toBe(1);
  });

  it('does not probe a local provider, because a local provider cannot lose its balance', async () => {
    const provider = localProvider();
    const result = await preflightSemanticConfig({ embeddingProvider: provider });
    expect(result.backend).toBe('tfidf');
    expect(provider.calls).toBe(0);
    expect(result.degradation).toBeUndefined();
  });

  it('names backend "none" for a config with no provider, rather than inventing one', async () => {
    const result = await preflightSemanticConfig({});
    expect(result.backend).toBe('none');
  });

  it('refuses to run on a refusal, naming the provider and the reason and the way out', async () => {
    // The default policy. The message has to carry the three things a reader needs: WHICH provider did not
    // answer, WHY, and what to do instead — the run this file exists for printed none of them and
    // measured anyway.
    const provider = refusingApiProvider();
    const factory = localFactory();
    const run = preflightSemanticConfig(
      { embeddingProvider: provider },
      { makeLocalProvider: factory.make },
    );
    await expect(run).rejects.toThrow(/api-embedding:embedding-3 is unavailable/);
    await expect(run).rejects.toThrow(/429/);
    await expect(run).rejects.toThrow(/BENCHMARK_EMBEDDING_FALLBACK=local/);
    // The refused arm must not build the local provider: a run that aborts has no use for it, and a
    // factory called on the abort path would be a second thing the refusal silently did.
    expect(factory.calls).toBe(0);
  });

  it('substitutes the local provider ONLY when the policy asks for it, and records the substitution', async () => {
    const provider = refusingApiProvider();
    const factory = localFactory();
    const result = await preflightSemanticConfig(
      { embeddingProvider: provider },
      { fallback: 'local', makeLocalProvider: factory.make },
    );
    expect(result.backend).toBe('tfidf');
    expect(result.config.embeddingProvider).not.toBe(provider);
    expect(result.degradation).toBeDefined();
    expect(result.degradation!.from).toBe('api-embedding:embedding-3');
    expect(result.degradation!.to).toBe('tfidf');
    expect(result.degradation!.reason).toContain('429');
    expect(factory.calls).toBe(1);
  });

  it('keeps the rest of the config when it substitutes, and swaps only the provider', async () => {
    const provider = refusingApiProvider();
    const result = await preflightSemanticConfig(
      { embeddingProvider: provider, alignmentConfig: { embeddingThreshold: 0.7 } },
      { fallback: 'local', makeLocalProvider: localFactory().make },
    );
    expect(result.config.alignmentConfig).toEqual({ embeddingThreshold: 0.7 });
    expect(result.config.llmProvider).toBeUndefined();
  });

  it('builds the REAL local provider on the production path, with no factory injected', async () => {
    // The path a dispatch takes: `BENCHMARK_EMBEDDING_FALLBACK=local` and nothing else. It is asserted on the
    // real provider rather than on an injected one because the substitution has to work when nobody wired it —
    // and because the lazy import is the one statement a fake factory hides: a typo in the module name would
    // pass every test above and fail on the only run that degrades.
    const provider = refusingApiProvider();
    const result = await preflightSemanticConfig(
      { embeddingProvider: provider },
      { fallback: 'local' },
    );
    expect(result.backend).toBe('tfidf');
    // The provider's own name, which is `TF-IDF` rather than the backend id: the degradation record has to
    // identify the thing that ran, not the family it belongs to.
    expect(result.degradation!.to).toBe('TF-IDF');
    // And the substitute really embeds, so a run that degrades still aligns: two texts in, two vectors out.
    const { vectors } = await result.config.embeddingProvider!.embed([
      'ts-auth-service',
      'adservice',
    ]);
    expect(vectors).toHaveLength(2);
  });

  it('truncates a long refusal so one error message cannot flood the log', async () => {
    const provider = refusingApiProvider('x'.repeat(1000));
    const result = await preflightSemanticConfig(
      { embeddingProvider: provider },
      { fallback: 'local', makeLocalProvider: localFactory().make },
    );
    expect(result.degradation!.reason.length).toBe(200);
  });

  it('fails a provider that answers without embedding anything', async () => {
    // The arity check is the default probe's, and this is the fixture that proves the probe reads the
    // RESULT rather than only the absence of a throw: a provider returning `{ vectors: [] }` has not
    // embedded anything, and alignment against an empty vector set matches nothing while looking healthy.
    const provider: IEmbeddingProvider = {
      modelId: 'silent',
      dimension: 8,
      meta: { name: 'silent', backend: 'api', requiresNetwork: true },
      async embed(): Promise<{ vectors: readonly Float32Array[] }> {
        return { vectors: [] };
      },
    };
    await expect(preflightSemanticConfig({ embeddingProvider: provider })).rejects.toThrow(
      /returned 0 of 2 vectors/,
    );
  });

  it('probes with two texts, so an empty answer is distinguishable from a one-text answer', async () => {
    expect(PROBE_TEXTS.length).toBe(2);
  });

  it('labels a provider that reports no backend as unknown, and does not probe it', async () => {
    // `meta` is OPTIONAL on the interface by design (it is aligned with log-parser-core, so requiring it would
    // force every external provider to grow one). A provider that does not say it is an API provider must not be
    // assumed to be one: probing it would be a network call the run did not ask for, and calling it `api` would
    // put a name on the configuration line that nothing verified.
    let probed = 0;
    const provider: IEmbeddingProvider = {
      modelId: 'opaque',
      dimension: 4,
      async embed(texts: readonly string[]): Promise<{ vectors: readonly Float32Array[] }> {
        probed++;
        return { vectors: texts.map(() => new Float32Array(4).fill(0.5)) };
      },
    };
    const result = await preflightSemanticConfig({ embeddingProvider: provider });
    expect(result.backend).toBe('unknown');
    expect(probed).toBe(0);
    expect(result.config.embeddingProvider).toBe(provider);
  });

  it('names a substitute by its model id when it carries no meta', async () => {
    // The other shape `nameOf` has to answer for: an injected local provider that reports no metadata. A
    // degradation record whose `to` field were blank would leave the artifact saying it degraded into nothing.
    const provider = refusingApiProvider();
    const bare: IEmbeddingProvider = {
      modelId: 'bare-local',
      dimension: 4,
      async embed(texts: readonly string[]): Promise<{ vectors: readonly Float32Array[] }> {
        return { vectors: texts.map(() => new Float32Array(4).fill(0.5)) };
      },
    };
    const result = await preflightSemanticConfig(
      { embeddingProvider: provider },
      { fallback: 'local', makeLocalProvider: async () => bare },
    );
    expect(result.degradation!.to).toBe('bare-local');
    expect(result.backend).toBe('unknown');
  });

  it('reports a non-Error refusal as its string form rather than losing the reason', async () => {
    // A provider, or a transport under it, may reject with a string. The degradation record is the only place a
    // reader learns WHY the run is degraded, so the reason has to survive whatever shape it arrives in.
    const provider = refusingApiProvider();
    const result = await preflightSemanticConfig(
      { embeddingProvider: provider },
      {
        fallback: 'local',
        probe: async () => {
          throw 'quota exhausted';
        },
        makeLocalProvider: localFactory().make,
      },
    );
    expect(result.degradation!.reason).toBe('quota exhausted');
  });
});

describe('topology configuration line', () => {
  it('names the backend that built the semantic edges', () => {
    expect(formatTopologyLine({ backend: 'api' })).toBe('topology: yaml-v2 + semantic(api)');
    expect(formatTopologyLine({ backend: 'tfidf' })).toBe('topology: yaml-v2 + semantic(tfidf)');
  });

  it('marks a degraded run as degraded, and states what it degraded from', () => {
    // The artifact-level consequence of the policy: a substituted run must not be able to present itself as
    // an API-embedded one, because the two produce different edges and therefore different cells.
    const line = formatTopologyLine({
      backend: 'tfidf',
      degradation: { from: 'api-embedding:embedding-3', to: 'tfidf', reason: QUOTA.slice(0, 200) },
    });
    expect(line).toContain('DEGRADED');
    expect(line).toContain('from api-embedding:embedding-3');
    expect(line).toContain('429');
  });
});
