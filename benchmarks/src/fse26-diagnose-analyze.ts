/**
 * Read the `--diagnose` dumps back as data, and turn a pair of them into the
 * regression set and its mechanism.
 *
 * The benchmark runner prints a `DIAG` block per case (see
 * `packages/kinetic/../fse26-diagnose.ts`) when `--diagnose` names that case's
 * fault type. A fault-type-level gap cannot be diagnosed from the scalar Top@1,
 * and a pair of dumps — the same cases scored under two log-signal modes — can
 * be, provided the two are reduced to something comparable. That reduction is
 * this module.
 *
 * It exists as a module rather than a throwaway script because every candidate
 * ranking fix has to be re-measured against the same set: the question is never
 * only "does this recover the losses" but "does it keep the gains", and both
 * halves need the identical extraction. The parser is pure and takes the log
 * text, so it is testable against synthetic blocks and can also be pointed at a
 * downloaded CI artifact.
 *
 * @module benchmarks/fse26-diagnose-analyze
 */

/** One service's signal inventory, as the `DIAG` block reports it. */
export interface DiagnosedService {
  readonly serviceId: string;
  /** Whether the case's ground truth includes this service. */
  readonly isGroundTruth: boolean;
  /** The engine's rank for this service, when it predicted it. */
  readonly predictedRank: number | undefined;
  readonly selfAnomaly: number;
  readonly logScore: number;
  readonly errorCount: number;
  readonly fatalCount: number;
  readonly logicExceptionCount: number;
  readonly httpExceptionCount: number;
}

/** One case's diagnostic block, as data. */
export interface DiagnosedCase {
  readonly datapack: string;
  readonly faultType: string;
  readonly groundTruth: readonly string[];
  /** The log-signal mode the block was produced under. */
  readonly logSignalMode: string;
  readonly services: readonly DiagnosedService[];
  /** The engine's ranking for this case, best first. */
  readonly prediction: readonly string[];
}

const HEADER_RE =
  /^DIAG datapack=(\S+) faultType=(\S+) GT=\[([^\]]*)\] services=(\d+)(?: logMode=(\S+))?$/;
const SERVICE_RE =
  /^ {2}(\S+)(?: \[([^\]]*)\])? selfAnomaly=(\S+) logScore=(\S+) dominant=(\S*) err=(\d+) fatal=(\d+) logic=(\d+) http=(\d+)$/;
const PREDICTION_RE = /^ {2}prediction=\[([^\]]*)\]$/;

/** Split a bracketed list into trimmed, non-empty entries. */
function parseList(body: string | undefined): string[] {
  if (body === undefined) return [];
  return body
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Parse every `DIAG` block in a dump, ignoring everything around them.
 *
 * The dumps are printed into the benchmark's stdout together with the run
 * header and the summary tables, so the parser scans for block starts rather
 * than expecting the text to be blocks only. A block that starts but never
 * reaches its `prediction=` line is dropped: a truncated block is worse than an
 * absent one, because its `services` list would read as complete.
 *
 * @param text - The log text (or any text containing `DIAG` blocks).
 * @returns One entry per complete block, in file order.
 */
export function parseDiagnosticDump(text: string): DiagnosedCase[] {
  const cases: DiagnosedCase[] = [];
  let current:
    | {
        datapack: string;
        faultType: string;
        groundTruth: string[];
        logSignalMode: string;
        services: DiagnosedService[];
      }
    | undefined;

  for (const line of text.split('\n')) {
    const header = HEADER_RE.exec(line);
    if (header) {
      // A new header without a footer means the previous block was truncated.
      current = {
        datapack: header[1]!,
        faultType: header[2]!,
        groundTruth: parseList(header[3]),
        logSignalMode: header[5] ?? '',
        services: [],
      };
      continue;
    }
    if (current === undefined) continue;

    const service = SERVICE_RE.exec(line);
    if (service) {
      const markers = parseList(service[2]);
      const rankMarker = markers.find((m) => m.startsWith('#'));
      current.services.push({
        serviceId: service[1]!,
        isGroundTruth: markers.includes('GT'),
        predictedRank: rankMarker === undefined ? undefined : Number(rankMarker.slice(1)),
        selfAnomaly: Number(service[3]),
        logScore: Number(service[4]),
        errorCount: Number(service[6]),
        fatalCount: Number(service[7]),
        logicExceptionCount: Number(service[8]),
        httpExceptionCount: Number(service[9]),
      });
      continue;
    }

    const prediction = PREDICTION_RE.exec(line);
    if (prediction) {
      cases.push({
        datapack: current.datapack,
        faultType: current.faultType,
        groundTruth: current.groundTruth,
        logSignalMode: current.logSignalMode,
        services: current.services,
        prediction: parseList(prediction[1]),
      });
      current = undefined;
    }
  }

  return cases;
}

/** Whether the engine's top-1 prediction is an accepted ground-truth service. */
export function isTop1Correct(kase: DiagnosedCase): boolean {
  const top = kase.prediction[0];
  return top !== undefined && kase.groundTruth.includes(top);
}

/** How a case's top-1 outcome changed between two modes. */
export type DiagnosticDeltaKind = 'regressed' | 'gained' | 'both-correct' | 'both-wrong';

/** One case's outcome under both modes. */
export interface DiagnosticDelta {
  readonly datapack: string;
  readonly faultType: string;
  readonly kind: DiagnosticDeltaKind;
  readonly groundTruth: readonly string[];
  readonly top1Before: string | undefined;
  readonly top1After: string | undefined;
}

/**
 * Pair two dumps by datapack and classify each case's top-1 outcome.
 *
 * Only cases present in BOTH dumps are compared. A case missing from one side
 * is skipped rather than counted as a change: the two runs are normally the same
 * case set, and if they are not, the difference is a property of the runs, not
 * of the mode. `kind` is stated from the perspective of the SECOND dump, so
 * `regressed` means "correct before, wrong after".
 *
 * @param before - Dump scored under the baseline configuration.
 * @param after - Dump scored under the candidate configuration.
 * @returns One entry per case present in both, in `before` order.
 */
export function diffDiagnostics(
  before: readonly DiagnosedCase[],
  after: readonly DiagnosedCase[],
): DiagnosticDelta[] {
  const afterByDatapack = new Map(after.map((kase) => [kase.datapack, kase]));
  const deltas: DiagnosticDelta[] = [];

  for (const caseBefore of before) {
    const caseAfter = afterByDatapack.get(caseBefore.datapack);
    if (caseAfter === undefined) continue;
    const correctBefore = isTop1Correct(caseBefore);
    const correctAfter = isTop1Correct(caseAfter);
    const kind: DiagnosticDeltaKind =
      correctBefore && !correctAfter
        ? 'regressed'
        : !correctBefore && correctAfter
          ? 'gained'
          : correctBefore
            ? 'both-correct'
            : 'both-wrong';
    deltas.push({
      datapack: caseBefore.datapack,
      faultType: caseBefore.faultType,
      kind,
      groundTruth: caseBefore.groundTruth,
      top1Before: caseBefore.prediction[0],
      top1After: caseAfter.prediction[0],
    });
  }

  return deltas;
}

/**
 * The signal inventory behind one regression.
 *
 * The hypothesis under test is that the framework-HTTP half of the `logicHttp`
 * mode rewards a VICTIM: the faulting service emits no exception of its own, its
 * callers see the broken calls and flood `HttpServerErrorException`, and the
 * caller's count then exceeds the source's and takes the top rank. Two booleans
 * state the two halves of that claim per case, so the summary can be counted
 * rather than argued.
 */
export interface RegressionMechanism {
  readonly datapack: string;
  readonly faultType: string;
  /** The ground-truth service the case should rank first. */
  readonly groundTruth: string | undefined;
  readonly top1Before: string | undefined;
  readonly top1After: string | undefined;
  /** The source's framework-HTTP line count under the `after` mode. */
  readonly sourceHttpCount: number | undefined;
  /** The winning (wrong) service's framework-HTTP line count. */
  readonly winnerHttpCount: number | undefined;
  /** The source's self-caused logic-exception count under the `after` mode. */
  readonly sourceLogicCount: number | undefined;
  readonly winnerLogicCount: number | undefined;
  readonly sourceSelfAnomaly: number | undefined;
  readonly winnerSelfAnomaly: number | undefined;
  /** The framework-HTTP half alone explains the swap: winner floods, source does not. */
  readonly winnerOutfloodsSource: boolean;
}

/**
 * Summarise the signal inventory of one regression, read from the `after` dump.
 *
 * Ground truth is single-service on this benchmark (the loader accepts a list,
 * but every FSE'26 case names one service), so the comparison is between that
 * service and whatever the engine ranked first instead.
 *
 * @param delta - A delta classified as `regressed`.
 * @param after - The dump the regression was measured on.
 * @returns The inventory, with `undefined` fields where a service is absent.
 */
export function regressionMechanism(
  delta: DiagnosticDelta,
  after: readonly DiagnosedCase[],
): RegressionMechanism {
  const kase = after.find((candidate) => candidate.datapack === delta.datapack);
  const groundTruth = delta.groundTruth[0];
  const find = (serviceId: string | undefined) =>
    serviceId === undefined
      ? undefined
      : kase?.services.find((service) => service.serviceId === serviceId);

  const source = find(groundTruth);
  const winner = find(delta.top1After);

  return {
    datapack: delta.datapack,
    faultType: delta.faultType,
    groundTruth,
    top1Before: delta.top1Before,
    top1After: delta.top1After,
    sourceHttpCount: source?.httpExceptionCount,
    winnerHttpCount: winner?.httpExceptionCount,
    sourceLogicCount: source?.logicExceptionCount,
    winnerLogicCount: winner?.logicExceptionCount,
    sourceSelfAnomaly: source?.selfAnomaly,
    winnerSelfAnomaly: winner?.selfAnomaly,
    winnerOutfloodsSource:
      source !== undefined &&
      winner !== undefined &&
      winner.httpExceptionCount > source.httpExceptionCount &&
      source.httpExceptionCount === 0,
  };
}

/** Count deltas by kind, for a one-line summary of a comparison. */
export function tallyDeltas(
  deltas: readonly DiagnosticDelta[],
): Readonly<Record<DiagnosticDeltaKind, number>> {
  const tally: Record<DiagnosticDeltaKind, number> = {
    regressed: 0,
    gained: 0,
    'both-correct': 0,
    'both-wrong': 0,
  };
  for (const delta of deltas) tally[delta.kind] += 1;
  return tally;
}

/** `value` with fixed decimals, or `-` when the datum is absent. */
function num(value: number | undefined, digits = 3): string {
  return value === undefined || !Number.isFinite(value) ? '-' : value.toFixed(digits);
}

/** Render the per-fault-type breakdown of the deltas. */
function faultTypeTable(deltas: readonly DiagnosticDelta[]): string[] {
  const byType = new Map<string, { regressed: number; gained: number; total: number }>();
  for (const delta of deltas) {
    const cell = byType.get(delta.faultType) ?? { regressed: 0, gained: 0, total: 0 };
    cell.total++;
    if (delta.kind === 'regressed') cell.regressed++;
    if (delta.kind === 'gained') cell.gained++;
    byType.set(delta.faultType, cell);
  }
  const lines = ['  fault type                          cases  regressed  gained'];
  for (const [faultType, cell] of [...byType.entries()].sort((a, b) => b[1].total - a[1].total)) {
    lines.push(
      `  ${faultType.padEnd(34)} ${String(cell.total).padStart(5)} ` +
        `${String(cell.regressed).padStart(10)} ${String(cell.gained).padStart(7)}`,
    );
  }
  return lines;
}

/**
 * Render the full report for one comparison.
 *
 * Exported so the formatting is covered by a test rather than only by running
 * the CLI, which would leave the arithmetic in the header lines unverified.
 *
 * @param before - Parsed baseline dump.
 * @param after - Parsed candidate dump.
 * @param modeLabel - How to describe the two configurations in the header.
 * @returns The report text, ending with a newline.
 */
export function formatDiagnoseComparison(
  before: readonly DiagnosedCase[],
  after: readonly DiagnosedCase[],
  modeLabel: string,
): string {
  const deltas = diffDiagnostics(before, after);
  const tally = tallyDeltas(deltas);
  const regressions = deltas.filter((delta) => delta.kind === 'regressed');
  const mechanisms = regressions.map((delta) => regressionMechanism(delta, after));
  const explained = mechanisms.filter((mechanism) => mechanism.winnerOutfloodsSource).length;

  const lines: string[] = [];
  const modes = [...new Set(after.map((kase) => kase.logSignalMode))].filter((m) => m !== '');
  lines.push(`FSE'26 diagnostic comparison — ${modeLabel}`);
  lines.push(`  after-mode: ${modes.length > 0 ? modes.join(', ') : '(unrecorded)'}`);
  lines.push(
    `  cases compared: ${deltas.length}   regressed: ${tally.regressed}   ` +
      `gained: ${tally.gained}   unchanged-correct: ${tally['both-correct']}   ` +
      `unchanged-wrong: ${tally['both-wrong']}`,
  );
  lines.push('');
  lines.push('Per-fault-type:');
  lines.push(...faultTypeTable(deltas));
  lines.push('');

  if (regressions.length === 0) {
    lines.push('No regressions: the candidate is never worse than the baseline on these cases.');
    return `${lines.join('\n')}\n`;
  }

  lines.push(`Regressions (${regressions.length}) — source vs the service that took rank 1:`);
  // Built with the same widths as the rows below, so the columns cannot drift
  // apart when a label is reworded.
  lines.push(
    `  ${'datapack'.padEnd(36)} ${'faultType'.padEnd(20)} ${'GT'.padEnd(15)} ` +
      `${'top1(before→after)'.padEnd(30)} ${'src http/logic'.padEnd(15)} ` +
      `${'win http/logic'.padEnd(15)} out-flooded`,
  );
  for (const mechanism of mechanisms) {
    lines.push(
      `  ${mechanism.datapack.padEnd(36)} ${(mechanism.faultType ?? '').padEnd(20)} ` +
        `${(mechanism.groundTruth ?? '-').padEnd(15)} ` +
        `${`${mechanism.top1Before ?? '-'}→${mechanism.top1After ?? '-'}`.padEnd(30)} ` +
        `${`${num(mechanism.sourceHttpCount, 0)}/${num(mechanism.sourceLogicCount, 0)}`.padEnd(15)} ` +
        `${`${num(mechanism.winnerHttpCount, 0)}/${num(mechanism.winnerLogicCount, 0)}`.padEnd(15)} ` +
        `${mechanism.winnerOutfloodsSource ? 'YES' : 'no'}`,
    );
  }
  lines.push('');
  lines.push(
    `Mechanism 'the winner is a victim flooding framework HTTP while the source emits none': ` +
      `${explained}/${regressions.length} regressions.`,
  );
  if (explained < regressions.length) {
    lines.push(
      `  ${regressions.length - explained} regression(s) need a different explanation — ` +
        `see the rows marked 'no'.`,
    );
  }
  return `${lines.join('\n')}\n`;
}
