/**
 * FSE'26 per-case diagnostic formatter.
 *
 * The benchmark runner invokes the engine on each case and scores a single
 * Top@1..K number, but a fault-type-level gap (e.g. HTTPResponseReplaceCode at
 * 4.8% vs HTTPResponseReplaceBody at 98%) cannot be diagnosed from that scalar
 * alone. This module renders the per-service signal inventory behind one
 * case's ranking — metric names, dominant metric, self-anomaly, log score,
 * error/logic-exception volumes and sample error lines — so a weak fault type
 * can be traced to its cause: the source's signature is absent from the data
 * the engine receives, or present but not rewarded by a ranking signal.
 *
 * The formatter is PURE and dataset-decoupled: it takes an already-summarised
 * service list (the runner does the glue extraction from {@link BenchmarkCase}
 * and the built fault graph) and returns a deterministic, human-readable text
 * block. It never reads the filesystem or the engine.
 *
 * @module benchmarks/fse26-diagnose
 */

import type { MetricDiagnostic } from '@agentix-e/micro-kinetic-core';

/** A single service's signal summary for one case. */
export interface FSE26DiagnosticService {
  /** Service ID (Train Ticket name, e.g. `ts-order-service`). */
  readonly serviceId: string;
  /** Distinct metric names the service carries in its `_metrics` series. */
  readonly metricNames: readonly string[];
  /** The metric that drove the engine's self-anomaly score (if any). */
  readonly dominantMetric: string | undefined;
  /**
   * The per-service score the engine RANKED on — the exact input of its `finalScore`'s
   * `log1p`, read off the fault graph after the builder finished with it.
   *
   * Deliberately not documented as "[0, 1] rank-normalised", which is what this field's
   * contract claimed until it was measured: the topology builder rescales the anomaly
   * vector only for a graph with at least `ANOMALY_NORMALIZE_NODE_THRESHOLD` nodes, and
   * which rescale it applies there is the `rankNormalization` flag's business. Above the
   * threshold this value is therefore in [0, 1] with a maximum of exactly 1; below it the
   * value is the RAW deviation, unbounded in the rise direction. A reader that assumed the
   * rescaled form was reading a different quantity for every case below the threshold —
   * one with the engine's order (any rescale here is monotone) and not the engine's gaps —
   * which is the defect `docs/fse26-cv-screen.md` §"The cause, and the fix" records. Print the value and
   * read it; do not rebuild it from the row order.
   */
  readonly selfAnomaly: number;
  /** The engine's max-normalised logic-exception log score in [0, 1]. */
  readonly logScore: number;
  /**
   * The engine's max-normalised failed-edge-direction score in [0, 1] — the
   * credit this service receives as the CALLEE of post-injection failed calls.
   *
   * Required, not optional: it is the INVERSE of `logScore`, so a regression it
   * causes cannot be attributed from a dump that omits it. The two together
   * say whether a service is the source (high here, silent in logs) or a victim
   * (high in logs, low here), which is the whole question.
   */
  readonly failedEdgeScore: number;
  /**
   * How many failed-edge RECORDS name this service as the callee, before the
   * signal's filtering or normalisation. A raw count, deliberately not a second
   * implementation of the aggregation: it answers "is this service's evidence
   * volume or its ranking that changed", which the normalised score cannot.
   */
  readonly failedEdgeRecords: number;
  /**
   * The largest inbound latency rise this service sees, as `postMeanMs / preMeanMs`
   * over the callers that have a measurement on both sides, or `undefined` when no
   * inbound edge has one.
   *
   * `undefined` rather than 1: "no caller measured a change" and "every caller
   * measured exactly the same latency" are different statements, and defaulting to
   * 1 would report the second for both.
   */
  readonly latRise: number | undefined;
  /** How many inbound edges carried a latency measurement on both sides. */
  readonly latEdges: number;
  /**
   * How long after fault injection this service's DOMINANT metric first left its
   * pre-injection baseline, in milliseconds — the input of the temporal causal
   * prior (`temporalWeight`), and the only per-service quantity in the dump that
   * is a TIME rather than a magnitude.
   *
   * Passed through RAW, including the engine's own `-1` for "undetermined":
   * interpreting it is the formatter's job, so a negative value here is data and
   * not a bug to be patched at the call site. Optional so a producer that does
   * not have the graph's map renders the block it rendered before, and so an
   * ABSENT field keeps meaning "this dump predates the field" — which is not the
   * same claim as "measured and undetermined", the way an absent `edges` line is
   * not the same as an empty one.
   */
  readonly onsetDelayMs?: number | undefined;
  /** Count of post-injection ERROR log lines. */
  readonly errorCount: number;
  /** Count of post-injection FATAL log lines. */
  readonly fatalCount: number;
  /** Count of post-injection self-caused logic-exception lines. */
  readonly logicExceptionCount: number;
  /**
   * Count of post-injection framework-HTTP exception lines
   * (`HttpServerErrorException`/`ResourceAccessException`/`RestClientException`
   * kin) — the `logicHttp` mode's second source signature. Reveals whether a
   * service is a DOMINANT framework-HTTP emitter (the replace-code source) or a
   * SPREAD cascade victim (the source-silent fault's caller).
   */
  readonly httpExceptionCount: number;
  /**
   * Count of post-injection ERROR/FATAL lines that are BOTH a self-caused logic
   * exception AND a framework-HTTP exception.
   *
   * The queue the log term divides by is the UNION of the two signatures, not
   * their sum: the engine admits a line once (`isSourceSignature` returns a
   * boolean per line), and a line can carry both flags. Measured on the shipped
   * 1422-case dump, the two sets overlap heavily wherever a framework-HTTP flood
   * exists — one case's source carries `logic=3495` inside `http=3499` out of
   * `err=3499` lines, so `logic + http` double-counts 3495 of them and the
   * reconstructed flood is 2× the engine's.
   *
   * Printed as a PRIMITIVE rather than as the pre-combined union, because the
   * union differs per mode: `count` admits logic lines alone, `logicHttp` and
   * its gates admit both, `all` admits every ERROR/FATAL. With `logic`, `http`,
   * `both` and `err`/`fatal` a reader can form the level-1 flood for every mode
   * exactly, which is what removes the reconstruction's error bar.
   *
   * Optional only so a producer that predates the field renders the block it
   * rendered before — the same additive rule `onsetDelayMs` follows. It is NEVER
   * omitted because it is zero: `both=0` is a measurement (the sets are disjoint)
   * and an absent field is the different claim "not measured", which is why a reader
   * that needs the union refuses an absent one instead of defaulting it.
   */
  readonly bothExceptionCount?: number | undefined;
  /** A small sample of the service's ERROR/FATAL messages (truncated). */
  readonly sampleErrorMessages: readonly string[];
  /**
   * The DISTINCT deepest `Caused by:` exception classes of the service's
   * post-injection ERROR/FATAL lines, sorted ascending. Reveals the actual
   * exception signature (e.g. `HttpServerErrorException`) that the log signal's
   * `isLogicException` gate may or may not recognise — the causal discriminator
   * behind a weak fault type.
   */
  readonly exceptionClasses: readonly string[];
  /**
   * The fate of every metric this service carries, in the order the engine
   * examined them (see {@link MetricDiagnostic}).
   *
   * The service's anomaly score is a MAXIMUM over its metrics, so a scalar
   * cannot say whether the metric that should have carried the fault signature
   * was scored and out-competed, or was discarded by a guard before it was ever
   * scored. Those are different defects with different fixes, and this is the
   * only field that separates them.
   *
   * Optional so an engine that does not report metric diagnostics renders
   * exactly the block it rendered before.
   */
  readonly metricOutcomes?: readonly MetricDiagnostic[];
}

/** Input to {@link formatFSE26Diagnostic}. */
export interface FSE26DiagnosticInput {
  /** Datapack name (the case identifier). */
  readonly datapack: string;
  /** The injected fault type (e.g. `JVMMemoryStress`). */
  readonly faultType: string;
  /** The accepted ground-truth service IDs. */
  readonly groundTruthServices: readonly string[];
  /** Per-service summaries; ordering is normalised by the formatter. */
  readonly services: readonly FSE26DiagnosticService[];
  /** The engine's top-K predicted service IDs, in rank order. */
  readonly topPredictions: readonly string[];
  /**
   * The log-signal mode this run scored with. Required rather than optional:
   * the per-service `logic` and `http` counts below are gated by the mode, so a
   * block without it cannot be interpreted after being copied out of a log.
   */
  readonly logSignalMode: string;
  /**
   * The case's call-graph edges, as `caller>callee`, sorted and de-duplicated.
   *
   * The per-service block carries only SCALARS, so no dump can answer a question
   * about STRUCTURE — whether the credited service calls the source, whether it sits
   * upstream or downstream of it, how deep it is. Those are exactly the
   * discriminators a signal that credits a CALLEE needs, and the failed-edge work was
   * blocked on them: its credited callee is the same service in the cases where it is
   * right and in the cases where it is wrong, so nothing about that service's identity
   * or its own score can separate the two.
   *
   * Optional so a dump written before this line renders exactly the block it rendered
   * before. An ABSENT line means "not recorded" and is reported as `undefined` by the
   * parser, never as an empty edge set — the same absence-versus-empty rule the
   * per-service fields follow.
   */
  readonly edges?: readonly string[];
  /**
   * The case's fault-injection time, Unix ms — the anchor every per-service
   * `onset` is measured from.
   *
   * Optional and rendered last, so an older block is unchanged. It is carried
   * because a delay is meaningless without its origin, and because the temporal
   * term is INERT when the injection time is unknown: a reader of a dump that
   * omits it must be able to tell "the engine had no anchor" from "the engine
   * measured and found nothing".
   */
  readonly injectTimeMs?: number | undefined;
}

/**
 * The decimals {@link fmt} renders `selfAnomaly`, `logScore` and `latRise` with.
 *
 * Exported because it is a PROPERTY OF THE ARTIFACT, not of this file: the analyzer reads the dump
 * and has to know how much of each number survived the render. A reader that assumed its own
 * precision would report a margin smaller than the quantum it was computed from — measured on run
 * `35107871516`, the decisive-stability screen claimed six gains at 0.030170 while the widest
 * discarded digit was four times the lead that decided the sixth one.
 *
 * Three, not more, because a dump is a summary of 1422 cases and the extra characters would buy
 * nothing a reader of the table needs; the analyzer states the resulting error bar instead of
 * asking for a different artifact.
 */
export const SERVICE_FIELD_DECIMALS = 3;

/**
 * How much of an ONSET DELAY the render discards: half a millisecond, and it is the same kind of
 * fact as {@link SERVICE_FIELD_DECIMALS} — a property of the artifact, not of this file.
 *
 * {@link fmtOnset} rounds to whole milliseconds, so every printed delay stands for a real value
 * somewhere in `[printed − 0.5, printed + 0.5]` ms. Two consequences, and the second is the one that
 * bites: a reader cannot tell a 0.4 ms gap from a tie, and the temporal term is an ORDER over these
 * numbers (`computeOnsetSlopes` sorts by delay, ties by service id), so inside one rounded
 * millisecond the engine's order is not recoverable from the dump at all.
 *
 * Exported for the same reason as the decimals above, and it is a DIFFERENT number: the analyzer's
 * ensembles must draw each field at ITS OWN resolution. A screen that drew the onset field at the
 * base fields' `5.0e-4` would model a precision the artifact does not have and, worse, a magnitude
 * three orders of magnitude away from the one that decides the term — measured on run `35107871516`,
 * the onset screen's `earliest-only` shape survives in 22 of 100 draws of ±0.5 ms while the screen
 * that never drew this field reported `100.0%`.
 */
export const ONSET_FIELD_HALF_QUANTUM = 0.5;

/**
 * Format a single `x` as a fixed {@link SERVICE_FIELD_DECIMALS}-decimal string, guarding against
 * non-finite values (which JSON cannot legally carry but a defensive renderer must still survive).
 */
function fmt(x: number): string {
  if (!Number.isFinite(x)) return 'nonfinite';
  return x.toFixed(SERVICE_FIELD_DECIMALS);
}

/**
 * Render an onset delay in whole milliseconds, or `-` when the engine could not
 * determine one.
 *
 * `-` covers the engine's `-1` sentinel AND any non-finite value, because all of
 * them mean the same thing to every reader: this service carries no onset
 * evidence, so the temporal term's earliness map omits it and it stays neutral.
 * A NEGATIVE delay is therefore never printed as a number — a reader subtracting
 * two of them would otherwise read a service that deviated before the injection
 * as the most "causal" service in the case.
 *
 * @param delayMs - The engine's raw delay; negative or non-finite = undetermined.
 * @returns The rendered field value.
 */
function fmtOnset(delayMs: number): string {
  return Number.isFinite(delayMs) && delayMs >= 0 ? String(Math.round(delayMs)) : '-';
}

/** Truncate a message to `max` characters without splitting a UTF-16 pair. */
function truncate(message: string, max: number): string {
  return message.length <= max ? message : `${message.slice(0, max)}…`;
}

/**
 * Format a ratio in the units the scorer used: two decimals below a thousand,
 * scientific notation above. A relative rise is unbounded, so a fixed-decimal
 * render would print `1954.300` — five significant digits spent on a quantity
 * whose useful information is its magnitude.
 *
 * Four significant digits, not three: the reader compares the baseline against
 * the near-zero guard's `0.001` floor, and a three-digit render maps `1.004e-3`
 * onto `1.00e-3`, which reads as at-the-floor when it is not.
 */
function fmtRatio(x: number): string {
  if (!Number.isFinite(x)) return 'nonfinite';
  return x >= 1000 ? x.toExponential(3) : x.toFixed(2);
}

/**
 * Format a baseline level. Baselines span roughly 1e-4 to 1e8 across the
 * bridge's metric sources, and a near-zero baseline is the whole reason a rise
 * can be huge, so the exponent is the part that has to survive the render.
 */
function fmtBase(x: number): string {
  if (!Number.isFinite(x)) return 'nonfinite';
  return x === 0 ? '0' : x.toExponential(3);
}

/** How many kept metrics carry a decomposition, and their combined lines. */
const SHAPE_TOP_K = 3;

/**
 * Render the decomposition of the metrics that decided a service's score.
 *
 * The anomaly score is unbounded in the RISE direction and hard-capped at
 * `log10(2)` in the DROP direction (a relative drop cannot exceed 100%), so a
 * score above ~0.55 can only have come from a rise. Without the rise ratio and
 * the baseline it was measured against, a score cannot be told apart from a
 * shape artifact. Rendered only for the metrics the caller supplied a
 * decomposition for, and the counts make a partial render detectable.
 *
 * @param outcomes - The engine's outcome list for one service.
 * @returns One line, or an empty array when no kept metric carries one.
 */
function formatAnomalyShape(outcomes: readonly MetricDiagnostic[]): string[] {
  const kept = outcomes.filter((d) => d.outcome === 'kept');
  const withBreakdown = kept
    .filter((d) => d.breakdown !== undefined)
    .sort((a, b) => b.score - a.score || (a.label < b.label ? -1 : 1));
  if (withBreakdown.length === 0) return [];
  const shown = withBreakdown.slice(0, SHAPE_TOP_K).map((d) => {
    const b = d.breakdown!;
    return (
      `${d.label}=${fmt(d.score)}{dev=${fmt(b.deviation)},trend=${fmt(b.trend)},` +
      `cv=${fmt(b.cv)},burst=${fmt(b.burst)},rise=${fmtRatio(b.riseRatio)},` +
      `drop=${fmtRatio(b.dropRatio)},base=${fmtBase(b.baselineMean)}}`
    );
  });
  // The declared count is what FOLLOWS on the line, and the denominator is the
  // kept count when the render was truncated. Declaring the kept count instead
  // asserts entries that were never printed, which is indistinguishable from a
  // truncated line — and the reader is right to reject it.
  const count =
    shown.length === kept.length ? String(shown.length) : `${shown.length}/${kept.length}`;
  return [`    metricTop(${count}): ${shown.join(' ')}`];
}

/**
 * Render one service's metric competition as two lines.
 *
 * `metricKept` carries the label and the score that competed for the service's
 * anomaly maximum, highest first; `metricDrop` carries the label and the guard
 * that discarded it, in label order. Both lines are always emitted — including
 * at zero — because the presence of the lines is what distinguishes "the
 * dataset carries no metrics for this service" from "this service was never
 * examined".
 *
 * @param outcomes - The engine's outcome list for one service.
 * @returns Two formatted lines.
 */
function formatMetricCompetition(outcomes: readonly MetricDiagnostic[]): string[] {
  const kept = outcomes
    .filter((d) => d.outcome === 'kept')
    .sort((a, b) => b.score - a.score || (a.label < b.label ? -1 : 1))
    .map((d) => `${d.label}=${fmt(d.score)}`);
  const dropped = outcomes
    .filter((d) => d.outcome !== 'kept')
    .sort((a, b) => (a.label < b.label ? -1 : 1))
    .map((d) => `${d.label}:${d.outcome}`);
  return [
    `    metricKept(${kept.length}):${kept.length > 0 ? ` ${kept.join(' ')}` : ''}`,
    `    metricDrop(${dropped.length}):${dropped.length > 0 ? ` ${dropped.join(' ')}` : ''}`,
  ];
}

/**
 * Render the composition of the metric that drove this service's score.
 *
 * Rendered as a line of its own, in the same `label=score{...}` shape `metricTop` uses, for EVERY
 * service — unlike the shape line, which is limited to the ground truth and the predictions because
 * a reader of the table only compares those two. A term built on this composition has to be
 * SIMULATED over every candidate a case could promote, so the number has to exist for every
 * service, and one line is a bounded cost against a block that already prints several per service.
 *
 * The metric is the one the engine NAMED (`dominant`), so this reports the engine's answer rather
 * than taking a second argmax that would be free to disagree with the ranking. There is deliberately
 * no fallback: when the named metric carries no decomposition the line is absent, and the reader
 * reports the composition as absent — which is a different statement from a composition of zeroes.
 *
 * @param service - One service's signal summary.
 * @returns One line, or an empty array when no named metric carries a decomposition.
 */
function formatDecisiveComposition(service: FSE26DiagnosticService): string[] {
  const decisive = service.metricOutcomes?.find(
    (outcome) => outcome.outcome === 'kept' && outcome.label === service.dominantMetric,
  );
  const b = decisive?.breakdown;
  if (decisive === undefined || b === undefined) return [];
  return [
    `    metricDecisive: ${decisive.label}=${fmt(decisive.score)}{dev=${fmt(b.deviation)},` +
      `trend=${fmt(b.trend)},cv=${fmt(b.cv)},burst=${fmt(b.burst)},rise=${fmtRatio(b.riseRatio)},` +
      `drop=${fmtRatio(b.dropRatio)},base=${fmtBase(b.baselineMean)}}`,
  ];
}

/**
 * Render the per-service signal inventory for a single case.
 *
 * Services are sorted deterministically by self-anomaly (descending, then
 * service ID ascending) so the output is byte-stable across runs. A `[GT]`
 * marker tags accepted ground-truth services and a `[#k]` marker tags the
 * engine's top-k predictions, so a wrong ranking reads directly off the text.
 *
 * @param input - The case summary.
 * @returns A human-readable diagnostic block (trailing newline included).
 */
export function formatFSE26Diagnostic(input: FSE26DiagnosticInput): string {
  const gt = new Set(input.groundTruthServices);
  const predRank = new Map<string, number>();
  input.topPredictions.forEach((serviceId, index) => {
    if (!predRank.has(serviceId)) predRank.set(serviceId, index + 1);
  });

  const ordered = [...input.services].sort((a, b) => {
    const d = b.selfAnomaly - a.selfAnomaly;
    if (d !== 0) return d;
    // Service IDs are distinct within a case, so the tie-break never sees
    // equal IDs — the two-armed comparator is total for this input domain.
    return a.serviceId < b.serviceId ? -1 : 1;
  });

  const lines: string[] = [];
  lines.push(
    `DIAG datapack=${input.datapack} faultType=${input.faultType} GT=[${input.groundTruthServices.join(
      ', ',
    )}] services=${input.services.length} logMode=${input.logSignalMode}` +
      (input.injectTimeMs === undefined ? '' : ` inject=${input.injectTimeMs}`),
  );
  // The graph goes on ONE line rather than into the per-service blocks, because it
  // is a property of the case and every reader wants all of it at once. Rendered
  // only when the producer supplied it, so an older block is byte-identical.
  if (input.edges !== undefined) {
    lines.push(`  edges=${[...input.edges].sort().join(',')}`);
  }

  for (const service of ordered) {
    const markers: string[] = [];
    if (gt.has(service.serviceId)) markers.push('GT');
    const rank = predRank.get(service.serviceId);
    if (rank !== undefined) markers.push(`#${rank}`);
    const tag = markers.length > 0 ? ` [${markers.join(',')}]` : '';
    const metricList = service.metricNames.join(',');
    lines.push(
      `  ${service.serviceId}${tag} selfAnomaly=${fmt(service.selfAnomaly)} ` +
        `logScore=${fmt(service.logScore)} failedEdge=${fmt(service.failedEdgeScore)} ` +
        `failedEdgeRecords=${service.failedEdgeRecords} ` +
        `latRise=${service.latRise === undefined ? '-' : fmt(service.latRise)} ` +
        `latEdges=${service.latEdges} ` +
        `dominant=${service.dominantMetric ?? '-'} ` +
        `err=${service.errorCount} fatal=${service.fatalCount} logic=${service.logicExceptionCount} ` +
        `http=${service.httpExceptionCount}` +
        // Appended to the counts group rather than at the end of the line, so the two
        // optional trailing fields stay distinguishable by NAME: an old block that has
        // `onset=` and no `both=` parses as a missing overlap, which is exactly what it
        // is. The reader's regex matches on the literals, so no index is ambiguous.
        (service.bothExceptionCount === undefined ? '' : ` both=${service.bothExceptionCount}`) +
        // Appended last, and only when the producer supplied it, so a block from a
        // producer that predates the field is byte-identical to what it rendered
        // before — the same additive rule the `edges` line follows.
        (service.onsetDelayMs === undefined ? '' : ` onset=${fmtOnset(service.onsetDelayMs)}`),
    );
    lines.push(`    metrics(${service.metricNames.length}): ${metricList}`);
    // Immediately after the metrics line, and outside the marked-rows condition below, because it
    // belongs to every service: a simulation over every candidate needs it for the ones the table
    // never compares.
    lines.push(...formatDecisiveComposition(service));
    for (const sample of service.sampleErrorMessages) {
      lines.push(`    ERR: ${truncate(sample, 160)}`);
    }
    if (service.exceptionClasses.length > 0) {
      lines.push(
        `    exc(${service.exceptionClasses.length}): ${service.exceptionClasses.join(',')}`,
      );
    }
    // The metric competition is rendered only for the two service sets a reader
    // actually compares — the ground truth and the engine's predictions. A case
    // has ~51 services carrying ~70 metrics each; rendering all of them would
    // grow the dump by an order of magnitude for rows nothing reads.
    if (service.metricOutcomes !== undefined && (gt.has(service.serviceId) || rank !== undefined)) {
      lines.push(...formatMetricCompetition(service.metricOutcomes));
      lines.push(...formatAnomalyShape(service.metricOutcomes));
    }
  }

  lines.push(`  prediction=[${input.topPredictions.join(', ')}]`);
  return `${lines.join('\n')}\n`;
}
