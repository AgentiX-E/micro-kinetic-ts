/**
 * Evidence-grounded root-cause reranker.
 *
 * Wraps an {@link IChatProvider} with the deterministic prompt/parse helpers so
 * the caller only sees the {@link IRootCauseReranker} contract. On any LLM
 * failure (network, timeout, unparseable output) it returns the input order
 * unchanged — the reranker is a best-effort refinement, never a correctness
 * regression.
 *
 * @module ai/providers
 */

import type { IRootCauseReranker, RerankRequest, RerankResult } from '../interfaces/reranker.js';
import type { IChatProvider } from './api-llm.js';
import { buildRerankPrompt, parseRerankOrder } from './reranker-core.js';

/**
 * Evidence-grounded reranker backed by a chat-completion provider.
 */
export class EvidenceGroundedReranker implements IRootCauseReranker {
  public readonly modelId: string;
  private readonly provider: IChatProvider;

  constructor(provider: IChatProvider) {
    this.provider = provider;
    this.modelId = provider.modelId;
  }

  async rerank(request: RerankRequest): Promise<RerankResult> {
    const ids = request.candidates.map((c) => c.serviceId);
    if (ids.length <= 1) return { order: ids };

    // buildRerankPrompt is non-empty here (≥1 candidate after the ≤1 guard),
    // and parseRerankOrder always returns a full permutation — so no further
    // defensive length checks are needed.
    const prompt = buildRerankPrompt(request);

    try {
      const response = await this.provider.complete([{ role: 'user', content: prompt }]);
      const order = parseRerankOrder(response, request.candidates);
      return { order, reasoning: response };
    } catch {
      // Deterministic fallback: keep the deterministic order.
      return { order: ids };
    }
  }
}
