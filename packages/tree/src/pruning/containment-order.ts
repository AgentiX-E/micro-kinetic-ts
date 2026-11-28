/**
 * The containment order: a caller may not outrank a callee whose own latency excursion is larger.
 *
 * ## The mechanism, and why the fusion cannot express it
 *
 * A caller's response time CONTAINS its callee's. When a fault propagates along the call graph, the upstream
 * service's response metric deviates by at least as much as the downstream one's — not because it is the
 * source, but because it is waiting. On the FSE'26 corpus this single mechanism accounts for the largest
 * identifiable block of ranking error: of 176 cases whose truth is inside the presented five but not first,
 * **111 put the truth at rank 2, and 100 of those have the rank-1 candidate as the truth's CALLER against 0
 * callees** (iteration 286 §4).
 *
 * No additive term can repair it. Every weighted term sees one candidate at a time, and the statement that has
 * to be made is RELATIONAL: "this pair is inverted, because the lower one's own latency left its fault-free
 * band and the upper one's did not". Iteration 286 measured four weight sweeps and seven topological-gate
 * settings on exactly this mechanism and every one of them left the ranking byte-identical, because the terms
 * that could speak had an empty input map.
 *
 * ## Why the signal is an EXCURSION and not a weight
 *
 * The pairwise test is not "which candidate scored higher" — the fusion already answered that, wrongly. It is
 * whether the two candidates' latency channels sit outside the band the same service occupied when nothing was
 * wrong. That band is the fault-free profile's, which is a corpus artifact the engine already builds
 * (`pruning/fault-free-profile.ts`). A caller INSIDE its band while its callee is far OUTSIDE it is a
 * propagation signature that no magnitude comparison can fake. Measured in the engine over the full corpus, the
 * pass changes the top-1 verdict of 52 cases and reads **47 gains against 5 losses** — not the zero the
 * all-channel screening formula predicted, because a duration-only excursion and an any-channel one are
 * different quantities (`docs/containment-order.md` §3, §4).
 *
 * ## What this pass does NOT use
 *
 * The ground truth, the fault type, the injection window's length, or which candidate the engine scored
 * highest. It reads the ranked list, the call edges, and two excursions. A case with no profile, a candidate
 * without a latency channel, or a pair with no direct edge is left EXACTLY as the fusion ordered it — the pass
 * is a no-op rather than an approximation.
 *
 * @module pruning/containment-order
 */

import type { MetricMap, ServiceId } from '@agentix-e/micro-kinetic-core';

import { injectionSplitIndex, medianOfRange } from '../causal/topology-fault-graph.js';
import { DEFAULT_FAULT_FREE_SIGMA, type FaultFreeProfile } from './fault-free-profile.js';

/**
 * The smallest callee excursion the containment pass will call a latency that LEFT its band, in band widths.
 *
 * Ships at 0.1. An excursion is a median's distance past a band edge measured in band widths, so 0.03-0.096 is
 * a median sitting 3-10 % outside a boundary — indistinguishable from noise at the edge. Iteration 382 measured
 * three full-corpus cases where the strict comparison (margin 0) inverted such a pair against a caller that was
 * itself INSIDE its band, moving a correct root cause below its own callee; the floor refuses exactly those three
 * and keeps every gain. This is an ABSOLUTE floor on the callee, not a relative margin: it does not move the
 * strict comparison {@link ContainmentOrderInput.margin} documents, it refuses to call a boundary measurement an
 * excursion at all.
 */
export const DEFAULT_MIN_CALLEE_EXCURSION = 0.1;

/**
 * Whether a resolvable callee excursion may license an inversion whose own interface carried no failed call.
 *
 * `true` ships from iteration 384. At floor 0 the failed-interface record was the licence that every published
 * number was measured under, because an unlicensed pair whose callee sat only 0.03-0.096 band widths past its
 * edge was boundary noise promoted over a correct root (§4/§7 of `docs/containment-order.md`). Iteration 382's
 * {@link DEFAULT_MIN_CALLEE_EXCURSION} now refuses exactly those noise pairs BEFORE this option is consulted, so
 * the record's veto is redundant for content faults and harmful for latency faults: a call can complete with a
 * 200-OK and still be slow, and train-ticket's Hystrix fallbacks turn downstream failures into synthetic 200s
 * (RESTberus, arXiv:2611.04769). The full FSE'26 corpus prices the switch at `+21 / −0` against fusion
 * (1 171 → 1 192, an extra five over the shipped 1 187), taking the whole reachable ceiling at zero losses.
 *
 * A run's switch, recorded in the dump and read back by replay, so an old artifact reproduces the configuration
 * it was produced under and an ablation can set it to false to price the failed-interface licence again.
 */
export const DEFAULT_LICENSE_BY_EXCURSION = true;

/**
 * Channel labels that measure how long a service took to answer, or how long its calls took to be answered.
 *
 * Two families, and they are two instruments rather than two spellings: `http.server.request.duration` is the
 * service's own server-side histogram, and `hubble_http_request_duration_*` is the network observer's view of
 * the same request. On this corpus only 21 % of candidates carry the first, which is why the excursion reads
 * the FAMILY’s maximum: a rule that needed the server histogram would be silent on four cases in five.
 */
const LATENCY_CHANNEL_PATTERNS: readonly string[] = [
  'http.server.request.duration',
  'hubble_http_request_duration',
];

/**
 * Is this channel a latency channel?
 *
 * Substring rather than exact-label matching on purpose: the Hubble family is emitted at six quantiles
 * (`p50`, `p90`, `p95`, `p99`, `max`, and the bare histogram) and a new quantile must not silently drop out of
 * the excursion. The two patterns are the two instruments, so a label matching neither is not a latency
 * channel whatever else it measures.
 *
 * @param label - The channel label as the case spells it.
 * @returns `true` when the channel measures elapsed time of a request.
 */
export function isLatencyChannel(label: string): boolean {
  for (const pattern of LATENCY_CHANNEL_PATTERNS) {
    if (label.includes(pattern)) return true;
  }
  return false;
}

/** What {@link latencyExcursions} needs. */
export interface LatencyExcursionInput {
  /** The case's channels, exactly as the engine received them. */
  readonly metrics: MetricMap;
  /** The corpus profile, or `undefined` when this run has none — in which case the result is empty. */
  readonly profile: FaultFreeProfile | undefined;
  /** Fault injection time in Unix ms. `<= 0` means unknown, and an unknown boundary yields no excursion. */
  readonly injectTimeMs: number;
  /** Band half-width in robust standard deviations. Defaults to the profile builder's own. */
  readonly sigma?: number | undefined;
}

/**
 * How far outside its fault-free band each service's post-injection latency median sits.
 *
 *   band(v, label) = [centre − σ·scale, centre + σ·scale]
 *   excursion(v)   = max over latency labels of (0 if post ∈ band else distance / band width)
 *
 * The measurement is in BAND WIDTHS rather than in units of the metric, because one channel's milliseconds
 * are not another's and the pass compares across candidates of the same case. `0` is the honest value for a
 * candidate that is inside its band: it is a measurement of no excursion, not an absence of measurement — and
 * the distinction is what licenses the pairwise rule, which requires BOTH excursions to exist.
 *
 * A service is absent from the result when the profile cannot speak about it: no entry for the service, no
 * entry for any of its latency labels, no usable split of its series, a non-finite sample, or a degenerate
 * band. Read as `0` instead, every unmeasured candidate would look like a candidate that did not move, and the
 * rule would fire on the absence of evidence.
 *
 * @param input - Channels, profile, anchor and band width.
 * @returns Per-service excursion in band widths, for the services that could be measured.
 */
export function latencyExcursions(input: LatencyExcursionInput): Map<ServiceId, number> {
  const excursions = new Map<ServiceId, number>();
  const { metrics, profile, injectTimeMs } = input;
  if (profile === undefined || profile.size === 0) return excursions;
  if (!(injectTimeMs > 0)) return excursions;
  const sigma = input.sigma ?? DEFAULT_FAULT_FREE_SIGMA;

  for (const [serviceId, seriesList] of metrics) {
    const published = profile.get(serviceId);
    if (published === undefined || published.size === 0) continue;

    let worst = Number.NEGATIVE_INFINITY;
    for (const series of seriesList) {
      if (!isLatencyChannel(series.label)) continue;
      const entry = published.get(series.label);
      if (entry === undefined) continue;
      const halfWidth = sigma * entry.scale;
      if (!(halfWidth > 0)) continue;
      const sampleCount = Math.min(series.values.length, series.timestamps.length);
      const split = injectionSplitIndex(series.timestamps, sampleCount, injectTimeMs);
      if (split === undefined || split >= sampleCount) continue;
      let finite = true;
      for (let i = 0; i < sampleCount; i++) {
        if (!Number.isFinite(series.values[i]!)) {
          finite = false;
          break;
        }
      }
      if (!finite) continue;
      // No finiteness guard on the median: the loop above refused the series if ANY sample was non-finite, and
      // `split < sampleCount` guarantees the median's range is non-empty, so a guard here would be a branch no
      // input can take.
      const post = medianOfRange(series.values, split, sampleCount);
      const low = entry.centre - halfWidth;
      const high = entry.centre + halfWidth;
      const width = high - low;
      const departure = post < low ? low - post : post > high ? post - high : 0;
      const normalized = departure / width;
      if (normalized > worst) worst = normalized;
    }
    if (Number.isFinite(worst)) excursions.set(serviceId, worst);
  }
  return excursions;
}

/** One directed call edge, in the orientation the call graph uses (`from` calls `to`). */
export interface ContainmentEdge {
  readonly from: ServiceId;
  readonly to: ServiceId;
}

/**
 * A requirement on an edge that the case did not measure.
 *
 * H2's second criterion is not about one case: the factorisation residual of a pair's out-of-band indicators is a
 * property of an EDGE over many cases, and the claim to test is that a positive residual is a sufficient licence
 * for an inversion. Testing that inside one run would be a leak — a case that contributed its own observation to
 * an edge's residual and is then judged by it is being graded on its own answer — so the residual is fitted on
 * one half of the corpus and required on the other. That is why the pass accepts a prior it cannot compute: the
 * fitting is the caller's business, and the engine's business is only to honour a requirement it is given.
 *
 * The prior is keyed by {@link failureEdgeKey}, i.e. by the DIRECTION of the call edge, because that is the only
 * key the sweep ever asks about: ρ itself is symmetric, but the pair the sweep examines is always the caller
 * above its callee, and a map keyed unordered would admit a pair on an edge the sweep did not look at.
 */
export interface ContainmentPrior {
  /** One fitted residual per directed edge, keyed by {@link failureEdgeKey}. */
  readonly residuals: ReadonlyMap<string, number>;
  /**
   * The smallest residual that admits an inversion, EXCLUSIVE.
   *
   * `ρ > threshold` rather than `≥`, for the reason the margin is strict: a residual of exactly zero is the
   * independence the requirement exists to exclude, so admitting it would admit every pair whose two ends move
   * independently of each other — the entire population the mechanism is trying to separate itself from.
   */
  readonly threshold: number;
}

/** What {@link applyContainmentOrder} needs. */
export interface ContainmentOrderInput<T> {
  /** The ranked candidates, best first, exactly as the fusion left them. */
  readonly ranking: readonly T[];
  /** The case's directed call edges. */
  readonly edges: readonly ContainmentEdge[];
  /** The excursion map from {@link latencyExcursions}. Empty means the pass is a no-op. */
  readonly excursions: ReadonlyMap<ServiceId, number>;
  /**
   * How much larger the callee's excursion must be before the pair is inverted, in band widths.
   *
   * `0` — the shipped value — is a strict comparison rather than a tuned one: the two excursions are measured
   * on the same case, in the same units, against the same band, so the comparison is exact at zero and any
   * positive margin would be a number with no derivation.
   */
  readonly margin?: number | undefined;
  /**
   * How far outside its band a callee must be before the pair may be inverted, in band widths.
   *
   * {@link DEFAULT_MIN_CALLEE_EXCURSION} = 0.1 ships. Unlike {@link margin} — a RELATIVE gap between two
   * measurements on the same case — this is an ABSOLUTE resolvability floor on the callee alone: an excursion of
   * 0.03-0.096 band widths is a median sitting 3-10 % past a band edge, which is measurement noise at the
   * boundary, not a latency that "left its band" in the sense this pass documents. Iteration 382 measured three
   * full-corpus cases where a caller inside its band (excursion 0) and such a noise-width callee were inverted by
   * the strict comparison, moving a correct root cause below its own callee; the floor removes exactly those three
   * and no gain. The strict comparison is preserved — this field does not change the margin, it refuses to call
   * a boundary measurement an excursion.
   *
   * Consulted after the interface record and the measured-side check, but before the margin and the residual, so
   * a noise pair is named `callee-in-band` rather than disguised as `not-larger` or `prior-below`.
   */
  readonly minCalleeExcursion?: number | undefined;
  /**
   * Whether a resolvable callee excursion licenses an inversion whose own interface recorded no failed call.
   *
   * A completed call is evidence that a CONTENT fault did not travel — a 200-OK delivered the value. It is not
   * evidence that a LATENCY fault did not travel: a call can complete and still be slow, and the train-ticket
   * corpus uses Hystrix fallbacks that turn a downstream failure into a synthetic 200-OK (RESTberus,
   * arXiv:2611.04769). At floor 0 this option would invert boundary noise over a correct root; with
   * {@link DEFAULT_MIN_CALLEE_EXCURSION} in force those pairs are refused as `callee-in-band` BEFORE this option is
   * consulted, so the only pairs it licenses are callees that genuinely left their band.
   *
   * The sweep falls through past the interface veto when this is on: unmeasured, in-band and not-larger pairs keep
   * their own reasons, and only an inversion licensed this way is named `excursion-licensed`. Absent means the
   * shipped {@link DEFAULT_LICENSE_BY_EXCURSION}; a run's value is recorded in the dump and replayed from it.
   */
  readonly licenseByExcursion?: boolean | undefined;
  /**
   * The interfaces that carried failed calls on this case, keyed by {@link failureEdgeKey}.
   *
   * When this is present the pass only inverts a pair whose **own interface failed**. When it is absent the
   * pass reads the excursions alone, which is the ruled-out arm: measured on the full corpus, dropping this
   * evidence is what produced the five losses the register refused (§4/§7 of `docs/containment-order.md`).
   * The distinction between the two arms is a measurement, not a preference — the same adjacent pairs, the
   * same excursions, and only the evidence requirement moved.
   */
  readonly failingEdges?: ReadonlyMap<string, unknown> | undefined;
  /**
   * What a missing record on a pair's own edge MEANS — the shipped reading, or the case-scoped one.
   *
   * `'edge'` — the default, and the configuration every published containment number was measured in — reads an
   * absent record as a refusal: the pass only inverts a pair whose own interface failed. That is the right
   * reading when the record is a LICENCE, and the corpus agrees with it: the arm earns `+15 / −0`.
   *
   * `'case'` reads the same absence as two different facts. When the case recorded failed calls somewhere, the
   * record exists and this edge is not in it, so the call completed and the refusal stands: the record's silence
   * about one edge is a VETO. When the case recorded no failed call at all, the record is silent about the CASE,
   * which is a fact about the recording rather than about this pair, and the pair falls through to the
   * measurements and the prior as it would in a walk that carried no record.
   *
   * The distinction is not a preference; it is what `docs/closed-axes-register.md` §299's three losses say. All
   * three are one edge (`ts-preserve → ts-security`) where the caller is the root, its callee moved further out,
   * and the shipped rule refused correctly. A rule that treats the record as a permission cannot tell those three
   * from the eighteen gains the same arm takes where the record never spoke at all. Splitting the absence is the
   * only rule change that can keep the refusal and the gains, and it is why this field is a scope and not a
   * threshold: no number is being tuned, one word is being disambiguated.
   */
  readonly recordScope?: 'edge' | 'case' | undefined;
  /**
   * A per-edge requirement fitted OUTSIDE this case.
   *
   * Consulted LAST — after the interface record, after both measurements, and after the inequality — so that the
   * two refusal reasons it adds (`prior-absent`, `prior-below`) mean **this pair would have been inverted and the
   * prior stopped it**. Asking earlier would label pairs the measurements had already refused, and the count of
   * blocked inversions is exactly the quantity the gate's price is read from: a gate that appears to block
   * hundreds of pairs when it is only relabelling refusals would look like a strict filter rather than the
   * narrow one it is.
   *
   * Absent means no requirement, which is the shipped configuration and the state every published containment
   * number was measured in.
   */
  readonly prior?: ContainmentPrior | undefined;
  /**
   * How many candidates of the order the sweep RECORDS decisions for, counting from the head.
   *
   * A recording window, not a smaller sweep. The pass still walks the whole list and still inverts every pair it
   * qualifies — `order` is the same array the caller would get without this field, because a decision that
   * depended on how much of itself the caller wanted written down would make the artifact decide the answer it
   * reports. This field only stops the verdict list at pair `window - 1`, which is a statement about what the
   * caller is measuring.
   *
   * It exists because the sweep's population is a POPULATION: ρ is fitted per edge over the pairs a corpus
   * examined, so widening the window changes the statistic and not the sample size. A run that recorded its pairs
   * at a width it never wrote down left its reader to infer the width from a length — the same defect class
   * `ContainmentChain.scope` closed for the flow pass (`docs/gate-replay.md` §9.1).
   *
   * The window is exact in POSITIONS and the recorded prefix is not: a pair with no call edge contributes no row,
   * so `verdicts.length <= window - 1`. Absent means every pair, which is the whole list.
   */
  readonly recordWindow?: number | undefined;
}

/** The minimum of a candidate and its rank, as the pass reads them. */
interface RankedService {
  readonly service: ServiceId;
}

/**
 * Why the sweep did or did not invert one adjacent pair.
 *
 * Six refusals rather than one, because they are six different statements: `no-failed-interface` says the
 * topology carried nothing between them, `unmeasured` says the profile could not speak, `not-larger` says it
 * spoke and the callee was not further out, and `prior-absent` / `prior-below` say the pair qualified on this
 * case and was stopped by what the corpus fitted elsewhere. A single `refused` would make a corpus that had no
 * evidence indistinguishable from one whose evidence pointed the other way.
 *
 * The last two are two statements rather than one on the same principle: an edge nobody fitted is not an edge
 * measured to be independent, and a gate that merged them would report unmeasured edges as edges that
 * disagreed with it.
 *
 * `record-silent` is the one decision that is an INVERSION and not a refusal, and it exists because the four
 * refusals above conflate two statements the moment the record's scope is allowed to vary. "No failed call on
 * this edge" means one thing when the case recorded failed calls elsewhere — the call between these two
 * completed, which is evidence the failure did not travel over it — and a different thing when the case recorded
 * no failed call at all, which is not evidence about this edge but about the recording. The shipped rule refuses
 * both, at no cost, because it never has a reason to distinguish them. A walk that consults the residual where
 * the record is silent does, and the count of pairs the silence opened is the quantity that walk is read on.
 */
export type ContainmentDecision =
  | 'inverted'
  | 'record-silent'
  | 'no-failed-interface'
  | 'unmeasured'
  | 'callee-in-band'
  | 'not-larger'
  | 'excursion-licensed'
  | 'prior-absent'
  | 'prior-below';

/**
 * One adjacent pair that carried a call edge, and what the sweep decided about it.
 *
 * The excursions are recorded whenever they were MEASURED, including on a refusal — a refusal is a negative
 * example, and the five losses the interface requirement removed were refusals whose excursions were the reason
 * the older arm inverted them. A side the profile could not measure is ABSENT rather than zero: substituting
 * zero is the exact move `latencyExcursions` refuses to make.
 */
export interface ContainmentVerdict {
  /** The candidate that sat higher in the published order when the pair was examined. */
  readonly upper: ServiceId;
  /** The candidate that sat lower. */
  readonly lower: ServiceId;
  /** What the sweep did about it. */
  readonly decision: ContainmentDecision;
  /** The upper candidate's excursion in band widths, when the profile could measure it. */
  readonly upperExcursion?: number | undefined;
  /** The lower candidate's excursion in band widths, when the profile could measure it. */
  readonly lowerExcursion?: number | undefined;
}

/** The sweep's order and its reasons, which {@link applyContainmentOrder} throws away. */
export interface ContainmentSweep<T> {
  /** The same candidates as the published ranking, with the qualified adjacent pairs inverted. */
  readonly order: T[];
  /** One row per adjacent pair that carried a call edge, in sweep order. */
  readonly verdicts: ContainmentVerdict[];
}

/**
 * Invert adjacent caller/callee pairs whose latency excursions are out of order, keeping the reasons.
 *
 * The same single sweep as {@link applyContainmentOrder} — that function is this one's `.order` — with one
 * addition: every pair that carried a call edge is recorded, whether it was inverted or not. The record exists
 * for a measurement that the ranking artifact cannot reconstruct: ρ, the factorisation residual of the pair's
 * out-of-band indicators over the corpus, is a property of an EDGE, and the edge population is the set of
 * adjacent pairs this sweep examined. A pair with no call edge is not recorded at all, because it has no edge
 * to be a property of.
 *
 * The rows are in sweep order, which is not the same as the order of the final ranking: once a pair is inverted
 * the next row describes the NEW adjacency, which is what makes the record reproducible from the same input.
 *
 * {@link ContainmentOrderInput.recordWindow} limits how much of that record is RETURNED and nothing else: the pass
 * decides and inverts over the whole list either way, so the order this function returns does not depend on the
 * window, and a run that records five candidates is still walking the pool it was given.
 *
 * @param input - The published ranking, the topology, the excursions, the margin, and the failed interfaces.
 * @returns The reordered candidates and one verdict per adjacent pair that carried an edge.
 */
export function inspectContainmentOrder<T extends RankedService>(
  input: ContainmentOrderInput<T>,
): ContainmentSweep<T> {
  const order = [...input.ranking];
  const verdicts: ContainmentVerdict[] = [];
  if (order.length < 2 || input.excursions.size === 0 || input.edges.length === 0)
    return { order, verdicts };
  const margin = input.margin ?? 0;
  const failingEdges = input.failingEdges;
  // The recording window is read once, as a position bound, and clamped to the list: a window wider than the order
  // states nothing, and one narrower than two records nothing — which is the honest reading of "measure the head
  // alone" rather than a special case that would silently record the first pair anyway.
  const window = Math.min(input.recordWindow ?? order.length, order.length);

  const calls = new Set<string>();
  for (const edge of input.edges) calls.add(`${edge.from}\u0000${edge.to}`);

  for (let i = 0; i + 1 < order.length; i++) {
    const upper = order[i]!;
    const lower = order[i + 1]!;
    // Outside the window the pair is still DECIDED and the order still changes; only the record stops. Placed
    // before the decision so that the two cannot drift: a pair refused for one of the nine reasons below and a pair
    // inverted both contribute exactly one row when they are inside the window.
    const recording = i + 1 < window;
    const key = `${upper.service}\u0000${lower.service}`;
    if (!calls.has(key)) continue;
    const upperExcursion = input.excursions.get(upper.service);
    const lowerExcursion = input.excursions.get(lower.service);
    // Measured sides are carried, unmeasured ones are omitted — never zeroed. The spread rather than two
    // conditional assignments so the optionality survives `exactOptionalPropertyTypes`.
    const pair = {
      upper: upper.service,
      lower: lower.service,
      ...(upperExcursion === undefined ? {} : { upperExcursion }),
      ...(lowerExcursion === undefined ? {} : { lowerExcursion }),
    };
    // The record's absence is two facts, and `recordScope` is which of them the caller wants read. Under `'edge'`
    // — and under `'case'` whenever this case recorded anything at all — the absence is the VETO: a call passed
    // between these two and completed. Only a case whose record is silent THROUGHOUT falls through to the
    // measurements, and it is labelled at the end, because `record-silent` describes why the pair qualified.
    let silentRecord = false;
    // Whether the RECORD licensed this pair — a different question from whether the pair ends up inverted, and the
    // one the prior is conditioned on below.
    let licensed = false;
    // Whether the callee's own resolvable excursion licensed a pair the interface record was silent about. Kept
    // distinct from `licensed` for the census, but treated the same by the prior below: both are a causal reason
    // to invert, so neither is a pair a correlational residual should be asked to second-guess.
    let licensedByExcursion = false;
    if (failingEdges !== undefined) {
      if (failingEdges.has(key)) licensed = true;
      else if (input.recordScope === 'case' && failingEdges.size === 0) silentRecord = true;
      else if (input.licenseByExcursion === true) licensedByExcursion = true;
      else {
        if (recording) verdicts.push({ ...pair, decision: 'no-failed-interface' });
        continue;
      }
    }
    if (upperExcursion === undefined || lowerExcursion === undefined) {
      if (recording) verdicts.push({ ...pair, decision: 'unmeasured' });
      continue;
    }
    // The callee must be a RESOLVABLE distance outside its own band. A median only 3-10 % past the band edge is
    // noise at the boundary; calling it an excursion and inverting on it moved three correct roots below their
    // callees on the full corpus (iteration 382). Placed before the margin so the pair is named by what refused it
    // -- a noise-height pair is `callee-in-band`, not a disguised `not-larger` under an unrelated margin.
    const floor = input.minCalleeExcursion ?? DEFAULT_MIN_CALLEE_EXCURSION;
    if (!(lowerExcursion > floor)) {
      if (recording) verdicts.push({ ...pair, decision: 'callee-in-band' });
      continue;
    }
    if (!(lowerExcursion > upperExcursion + margin)) {
      if (recording) verdicts.push({ ...pair, decision: 'not-larger' });
      continue;
    }
    // Last, and deliberately: everything above this line already refused the pair on its own measurements, so a
    // `prior-*` verdict below is a pair this case would have inverted. See `ContainmentOrderInput.prior`.
    //
    // AND conditioned on the record, which is the one place this sweep can be got wrong in a way no single test
    // sees: a pair the record LICENSED already has a causal reason to be inverted, and asking the residual whether
    // its two ends co-move would put the correlational statistic on top of the causal one. §299 measured that as a
    // replacement and refused it; applying it on top of the licence is the same mistake wearing a narrower scope,
    // and it is why the condition is `!licensed` rather than "the prior is present". A walk with no record at all
    // (the `prior` arm) leaves `licensed` false everywhere, so its behaviour is unchanged.
    const prior = input.prior;
    if (prior !== undefined && !licensed && !licensedByExcursion) {
      const fitted = prior.residuals.get(key);
      if (fitted === undefined) {
        if (recording) verdicts.push({ ...pair, decision: 'prior-absent' });
        continue;
      }
      if (!(fitted > prior.threshold)) {
        if (recording) verdicts.push({ ...pair, decision: 'prior-below' });
        continue;
      }
    }
    order[i] = lower;
    order[i + 1] = upper;
    if (recording)
      verdicts.push({
        ...pair,
        decision: silentRecord
          ? 'record-silent'
          : licensedByExcursion
            ? 'excursion-licensed'
            : 'inverted',
      });
  }
  return { order, verdicts };
}

/**
 * Invert adjacent caller/callee pairs whose latency excursions are out of order.
 *
 * One pass from the top, over ADJACENT positions only, and a pair is inverted when the higher candidate calls
 * the lower one and the lower one's excursion exceeds the higher one's by more than `margin`. Adjacency is not
 * a simplification of a full re-sort: the claim is about the ORDER the fusion published, and a full re-sort on
 * excursions alone was measured at 45.9 % Top@1 against the engine's 85.9 % (iteration 286 §2) — the excursion
 * is a disambiguator between two candidates, never a ranker.
 *
 * The pass is a single sweep with no backtracking, so its result is deterministic and independent of the
 * candidates' scores. After an inversion the pair is not re-examined: the element that moved up has already
 * been compared against the position above it, and re-testing it would let one candidate climb an arbitrary
 * number of places on one measurement.
 *
 * A pair qualified only when BOTH excursions are measured. An unmeasured candidate is not evidence of no
 * excursion, and a rule that treated it as one would invert pairs on the strength of missing data.
 *
 * When {@link ContainmentOrderInput.failingEdges} is supplied, a pair also has to have carried failed calls on
 * its own interface. That is the difference between "these two services moved" and "something passed between
 * these two services": the excursion is measured per service, so without the interface record the rule compares
 * two independent measurements and calls the larger one a callee of the smaller. Every one of the five losses
 * this pass took on the full corpus was a pair with no failed call at all, and 32 of its 38 gains were pairs
 * that had one — the distinction is measured, and it is the reason the requirement ships.
 *
 * @param input - The published ranking, the topology, the excursions, the margin, and the failed interfaces.
 * @returns The same candidates in the same order, with the qualified adjacent pairs inverted.
 */
export function applyContainmentOrder<T extends RankedService>(
  input: ContainmentOrderInput<T>,
): T[] {
  return inspectContainmentOrder(input).order;
}
