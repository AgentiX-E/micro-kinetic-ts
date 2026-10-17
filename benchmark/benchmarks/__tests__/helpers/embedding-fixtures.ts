/**
 * Deterministic embedding fixtures for the benchmark test suites.
 *
 * `IEmbeddingProvider` is a port: the real implementations are TF-IDF (which
 * computes similarity from token overlap, so its scores depend on tokenization
 * heuristics) and a network provider. Neither lets a test say "these two names
 * are identical and nothing else is". `DeterministicEmbeddingProvider` does,
 * by returning vectors the test chose, so a similarity score is a fixture
 * rather than an outcome of the tokenizer.
 *
 * This is an implementation of the port, not a mock of the code under test --
 * the enhancer and the topology builder consume it exactly as they would a real
 * provider.
 *
 * @module benchmarks/__tests__/helpers/embedding-fixtures
 */

import type {
  EmbeddingResult,
  IEmbeddingProvider,
  ILLMProvider,
  LlmAlignmentResult,
  SingleEntityAlignmentResult,
} from '@agentix-e/micro-kinetic-ai';

/**
 * An embedding provider backed by a fixed text → vector table.
 *
 * Texts that are not in the table get a zero vector, which has cosine
 * similarity 0 against every descriptor and therefore never clears any positive
 * threshold. That is how a test expresses "this name matches nothing".
 */
export class DeterministicEmbeddingProvider implements IEmbeddingProvider {
  public readonly dimension: number;
  public readonly modelId = 'deterministic-embedding';

  constructor(
    private readonly vectorMap: ReadonlyMap<string, Float32Array>,
    dimension = 8,
  ) {
    this.dimension = dimension;
  }

  get meta(): { name: string; backend: string; requiresNetwork: boolean } {
    return { name: 'deterministic-embedding', backend: 'fixture', requiresNetwork: false };
  }

  async embed(texts: readonly string[]): Promise<EmbeddingResult> {
    return {
      vectors: texts.map((text) => {
        const vector = this.vectorMap.get(text);
        return vector ? new Float32Array(vector) : new Float32Array(this.dimension);
      }),
    };
  }
}

/**
 * Build a provider that makes each case service name identical to one YAML
 * service descriptor, and unlike every other one.
 *
 * `SemanticAlignmentProvider` embeds the span names and the descriptor queries
 * in a single batch; a descriptor query is `` `${name} ${id} ${namespace}` ``
 * (see `buildDescriptorQuery`). Mapping both spellings of a pair onto the same
 * one-hot axis makes their cosine similarity exactly 1, while two different
 * pairs share no axis and score exactly 0.
 *
 * @param unmatchedToYaml - case service name → YAML service id to align it with
 * @param system - topology namespace, i.e. the third part of a descriptor query
 */
export function createMatchEmbedding(
  unmatchedToYaml: ReadonlyMap<string, string>,
  system: string,
): IEmbeddingProvider {
  const pairs = [...unmatchedToYaml];
  const dimension = Math.max(4, pairs.length * 2);
  const vectorMap = new Map<string, Float32Array>();

  pairs.forEach(([caseService, yamlService], index) => {
    const axis = new Float32Array(dimension);
    axis[index] = 1;
    vectorMap.set(caseService, axis);
    vectorMap.set(`${yamlService} ${yamlService} ${system}`, axis);
  });

  return new DeterministicEmbeddingProvider(vectorMap, dimension);
}

/**
 * Build a provider whose similarity for one pair is a chosen value.
 *
 * The descriptor sits on the first axis and the span is rotated towards it by
 * `cos(θ) = similarity`, so the cosine similarity is exactly `similarity`. Use
 * this when a test needs a match that is a *candidate* but sits below the
 * embedding threshold -- which is what sends a service to the LLM fallback.
 */
export function createPartialMatchEmbedding(
  caseService: string,
  yamlService: string,
  system: string,
  similarity: number,
): IEmbeddingProvider {
  const dimension = 4;
  const descriptorAxis = new Float32Array(dimension);
  descriptorAxis[0] = 1;

  const spanVector = new Float32Array(dimension);
  spanVector[0] = similarity;
  spanVector[1] = Math.sqrt(Math.max(0, 1 - similarity * similarity));

  return new DeterministicEmbeddingProvider(
    new Map([
      [caseService, spanVector],
      [`${yamlService} ${yamlService} ${system}`, descriptorAxis],
    ]),
    dimension,
  );
}

/**
 * A deterministic `ILLMProvider`: the same reasoning shape as the real one, with
 * the decision table supplied by the test.
 *
 * The LLM is an external service behind a port, so the port is where a test
 * stands in for it. `usage` is reported so the provider's cost accounting -- and
 * therefore its budget guard -- actually runs.
 */
export class TableLLMProvider implements ILLMProvider {
  public readonly modelId = 'table-llm';
  /** Number of `alignEntity` calls, i.e. how many entities reached the LLM. */
  public calls = 0;

  constructor(
    private readonly mapping: ReadonlyMap<string, string>,
    private readonly confidence = 0.9,
  ) {}

  async alignEntity(spanService: string): Promise<SingleEntityAlignmentResult> {
    this.calls += 1;
    const topologyId = this.mapping.get(spanService) ?? null;
    return {
      topologyId,
      confidence: topologyId ? this.confidence : 0,
      reasoning: `table lookup for ${spanService}`,
      usage: { promptTokens: 10, completionTokens: 5 },
    };
  }

  async alignEntities(spanServices: readonly string[]): Promise<LlmAlignmentResult> {
    return {
      matches: new Map(this.mapping),
      unmatched: spanServices
        .filter((s) => !this.mapping.has(s))
        .map((spanService) => ({ spanService, reason: 'not in the table' })),
      modelId: this.modelId,
      usage: { promptTokens: 10, completionTokens: 5 },
    };
  }
}
