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
  // Metric-derived too, and mapped rather than left unmapped: the rise signal is a property of the case's own
  // series and the PRISM score is a deviation z-score over them, so both act on the channel every RCAEval case
  // has. A term left out of this map renders `UNKNOWN-CHANNEL` in the verdict block, and that token now means
  // exactly one thing — a SWITCH, a FLOOR or a FORM SELECTOR, none of which multiplies an input.
  riseWeight: 'metrics',
  prismWeight: 'metrics',
};

/** Per-population counts of the cases that carry each channel's input. */
export interface InputCoverage {
  /** How many cases the population holds. */
  readonly cases: number;
  /**
   * Cases retaining at least one **readable** log row — one the severity derivation kept (ERROR/FATAL) — and the
   * total readable entries.
   *
   * Named for what it counts, because `run-rcaeval.ts` prints a `cases with logs` line of its own that counts a
   * DIFFERENT quantity: cases whose file yielded any row at all, taken from `logRowsRead` before the assembly's
   * retention filter. On RE2-OnlineBoutique the two read `21/90` and `90/90` for the same corpus, and neither line
   * said which it was. This is the one `logWeight`'s measurability must be decided on, because a case with no
   * readable row contributes nothing to the signal.
   */
  readonly casesWithReadableLogs: number;
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
  let casesWithReadableLogs = 0;
  let logEntries = 0;
  let casesWithSpans = 0;
  let casesWithSpanActivity = 0;
  let casesWithFailedEdges = 0;
  let casesWithLatency = 0;
  let latencyEdges = 0;
  for (const c of cases) {
    const logs = c.logs?.length ?? 0;
    if (logs > 0) {
      casesWithReadableLogs++;
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
    casesWithReadableLogs,
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
      return coverage.casesWithReadableLogs;
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
      `logs ${coverage.casesWithReadableLogs}/${coverage.cases} readable ` +
      `(${coverage.logEntries} entries) | ` +
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

// ── The latency-route census: three derivations of ONE quantity, and where each of them dies ──
//
// `input-coverage` above can say that `latency` holds nothing, and that is all it can say: STARVED names the
// term's verdict but not the mechanism, and `latWeight` is read by three DIFFERENT derivations of the same
// array. Iteration 73 left the sharpest question in the register open on exactly that ambiguity — RE3
// OnlineBoutique reads `failedEdges 15/30` while `latency 0/30`, from one file, in the same cases — and the
// candidate mechanisms predict the SAME zero while differing in everything else:
//
// - a **missing anchor** (`tryLoadInjectTime` degrades to `0`, and every span is after zero) leaves the capped
//   list with no pre-injection span;
// - a **unit defect** (a value already in milliseconds scaled by 1000 again) leaves it with no pre-injection
//   span either — the same signature, one layer up;
// - a **truncating cap** (`tryLoadTraces` reads a byte prefix) leaves it with no POST-injection span, which is
//   the opposite signature.
//
// The counts below separate them, because the anchor's presence and the cap's landing side are both observable
// and so is each route's row count. What is NOT observable from a single number is the difference between "the
// input is absent" and "the derivation cannot express it" — which is the whole point.

/** One case's contribution to the latency-route census. Computed by the corpus owner, aggregated here. */
export interface LatencyRouteEntry {
  /**
   * Whether the case carried a usable fault injection time.
   *
   * The THIRD way every span can end up on the "after" side, and it has to be counted separately or it
   * silently impersonates the other two: `tryLoadInjectTime` degrades to `0` when `inject_time.txt` is absent
   * or unparsable, and an anchor of zero puts every span after it — so the ALL-AFTER signature is produced by a
   * missing anchor just as it is by a start time scaled twice. One boolean removes the confound.
   */
  readonly anchorPresent: boolean;
  /** Spans in the case's CAPPED list, which is the input every view but `whole-file` reads. */
  readonly capSpans: number;
  /** Of those, how many start before the injection anchor. */
  readonly capPre: number;
  readonly capPost: number;
  /** Rows each view produced, so a zero can be attributed to a view rather than to the channel. */
  readonly shippedRows: number;
  readonly cappedRows: number;
  readonly wholeFileRows: number;
}

/** The latency channel's three routes over one population. */
export interface LatencyRouteCensus {
  readonly cases: number;
  /** Cases with no usable injection anchor, whose split is therefore "everything is after". */
  readonly casesWithoutAnchor: number;
  /** Cases whose capped list held at least one span. */
  readonly casesWithCapSpans: number;
  readonly capSpans: number;
  readonly capPre: number;
  readonly capPost: number;
  /** Cases whose capped list lies ENTIRELY at/after the anchor — the signature of the double scale. */
  readonly casesCapAllAfter: number;
  /** Cases whose capped list lies ENTIRELY before the anchor — the signature of a cap that truncates early. */
  readonly casesCapAllBefore: number;
  /** Cases whose capped list holds both sides, so a rise is expressible for at least one edge. */
  readonly casesCapComparable: number;
  readonly shippedCases: number;
  readonly shippedRows: number;
  readonly cappedCases: number;
  readonly cappedRows: number;
  readonly wholeFileCases: number;
  readonly wholeFileRows: number;
}

/**
 * Aggregate the per-case entries.
 *
 * @param entries - One entry per assembled trace-bearing case. A case with no traces contributes its zeros.
 * @returns The counts, with `cases` = the population size.
 */
export function summarizeLatencyRoutes(entries: readonly LatencyRouteEntry[]): LatencyRouteCensus {
  let casesWithoutAnchor = 0;
  let casesWithCapSpans = 0;
  let capSpans = 0;
  let capPre = 0;
  let capPost = 0;
  let casesCapAllAfter = 0;
  let casesCapAllBefore = 0;
  let casesCapComparable = 0;
  let shippedCases = 0;
  let shippedRows = 0;
  let cappedCases = 0;
  let cappedRows = 0;
  let wholeFileCases = 0;
  let wholeFileRows = 0;
  for (const e of entries) {
    if (!e.anchorPresent) casesWithoutAnchor++;
    if (e.capSpans > 0) {
      casesWithCapSpans++;
      capSpans += e.capSpans;
      capPre += e.capPre;
      capPost += e.capPost;
      if (e.capPre === 0) casesCapAllAfter++;
      else if (e.capPost === 0) casesCapAllBefore++;
      else casesCapComparable++;
    }
    if (e.shippedRows > 0) {
      shippedCases++;
      shippedRows += e.shippedRows;
    }
    if (e.cappedRows > 0) {
      cappedCases++;
      cappedRows += e.cappedRows;
    }
    if (e.wholeFileRows > 0) {
      wholeFileCases++;
      wholeFileRows += e.wholeFileRows;
    }
  }
  return {
    cases: entries.length,
    casesWithoutAnchor,
    casesWithCapSpans,
    capSpans,
    capPre,
    capPost,
    casesCapAllAfter,
    casesCapAllBefore,
    casesCapComparable,
    shippedCases,
    shippedRows,
    cappedCases,
    cappedRows,
    wholeFileCases,
    wholeFileRows,
  };
}

/**
 * The verdict the three routes' counts earn — the mechanism, named, with its own discriminator.
 *
 * The arms are ordered so that the FIRST one that can be read decides, and the order is a claim about which
 * reading is stronger: a view that produced a row is not explained away by a starvation, and a cap that landed
 * on one side is a statement about the input that no row count can overrule. The `whole-file` clause is
 * appended rather than made its own arm because it is not a competing explanation — it is the same population
 * read through the one derivation that sees the whole file, and its presence is what distinguishes "the corpus
 * cannot express this" from "the input never arrived".
 *
 * @param c - The census.
 * @returns One line. The arms are exclusive and the last one is a residue rather than a catch-all — see its
 *          own note — and the whole-file discriminator is appended whenever the capped routes are dead and the
 *          streaming route is not.
 */
export function latencyChannelVerdict(c: LatencyRouteCensus): string {
  const counter = `${c.casesCapAllAfter + c.casesCapAllBefore + c.casesCapComparable}`;
  const live =
    `the WHOLE-FILE route yields ${c.wholeFileRows} rows in ${c.wholeFileCases}/${counter} cases — ` +
    `the channel is not starved; its input is discarded at the assembly`;
  let verdict: string;
  if (c.shippedCases > 0) {
    verdict = `LIVE (shipped) — ${c.shippedRows} rows in ${c.shippedCases} cases`;
  } else if (c.capSpans === 0) {
    verdict = `STARVED — the capped list holds no spans at all`;
  } else if (c.casesWithoutAnchor > 0) {
    // FIRST among the mechanisms that empty the pre side, because it produces the same signature as the next
    // arm and the next arm is the one a reader would otherwise conclude: with no anchor, `atMs < 0` is false
    // for every span, so every span is "after" it and no edge can have a pre-side mean — without any start time
    // being scaled wrongly. Reading ALL-AFTER here would name a defect the run may not have.
    //
    // Its rate is over the POPULATION, not over `counter`: a missing anchor is a property of the case, whereas
    // `counter` counts the cases that had spans to split. Two denominators in one sentence would make the
    // reader compare a count of cases against a count of cases-with-spans.
    verdict =
      `NO ANCHOR — ${c.casesWithoutAnchor}/${c.cases} cases carry no usable injection time ` +
      `(inject_time.txt absent or unparsable), so every span is after it`;
  } else if (c.casesCapAllAfter > 0) {
    verdict =
      `ALL-AFTER — ${c.casesCapAllAfter}/${counter} cases put EVERY capped span at or after the anchor, so no ` +
      `edge can have a pre-side mean`;
  } else if (c.casesCapAllBefore > 0) {
    verdict =
      `CAP TRUNCATES — ${c.casesCapAllBefore}/${counter} cases place every capped span BEFORE the anchor, so ` +
      `the prefix ends before the window`;
  } else if (c.cappedCases > 0) {
    verdict = `LIVE (capped) — ${c.cappedRows} rows in ${c.cappedCases} cases`;
  } else {
    // The residual, and it is a RESIDUE rather than a possibility: every earlier arm has been excluded, so
    // `capSpans > 0` while no case is all-after and none is all-before — which can only mean every case with
    // spans holds both sides. So `casesCapComparable > 0` here BY CONSTRUCTION, and the reading is that the
    // input is present, expressible, and still yields nothing.
    verdict = `UNEXPLAINED — ${c.casesCapComparable} cases hold both sides and no route emitted a row`;
  }
  const dead = c.shippedCases === 0 && c.cappedCases === 0;
  return dead && c.wholeFileRows > 0 ? `${verdict}; ${live}` : verdict;
}

/**
 * Render the census as the lines the artifact carries.
 *
 * @param c - The census.
 * @param label - What the population was (a system name).
 * @returns Lines, without trailing newlines: the counts, then the verdict.
 */
export function formatLatencyRoutes(c: LatencyRouteCensus, label: string): string[] {
  return [
    `latency-routes[${label}]: ${c.cases} cases | no anchor ${c.casesWithoutAnchor} | ` +
      `capped spans ${c.capSpans} (pre ${c.capPre} / post ${c.capPost}) | ` +
      `cap all-after ${c.casesCapAllAfter} | cap all-before ${c.casesCapAllBefore} | ` +
      `comparable ${c.casesCapComparable} | ` +
      `rows: shipped ${c.shippedRows} | capped ${c.cappedRows} | whole-file ${c.wholeFileRows}`,
    `  VERDICT: ${latencyChannelVerdict(c)}`,
  ];
}
