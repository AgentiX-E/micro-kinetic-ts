/**
 * The semantic-alignment provider is probed BEFORE the corpus is walked, and a failure is declared.
 *
 * The defect this file exists for is run 43901259774. The Zhipu account behind `ZHIPU_API_KEY` ran out
 * of balance; every alignment call answered `429 {"code":"1113","message":"Insufficient balance…"}`; the
 * loader swallowed one such failure per case; and the run went on to print nine cells, three of which were
 * `0.0%` over an empty denominator and one of which was empty enough to make the loss census report "no
 * cases found". The run took fourteen minutes to reach that state, and nothing in it failed.
 *
 * A provider that cannot answer is not a provider that answered zero. So it is asked one question before
 * any work starts, and there are exactly two honest responses to a refusal:
 *
 *   - `abort` (the default) — stop before the corpus walk, name the provider and the reason, and exit
 *     non-zero. The published configuration is the API-embedded one; a run that could not reach it did not
 *     measure that configuration, and a green workflow carrying a substitute's numbers is worse than a red
 *     one carrying none.
 *   - `local` — proceed with the in-process TF-IDF provider and RECORD the substitution, which changes the
 *     configuration line and therefore makes the artifact incomparable with an API-embedded run by
 *     construction rather than by a reader's memory.
 *
 * The substitution is never implicit. A run may only publish under a label it actually ran.
 *
 * @module benchmarks/semantic-preflight
 */

import type { IEmbeddingProvider } from '@agentix-e/micro-kinetic-ai';

import type { SemanticEnhancerConfig } from './rcaeval-semantic.js';

/** What to do when the configured provider refuses to answer. */
export type EmbeddingFallback = 'abort' | 'local';

/** The two texts the probe embeds. Two, because a provider that answers `data: []` must not pass. */
export const PROBE_TEXTS: readonly string[] = ['probe', 'probe-fleet'];

/**
 * Read the fallback policy from an environment value.
 *
 * An unrecognised value is refused rather than defaulted: this policy decides whether a run measures the
 * published configuration, so a typo must not silently select the strict arm (a dispatch believing it
 * degraded) and must not silently select the loose one (a run publishing a substitute under the anchor's
 * name). Mirror of the rule the anomaly knobs follow — "a value this block could not name cannot be
 * published under a label it did not run".
 *
 * @param value - The raw `BENCHMARK_EMBEDDING_FALLBACK` value, or `undefined` when unset.
 */
export function parseEmbeddingFallback(value: string | undefined): EmbeddingFallback {
  if (value === undefined || value === '') return 'abort';
  if (value === 'abort' || value === 'local') return value;
  throw new Error(
    `BENCHMARK_EMBEDDING_FALLBACK takes abort or local, got '${value}' — ` +
      'an unrecognised policy cannot be published under either arm',
  );
}

/** A substitution that happened, with the evidence for it. */
export interface EmbeddingDegradation {
  /** The provider that refused, by its own `meta.name` (or its model id when it carries no meta). */
  readonly from: string;
  /** The provider that replaced it, by its own `meta.name`. */
  readonly to: string;
  /** The refusal, verbatim and truncated at 200 characters — the reason, not a rendering of it. */
  readonly reason: string;
}

/** The outcome of the probe: the config to run with, and what it took to get there. */
export interface SemanticPreflightResult {
  /** The configuration the run must use. Identical to the input unless a degradation happened. */
  readonly config: SemanticEnhancerConfig;
  /** The provider's own answer about which backend reached the run. */
  readonly backend: string;
  /** Present only when the configured provider refused and `local` was chosen. */
  readonly degradation?: EmbeddingDegradation | undefined;
}

/** Options for {@link preflightSemanticConfig}. */
export interface SemanticPreflightOptions {
  /** What to do on refusal. Default `abort`. */
  readonly fallback?: EmbeddingFallback | undefined;
  /**
   * The probe itself, injectable so the unit tests can refuse without a network.
   *
   * Defaults to `provider.embed(PROBE_TEXTS)` plus the arity check below; a real network path is the one
   * thing a test must not depend on, and an injected probe also lets the test assert that a LOCAL provider
   * is never probed.
   */
  readonly probe?: ((provider: IEmbeddingProvider) => Promise<void>) | undefined;
  /** The local provider factory, injectable for the same reason. Defaults to the real TF-IDF provider. */
  readonly makeLocalProvider?: (() => Promise<IEmbeddingProvider>) | undefined;
}

/**
 * The default probe: one small batch, and a refusal if fewer vectors come back than went in.
 *
 * The arity check is not defensive padding. `ApiEmbeddingProvider.embed([])` returns `{ vectors: [] }`
 * without a request, and a provider that mis-parses a response can return the same — so "the call did not
 * throw" is not the question. The question is whether the provider can turn text into the vectors the
 * aligner consumes, and one vector per text is that question.
 */
async function defaultProbe(provider: IEmbeddingProvider): Promise<void> {
  const { vectors } = await provider.embed(PROBE_TEXTS);
  if (vectors.length !== PROBE_TEXTS.length) {
    throw new Error(
      `probe returned ${vectors.length} of ${PROBE_TEXTS.length} vectors — the provider answered ` +
        'without embedding anything',
    );
  }
}

/** The provider's name for itself, falling back to its model id when it carries no meta. */
function nameOf(provider: IEmbeddingProvider): string {
  return provider.meta?.name ?? provider.modelId;
}

/**
 * Probe the configured provider and return the configuration the run must use.
 *
 * A provider whose `meta.backend` is not `'api'` is returned untouched and unprobed: the local TF-IDF
 * provider cannot run out of a third party's balance, and probing a provider that is not chosen by a
 * remote service would only add a way for the run to fail.
 *
 * @param config - The configuration built from the environment.
 * @param options - The fallback policy, plus injectable probe and factory.
 * @throws When the provider refuses and the policy is `abort`, or when no local provider can be built.
 */
export async function preflightSemanticConfig(
  config: SemanticEnhancerConfig,
  options: SemanticPreflightOptions = {},
): Promise<SemanticPreflightResult> {
  const provider = config.embeddingProvider;
  if (provider === undefined) {
    return { config, backend: 'none' };
  }

  const backend = provider.meta?.backend ?? 'unknown';
  if (backend !== 'api') {
    return { config, backend };
  }

  const probe = options.probe ?? defaultProbe;
  try {
    await probe(provider);
    return { config, backend };
  } catch (err) {
    const reason = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    const policy = options.fallback ?? 'abort';

    if (policy === 'abort') {
      throw new Error(
        `embedding provider ${nameOf(provider)} is unavailable: ${reason}. ` +
          'Refusing to run: the published cells are measured with this provider, and a run without it ' +
          'would publish a different configuration under the same name. To measure anyway, set the ' +
          'repository variable BENCHMARK_EMBEDDING_FALLBACK to `local` (CI: Settings -> Secrets and ' +
          'variables -> Actions -> Variables; locally: export it in the environment). That substitutes ' +
          'the in-process TF-IDF provider, labels the run degraded above every number it prints, and ' +
          'its cells are not comparable with an API-embedded run.',
      );
    }

    const makeLocal = options.makeLocalProvider ?? (await loadLocalProviderFactory());
    const local = await makeLocal();
    return {
      config: { ...config, embeddingProvider: local },
      backend: local.meta?.backend ?? 'unknown',
      degradation: { from: nameOf(provider), to: nameOf(local), reason },
    };
  }
}

/** Import the local provider lazily, so a run that never degrades never loads it. */
async function loadLocalProviderFactory(): Promise<() => Promise<IEmbeddingProvider>> {
  return async () => {
    const { TfIdfEmbeddingProvider } = await import('@agentix-e/micro-kinetic-ai');
    return new TfIdfEmbeddingProvider();
  };
}

/**
 * The configuration line's `topology:` field — which backend BUILT the graph's semantic edges.
 *
 * It is on the configuration line for the same reason `corpus:` is: it can move a published cell on its
 * own. The aligner adds edges for services the YAML registry does not name, those edges are ranking input,
 * and a run that built them from TF-IDF and a run that built them from `embedding-3` are not the same
 * experiment — while before this line existed their artifacts were byte-identical in every field a reader
 * could see.
 *
 * @param input - The backend that ran, and the degradation when one happened.
 */
export function formatTopologyLine(input: {
  readonly backend: string;
  readonly degradation?: EmbeddingDegradation | undefined;
}): string {
  const base = `topology: yaml-v2 + semantic(${input.backend})`;
  if (input.degradation === undefined) return base;
  const { from, to, reason } = input.degradation;
  return `${base} DEGRADED from ${from} to ${to}: ${reason}`;
}
