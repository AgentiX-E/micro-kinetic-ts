/**
 * The log tier's four ways to read zero, and the gate that decides three of them.
 *
 * ## Why this module exists
 *
 * `logWeight` is **1.0** — the largest weight in the ranking — and on RCAEval its input is an empty map: the loss
 * census reads `INPUT_MAP_EMPTY(logScores)` on **719 of 735 cases**, while the same artifact reports that the
 * corpus **supplied logs on every one of RE2's 270 and RE3's 90 cases**. `docs/loss-decomposition.md` §8.5 names
 * the question and leaves it open — *"why is the tier empty, which is a question for the loader"* — and the reason
 * a single number cannot answer it is that an empty map has **four** mechanisms:
 *
 * 1. the case has no `logs.csv` at all (RE1's three systems, whose census reads `capped spans 0` too);
 * 2. the file was READ and carried no row the owner retains (the severity bar is ERROR/FATAL);
 * 3. rows were retained and the MODE's source-signature gate admits none of them — this is the arm the shipped
 *    mode makes live, because `count` admits only `isLogicException` rows;
 * 4. rows were admitted and every emitter is outside the call graph, so no candidate ever receives a score.
 *
 * The fifth state — the map holds the service and the value is zero — is the LOSS census's to see (`VALUE_ZERO`),
 * so the two instruments are the two halves of one attribution rather than two opinions: this one says what the
 * INPUT could support, that one says what the engine's map did. **They also cross-check each other.** This census
 * can say the tier SHOULD be populated (`admittedInGraph > 0`), and a case whose loss census reads
 * `INPUT_MAP_EMPTY` for the same `caseId` is then contradicting a measured input rather than merely reporting a
 * zero — the same contradiction the latency channel's `wholeFileRows` makes visible.
 *
 * ## The one owner of the admission rule
 *
 * Level 1 of the gate is `logLineAdmittedByMode` in `packages/tree`, imported here rather than re-spelled. It was
 * a closure inside `computeLogScores` until this module needed it, and a census that carried its own copy — "admit
 * a row when `isLogicException`" — would be a second answer to the question it exists to answer. That is this
 * repository's most-repeated defect and the reason the function is now exported.
 *
 * @module benchmarks/log-route
 */

import type { FaultLogEntry } from '../../packages/core/src/interfaces/rca-engine.js';
import {
  classifyExceptionKind,
  type ExceptionKind,
} from '../../packages/kinetic/src/benchmarks/loaders/rcaeval-loader.js';
import {
  logLineAdmittedByMode,
  type LogSignalMode,
} from '../../packages/tree/src/pruning/ranking-signals.js';

/**
 * The four exception kinds, as the zeroed accumulator's key set.
 *
 * Exhaustive over {@link ExceptionKind}: a kind added to the loader's union fails to compile here rather than being
 * silently under-counted — the guard this repository uses for every closed vocabulary.
 */
const EXCEPTION_KINDS: Readonly<Record<ExceptionKind, true>> = {
  logic: true,
  propagated: true,
  unclassified: true,
  none: true,
};

/** A retained row as this module needs it: the engine's fields, plus the TEXT the taxonomy reads. */
export type LogRow = FaultLogEntry & { readonly message?: string | undefined };

/** One case's contribution to the log-route census. Computed by the caller that holds the case's rows. */
export interface LogRouteEntry {
  /** The mode whose Level-1 gate the counts below were taken under — read, not assumed. */
  readonly mode: LogSignalMode;
  /** Rows the loader READ, before the retention filter. `0` when the case has no log file. */
  readonly rowsRead: number;
  /** Rows retained: the ERROR/FATAL rows every consumer would keep. */
  readonly retained: number;
  /** Of those, how many the mode's Level-1 gate ADMITS. */
  readonly admitted: number;
  /** Of those, how many name a service the call graph contains. */
  readonly admittedInGraph: number;
  /**
   * Distinct services among the admitted in-graph rows.
   *
   * The count that makes `LIVE` a statement rather than an expectation: a mode can admit rows and still produce
   * an empty map if every one of them belongs to a service the ranking never scores.
   */
  readonly emitters: number;
  /**
   * The exception SEMANTICS of the retained rows, from the loader's own `classifyExceptionKind`.
   *
   * The distinction a bare `admitted 0` cannot make: a gate that refuses TRANSPORT noise is doing exactly what its
   * docblock says, and one that refuses a whitelist-missed LOGIC exception is a bug. `re3-log-ceiling.md` measured
   * this taxonomy on RE3's 90 cases; RE2's 270 — where 180 of the 210 gate-blind cases live — had never been
   * classified, and this is the field that classifies them by the LOADER's rule rather than by a second one
   * written here.
   */
  readonly retainedByKind: Readonly<Record<ExceptionKind, number>>;
  /**
   * Retained rows whose stored `isLogicException` flag DISAGREES with the taxonomy.
   *
   * `isLogicException` is DEFINED as the taxonomy's `logic`, so agreement is an invariant of the pipeline rather
   * than a coincidence, and a non-zero count means the flag was written by something other than the classifier
   * that reads it. The verdict names it as a DEFECT, above every corpus explanation, because that is what it is.
   */
  readonly flagDisagreements: number;
}

/** The log channel's four levels over one population. */
export interface LogRouteCensus {
  readonly cases: number;
  /** Cases with no log file at all — RE1's shape, and a corpus property rather than a gate's. */
  readonly casesWithoutRows: number;
  readonly rowsRead: number;
  readonly retained: number;
  readonly admitted: number;
  readonly admittedInGraph: number;
  readonly emitters: number;
  /** Cases that retained at least one row. */
  readonly casesRetaining: number;
  /** Cases whose mode admitted at least one row. */
  readonly casesAdmitting: number;
  /** Cases whose mode admitted at least one row naming a graph node. */
  readonly casesAdmittingInGraph: number;
  /** The retained rows' exception semantics, summed over the population. */
  readonly retainedByKind: Readonly<Record<ExceptionKind, number>>;
  /** Retained rows whose stored flag disagrees with the taxonomy — a pipeline DEFECT when non-zero. */
  readonly flagDisagreements: number;
}

/**
 * One case's four levels counted.
 *
 * Level 1 is the MODE's rule and comes from `packages/tree`, so this function cannot disagree with the scorer
 * about which rows count. Levels 2-4 are this module's and are pure counts of what the corpus carried.
 *
 * @param logs - The case's RETAINED rows (ERROR/FATAL), as the assembly handed them to the engine.
 * @param nodeIds - The services the case's call graph contains — the set the ranking can score.
 * @param mode - The mode the run was configured with.
 * @param rowsRead - Rows the loader read before retention; `0` when the case has no log file.
 * @returns The four levels.
 */
export function deriveLogRoute(
  logs: readonly LogRow[] | undefined,
  nodeIds: ReadonlySet<string>,
  mode: LogSignalMode,
  rowsRead: number,
): LogRouteEntry {
  const rows = logs ?? [];
  let admitted = 0;
  let admittedInGraph = 0;
  let retained = 0;
  let flagDisagreements = 0;
  const emitters = new Set<string>();
  const retainedByKind: Record<ExceptionKind, number> = {
    logic: 0,
    propagated: 0,
    unclassified: 0,
    none: 0,
  };
  for (const log of rows) {
    if (log.level !== 'ERROR' && log.level !== 'FATAL') continue;
    retained += 1;
    // The taxonomy, from the LOADER's classifier — the same function its own `isLogicException` flag is built
    // from, so the two cannot describe different rules.
    const kind = classifyExceptionKind(log.message ?? '');
    retainedByKind[kind] += 1;
    if ((log.isLogicException === true) !== (kind === 'logic')) flagDisagreements += 1;
    if (!logLineAdmittedByMode(mode, log)) continue;
    admitted += 1;
    if (!nodeIds.has(log.service)) continue;
    admittedInGraph += 1;
    emitters.add(log.service);
  }
  return {
    mode,
    rowsRead,
    retained,
    admitted,
    admittedInGraph,
    emitters: emitters.size,
    retainedByKind,
    flagDisagreements,
  };
}

/**
 * Aggregate the per-case entries.
 *
 * @param entries - One entry per assembled case, INCLUDING the cases with no logs at all — a case that
 *        contributed nothing is a count, not an omission, and dropping it would make `casesWithoutRows` a
 *        property of whoever built the list.
 * @returns The counts, with `cases` = the population size.
 */
export function summarizeLogRoutes(entries: readonly LogRouteEntry[]): LogRouteCensus {
  let casesWithoutRows = 0;
  let rowsRead = 0;
  let retained = 0;
  let admitted = 0;
  let admittedInGraph = 0;
  let flagDisagreements = 0;
  const retainedByKind: Record<ExceptionKind, number> = {
    logic: 0,
    propagated: 0,
    unclassified: 0,
    none: 0,
  };
  const emitters = new Set<string>();
  let casesRetaining = 0;
  let casesAdmitting = 0;
  let casesAdmittingInGraph = 0;
  for (const e of entries) {
    if (e.rowsRead === 0 && e.retained === 0) casesWithoutRows += 1;
    rowsRead += e.rowsRead;
    retained += e.retained;
    admitted += e.admitted;
    admittedInGraph += e.admittedInGraph;
    flagDisagreements += e.flagDisagreements;
    for (const kind of Object.keys(EXCEPTION_KINDS) as ExceptionKind[]) {
      retainedByKind[kind] += e.retainedByKind[kind];
    }
    emitters.add(`${e.mode}:${e.emitters}`);
    if (e.retained > 0) casesRetaining += 1;
    if (e.admitted > 0) casesAdmitting += 1;
    if (e.admittedInGraph > 0) casesAdmittingInGraph += 1;
  }
  return {
    cases: entries.length,
    casesWithoutRows,
    rowsRead,
    retained,
    admitted,
    admittedInGraph,
    // Distinct emitters is reported per case by construction (a population-wide set cannot be summed from
    // per-case sets without double counting services that appear in several cases), so the census reports the
    // number of CASES that admitted anything into the graph and the per-case count is what a reader divides.
    emitters: emitters.size,
    casesRetaining,
    casesAdmitting,
    casesAdmittingInGraph,
    retainedByKind,
    flagDisagreements,
  };
}

/**
 * The verdict the four levels earn — the mechanism, named, with its own discriminator.
 *
 * The arms are ordered so the FIRST one that can be read decides, and the order is a claim about strength: a
 * corpus with no log file is not a gate that rejected everything, and a gate that rejected everything is not a
 * graph that does not contain the emitters. The last arm is a RESIDUE rather than a catch-all — every earlier one
 * has been excluded, so `admittedInGraph > 0` holds by construction there.
 *
 * @param c - The census.
 * @returns One line. It names a MECHANISM; restating the zero is what the arms exist to avoid.
 */
export function logChannelVerdict(c: LogRouteCensus): string {
  // A DEFECT outranks every corpus explanation, because no corpus can cause it: the flag the gate reads is
  // defined as the taxonomy's `logic`, so a disagreement cannot be measured into existence by a fault class.
  if (c.flagDisagreements > 0) {
    return (
      `STALE FLAGS — ${c.flagDisagreements} of ${c.retained} retained rows carry an \`isLogicException\` flag that ` +
      `DISAGREES with \`classifyExceptionKind\` on their own text; the gate is reading a flag nothing in this ` +
      `pipeline produced, which is a DEFECT rather than a property of the corpus`
    );
  }
  if (c.cases > 0 && c.casesWithoutRows === c.cases) {
    return (
      `STARVED — none of the ${c.cases} cases has a log file at all, so no mode could read one ` +
      `(the loader reports 0 rows read)`
    );
  }
  if (c.retained === 0) {
    return (
      `NO ERROR ROWS — ${c.rowsRead} rows were read and none is ERROR/FATAL, which is the severity bar every ` +
      `consumer keeps`
    );
  }
  if (c.admitted === 0) {
    // The COMPOSITION is the finding, not the zero: a gate refusing transport noise is doing its job, and one
    // refusing a whitelist-missed logic exception is a bug — and the two are the same number without this.
    const k = c.retainedByKind;
    const composed = `composed of ${k.propagated} propagated / ${k.unclassified} unclassified / ${k.none} with no class name`;
    return (
      `GATE BLIND — ${c.retained} rows retained in ${c.casesRetaining}/${c.cases} cases and the mode's ` +
      `source-signature gate admits NONE of them — ${composed}; the tier is empty by the GATE, not by the corpus`
    );
  }
  if (c.admittedInGraph === 0) {
    return (
      `OFF GRAPH — ${c.admitted} rows admitted and every emitter is outside the call graph, so no candidate ` +
      `can receive the score`
    );
  }
  // The residue carries a RATE as well as a count, because two rows out of 134 903 and five thousand out of
  // forty-one thousand are different mechanisms for any decision and a bare count reads them identically.
  const pct = ((100 * c.admittedInGraph) / c.retained).toFixed(2);
  return (
    `LIVE — ${c.admittedInGraph} rows admitted into the graph (${pct}% of ${c.retained} retained) in ` +
    `${c.casesAdmittingInGraph}/${c.cases} cases (the map is populated wherever this fires, so an ` +
    `INPUT_MAP_EMPTY beside it contradicts a measured input)`
  );
}

/**
 * Render the census as the lines the artifact carries.
 *
 * @param c - The census.
 * @param label - What the population was (a system name).
 * @returns Lines, without trailing newlines: the counts, then the verdict.
 */
export function formatLogRoutes(c: LogRouteCensus, label: string): string[] {
  return [
    `log-routes[${label}]: ${c.cases} cases | no log file ${c.casesWithoutRows} | ` +
      `read ${c.rowsRead} | retained ${c.retained} | admitted ${c.admitted} | in-graph ${c.admittedInGraph} | ` +
      `cases: retaining ${c.casesRetaining} | admitting ${c.casesAdmitting} | admitting-in-graph ${c.casesAdmittingInGraph} | ` +
      `kinds: logic ${c.retainedByKind.logic} | propagated ${c.retainedByKind.propagated} | ` +
      `unclassified ${c.retainedByKind.unclassified} | none ${c.retainedByKind.none} | ` +
      `flag-disagreements ${c.flagDisagreements}`,
    `  VERDICT: ${logChannelVerdict(c)}`,
  ];
}
