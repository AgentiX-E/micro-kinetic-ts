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
    )}] services=${input.services.length}`,
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
        `err=${service.errorCount} fatal=${service.fatalCount} logic=${service.logicExceptionCount}`,
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
  }

  lines.push(`  prediction=[${input.topPredictions.join(', ')}]`);
  return `${lines.join('\n')}\n`;
}
