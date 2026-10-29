/**
 * The trace candidate's count change in units of its OWN fluctuation — the scale-free axis the ratio threshold
 * could not be.
 *
 * ## Why a second axis exists at all
 *
 * The trace term pays a binary unit to the unique service whose span count rose (`pre >= 500`, `post/pre >= 1.15`).
 * Four refinements have been refused by measurement, and each refusal was a statement about the SHAPE of the
 * evidence rather than about the term:
 *
 * - the leader mask and the tail-only refinement both died on the rank histogram (`atMax=2/2` — the two loudest
 *   votes are both correct, so neither rank nor its complement separates anything);
 * - the failure DIRECTION vector is `+0` on all twenty TrainTicket votes: a term built on it could not fire;
 * - `traceRiseFloor`, a materiality guard on the absolute rise, was killed **before it was built**, because the
 *   five misses are not small rises — they gain `+295 … +15 020` spans — while eight of the fifteen hits gain only
 *   `+309 … +389`. A floor high enough to exclude the misses excludes most of the term's wins.
 *
 * What that leaves is **scale-relative significance**. A ratio means different things at different volumes: at
 * 1 800 spans a 17% rise is ~300 spans, at 12 000 a 7% fall is ~840. The ratio is loud for small services and deaf
 * for large ones, and `minPreCount = 500` is a crude absolute patch on exactly that deafness.
 *
 * ## The normalisation, and why each half of it is the way it is
 *
 * Under the kinetic limit a service's span count in a window is a count of independent arrivals, so its variance is
 * its mean: `Var(N) = N`. A service that emitted `pre` spans before the injection is therefore expected to emit
 * `r · pre` after it, where `r` is the fleet's **common-mode drift** — the change every service would show if none
 * of them changed its work per request. Its fluctuation is `sqrt(r · pre)`, and
 *
 * ```
 * z = (post − r · pre) / sqrt(r · pre)
 * ```
 *
 * is the change measured in units of the change that would have happened anyway. Two populations of very
 * different volume land on one axis, which is what the ratio could never do.
 *
 * The drift `r` is the **unweighted median of the per-service ratios**, and both halves of that choice were measured
 * before they were written down. A volume ratio `Σpost / Σpre` looks like the obvious estimator and is the one that
 * fails here: on the five TrainTicket route misses the truth carries a large share of the fleet's spans, so its own
 * fall is absorbed into the denominator and a thousand missing spans normalise to `z ≈ −1.3` instead of `−9.1`.
 * Weighting the median by spans has the same defect for the same reason — the median SPAN belongs to a large
 * service, and the large service may be the fault. An unweighted median treats every service as one observation of
 * "did the world change", so the fault's own service is one vote out of sixty-eight rather than the yardstick.
 *
 * ## What this is NOT
 *
 * It is an INSTRUMENT: it computes a number for every graph member and records the ground truth's own place in the
 * ordering. It does not vote, does not rank, and is read by no term of the engine. The selector, if one exists, is
 * a claim about which of these `z` values is the source, and that claim is a ranking change that has to be measured
 * as an arm after this axis is shown to carry the separation at all.
 *
 * @module benchmarks/runners/trace-significance
 */

import type { TraceActivityCounts } from '@agentix-e/micro-kinetic-core';
import { traceFleetDrift } from '@agentix-e/micro-kinetic-tree';

/** One service's count change, normalised by its own fluctuation. */
export interface ServiceSignificance {
  /** The service this entry describes. */
  readonly service: string;
  /** Spans emitted before the injection. */
  readonly pre: number;
  /** Spans emitted at or after it. */
  readonly post: number;
  /** `pre · drift` — what the service would have emitted had it followed the fleet exactly. */
  readonly expected: number;
  /** `(post − expected) / sqrt(expected)`: the change in units of its own Poisson fluctuation. */
  readonly z: number;
}

/** The scale-free axis for one case. */
export interface TraceSignificance {
  /**
   * The fleet's common-mode drift: the unweighted median of `post / pre` over the measured services.
   *
   * One observation per SERVICE rather than per span, so a single service's deviation — however large that service
   * is — moves the estimate by one vote. This is the property the volume ratio does not have, and it is the
   * property the five misses need: their truth is the fleet's largest riser in absolute terms and would otherwise
   * normalise itself away.
   */
  readonly drift: number;
  /** The measured services, ordered by `|z|` descending (ties by `z` descending, then by name). */
  readonly ranked: readonly ServiceSignificance[];
  /** The ground truth's own entry, or `undefined` when it emitted no span before the injection. */
  readonly truth?: ServiceSignificance | undefined;
  /**
   * `1 + |{ s : |z(s)| > |z(truth)| }|`, or `undefined` when the truth has no `z`.
   *
   * Strict inequality on purpose: a tie shares a rank, because a selector cannot prefer one of two equally
   * significant services and a rank that broke the tie would report a preference nobody has.
   */
  readonly truthRank?: number | undefined;
}

/** The case-level evidence the axis is computed from. */
export interface TraceSignificanceInput {
  /** Per-service pre/post span counts; absent or empty means no trace file was read. */
  readonly traceActivity?: ReadonlyMap<string, TraceActivityCounts> | undefined;
  /** The services the ranking can name — the call graph's members. */
  readonly nodeIds: ReadonlySet<string>;
  /** The ground truth, whose place in the ordering is part of the measurement. */
  readonly truth: string;
}

/**
 * Compute the scale-free axis for one case.
 *
 * @param input - The case's span counts, the graph's members, and the ground truth.
 * @returns The axis, or `undefined` when it cannot be measured: no counts at all (no trace file), or no service
 *   with a pre-injection baseline (nothing to normalise, and every `z` would be `0 / 0`).
 */
export function traceSignificanceOf(input: TraceSignificanceInput): TraceSignificance | undefined {
  const counts = input.traceActivity;
  if (counts === undefined || counts.size === 0) return undefined;

  // The population is the RANKING's population: a service the graph does not carry cannot be ranked, so measuring
  // it here would report a significance no term could spend, and counting it in the drift would let an unrankable
  // service move every ranked one's baseline. A zero baseline is excluded for a different reason: `post / 0` is not
  // a level of anything, so such a service carries no estimate to vote with.
  const measured: { service: string; pre: number; post: number }[] = [];
  for (const nodeId of input.nodeIds) {
    const c = counts.get(nodeId);
    if (c === undefined || c.pre <= 0) continue;
    measured.push({ service: nodeId, pre: c.pre, post: c.post });
  }
  if (measured.length === 0) return undefined;

  // The estimator is `packages/tree`'s, and that is a correctness requirement rather than a refactor: the trace
  // VOTE gates on the same quotient, so a second median here would let this artifact print a baseline the rule
  // never saw — and the census that reads this line to explain a wrong vote would be explaining the wrong number.
  const drift = traceFleetDrift(counts, input.nodeIds);
  // A zero drift means the median service emitted nothing after the injection: the axis has no rate to normalise
  // against, and every `z` would be `0 / 0`. Absent rather than zero, because "no rate" and "no deviation" are
  // different findings and only the second is a level.
  if (!(drift > 0)) return undefined;

  const entries: ServiceSignificance[] = measured.map((m) => {
    const expected = m.pre * drift;
    return {
      service: m.service,
      pre: m.pre,
      post: m.post,
      expected,
      z: (m.post - expected) / Math.sqrt(expected),
    };
  });
  entries.sort(compareByMagnitude);

  const truth = entries.find((e) => e.service === input.truth);
  if (truth === undefined) return { drift, ranked: entries };
  let louder = 0;
  for (const e of entries) if (Math.abs(e.z) > Math.abs(truth.z)) louder += 1;
  return { drift, ranked: entries, truth, truthRank: 1 + louder };
}

/**
 * Order by MAGNITUDE, then by sign.
 *
 * `|z|` first because the axis is a deviation axis and a large fall is as much a deviation as a large rise; the sign
 * second so a rise precedes an equal fall (the term's own premise is a rise, so on a tie the reading that agrees with
 * it comes first).
 *
 * A service-name tie-break would be a THIRD arm whose equality case cannot occur — the population is a `Set`, so two
 * entries never share a name — and this repository treats an unreachable arm as a defect rather than a formality.
 * Ties in both keys are therefore left to `Array.prototype.sort`, whose stability the language guarantees: they keep
 * the population's own order, which is the call graph's node order, which is the order every other artifact reads
 * services in.
 */
function compareByMagnitude(a: ServiceSignificance, b: ServiceSignificance): number {
  const byMagnitude = Math.abs(b.z) - Math.abs(a.z);
  if (byMagnitude !== 0) return byMagnitude;
  return b.z - a.z;
}
