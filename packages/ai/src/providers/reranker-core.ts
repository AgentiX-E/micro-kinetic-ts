/**
 * Pure helpers for the evidence-grounded LLM reranker.
 *
 * Everything here is deterministic and side-effect-free so it can be unit
 * tested exhaustively without a network: prompt construction, response parsing,
 * and the gap-trigger predicate that decides whether a rerank is even worth
 * the cost of an LLM call.
 *
 * @module ai/providers
 */

import type { CandidateEvidence, RerankRequest } from '../interfaces/reranker.js';

/**
 * Single-letter label for candidate index `i` (A, B, C, …).
 *
 * The LLM returns these short, typo-proof labels instead of reproducing exact
 * service IDs (which it might reword or truncate).
 */
function labelFor(i: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + i);
}

/**
 * Upper bound on the number of candidates the reranker will ever consider.
 * The deterministic ranker's default Top-K is 5; capping here keeps the prompt
 * and the LLM budget bounded regardless of caller.
 */
export const MAX_RERANK_CANDIDATES = 5;

/**
 * Build the re-ranking prompt from a request.
 *
 * The prompt gives the model a domain prior (a fault SOURCE shows a modest
 * permanent metric change; a SYMPTOM shows a traffic collapse to near-zero),
 * then lists each candidate's evidence pointers under a single-letter label,
 * and asks for the labels in descending likelihood order.
 *
 * @param request - The candidates and optional context.
 * @returns A plain-text prompt. Returns '' when there are no candidates.
 */
export function buildRerankPrompt(request: RerankRequest): string {
  const candidates = request.candidates.slice(0, MAX_RERANK_CANDIDATES);
  if (candidates.length === 0) return '';

  const lines: string[] = [];
  lines.push(
    'You are a root cause analysis expert for microservice systems.',
    'Given the top candidate root causes below, rank them by likelihood of being the TRUE root cause.',
    'A fault SOURCE may be SILENT: a "wrong value" logic fault produces no exception at the source,',
    'only a modest metric change (often a RISE as it does more work).',
    'A SYMPTOM emits the exception from PROCESSING the bad output (e.g. a MalformedJwtException or',
    'JsonMappingException means it received a malformed value from its UPSTREAM) and may COLLAPSE',
    'as it stops receiving traffic.',
    'If a candidate exception implies bad INPUT from upstream, the UPSTREAM is the source, not the candidate.',
    'Prefer the silent source over the exception-throwing symptom. Respond with ONLY the candidate labels',
    'in rank order, one per line, e.g.:',
    'A',
    'C',
    'B',
    '',
  );

  if (request.context) {
    lines.push(`Context: ${request.context}`, '');
  }

  lines.push('Candidates:');
  candidates.forEach((c, i) => {
    const label = labelFor(i);
    const name = c.name && c.name !== c.serviceId ? ` (${c.name})` : '';
    lines.push(`[${label}] ${c.serviceId}${name}`);
    if (c.anomalyScore !== undefined) {
      lines.push(`  - anomaly: ${c.anomalyScore.toFixed(3)}`);
    }
    if (c.dominantMetric) {
      lines.push(`  - metric: ${c.dominantMetric}${c.metricShift ? ` ${c.metricShift}` : ''}`);
    }
    if (c.breakdown) {
      const b = c.breakdown;
      lines.push(
        `  - deviation=${b.deviation.toFixed(3)} trend=${b.trend.toFixed(3)}` +
          ` rise=${b.riseRatio.toFixed(3)} drop=${b.dropRatio.toFixed(3)}`,
      );
    }
    if (c.deepestLogException) {
      lines.push(`  - log: ${c.deepestLogException}`);
    }
    if (c.adjacency) {
      lines.push(`  - topology: ${c.adjacency}`);
    }
  });

  lines.push('', 'Ranked order:');
  return lines.join('\n');
}

/**
 * Parse a model response into a permutation of the input candidate IDs.
 *
 * Extracts the single-letter labels from the response in order of appearance,
 * maps them back to service IDs, and appends any candidate whose label the
 * model did not mention (preserving their relative input order) so the result
 * is ALWAYS a full permutation — the reranker must never drop candidates.
 *
 * @param response - The model's free-text response.
 * @param candidates - The original candidate list (≤ MAX_RERANK_CANDIDATES).
 * @returns A permutation of the candidate service IDs.
 */
export function parseRerankOrder(
  response: string,
  candidates: readonly CandidateEvidence[],
): readonly string[] {
  const ids = candidates.map((c) => c.serviceId);
  if (ids.length === 0) return ids;

  const labelToId = new Map<string, string>();
  candidates.forEach((c, i) => {
    labelToId.set(labelFor(i), c.serviceId);
  });

  // Collect labels in the order they appear in the response, de-duplicating on
  // the SERVICE ID (so a repeated label cannot emit the same candidate twice).
  const emitted = new Set<string>();
  const order: string[] = [];
  for (const ch of response.toUpperCase()) {
    const id = labelToId.get(ch);
    if (id !== undefined && !emitted.has(id)) {
      emitted.add(id);
      order.push(id);
    }
  }

  // Append any candidate the model omitted, preserving input order.
  for (const id of ids) {
    if (!emitted.has(id)) order.push(id);
  }

  return order;
}

/**
 * Decide whether a rerank is worth an LLM call: the deterministic ranker's
 * top-1 and top-2 scores are within `threshold` of each other.
 *
 * A wide gap means the deterministic ranker is confident and the LLM call
 * would be wasted; a narrow gap is exactly where the evidence-grounded rerank
 * can flip the order. `scores` must be descending.
 *
 * @param scores - The top-K deterministic scores, descending.
 * @param threshold - The gap below which a rerank is triggered (≥ 0).
 * @returns true when the top-1/top-2 gap is strictly below `threshold`.
 */
export function shouldRerank(scores: readonly number[], threshold: number): boolean {
  if (scores.length < 2) return false;
  if (threshold <= 0) return false;
  const gap = scores[0]! - scores[1]!;
  return gap < threshold;
}
