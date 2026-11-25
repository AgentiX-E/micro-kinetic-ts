/**
 * The trace-channel census: what the FSE'26 cell reads when its trace-derived inputs are taken away.
 *
 * ## The question, and why it is asked of our own engine
 *
 * `arXiv:2603.02057` (TU Berlin / Huawei, 2026-03-02) re-runs 24 RCA methods on a GPU-driven LLM inference
 * deployment and reports that **"trace-based methods largely fail"** there, that metric-based ones are strongly
 * fault-type dependent, and that only multi-source approaches hold. This engine's largest single FSE'26 gain is
 * `failedTraceEdges` and its containment order reads trace-derived structure, so that sentence is about a
 * channel this arm leans on — the only open question is how hard.
 *
 * The census answers it by **ablation rather than by argument**: score the cell five times, once with nothing
 * removed and once with each trace-derived input emptied, then read the difference. If the cell loses twenty
 * points without traces the dependence is structural and the paper names a ceiling to price; if it loses three
 * the paper is about methods that lean on traces harder than this one does. Either way the answer is a number
 * obtained for **zero model calls**, because the engine is a pure function of the case and the case is on disk.
 *
 * ## The three channels, and why there are exactly three
 *
 * The FSE'26 bridge emits three trace-derived fields and the loader forwards all three:
 *
 * | raw field | what it carries | where it lands |
 * | --- | --- | --- |
 * | `traceEdges` | observed `[caller, callee]` pairs | the call graph, layered over the static topology |
 * | `failedTraceEdges` | per edge, failed calls after the injection | the `failedEdge` term and the containment order |
 * | `traceEdgeLatency` | per edge, mean duration either side of the injection | latency excursions |
 *
 * `traceActivity` is deliberately NOT a fourth channel: the FSE'26 loader never populates it (it is an RCAEval
 * input), so an arm for it would strip nothing and read as "the engine does not use this channel" — a null
 * result indistinguishable from a finding. It is named here so a reader can tell an omission from an oversight.
 *
 * ## What an ablation is not allowed to do
 *
 * Change the label. The accepted set, the fault type, the metric series, the logs and the injection time are
 * copied through every strip untouched, and the test suite asserts it per arm. A "gain" produced by narrowing
 * the answer set would be the same defect class as `engineRank`, the gate that was refused because
 * `engineRank` is `truthRank`: a rule that reads the answer key.
 *
 * ## Why the vocabulary is a record and not a list
 *
 * The same reason `--log-mode count` was lost from a hand-written `||` chain: a list cannot be checked against
 * a union. {@link TRACE_CHANNELS} is a `Record<TraceChannel, …>`, so **adding a channel to the union fails to
 * compile until it is added there**, and {@link TRACE_ARM_NAMES} is asserted over that table's key set so a
 * fourth channel cannot become silently unablatable.
 *
 * @module benchmarks/trace-channel-census
 */

import type { BenchmarkCase, FSE26RawCase } from '../../packages/kinetic/src/benchmarks/index.js';

/**
 * The part of a ranking position this census reads.
 *
 * Structural rather than `RootCauseResult` on purpose: `topOneHit` asks one question — is the FIRST service in
 * the accepted set — and a parameter type that demanded seven more fields would force every caller that is not
 * the pruner (and every test) to fabricate a confidence, a fault type and a propagation depth in order to say
 * which service came first. A `RootCauseResult` satisfies this type, so the pruner's order is accepted unchanged.
 */
export interface RankedService {
  /** The service this position names. */
  readonly serviceId: string;
}

/** A trace-derived input the FSE'26 loader forwards to the engine. */
export type TraceChannel = 'call-graph-edges' | 'failed-edges' | 'edge-latency';

/** A row of {@link TRACE_CHANNELS}. */
export interface TraceChannelSpec {
  /** The `FSE26RawCase` field this channel is read from. One owner for the channel → field mapping. */
  readonly field: 'traceEdges' | 'failedTraceEdges' | 'traceEdgeLatency';
  /** What the field carries, in the words a report can quote. */
  readonly carries: string;
  /** Where the engine reads it, so a reader can follow the ablation to the term it moved. */
  readonly lands: string;
}

/**
 * Every trace-derived channel, by name.
 *
 * `Record<TraceChannel, …>` rather than a list: this table is the ONLY place the channel → field mapping is
 * written, so {@link stripTraceChannel} derives its edit from it and cannot disagree with the report about
 * which field an arm emptied.
 */
export const TRACE_CHANNELS: Readonly<Record<TraceChannel, TraceChannelSpec>> = {
  'call-graph-edges': {
    field: 'traceEdges',
    carries: 'observed [caller, callee] pairs',
    lands: 'the call graph, layered over the static topology',
  },
  'failed-edges': {
    field: 'failedTraceEdges',
    carries: 'per edge, failed calls after the injection',
    lands: 'the failedEdge term and the containment order',
  },
  'edge-latency': {
    field: 'traceEdgeLatency',
    carries: 'per edge, mean duration either side of the injection',
    lands: 'latency excursions',
  },
};

/** The unit of the table: the control, one arm per channel, and the arm with every channel removed. */
export type TraceArmName = 'baseline' | TraceChannel | 'all-trace';

/**
 * The five arms, in the order the report prints them.
 *
 * Derived from {@link TRACE_CHANNELS}'s key set rather than hand-written, so a channel added to the union
 * appears here automatically and a channel whose arm was forgotten cannot ship.
 */
export const TRACE_ARM_NAMES: readonly TraceArmName[] = [
  'baseline',
  ...(Object.keys(TRACE_CHANNELS) as TraceChannel[]),
  'all-trace',
];

/**
 * Empty one channel of a case, leaving the label and every other input exactly as it was.
 *
 * The edit is derived from {@link TRACE_CHANNELS} so the table and the strip have one owner. The field is set
 * to `[]` rather than deleted because the loader treats an empty array and an absent key identically for all
 * three channels (`toFSE26FailedEdges` and `toFSE26EdgeLatency` both return `undefined` for either, and
 * `buildFSE26CallGraph` reads `traceEdges ?? []`), so a case the bridge never instrumented strips to the same
 * state as an instrumented one and the arms stay comparable across the corpus.
 *
 * @param raw - The case to strip. Not modified.
 * @param channel - The channel to empty.
 * @returns A new case with that one field emptied.
 */
export function stripTraceChannel(raw: FSE26RawCase, channel: TraceChannel): FSE26RawCase {
  return { ...raw, [TRACE_CHANNELS[channel].field]: [] } as FSE26RawCase;
}

/**
 * Empty every channel in {@link TRACE_CHANNELS}, in table order.
 *
 * Exposed rather than inlined at the call site so the `all-trace` arm is provably the three singles applied in
 * sequence: a table that reported a total which was not the sum of the parts it is presented as would be the
 * `BASELINE (all OFF)` defect again — a label asserting a configuration the run did not have.
 *
 * @param raw - The case to strip. Not modified.
 * @returns A new case with all three trace-derived fields emptied.
 */
export function stripAllTraceChannels(raw: FSE26RawCase): FSE26RawCase {
  let stripped = raw;
  for (const channel of Object.keys(TRACE_CHANNELS) as TraceChannel[]) {
    stripped = stripTraceChannel(stripped, channel);
  }
  return stripped;
}

/**
 * The case as one arm sees it.
 *
 * Derived from the base case on demand rather than precomputed as a table of five, because an `FSE26RawCase`
 * holds every metric series in the datapack — tens of megabytes — and five live copies per case is a memory
 * profile a census does not have to spend.
 *
 * The control returns the case ITSELF rather than a copy. That is deliberate: `baseline` must be the case the
 * shipped run would score, byte for byte, and a copy that happened to differ in one key would make the control
 * a sixth arm rather than the reference the other four are measured against.
 *
 * @param base - The case as loaded, after any `--drop-metrics` filter.
 * @param arm - The arm to produce.
 * @returns The case with that arm's channels emptied.
 */
export function rawForArm(base: FSE26RawCase, arm: TraceArmName): FSE26RawCase {
  if (arm === 'baseline') return base;
  if (arm === 'all-trace') return stripAllTraceChannels(base);
  return stripTraceChannel(base, arm);
}

/**
 * The case's accepted answer set.
 *
 * FSE'26 network faults carry TWO valid labels — the injection point's source and target service — and the
 * dual-label set is what this corpus is scored against, so scoring a network case against `serviceId` alone
 * would under-count a correct target-service prediction. `serviceIds` is the complete accepted set when the
 * loader found more than one label and `undefined` otherwise, which is why the fallback is the single label and
 * not an empty set.
 *
 * @param benchCase - The loaded case.
 * @returns The set of service ids that count as correct at rank 1.
 */
export function acceptedServices(benchCase: BenchmarkCase): ReadonlySet<string> {
  const labels = benchCase.groundTruth.serviceIds ?? [benchCase.groundTruth.serviceId];
  return new Set(labels);
}

/**
 * Whether the engine's rank-1 answer is in the accepted set.
 *
 * Position 0 only: an accepted answer at rank 2 is a Top@5 hit and not a Top@1 one, and the two are reported
 * separately everywhere else in this programme. An empty ranking is a miss and not an error — a case whose
 * call graph had no edges produces no order, and a census that threw on it would drop the case and quietly
 * raise the accuracy of the remaining denominator.
 *
 * @param ranking - The pruner's order, rank 1 first.
 * @param accepted - The case's accepted answer set.
 * @returns `true` when the top answer is accepted.
 */
export function topOneHit(
  ranking: readonly RankedService[],
  accepted: ReadonlySet<string>,
): boolean {
  const top = ranking[0];
  return top !== undefined && accepted.has(top.serviceId);
}

/** One arm's tally. */
export interface TraceArmTally {
  /** Cases whose rank-1 answer was accepted on this arm. */
  readonly hits: number;
  /** Cases scored on this arm. The denominator, and the same number on every arm of a complete run. */
  readonly total: number;
  /** Case ids this arm got wrong and the baseline got right. */
  readonly lost: readonly string[];
  /** Case ids this arm got right and the baseline got wrong. */
  readonly gained: readonly string[];
}

/** The census, one tally per arm. */
export interface TraceCensus {
  readonly arms: Readonly<Record<TraceArmName, TraceArmTally>>;
}

/** One case's outcome on every arm. `Record` over the union: a partial row does not compile. */
export type TraceArmHits = Readonly<Record<TraceArmName, boolean>>;

/**
 * An empty census.
 *
 * Empty rather than zero-filled-with-a-denominator, because "0 of 0" and "0 of 1 422" are different claims and
 * the report renders the first as `not measured`. A census that started at a plausible-looking zero could be
 * printed as a catastrophic result by a run that never scored a case.
 *
 * @returns A census with every arm at zero cases.
 */
export function createTraceCensus(): TraceCensus {
  const arms = Object.fromEntries(
    TRACE_ARM_NAMES.map((arm) => [arm, { hits: 0, total: 0, lost: [], gained: [] }]),
  ) as unknown as Record<TraceArmName, TraceArmTally>;
  return { arms };
}

/**
 * Fold one case's outcomes into the census.
 *
 * `lost` and `gained` are measured against the `baseline` arm of the SAME case, so the two lists are a
 * disagreement map rather than a score: a channel the engine does not need can only be neutral or harmful, so
 * an arm that GAINS cases when a channel is removed says that channel was actively misleading — a different
 * finding from "no change", and one a bare delta of zero would hide.
 *
 * @param census - The census so far. Not modified.
 * @param caseId - The case's id, recorded by name in the lost/gained lists.
 * @param hits - Whether each arm got this case right.
 * @returns A new census.
 */
export function accumulateTraceCase(
  census: TraceCensus,
  caseId: string,
  hits: TraceArmHits,
): TraceCensus {
  const baselineHit = hits.baseline;
  const arms = Object.fromEntries(
    TRACE_ARM_NAMES.map((arm) => {
      const previous = census.arms[arm];
      const hit = hits[arm];
      const lost = !hit && baselineHit ? [...previous.lost, caseId] : previous.lost;
      const gained = hit && !baselineHit ? [...previous.gained, caseId] : previous.gained;
      return [arm, { hits: previous.hits + (hit ? 1 : 0), total: previous.total + 1, lost, gained }];
    }),
  ) as Record<TraceArmName, TraceArmTally>;
  return { arms };
}

/**
 * One arm's line, in the shape the report prints.
 *
 * The delta is signed and given in points against the baseline of the same run, because the reader's question
 * is "how much does this channel buy" and a figure they have to subtract two others to obtain is a figure they
 * will not check. `not measured` covers the empty census: a zero denominator has no percentage, and printing
 * `0.0 %` for it would be a statement about the engine rather than about the run.
 *
 * @param census - The census to render.
 * @param arm - The arm to render.
 * @returns A single line.
 */
export function formatTraceCensusLine(census: TraceCensus, arm: TraceArmName): string {
  const tally = census.arms[arm];
  const baseline = census.arms.baseline;
  if (tally.total === 0 || baseline.total === 0) {
    return `trace-census[${arm}] not measured (0 cases scored)`;
  }
  const share = (tally.hits / tally.total) * 100;
  const delta = share - (baseline.hits / baseline.total) * 100;
  const signed = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`;
  return (
    `trace-census[${arm}] ${tally.hits}/${tally.total} = ${share.toFixed(2)}% ` +
    `(${signed} pp vs baseline ${baseline.hits}/${baseline.total}) ` +
    `lost=${tally.lost.length} gained=${tally.gained.length}`
  );
}
