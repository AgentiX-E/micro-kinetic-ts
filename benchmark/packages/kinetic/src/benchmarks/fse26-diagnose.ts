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
  /** The engine's rank-normalised self-anomaly in [0, 1]. */
  readonly selfAnomaly: number;
  /** The engine's max-normalised logic-exception log score in [0, 1]. */
  readonly logScore: number;
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
}

/**
 * Format a single `x` as a fixed 3-decimal string, guarding against non-finite
 * values (which JSON cannot legally carry but a defensive renderer must still
 * survive).
 */
function fmt(x: number): string {
  if (!Number.isFinite(x)) return 'nonfinite';
  return x.toFixed(3);
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
    )}] services=${input.services.length} logMode=${input.logSignalMode}`,
  );

  for (const service of ordered) {
    const markers: string[] = [];
    if (gt.has(service.serviceId)) markers.push('GT');
    const rank = predRank.get(service.serviceId);
    if (rank !== undefined) markers.push(`#${rank}`);
    const tag = markers.length > 0 ? ` [${markers.join(',')}]` : '';
    const metricList = service.metricNames.join(',');
    lines.push(
      `  ${service.serviceId}${tag} selfAnomaly=${fmt(service.selfAnomaly)} ` +
        `logScore=${fmt(service.logScore)} dominant=${service.dominantMetric ?? '-'} ` +
        `err=${service.errorCount} fatal=${service.fatalCount} logic=${service.logicExceptionCount} ` +
        `http=${service.httpExceptionCount}`,
    );
    lines.push(`    metrics(${service.metricNames.length}): ${metricList}`);
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
