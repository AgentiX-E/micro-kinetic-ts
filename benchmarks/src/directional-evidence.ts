/**
 * The DIRECTIONAL evidence the RCAEval loader never built, derived from the traces it does load.
 *
 * ## Why this module exists
 *
 * The corpus's held-out misses are attributed (iteration 59) to `loss` — network packet loss — and to RE3
 * TrainTicket/SockShop, and the standing hypothesis is that a network-class fault needs a signal that carries
 * the DIRECTION of an error: which service the failed calls were made ABOUT. Two fields exist for that —
 * `FaultFailedEdge` (counts) and `FaultEdgeLatency` (durations) — and both are populated by the **FSE'26
 * loader only**. On the RCAEval side the channel is not merely inert (`failedEdgeWeight` defaults to `0.0`
 * even where it is populated); it was never supplied, so no measurement about it could be taken there.
 *
 * This module derives the same two observables from what the RCAEval cases DO carry: per-span `service`,
 * `parentSpanId`, `startTime`, `duration` and `status` (`OK`/`ERROR`). An edge is caller→callee, read off the
 * parent relation; the failures are the `ERROR` spans; the latency rise is the duration shift across the
 * injection. Every observable is a function of the case's INPUTS alone — no ground truth enters the
 * derivation, which is the property that makes a reading about it deployable rather than a description of the
 * population it was measured inside.
 *
 * ## What it is for
 *
 * To answer, on the RCAEval side and for the first time, the falsifier §85 states: if a label-free directional
 * observable cannot pick out the `loss` cases the engine gets wrong, the network-class hypothesis is wrong.
 * The rankings below are that observable, and the separation machinery is the repository's own
 * (`DEFAULT_SEPARATOR_CRITERION`, `separationPValue`) rather than a second apparatus free to disagree with it.
 *
 * @module benchmarks/directional-evidence
 */

import type {
  FaultEdgeLatency,
  FaultFailedEdge,
} from '../../packages/core/src/interfaces/rca-engine.js';
import { DEFAULT_SEPARATOR_CRITERION, separationPValue } from './fse26-separator.js';

/**
 * The six fields this module reads from a span, and nothing else.
 *
 * Structural rather than the loader's `DirectionalSpan`: the runners map raw traces into their OWN span
 * shape, and a derivation that demanded the loader's type would force a second mapping of the same data at
 * every call site. What a direction needs is the parent relation, the service on both ends, the timing on both
 * sides of the injection, the duration and whether the call failed — so that is what this asks for.
 */
export interface DirectionalSpan {
  readonly spanId: string;
  readonly parentSpanId?: string | undefined;
  readonly service: string;
  /** Unix milliseconds. */
  readonly startTime: number;
  readonly duration: number;
  readonly status: 'OK' | 'ERROR';
}

/** The parts of a case this module reads. Structural, so a test needs no loader. */
export interface DirectionalCaseInput {
  readonly caseId: string;
  /** `system:suite:fault` — carried for the report, never read by the derivation. */
  readonly stratum: string;
  /** Fault-injection time as Unix milliseconds; the boundary between before and after. */
  readonly injectTimeMs: number;
  readonly traces?: readonly DirectionalSpan[];
}

/** One service's inbound evidence, as the two channels see it. */
export interface ServiceEvidence {
  readonly service: string;
  /** Failed calls made ABOUT this service: `Σ max(0, after − before)` over its inbound edges. */
  readonly failedMass: number;
  /** The largest inbound latency rise (after/before mean duration), or `0` when no edge is comparable. */
  readonly latencyRise: number;
}

/** What the two channels say about one case. */
export interface DirectionalReading {
  readonly caseId: string;
  readonly stratum: string;
  readonly spans: number;
  /** Distinct caller→callee edges the traces imply. */
  readonly edges: number;
  /** Service ranked first by inbound failed mass, or `undefined` when nothing was measurable. */
  readonly failedTop1?: string;
  /** Service ranked first by inbound latency rise, or `undefined` when nothing was comparable. */
  readonly latencyTop1?: string;
  /** Every service's two values, so a caller can re-rank or inspect rather than take the top-1 on trust. */
  readonly services: readonly ServiceEvidence[];
}

/** The caller→callee pairs the traces imply, as "caller>callee". */
function edgesOf(
  traces: readonly DirectionalSpan[],
): Map<string, { caller: string; callee: string }> {
  const byId = new Map<string, DirectionalSpan>();
  for (const s of traces) byId.set(s.spanId, s);
  const edges = new Map<string, { caller: string; callee: string }>();
  for (const s of traces) {
    const parent = s.parentSpanId === undefined ? undefined : byId.get(s.parentSpanId);
    // A span without a parent in the same traces is a ROOT: it has no caller, so it establishes no edge. A
    // self-edge (a service calling itself) is kept — it is a real call and its direction is unambiguous.
    if (parent === undefined) continue;
    const caller = parent.service;
    const callee = s.service;
    edges.set(`${caller}>${callee}`, { caller, callee });
  }
  return edges;
}

/**
 * Read one case's directional evidence out of its traces.
 *
 * Both channels are computed per INBOUND edge and credited to the CALLEE, which is the service the calls were
 * made about — the direction the log and metric signals lack. Failures are `status === 'ERROR'` spans, and the
 * pre-injection count on the same edge is their baseline, so a service that is merely noisy is not credited
 * for being noisy.
 *
 * @param input - The case's id, stratum, injection time and traces.
 * @returns The reading. Both tops are `undefined` when nothing was measurable, which is reported rather than
 *          counted as a miss: an absent input is not evidence about a ranking.
 */
export function readDirectionalEvidence(input: DirectionalCaseInput): DirectionalReading {
  const traces = input.traces ?? [];
  const perService = new Map<string, { failedMass: number; latencyRise: number }>();
  const bump = (service: string): { failedMass: number; latencyRise: number } => {
    const entry = perService.get(service) ?? { failedMass: 0, latencyRise: 0 };
    perService.set(service, entry);
    return entry;
  };

  // Failures, per inbound edge, after minus before.
  const failedAfter = new Map<string, number>();
  const failedBefore = new Map<string, number>();
  // Durations, per inbound edge, on each side of the injection.
  const durAfter = new Map<string, number[]>();
  const durBefore = new Map<string, number[]>();
  const byId = new Map<string, DirectionalSpan>();
  for (const s of traces) byId.set(s.spanId, s);

  for (const s of traces) {
    const parent = s.parentSpanId === undefined ? undefined : byId.get(s.parentSpanId);
    if (parent === undefined) continue;
    const key = `${parent.service}>${s.service}`;
    const after = s.startTime >= input.injectTimeMs;
    if (s.status === 'ERROR') {
      const target = after ? failedAfter : failedBefore;
      target.set(key, (target.get(key) ?? 0) + 1);
    }
    const target = after ? durAfter : durBefore;
    const list = target.get(key) ?? [];
    list.push(s.duration);
    target.set(key, list);
  }

  for (const key of new Set([...failedAfter.keys(), ...failedBefore.keys()])) {
    const callee = key.split('>')[1]!;
    const delta = Math.max(0, (failedAfter.get(key) ?? 0) - (failedBefore.get(key) ?? 0));
    if (delta > 0) bump(callee).failedMass += delta;
    else bump(callee);
  }

  const mean = (xs: readonly number[]): number =>
    xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
  for (const key of new Set([...durAfter.keys(), ...durBefore.keys()])) {
    const callee = key.split('>')[1]!;
    const afterMean = mean(durAfter.get(key) ?? []);
    const beforeMean = mean(durBefore.get(key) ?? []);
    const entry = bump(callee);
    // A rise needs BOTH sides: with no pre-injection mean there is no baseline to rise from, and treating an
    // absent baseline as 1.0 would invent a rise for every edge that only exists after the injection.
    if (beforeMean <= 0 || afterMean <= 0) continue;
    entry.latencyRise = Math.max(entry.latencyRise, afterMean / beforeMean);
  }

  const services: ServiceEvidence[] = [...perService.entries()]
    .map(([service, e]) => ({ service, failedMass: e.failedMass, latencyRise: e.latencyRise }))
    .sort((a, b) => a.service.localeCompare(b.service));

  // Deterministic tops: by value, then by name, so two runs of one corpus agree and a diff is about a change.
  const topBy = (pick: (s: ServiceEvidence) => number): string | undefined => {
    const ranked = [...services]
      .filter((s) => pick(s) > 0)
      .sort((a, b) => pick(b) - pick(a) || a.service.localeCompare(b.service));
    return ranked[0]?.service;
  };

  return {
    caseId: input.caseId,
    stratum: input.stratum,
    spans: traces.length,
    edges: edgesOf(traces).size,
    ...(topBy((s) => s.failedMass) === undefined ? {} : { failedTop1: topBy((s) => s.failedMass) }),
    ...(topBy((s) => s.latencyRise) === undefined
      ? {}
      : { latencyTop1: topBy((s) => s.latencyRise) }),
    services,
  };
}

/** Which of the two channels a reading is about. */
export type EvidenceChannel = 'failedMass' | 'latencyRise';

/**
 * How one channel does on the cases the ENGINE gets wrong, with the repository's own significance reading.
 *
 * The population is the one the question is about: cases the engine misses. Inside it, the channel either
 * prefers the true source — which is what a deployable signal would have to do to fix them — or it does not,
 * and the two counts go through {@link separationPValue}. An AUC is reported beside the p-value for
 * comparability with the FSE'26 battery, but a reader should take the counts: two cases can give an AUC of 1.0.
 */
export interface EvidenceSeparation {
  readonly channel: EvidenceChannel;
  /** What the population was restricted to, e.g. `loss` or `all`. */
  readonly population: string;
  /** Cases where the channel produced a ranking at all. Outside the rate, never a loss. */
  readonly measurable: number;
  /** Of those, how many the engine got wrong. */
  readonly engineMisses: number;
  /** Of those, how many the channel's top-1 names the true source (= would have fixed the case). */
  readonly channelFixable: number;
  /** `channelFixable / engineMisses`, or `undefined` when the engine missed nothing here. */
  readonly auc: number | undefined;
  /** The exact two-sided permutation p-value over the pairs, or `undefined` when nothing was ordered. */
  readonly p: number | undefined;
  /** Whether the pre-registered bar is met: `minAuc` on enough pairs to test. */
  readonly meetsBar: boolean;
}

/**
 * Read one channel's separation over a population, given each case's truth and the engine's rank-1.
 *
 * @param readings - The per-case evidence.
 * @param truthOf - The case's ground-truth source service.
 * @param engineTop1Of - The engine's rank-1 service for the case.
 * @param populationOf - The stratum key a case belongs to, for the filter.
 * @param want - A stratum substring to restrict to (`''` for all), so `loss` and `all` are one call apart.
 * @param criterion - The pre-registered bar; defaults to the repository's.
 * @returns The counts, the rate over them, the p-value and whether the bar is met.
 */
export function readEvidenceSeparation(
  readings: readonly DirectionalReading[],
  truthOf: (caseId: string) => string | undefined,
  engineTop1Of: (caseId: string) => string | undefined,
  populationOf: (caseId: string) => string,
  want: string,
  channel: EvidenceChannel,
  criterion: { minAuc: number; minCases: number } = DEFAULT_SEPARATOR_CRITERION,
): EvidenceSeparation {
  let measurable = 0;
  let engineMisses = 0;
  let channelFixable = 0;
  for (const r of readings) {
    if (want !== '' && !populationOf(r.caseId).includes(want)) continue;
    const top1 = channel === 'failedMass' ? r.failedTop1 : r.latencyTop1;
    const truth = truthOf(r.caseId);
    const engine = engineTop1Of(r.caseId);
    // A case with no measurable evidence is not a loss for the channel — it is unmeasured, which is why it is
    // counted separately and kept out of the rate.
    if (top1 === undefined || truth === undefined) continue;
    measurable++;
    // An engine top-1 the runner could not supply is not a miss either: the comparison needs both sides.
    if (engine === undefined || engine === truth) continue;
    engineMisses++;
    if (top1 === truth) channelFixable++;
  }
  const auc = engineMisses > 0 ? channelFixable / engineMisses : undefined;
  const p = separationPValue(channelFixable, engineMisses - channelFixable);
  return {
    channel,
    population: want === '' ? 'all' : want,
    measurable,
    engineMisses,
    channelFixable,
    auc,
    p,
    meetsBar: auc !== undefined && auc >= criterion.minAuc && engineMisses >= criterion.minCases,
  };
}

/**
 * Render the evidence's availability, which is the first thing a reading about it needs.
 *
 * `failedTraceEdges` is FSE'26-only, so on the RCAEval side the honest first question is whether the raw
 * material is even there: how many cases carry traces, how many traces imply an edge, and how many cases each
 * channel could rank at all. A separation rate quoted without this would be a rate over an unstated
 * denominator.
 *
 * @param readings - The per-case evidence.
 * @returns The availability lines, plus one per stratum that has any traces.
 */
export function formatDirectionalEvidence(readings: readonly DirectionalReading[]): string[] {
  const withTraces = readings.filter((r) => r.spans > 0).length;
  const withEdges = readings.filter((r) => r.edges > 0).length;
  const failedMeasurable = readings.filter((r) => r.failedTop1 !== undefined).length;
  const latencyMeasurable = readings.filter((r) => r.latencyTop1 !== undefined).length;
  const lines = [
    `evidence: ${readings.length} cases | with traces=${withTraces} | implying an edge=${withEdges} | ` +
      `failedMass rankable=${failedMeasurable} | latencyRise rankable=${latencyMeasurable}`,
  ];
  const byStratum = new Map<string, { total: number; traced: number }>();
  for (const r of readings) {
    const entry = byStratum.get(r.stratum) ?? { total: 0, traced: 0 };
    entry.total++;
    if (r.spans > 0) entry.traced++;
    byStratum.set(r.stratum, entry);
  }
  const untraced = [...byStratum.entries()]
    .filter(([, e]) => e.traced === 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (untraced.length > 0) {
    lines.push(
      `evidence: ${untraced.length} of ${byStratum.size} strata have NO traces at all — ` +
        `no directional channel can speak about them: ${untraced
          .slice(0, 8)
          .map(([k, e]) => `${k}(${e.total})`)
          .join(' ')}${untraced.length > 8 ? ' …' : ''}`,
    );
  }
  return lines;
}

/**
 * Render a separation reading as the line a report carries.
 *
 * The bar and its requirement are named on the line rather than left to the reader, because the repository's
 * standard is a PRE-REGISTERED bar: `meetsBar` false at a high ratio on three pairs is the correct outcome,
 * and a line that printed only the ratio would invite the opposite reading.
 *
 * @param separation - The reading.
 * @returns One line, without a trailing newline.
 */
export function formatEvidenceSeparation(separation: EvidenceSeparation): string {
  const rate = separation.auc === undefined ? 'n/a' : `${(separation.auc * 100).toFixed(1)}%`;
  const p = separation.p === undefined ? 'n/a' : separation.p.toFixed(3);
  return (
    `separation[${separation.channel}|${separation.population}]: measurable=${separation.measurable} | ` +
    `engine misses=${separation.engineMisses} | channel names the truth=${separation.channelFixable} ` +
    `(${rate}) | p=${p} | bar ${separation.meetsBar ? 'MET' : 'NOT met'} ` +
    `(needs ${DEFAULT_SEPARATOR_CRITERION.minAuc.toFixed(2)} on >=${DEFAULT_SEPARATOR_CRITERION.minCases} pairs)`
  );
}

/**
 * The same two observables in the SHAPES THE ENGINE ALREADY ACCEPTS.
 *
 * This is the bridge the RCAEval side never had: `FaultFailedEdge` (`{caller, callee, failed, baseline}`) and
 * `FaultEdgeLatency` (`{caller, callee, preMeanMs, postMeanMs}`) are populated by the FSE'26 loader alone, so
 * the two fields the engine reads for a fault's DIRECTION have been structurally absent on every RCAEval run —
 * including the nine published cells, whose configuration holds `latWeight` non-zero and shipped.
 *
 * The numbers are the SAME per-edge quantities {@link readDirectionalEvidence} reduces to a per-service
 * reading (one pass over the spans, one definition of a failed call, one baseline rule); only the grouping
 * differs, so the measured evidence and the engine's input cannot disagree about the same case.
 *
 * @param traces - The case's spans.
 * @param injectTimeMs - The case's real injection time; `0` disables the before/after split and yields empty
 *        arrays, because with no anchor there is no direction to report rather than a direction of zero.
 * @returns The two arrays, deterministic (ascending by `caller`, then `callee`).
 */
export function toEngineDirectionalInputs(
  traces: readonly DirectionalSpan[] | undefined,
  injectTimeMs: number,
): { failedTraceEdges: FaultFailedEdge[]; edgeLatency: FaultEdgeLatency[] } {
  const spans = traces ?? [];
  // With no anchor every span would count as "after", and a fault's direction is exactly the thing the anchor
  // is needed to see. Reporting nothing is the honest answer; reporting a direction of zero is not.
  if (injectTimeMs <= 0) return { failedTraceEdges: [], edgeLatency: [] };

  const byId = new Map<string, DirectionalSpan>();
  for (const s of spans) byId.set(s.spanId, s);

  interface Edge {
    caller: string;
    callee: string;
    failed: number;
    baseline: number;
    pre: number[];
    post: number[];
  }
  const edges = new Map<string, Edge>();
  for (const s of spans) {
    const parent = s.parentSpanId === undefined ? undefined : byId.get(s.parentSpanId);
    if (parent === undefined) continue;
    const key = `${parent.service}>${s.service}`;
    const edge = edges.get(key) ?? {
      caller: parent.service,
      callee: s.service,
      failed: 0,
      baseline: 0,
      pre: [],
      post: [],
    };
    edges.set(key, edge);
    const after = s.startTime >= injectTimeMs;
    if (s.status === 'ERROR') {
      if (after) edge.failed++;
      else edge.baseline++;
    }
    (after ? edge.post : edge.pre).push(s.duration);
  }

  const ordered = [...edges.values()].sort(
    (a, b) => a.caller.localeCompare(b.caller) || a.callee.localeCompare(b.callee),
  );

  return {
    // `failed > 0`, which is the SAME rule the streaming derivation uses
    // (`countDirectionalInputs` in `rcaeval-loader.ts`), and the rule this function used to state as
    // `failed > 0 || baseline > 0`. The two derivations describe one relation, so a difference between them
    // would be a difference in a case INPUT; the ENGINE's own consumer makes the divergence harmless —
    // `computeFailedEdgeScores` reads `max(0, failed - baseline)` and skips anything `<= 0`, so a row whose
    // only content is a baseline contributes nothing — but relying on that would be a guard whose
    // reachability belongs to its caller. The row is not emitted instead.
    failedTraceEdges: ordered
      .filter((e) => e.failed > 0)
      .map((e) => ({ caller: e.caller, callee: e.callee, failed: e.failed, baseline: e.baseline })),
    // A latency RISE needs both sides: with no pre-injection mean there is no baseline, and reporting `pre = 0`
    // would invite the engine to read a rise of infinity where there is only an absent measurement. The guard
    // is INSIDE the mapping rather than a filter before it, so both arrays are known non-empty at the point
    // they are divided — which is why this needs no empty-array arm, and has none.
    edgeLatency: ordered.flatMap((e) =>
      e.pre.length > 0 && e.post.length > 0
        ? [
            {
              caller: e.caller,
              callee: e.callee,
              preMeanMs: e.pre.reduce((a, b) => a + b, 0) / e.pre.length,
              postMeanMs: e.post.reduce((a, b) => a + b, 0) / e.post.length,
            },
          ]
        : [],
    ),
  };
}

/**
 * What the direction channels actually hold, counted from the cases themselves.
 *
 * ## Why this is not a nicety
 *
 * A weighted term whose input is ABSENT contributes exactly zero, and so does a weighted term whose input is
 * present but uninformative. Every artifact in this repository reports the score the term produced and
 * neither of those facts, so the two are indistinguishable in the output — and the ablation battery spent
 * six iterations reading the second as if it were the first. `latWeight = 0.561495` is one of the three
 * terms that dominate the shipped ranking, and on the RCAEval path it multiplied an empty map for as long as
 * the loader attached only `failedTraceEdges`.
 *
 * ## What is counted
 *
 * Cases that carry at least one row, and the rows themselves. `casesWith* == 0` is the "starved" reading;
 * `casesWith* == <all cases>` with a flat score is the "inert" reading. Both are results, and only one of
 * them is about the term's usefulness.
 */
export interface DirectionalCoverage {
  readonly cases: number;
  readonly casesWithFailedEdges: number;
  readonly failedEdges: number;
  readonly casesWithLatency: number;
  readonly latencyEdges: number;
}

/**
 * Count the direction channels' coverage over a corpus.
 *
 * @param cases - The cases, read only through the two optional fields; anything else is ignored so a caller
 *        can pass its own case type.
 * @returns The counts. An absent field and an empty array count the same way — nothing to measure.
 */
export function summarizeDirectionalCoverage(
  cases: ReadonlyArray<{
    readonly failedTraceEdges?: ReadonlyArray<FaultFailedEdge> | undefined;
    readonly edgeLatency?: ReadonlyArray<FaultEdgeLatency> | undefined;
  }>,
): DirectionalCoverage {
  let casesWithFailedEdges = 0;
  let failedEdges = 0;
  let casesWithLatency = 0;
  let latencyEdges = 0;
  for (const c of cases) {
    const failed = c.failedTraceEdges?.length ?? 0;
    if (failed > 0) {
      casesWithFailedEdges++;
      failedEdges += failed;
    }
    const latency = c.edgeLatency?.length ?? 0;
    if (latency > 0) {
      casesWithLatency++;
      latencyEdges += latency;
    }
  }
  return {
    cases: cases.length,
    casesWithFailedEdges,
    failedEdges,
    casesWithLatency,
    latencyEdges,
  };
}

/**
 * Render a coverage reading as one line, naming which channel is STARVED when one is.
 *
 * @param coverage - The counts.
 * @param label - What the corpus was (a system name, a suite), for the artifact's reader.
 * @returns One line, without a trailing newline. Ends with an explicit warning when a channel is empty,
 *          because that is the case in which any weight on it measures nothing and a bare `0` does not say so.
 */
export function formatDirectionalCoverage(coverage: DirectionalCoverage, label: string): string {
  const line =
    `direction-coverage[${label}]: ${coverage.cases} cases | ` +
    `failedTraceEdges ${coverage.casesWithFailedEdges}/${coverage.cases} cases, ` +
    `${coverage.failedEdges} edges | ` +
    `edgeLatency ${coverage.casesWithLatency}/${coverage.cases} cases, ${coverage.latencyEdges} edges`;
  const starved = [
    coverage.casesWithFailedEdges === 0 ? 'failedTraceEdges' : undefined,
    coverage.casesWithLatency === 0 ? 'edgeLatency' : undefined,
  ].filter((n): n is string => n !== undefined);
  if (starved.length === 0) return line;
  return `${line} | STARVED: ${starved.join(', ')} — any weight on ${starved.length > 1 ? 'these' : 'it'} measures nothing`;
}

// ── The input census: which channel each ablated term reads, and which are empty ──
//
// The register's requirement, in its own words: **a zero is only readable if the artifact says whether it is
// STARVED or INERT.** `formatDirectionalCoverage` above names the two direction channels; this generalises it
// to every channel an ablated term can read, and it exists because iteration 72 measured the difference and
// iteration 73 had to state it: on RE1 **every** boolean signal reads `+0.0` because the suite carries no
// `logs.csv` and no `traces.csv` at all, while on RE2 the same signals read `+0.0` **with 50 of 50 cases
// carrying both**. The first zero says nothing about the term; the second is the term's verdict.

/** The input a signal is built from. A term whose channel is empty cannot be measured, only reported. */
export type SignalChannel = 'metrics' | 'logs' | 'spans' | 'spanActivity' | 'latency';

/**
 * Which channel each ablated term reads.
 *
 * Owned here rather than at the report site, because the verdict `readZero` computes is a function of this
 * mapping and a mapping that lives beside the print statement is a mapping nobody can test. The entries are
 * the engine OPTION names, so a knob enrolled later without a channel is a missing key rather than a silent
 * `undefined` — see the fence, which requires every ablated weight to appear.
 */
export const TERM_CHANNELS: Readonly<Record<string, SignalChannel>> = {
  logWeight: 'logs',
  traceWeight: 'spanActivity',
  topoWeight: 'spans',
  collisionWeight: 'metrics',
  latWeight: 'latency',
  poolMetricPenaltyWeight: 'metrics',
  stabilityWeight: 'metrics',
};

/** Per-population counts of the cases that carry each channel's input. */
export interface InputCoverage {
  /** How many cases the population holds. */
  readonly cases: number;
  /** Cases with at least one log entry, and the total entries. */
  readonly casesWithLogs: number;
  readonly logEntries: number;
  /** Cases that carried spans into the assembly (the augmentation's input). */
  readonly casesWithSpans: number;
  /** Cases with per-service pre/post span counts (the trace-activity signal's input). */
  readonly casesWithSpanActivity: number;
  /** Cases with a failed edge / a latency edge, and the total latency edges. */
  readonly casesWithFailedEdges: number;
  readonly casesWithLatency: number;
  readonly latencyEdges: number;
}

/**
 * Count the cases that carry each channel's input.
 *
 * The metric channel is deliberately `cases` — every RCAEval case has metrics, which is why the two
 * never-ablated priors act on it and are the only levers a suite with no logs and no traces has.
 *
 * @param cases - The assembled cases of one population (a system, or a suite).
 * @returns The counts. A zero here is a STATEMENT about the corpus, not about a term.
 */
export function summarizeInputCoverage(
  cases: ReadonlyArray<{
    readonly logs?: ReadonlyArray<unknown> | undefined;
    readonly traces?: ReadonlyArray<unknown> | undefined;
    readonly traceActivity?: ReadonlyMap<string, unknown> | undefined;
    readonly failedTraceEdges?: ReadonlyArray<unknown> | undefined;
    readonly edgeLatency?: ReadonlyArray<unknown> | undefined;
  }>,
): InputCoverage {
  let casesWithLogs = 0;
  let logEntries = 0;
  let casesWithSpans = 0;
  let casesWithSpanActivity = 0;
  let casesWithFailedEdges = 0;
  let casesWithLatency = 0;
  let latencyEdges = 0;
  for (const c of cases) {
    const logs = c.logs?.length ?? 0;
    if (logs > 0) {
      casesWithLogs++;
      logEntries += logs;
    }
    if ((c.traces?.length ?? 0) > 0) casesWithSpans++;
    if ((c.traceActivity?.size ?? 0) > 0) casesWithSpanActivity++;
    if ((c.failedTraceEdges?.length ?? 0) > 0) casesWithFailedEdges++;
    const latency = c.edgeLatency?.length ?? 0;
    if (latency > 0) {
      casesWithLatency++;
      latencyEdges += latency;
    }
  }
  return {
    cases: cases.length,
    casesWithLogs,
    logEntries,
    casesWithSpans,
    casesWithSpanActivity,
    casesWithFailedEdges,
    casesWithLatency,
    latencyEdges,
  };
}

/**
 * How many cases carry a channel's input.
 *
 * @param coverage - The counts.
 * @param channel - Which channel.
 * @returns The case count, or the population size for `metrics`, which every case has.
 */
export function channelCases(coverage: InputCoverage, channel: SignalChannel): number {
  switch (channel) {
    case 'metrics':
      return coverage.cases;
    case 'logs':
      return coverage.casesWithLogs;
    case 'spans':
      return coverage.casesWithSpans;
    case 'spanActivity':
      return coverage.casesWithSpanActivity;
    case 'latency':
      return coverage.casesWithLatency;
  }
}

/**
 * The verdict a row's delta earns, given its channel's coverage — the STARVED/INERT distinction.
 *
 * @param delta - The row's measured delta against its baseline.
 * @param coveredCases - Cases in the population that carry the term's input.
 * @param epsilon - Tolerance below which a delta counts as no movement.
 * @returns `moved`, or `STARVED` when the input was absent (the zero says nothing about the term), or
 *          `INERT` when the input was present and the ranking did not move.
 */
export function readZero(
  delta: number,
  coveredCases: number,
  epsilon = 1e-9,
): 'moved' | 'INERT' | 'STARVED' {
  if (Math.abs(delta) > epsilon) return 'moved';
  return coveredCases === 0 ? 'STARVED' : 'INERT';
}

/**
 * Render the census as lines that name every starved channel and the terms it makes unmeasurable.
 *
 * @param coverage - The counts.
 * @param label - What the population was (a system name, a suite).
 * @returns Lines, without trailing newlines.
 */
export function formatInputCoverage(coverage: InputCoverage, label: string): string[] {
  const lines = [
    `input-coverage[${label}]: ${coverage.cases} cases | ` +
      `logs ${coverage.casesWithLogs}/${coverage.cases} (${coverage.logEntries} entries) | ` +
      `spans ${coverage.casesWithSpans}/${coverage.cases} | ` +
      `spanActivity ${coverage.casesWithSpanActivity}/${coverage.cases} | ` +
      `failedEdges ${coverage.casesWithFailedEdges}/${coverage.cases} | ` +
      `latency ${coverage.casesWithLatency}/${coverage.cases} (${coverage.latencyEdges} edges)`,
  ];
  const starved = (Object.keys(TERM_CHANNELS) as string[]).filter(
    (term) => channelCases(coverage, TERM_CHANNELS[term]!) === 0,
  );
  lines.push(
    starved.length === 0
      ? `  every ablated term has its input here — a 0.0 below is INERT, not starved`
      : `  STARVED channels ⇒ UNMEASURABLE terms: ${starved.join(', ')}` +
          ` — a 0.0 on any of them says nothing about the term`,
  );
  return lines;
}
