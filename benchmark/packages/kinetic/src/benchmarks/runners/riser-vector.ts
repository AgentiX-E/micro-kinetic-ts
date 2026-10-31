/**
 * The trace rule's candidate, as a VECTOR of evidence the rule could have read and did not.
 *
 * ## Why this exists
 *
 * The trace term pays one unit to the UNIQUE service whose span count rose (`pre >= 500`, `post/pre >= 1.15`) while
 * no service threw a self-caused logic exception. On TrainTicket RE3 it votes on 20 of 30 cases and is right on
 * 15; the five wrong votes all became the top-1. Three instruments have now read that cell and none could say what
 * the wrong votes have in common:
 *
 * - the term-gap census charges `trace` a full unit on 5 of 11 misses, and a removal arm prices the pin at **+10
 *   cases**, so the term wins more than it loses;
 * - the rank histogram kills the rank-shaped explanations (`atMax=2/2`: the two loudest votes are both correct;
 *   the non-tail votes are 2 of 2 right, so `traceTailOnly` is dead);
 * - what is left is a property of the CANDIDATE rather than of its standing: a riser that is a SOURCE does more
 *   work per request, and a riser that is a VICTIM is re-routed traffic or a retry storm.
 *
 * The three quantities a source/victim split can be stated in are all already on the case, and none of them is
 * read by the rule: the rise itself (as counts and as a ratio), and the DIRECTION of the failures beside it — the
 * calls that failed INTO the candidate, and the calls that failed OUT of it. A source's interface fails; a victim
 * reports its callee.
 *
 * ## The distinctions this type keeps
 *
 * These are the whole reason the vector is a type rather than three numbers:
 *
 * - **No span measurement** (the case carries no trace file) is `undefined`, not a vector of zeros. Zero coverage
 *   and zero activity are different findings.
 * - **A service the count map does not name** is `pre: 0, post: 0` — measured, because every span in the file was
 *   counted under some name. This is what lets the census say "the truth emitted no spans".
 * - **A ratio with a zero denominator** is absent. `growth = 0` would read as "did not rise" and `growth = 1` as
 *   "flat"; neither is a measurement.
 * - **A failed-edge array that is absent** leaves both failure fields absent, while an array that names other
 *   services leaves both at zero. The loader writes a row for every edge with a post-injection failure, so the
 *   absence of a row is a measurement of zero — but only once the array exists.
 *
 * @module benchmarks/runners/riser-vector
 */

import type { FaultFailedEdge, TraceActivityCounts } from '@agentix-e/micro-kinetic-core';

/**
 * One service's rise and the failure direction beside it.
 *
 * Every field except {@link service} is optional, and each absence is a distinct statement — see the module
 * documentation. Nothing here is derived from a threshold: the thresholds belong to the rule, and a copy of one
 * would let a change to the rule silently move a reading that claims to be about it.
 */
export interface RiserVector {
  /** The service this vector describes. */
  readonly service: string;
  /**
   * Spans emitted before the injection, or `0` when the service appears in no span.
   *
   * Required rather than optional: once a case carries counts, every service has a pre count — zero is a
   * measurement here, and the one case that has no count at all (no trace file) is the whole vector being absent.
   * A consumer that has to ask whether `pre` exists would be asking a question the producer already answered.
   */
  readonly pre: number;
  /** Spans emitted at or after the injection, or `0` when the service appears in no span. */
  readonly post: number;
  /** `post / pre`, absent when `pre` is zero — a ratio with no denominator is not a level of anything. */
  readonly growth?: number;
  /** Failed calls made INTO the service, net of the same edges' pre-injection baseline, clamped at zero. */
  readonly failedIn?: number;
  /** Failed calls made BY the service, net of the same edges' pre-injection baseline, clamped at zero. */
  readonly failedOut?: number;
}

/**
 * The case-level evidence a {@link RiserVector} is computed from.
 *
 * A structural subset of `BenchmarkCase`, deliberately: the function is total over what it reads, so a test can
 * hand it three fields and a caller cannot forget one.
 */
export interface RiserVectorInput {
  /** Per-service pre/post span counts; absent or empty means no trace file was read. */
  readonly traceActivity?: ReadonlyMap<string, TraceActivityCounts> | undefined;
  /** Per-edge post-injection failed calls with their pre-injection baseline. */
  readonly failedTraceEdges?: ReadonlyArray<FaultFailedEdge> | undefined;
}

/**
 * Compute one service's rise-and-failure vector.
 *
 * @param service - The candidate to describe, whether or not it appears in the case's maps.
 * @param input - The case's span counts and failed edges.
 * @returns The vector, or `undefined` when the case carries no span counts at all — in which case nothing about a
 *   rise is known, and the failure fields would be a claim about a file that was never read.
 */
export function riserVectorOf(service: string, input: RiserVectorInput): RiserVector | undefined {
  const counts = input.traceActivity;
  if (counts === undefined || counts.size === 0) return undefined;

  const own = counts.get(service);
  const pre = own?.pre ?? 0;
  const post = own?.post ?? 0;

  const vector: {
    service: string;
    pre: number;
    post: number;
    growth?: number;
    failedIn?: number;
    failedOut?: number;
  } = {
    service,
    pre,
    post,
  };
  if (pre > 0) vector.growth = post / pre;

  const edges = input.failedTraceEdges;
  if (edges !== undefined) {
    let failedIn = 0;
    let failedOut = 0;
    for (const edge of edges) {
      // The DIRECTION is the evidence: the callee is the service the error was emitted ABOUT, the caller is
      // where it was reported. A self-edge satisfies both conditions and is counted twice on purpose — both
      // statements are true of it, and picking one would make the vector depend on how the edge was written.
      const delta = Math.max(0, edge.failed - edge.baseline);
      if (edge.callee === service) failedIn += delta;
      if (edge.caller === service) failedOut += delta;
    }
    vector.failedIn = failedIn;
    vector.failedOut = failedOut;
  }

  return vector;
}
