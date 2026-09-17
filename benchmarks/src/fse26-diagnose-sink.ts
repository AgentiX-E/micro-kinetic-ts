/**
 * The RCAEval runner's diagnostic sink: one case in, one dump block out.
 *
 * Extracted from the runner's loop so the mapping from a benchmark case to the dump's inputs is a
 * FUNCTION rather than a closure buried in an early-return-heavy `main()`. Three of its decisions
 * are benchmark-specific and each is a place a dump can quietly lie:
 *
 * - the accepted set, which is multi-label for some benchmarks and must be reported whole;
 * - the injection anchor, which is `0` when the run disabled it — a dump that reported the case's
 *   own time would license a temporal window the engine never ran;
 * - the datapack id, which has to be the artefact's own case id or no reader can join the two.
 *
 * @module benchmarks/fse26-diagnose-sink
 */

import type { DiagnosticCaseInput } from '../../packages/kinetic/src/benchmarks/index.js';
import { buildFSE26Diagnostic } from '../../packages/kinetic/src/benchmarks/index.js';
import type { DiagnosedCaseRecord } from '../../packages/kinetic/src/benchmarks/runners/benchmark-runner.js';

/** What the dump needs that the record does not carry. */
export interface DiagnoseDumpOptions {
  /** The log-signal mode this configuration ran under, as the runner selected it. */
  readonly logSignalMode: string;
  /**
   * Whether the engine received the case's fault-injection time.
   *
   * Not "whether the case has one": this is the anchor the RANKING was given, and the dump exists to
   * describe the configuration that produced the number next to it.
   */
  readonly useInjectTime: boolean;
}

/**
 * Assemble one case's dump inputs from the runner's own record.
 *
 * @param record - The case, the graph the engine built, the ranking it returned.
 * @param options - The log-signal mode and whether the injection time reached the engine.
 * @returns The assembler's input, with every per-service magnitude coming from the graph.
 */
export function diagnoseDumpInput(
  record: DiagnosedCaseRecord,
  options: DiagnoseDumpOptions,
): DiagnosticCaseInput {
  return {
    case: record.case,
    graph: record.graph,
    ranking: record.ranking,
    callGraph: record.callGraph,
    datapack: record.case.id,
    faultType: record.case.groundTruth.faultType,
    // The case's OWN accepted set: a benchmark that marks several services correct has to report
    // every one of them, or a dump of a multi-label case would describe a single-answer scoring.
    groundTruthServices: record.case.groundTruth.serviceIds ?? [record.case.groundTruth.serviceId],
    logSignalMode: options.logSignalMode,
    injectTimeMs: options.useInjectTime ? record.case.injectTime : 0,
  };
}

/**
 * Render one recorded case as a dump block.
 *
 * The sink itself is deliberately one line: it takes a record and returns text, so a runner wires it
 * by pushing the result into a list and a test can call it with a record it built by hand.
 *
 * @param record - The case, the graph the engine built, the ranking it returned.
 * @param options - The log-signal mode and whether the injection time reached the engine.
 * @returns The block, as the analyzer's `parseDiagnosticDump` reads it.
 */
export function renderDiagnosedCase(
  record: DiagnosedCaseRecord,
  options: DiagnoseDumpOptions,
): string {
  return buildFSE26Diagnostic(diagnoseDumpInput(record, options));
}
