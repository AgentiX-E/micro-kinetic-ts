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

import {
  DEFAULT_HTTP_DOMINANCE_THRESHOLD,
  DEFAULT_LAT_MIN_RISE,
  DEFAULT_LAT_WEIGHT,
} from '../../packages/tree/src/index.js';

import { formatTermOracleReport, latencySlopes } from './fse26-term-oracle.js';

/**
 * `latencySlopes` moved to `fse26-term-oracle.ts` — the module that owns "rebuild a term
 * from a dump" — so the solver below and the oracle there cannot disagree about the
 * engine: two implementations of one signal is the defect this whole analyzer exists to
 * find. Re-exported so every existing caller keeps its import path.
 */
export { latencySlopes };

/**
 * The score decomposition of one metric, as the `metricTop` line reports it.
 *
 * Needed because the score alone cannot say whether a metric won on a genuine
 * deviation or on a bonus, nor how large its rise was. The anomaly score is
 * unbounded in the RISE direction and hard-capped at `log10(2)` in the DROP
 * direction, so a high score IS a rise — the ratio says how extreme.
 */
export interface DiagnosedBreakdown {
  readonly deviation: number;
  readonly trend: number;
  readonly cv: number;
  readonly burst: number;
  /** `(max − baseline) / baseline` — unbounded. */
  readonly riseRatio: number;
  /** `(baseline − min) / baseline` — bounded at 1 by construction. */
  readonly dropRatio: number;
  /** The pre-anomaly baseline the two ratios were measured against. */
  readonly baselineMean: number;
}

/** One metric's fate, as the `DIAG` block reports it. */
export interface DiagnosedMetricOutcome {
  readonly label: string;
  /**
   * The engine's outcome word. Kept as a plain string rather than a closed
   * union: this reader must survive an engine that adds a guard, and a strict
   * union here would turn a new reason into a parse failure.
   */
  readonly outcome: string;
  /** The metric's score. Meaningful only when `outcome` is `kept`. */
  readonly score: number;
  /** The score decomposition, when the block reported one. */
  readonly breakdown?: DiagnosedBreakdown;
}

/** One service's signal inventory, as the `DIAG` block reports it. */
export interface DiagnosedService {
  readonly serviceId: string;
  /** Whether the case's ground truth includes this service. */
  readonly isGroundTruth: boolean;
  /** The engine's rank for this service, when it predicted it. */
  readonly predictedRank: number | undefined;
  readonly selfAnomaly: number;
  readonly logScore: number;
  /**
   * The failed-edge-direction score (the log score's INVERSE), or `undefined`
   * for a dump written before the engine reported it.
   *
   * Optional on purpose. A dump copied out of an older run has no such field,
   * and defaulting it to 0 would claim "this service was measured and credited
   * nothing" — a different statement from "this dump cannot answer that". The
   * analyzer exists to compare dumps across runs, so it has to read both.
   */
  readonly failedEdgeScore: number | undefined;
  /** Raw failed-edge records naming this service as the callee, or `undefined`. */
  readonly failedEdgeRecords: number | undefined;
  /** Largest inbound latency rise, or `undefined` when not recorded / not measured. */
  readonly latRise: number | undefined;
  /** Measured inbound edges, or `undefined` when the dump predates the field. */
  readonly latEdges: number | undefined;
  /**
   * The metric that drove this service's anomaly score, or `''` when the engine
   * named none (the block prints `-` for that).
   */
  readonly dominantMetric: string;
  readonly errorCount: number;
  readonly fatalCount: number;
  readonly logicExceptionCount: number;
  readonly httpExceptionCount: number;
  /**
   * The service's metric competition, or `undefined` when the block did not
   * report it (an older dump, or a service the formatter chose not to render).
   *
   * A list whose declared size disagrees with the entries actually printed is
   * reported as `undefined`, never as a short list: a truncated inventory reads
   * exactly like a complete one, which is how a parser once fabricated
   * `gt_http = 0` for every replace-code case.
   */
  readonly metricOutcomes: readonly DiagnosedMetricOutcome[] | undefined;
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
  /**
   * The case's call-graph edges (`caller>callee`), or `undefined` for a dump
   * written before the line existed.
   *
   * Optional, and never defaulted to an empty array: "this dump recorded no graph"
   * and "this case has no edges" are different statements, and a structural
   * question answered from a defaulted empty graph would report every service as
   * unconnected — a fabricated answer rather than a missing one.
   */
  readonly edges: readonly string[] | undefined;
}

const HEADER_RE =
  /^DIAG datapack=(\S+) faultType=(\S+) GT=\[([^\]]*)\] services=(\d+)(?: logMode=(\S+))?$/;
/**
 * One service row.
 *
 * The id is `\S*`, not `\S+`, because a row with an EMPTY id is what the producer
 * writes for a candidate whose service label is missing — on the shipped dump that is
 * one row per case carrying the ten unlabelled `k8s.*` series. Requiring an id here
 * silently dropped that row, and the drop is not cosmetic: the engine's
 * `rankNormalizeScores` divides by `n - 1` over ITS candidate set, so a reader that
 * parses `n - 1` rows computes a different metric term for every service in the case.
 * The row also made the parsed count disagree with the header's `services=` — which
 * nothing checked until the guard on the `prediction=` line below.
 */
const SERVICE_RE =
  /^ {2}(\S*)(?: \[([^\]]*)\])? selfAnomaly=(\S+) logScore=(\S+)(?: failedEdge=(\S+) failedEdgeRecords=(\d+))?(?: latRise=(\S+) latEdges=(\d+))? dominant=(\S*) err=(\d+) fatal=(\d+) logic=(\d+) http=(\d+)$/;
const PREDICTION_RE = /^ {2}prediction=\[([^\]]*)\]$/;
const EDGES_RE = /^ {2}edges=(.*)$/;
const METRIC_KEPT_RE = /^ {4}metricKept\((\d+)\):(?: (.*))?$/;
const METRIC_DROP_RE = /^ {4}metricDrop\((\d+)\):(?: (.*))?$/;
/**
 * The shape line always carries at least one entry: the producer omits the line
 * entirely when it has no decomposition to print. Requiring the body here rather
 * than defaulting an absent one keeps a `?? ''` fallback out of the reader — a
 * fallback that could only ever fire on a line the producer cannot write.
 */
const METRIC_TOP_RE = /^ {4}metricTop\((\d+)(?:\/(\d+))?\): (.+)$/;

/**
 * `label=score{dev=…,trend=…,cv=…,burst=…,rise=…,drop=…,base=…}`.
 *
 * The label is `.+?` and the score `[^{]+` because the score is immediately
 * followed by `{`, which a `\S+` would swallow.
 */
const TOP_ENTRY_RE =
  /^(.+?)=([^{]+)\{dev=(\S+),trend=(\S+),cv=(\S+),burst=(\S+),rise=(\S+),drop=(\S+),base=(\S+)\}$/;

/**
 * Split a space-separated `label=value` / `label:value` list.
 *
 * The separator is the LAST occurrence, not the first: metric labels are
 * dotted names that never contain `=` or `:`, but a label that did would then
 * corrupt one entry rather than the whole list, and the declared-count check
 * below would catch it either way.
 */
function parseEntries(body: string | undefined, separator: '=' | ':'): string[][] {
  if (body === undefined || body === '') return [];
  return body
    .split(' ')
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const at = entry.lastIndexOf(separator);
      return at < 0 ? [entry, ''] : [entry.slice(0, at), entry.slice(at + 1)];
    });
}

/** Split a bracketed list into trimmed, non-empty entries. */
function parseList(body: string | undefined): string[] {
  if (body === undefined) return [];
  return body
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * A service under construction.
 *
 * The metric lines trail the service line they belong to, so the outcome list
 * has to be appended to after the service has been read. Kept private: the only
 * thing that needs the mutable shape is the parser, and exposing it would let a
 * consumer mutate a parsed dump.
 */
interface MutableService extends Omit<DiagnosedService, 'metricOutcomes'> {
  metricOutcomes: DiagnosedMetricOutcome[] | undefined;
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
        services: MutableService[];
        /** The candidate count the header DECLARED, for the completeness check. */
        declaredServices: number;
        /** Filled by the `edges=` line, which may appear anywhere in the block. */
        edges: readonly string[] | undefined;
      }
    | undefined;
  // The metric lines follow the service they belong to, so the parser has to
  // remember which service it last emitted rather than which case it is in.
  let lastService: MutableService | undefined;
  // The inventory currently being read. It is opened by a `metricKept` line and
  // extended by the `metricDrop` line that follows. `undefined` therefore means
  // "this block never opened an inventory", which is what makes a lost
  // `metricKept` line detectably different from an empty one: a dropped-only
  // list would otherwise match its own declared count and read as complete.
  let openOutcomes: DiagnosedMetricOutcome[] | undefined;
  // The count the block DECLARED, accumulated across both lines. An inventory
  // that disagrees with it is discarded rather than shortened — a short
  // inventory reads exactly like a complete one.
  let declaredOutcomeCount = 0;

  const finalizeOutcomes = (): void => {
    if (lastService === undefined) return;
    const outcomes = openOutcomes;
    if (outcomes === undefined) return;
    const faithful =
      outcomes.length === declaredOutcomeCount &&
      outcomes.every((outcome) => Number.isFinite(outcome.score));
    lastService.metricOutcomes = faithful ? outcomes : undefined;
  };

  for (const line of text.split('\n')) {
    const header = HEADER_RE.exec(line);
    if (header) {
      // A new header without a footer means the previous block was truncated.
      finalizeOutcomes();
      current = {
        datapack: header[1]!,
        faultType: header[2]!,
        groundTruth: parseList(header[3]),
        logSignalMode: header[5] ?? '',
        services: [],
        declaredServices: Number(header[4]),
        edges: undefined,
      };
      lastService = undefined;
      declaredOutcomeCount = 0;
      openOutcomes = undefined;
      continue;
    }
    if (current === undefined) continue;

    const edges = EDGES_RE.exec(line);
    if (edges) {
      // `parseList` maps an empty body to `[]`, which is correct HERE: the line is
      // present, so the producer recorded a graph and it happens to be empty. The
      // absent line stays `undefined` and is never conflated with this.
      current.edges = parseList(edges[1]);
      continue;
    }

    const service = SERVICE_RE.exec(line);
    if (service) {
      finalizeOutcomes();
      const markers = parseList(service[2]);
      const rankMarker = markers.find((m) => m.startsWith('#'));
      const entries: MutableService = {
        serviceId: service[1]!,
        isGroundTruth: markers.includes('GT'),
        predictedRank: rankMarker === undefined ? undefined : Number(rankMarker.slice(1)),
        selfAnomaly: Number(service[3]),
        logScore: Number(service[4]),
        // `undefined`, never 0, when the field is absent: the optional group
        // leaves both captures undefined together, so a dump from before this
        // field reads as unknown rather than as a measurement of zero.
        failedEdgeScore: service[5] === undefined ? undefined : Number(service[5]),
        failedEdgeRecords: service[6] === undefined ? undefined : Number(service[6]),
        // `-` is the producer's marker for "no caller measured a change", which is
        // not the same as a rise of 1, so it parses to `undefined` and not to a
        // number.
        latRise: service[7] === undefined || service[7] === '-' ? undefined : Number(service[7]),
        latEdges: service[8] === undefined ? undefined : Number(service[8]),
        dominantMetric: service[9] === '-' ? '' : service[9]!,
        errorCount: Number(service[10]),
        fatalCount: Number(service[11]),
        logicExceptionCount: Number(service[12]),
        httpExceptionCount: Number(service[13]),
        metricOutcomes: undefined,
      };
      current.services.push(entries);
      lastService = entries;
      declaredOutcomeCount = 0;
      openOutcomes = undefined;
      continue;
    }

    const kept = METRIC_KEPT_RE.exec(line);
    if (kept && lastService !== undefined) {
      finalizeOutcomes();
      openOutcomes = parseEntries(kept[2], '=').map(([label, score]) => ({
        label: label!,
        outcome: 'kept',
        score: Number(score),
      }));
      declaredOutcomeCount = Number(kept[1]);
      continue;
    }

    const dropped = METRIC_DROP_RE.exec(line);
    if (dropped && lastService !== undefined) {
      // A dropped line with no open inventory is a malformed block: it is
      // ignored outright, so the service reads as "unreported" rather than
      // acquiring a fabricated kept-less list.
      if (openOutcomes !== undefined) {
        openOutcomes.push(
          ...parseEntries(dropped[2], ':').map(([label, outcome]) => ({
            label: label!,
            outcome: outcome!,
            score: 0,
          })),
        );
        declaredOutcomeCount += Number(dropped[1]);
      }
      continue;
    }

    const top = METRIC_TOP_RE.exec(line);
    if (top && openOutcomes !== undefined) {
      // The shape line is space-separated like the other two, but each entry is
      // `label=score{…}` rather than a single `key=value` pair, so it is split
      // here rather than through the shared one-separator helper.
      const raw = top[3]!.split(' ').filter((entry) => entry.length > 0);
      const byLabel = new Map<string, DiagnosedBreakdown>();
      let parsed = 0;
      for (const entry of raw) {
        const m = TOP_ENTRY_RE.exec(entry);
        if (m === null) continue;
        const nums = [m[3], m[4], m[5], m[6], m[7], m[8], m[9]].map(Number);
        if (!nums.every((n) => Number.isFinite(n))) continue;
        byLabel.set(m[1]!, {
          deviation: nums[0]!,
          trend: nums[1]!,
          cv: nums[2]!,
          burst: nums[3]!,
          riseRatio: nums[4]!,
          dropRatio: nums[5]!,
          baselineMean: nums[6]!,
        });
        parsed++;
      }
      // A render whose entries did not all parse, or that claims a different
      // number of decompositions than it printed, is a truncation — and a
      // truncation reads as complete. The whole line is ignored, not partially
      // consumed: a partially attached decomposition is worse than none,
      // because it looks like a metric that genuinely carried no decomposition.
      const keptCount = openOutcomes.filter((outcome) => outcome.outcome === 'kept').length;
      const declaredKept = top[2] === undefined ? keptCount : Number(top[2]);
      if (parsed === raw.length && parsed === Number(top[1]) && declaredKept === keptCount) {
        openOutcomes = openOutcomes.map((outcome) => {
          const breakdown = byLabel.get(outcome.label);
          return breakdown === undefined ? outcome : { ...outcome, breakdown };
        });
      }
      continue;
    }

    const prediction = PREDICTION_RE.exec(line);
    if (prediction) {
      finalizeOutcomes();
      // A block whose parsed candidate count disagrees with its own header is
      // DROPPED, for the same reason a block with no `prediction=` line is: its service
      // list is known to be short, and a short list is not a smaller case — it is a
      // different `n`, which changes the metric term of every service in the case. An
      // absent case is visible in the totals; a wrong one is not.
      if (current.services.length === current.declaredServices) {
        cases.push({
          datapack: current.datapack,
          faultType: current.faultType,
          groundTruth: current.groundTruth,
          logSignalMode: current.logSignalMode,
          edges: current.edges,
          services: current.services,
          prediction: parseList(prediction[1]),
        });
      }
      current = undefined;
      lastService = undefined;
      declaredOutcomeCount = 0;
      openOutcomes = undefined;
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
  /**
   * The ground-truth service the case should rank first.
   *
   * Non-optional because `regressionMechanism` is called on cases that were
   * CORRECT before, and a case is only correct when it named a ground truth.
   * A caller that passes a delta of another kind still gets a value: the
   * contract is stated at {@link regressionMechanism} instead, which defaults
   * the field and is tested for the absent case.
   */
  readonly groundTruth: string;
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
    groundTruth: groundTruth ?? '-',
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

/**
 * The metric family a fault's signature is expected to live in.
 *
 * Stated by the caller rather than baked in: this module reduces a dump, and
 * which labels constitute a fault signature is a property of the fault under
 * investigation, not of the dump format.
 */
/**
 * The latency weight and rise floor the SHIPPED engine runs with.
 *
 * Imported rather than restated: a diagnostic describes an engine, and if the two
 * numbers that describe it are typed out here they can drift from the engine's
 * own — which is precisely how this module came to report the shipped signal's
 * decisions as engine anomalies.
 */
const SHIPPED_LAT_WEIGHT = DEFAULT_LAT_WEIGHT;
const SHIPPED_LAT_FLOOR = DEFAULT_LAT_MIN_RISE;

/**
 * Which scored term decided a Top@1 miss.
 *
 * The engine's own order is `log1p(selfAnomaly) + logWeight × logScore` when the
 * other priors are off, and the dump carries both inputs — so every miss can be
 * ATTRIBUTED rather than guessed. Each value names a different defect, which is
 * why they are separate values and not one "wrong" bucket:
 *
 * - `metric` — the winner's own anomaly is higher. The ranking had nothing else
 *   to go on; the loss is an anomaly-signal problem.
 * - `log` — the winner's log score is higher. The engine saw error evidence
 *   pointing at the winner.
 * - `lat` — the winner's per-edge latency rise is higher. The engine saw a
 *   duration signal the error counts cannot express.
 * - a COMBINATION (`metric+log`, `metric+lat`, `log+lat`, `metric+log+lat`) — every
 *   listed term favours the winner. Spelled out rather than collapsed into one
 *   "both": with three terms, "both" stops saying which two, and whether the log is
 *   implicated at all changes what a reader does next.
 * - `tie` — the terms are equal, so the deterministic service-id tiebreak decided
 *   it. Not a signal failure; a missing discrimination.
 * - `unexplained` — NO MODELLED term explains the loss, i.e. the engine ordered a
 *   service below one with a strictly higher score on every term this report
 *   modelled. That is a defect in the engine or in the dump, never a modelling
 *   result. "Modelled" is load-bearing: the report prints which terms it used, and
 *   an unmodelled term's decisions land here, so a reader must check the banner
 *   before treating one as an engine finding.
 * - `absent` — either service the attribution needs (the source or the winner) is
 *   missing from this dump's service list. The case cannot be attributed from this
 *   dump at all: the fields are reported as `NaN`, never 0, because a fabricated
 *   zero would read as "measured and credited nothing", which is a different
 *   statement and the wrong one to build a next step on.
 */
export type MissTerm = 'metric' | 'log' | 'lat';

export type MissDecidedBy =
  | MissTerm
  | 'metric+log'
  | 'metric+lat'
  | 'log+lat'
  | 'metric+log+lat'
  | 'tie'
  | 'unexplained'
  | 'absent';

/** How one wrong case was decided. */
export interface MissClassification {
  readonly datapack: string;
  readonly faultType: string;
  readonly source: string;
  readonly winner: string | undefined;
  readonly decidedBy: MissDecidedBy;
  readonly sourceAnomaly: number;
  readonly winnerAnomaly: number;
  readonly sourceLog: number;
  readonly winnerLog: number;
  /**
   * Whether the service emitted any post-injection ERROR/FATAL line. The
   * distinction that matters for the silent-source block: a miss where NEITHER
   * side emits is a case the log signal structurally cannot decide, so it needs a
   * different signal rather than a reweighting.
   */
  readonly sourceEmits: boolean;
  readonly winnerEmits: boolean;
}

/** The priors a dump's DIAG blocks can be attributed with. */
export interface MissAttributionWeights {
  /**
   * The run's log weight. Required, because its SCALE decides the attribution and
   * a defaulted one would attribute losses at a scale the run never used.
   */
  readonly logWeight: number;
  /**
   * The run's per-edge latency weight. Defaults to the SHIPPED constant.
   *
   * There is no "absent" spelling: the dump carries `latRise` and `latEdges`, so
   * the term is attributable, and a reader diagnosing the shipped engine gets the
   * shipped engine. `0` is the explicit two-term ablation.
   */
  readonly latWeight?: number;
  /** The run's latency rise floor. Defaults to the shipped constant. */
  readonly latFloor?: number;
}

/** Float tolerance for "the two scores are equal". */
const SCORE_EPSILON = 1e-9;

/** Whether a service carries any post-injection error evidence. */
function emits(service: DiagnosedService): boolean {
  return service.errorCount + service.fatalCount + service.logicExceptionCount > 0;
}

/** The order the miss kinds are reported and tallied in. */
const MISS_ORDER: readonly MissDecidedBy[] = [
  'metric',
  'log',
  'lat',
  'metric+log',
  'metric+lat',
  'log+lat',
  'metric+log+lat',
  'tie',
  'unexplained',
  'absent',
];

/** The terms a classification can name, in the order they are spelled out. */
const MISS_TERMS: readonly MissTerm[] = ['metric', 'log', 'lat'];

/**
 * Attribute a case's Top@1 miss.
 *
 * Models every term the dump carries: `selfAnomaly`, `logScore` and the per-edge
 * latency rise (`latRise`/`latEdges`). The last of those is the reason this
 * function changed — the dump grew that field for the latency term, and this
 * comparison was not extended with it, so the shipped signal's own decisions were
 * reported as `unexplained` (12 of 672 misses on the shipped configuration, all
 * twelve explained by the latency term once it was modelled). A diagnostic that
 * does not model the configuration it is diagnosing is not conservative; it is
 * wrong, and it was wrong in the direction that sends a reader to fix the engine.
 *
 * Still exact only for a run whose non-zero priors are among the modelled ones,
 * which is why `weights` also names the LATENCY weight and the rise floor, and
 * why the report prints them: `unexplained` is a claim about the modelled terms.
 *
 * @param kase - One parsed case.
 * @param weights - The run's log weight, latency weight and rise floor.
 * @returns One classification, or `[]` when Top@1 was already correct.
 */
export function classifyMiss(
  kase: DiagnosedCase,
  weights: MissAttributionWeights,
): MissClassification[] {
  if (isTop1Correct(kase)) return [];

  const winner = kase.prediction[0];
  const source = kase.groundTruth[0] ?? '';
  const byId = new Map(kase.services.map((s) => [s.serviceId, s]));
  const win = winner === undefined ? undefined : byId.get(winner);
  const src = byId.get(source);

  // Attribution needs BOTH services. If either is missing the case cannot be
  // attributed from this dump, and every field it would have contributed is
  // reported as `NaN` — never as 0, which would read as a measurement.
  if (src === undefined || win === undefined) {
    return [
      {
        datapack: kase.datapack,
        faultType: kase.faultType,
        source,
        winner,
        decidedBy: 'absent',
        sourceAnomaly: src?.selfAnomaly ?? Number.NaN,
        winnerAnomaly: win?.selfAnomaly ?? Number.NaN,
        sourceLog: src?.logScore ?? Number.NaN,
        winnerLog: win?.logScore ?? Number.NaN,
        sourceEmits: src === undefined ? false : emits(src),
        winnerEmits: win === undefined ? false : emits(win),
      },
    ];
  }

  // Both services are known from here on, so every term below is read from a real
  // row and no fallback exists that coverage could never reach.
  const latWeight = weights.latWeight ?? SHIPPED_LAT_WEIGHT;
  const latSlopes = latencySlopes(kase.services, weights.latFloor ?? SHIPPED_LAT_FLOOR);
  const latOf = (serviceId: string) => latSlopes.get(serviceId) ?? 0;

  const parts: Record<MissTerm, number> = {
    metric: Math.log1p(win.selfAnomaly) - Math.log1p(src.selfAnomaly),
    log: weights.logWeight * (win.logScore - src.logScore),
    lat: latWeight * (latOf(winner!) - latOf(source)),
  };
  const gap = MISS_TERMS.reduce((sum, term) => sum + parts[term], 0);

  let decidedBy: MissDecidedBy;
  if (Math.abs(gap) <= SCORE_EPSILON) decidedBy = 'tie';
  else if (gap < 0) decidedBy = 'unexplained';
  else decidedBy = MISS_TERMS.filter((term) => parts[term] > 0).join('+') as MissDecidedBy;

  return [
    {
      datapack: kase.datapack,
      faultType: kase.faultType,
      source,
      winner,
      decidedBy,
      sourceAnomaly: src.selfAnomaly,
      winnerAnomaly: win.selfAnomaly,
      sourceLog: src.logScore,
      winnerLog: win.logScore,
      sourceEmits: emits(src),
      winnerEmits: emits(win),
    },
  ];
}

/**
 * Attribute every Top@1 miss in a dump.
 *
 * Reports the silent-both-sides count separately from the total: a miss where
 * neither the source nor the winner emits is the block no reweighting can move,
 * so that is the number which decides whether a log-side fix is the right next
 * move at all.
 *
 * @param cases - Parsed cases.
 * @param weights - The run's log weight.
 * @returns The classifications, with the tallies.
 */
export function tallyMisses(
  cases: readonly DiagnosedCase[],
  weights: MissAttributionWeights,
): {
  readonly total: number;
  readonly byDecidedBy: ReadonlyMap<MissDecidedBy, number>;
  readonly silentBothSides: number;
  readonly classifications: readonly MissClassification[];
} {
  const classifications = cases.flatMap((kase) => classifyMiss(kase, weights));
  const byDecidedBy = new Map<MissDecidedBy, number>();
  let silentBothSides = 0;
  for (const c of classifications) {
    byDecidedBy.set(c.decidedBy, (byDecidedBy.get(c.decidedBy) ?? 0) + 1);
    if (!c.sourceEmits && !c.winnerEmits) silentBothSides += 1;
  }
  return { total: classifications.length, byDecidedBy, silentBothSides, classifications };
}

/**
 * Render the miss attribution over a whole dump.
 *
 * @param cases - Parsed cases.
 * @param weights - The run's log weight.
 * @returns One multi-line report, without a trailing newline.
 */
export function formatMissReport(
  cases: readonly DiagnosedCase[],
  weights: MissAttributionWeights,
): string {
  const { total, byDecidedBy, silentBothSides, classifications } = tallyMisses(cases, weights);
  const lines: string[] = [];
  // The banner names every modelled term, because `unexplained` is a claim about
  // THEM and not about the engine. A reader who skipped this line once spent a
  // session treating the shipped signal's own decisions as twelve engine bugs.
  const latWeight = weights.latWeight ?? SHIPPED_LAT_WEIGHT;
  const modelled =
    latWeight === 0
      ? 'latency term NOT modelled (--lat-weight 0)'
      : `latWeight=${latWeight}; latFloor=${weights.latFloor ?? SHIPPED_LAT_FLOOR}`;
  lines.push(
    `Miss attribution (logWeight=${weights.logWeight}; ${modelled}; ` +
      'exact only when no other prior is on):',
  );
  lines.push(`  wrong cases: ${total}`);
  for (const kind of MISS_ORDER) {
    const n = byDecidedBy.get(kind) ?? 0;
    if (n > 0) lines.push(`  ${kind.padEnd(12)} ${n}`);
  }
  lines.push(`  silent both sides (no error evidence either side): ${silentBothSides}`);

  const byType = new Map<string, MissClassification[]>();
  for (const c of classifications) {
    const list = byType.get(c.faultType);
    if (list) list.push(c);
    else byType.set(c.faultType, [c]);
  }
  for (const [faultType, list] of [...byType].sort((a, b) => b[1].length - a[1].length)) {
    const counts = new Map<MissDecidedBy, number>();
    let silent = 0;
    for (const c of list) {
      counts.set(c.decidedBy, (counts.get(c.decidedBy) ?? 0) + 1);
      if (!c.sourceEmits && !c.winnerEmits) silent += 1;
    }
    const parts = MISS_ORDER.filter((k) => (counts.get(k) ?? 0) > 0).map(
      (k) => `${k}=${counts.get(k)}`,
    );
    lines.push(
      `  ${faultType.padEnd(26)} wrong=${list.length} silent=${silent} ${parts.join(' ')}`,
    );
  }
  return lines.join('\n');
}

/**
 * One case's requirement on a weight.
 *
 * Every candidate's score is affine in the weight — `base + w × slope` — which is
 * what makes a sweep PREDICTABLE rather than something to run. For the shipped
 * formula the base is `log1p(selfAnomaly) + logWeight × logScore` and the slope is
 * the new signal's score, so a control dump (weight 0) already carries everything
 * needed to say whether any weight could work.
 */
export interface WeightSeparationCase {
  /** Case identifier, so the binding case can be named. */
  readonly datapack: string;
  /**
   * The services ANY of which may end up at rank 1.
   *
   * A list rather than one name, because the benchmark's own labels are a list:
   * every FSE'26 network-fault case names two acceptable roots (`mysql` plus the
   * service it is co-located with). Requiring `groundTruth[0]` specifically would
   * demand a ranking the benchmark never asked for, and would report a
   * correctly-ranked case as unsatisfiable — it did, for 42 of 97
   * `NetworkPartition` cases in one measured dump, which is how this was found.
   */
  readonly targets: readonly string[];
  /** Per-service affine score, `base` at `w = 0` and `slope` as the coefficient. */
  readonly scores: ReadonlyMap<string, { readonly base: number; readonly slope: number }>;
}

/** The interval of weights, if any, at which EVERY case puts its target first. */
export interface WeightSeparation {
  readonly cases: number;
  /** The smallest weight that satisfies every case. */
  readonly requiredMin: number;
  /** The largest weight that satisfies every case (may be `Infinity`). */
  readonly allowedMax: number;
  /** Whether a single weight exists. False means no sweep can pass. */
  readonly separable: boolean;
  /** The case that demands the largest minimum — the binding lower bound. */
  readonly bindingMin: string | undefined;
  /** The case that permits the smallest maximum — the binding upper bound. */
  readonly bindingMax: string | undefined;
}

/**
 * Which signal's score is the coefficient of the weight being solved for.
 *
 * A selector rather than a map, because the two terms live in the same dump and
 * only one of them is ever the subject of a question: the solver answers "does a
 * weight exist" for ONE term at a time, and passing a precomputed map would let a
 * caller mix them.
 */
export type SlopeKind = 'failedEdge' | 'lat';

/** Float tolerance for a zero coefficient or a zero gap. */
const WEIGHT_EPSILON = 1e-12;

/** A closed interval of weights. */
export interface WeightInterval {
  readonly min: number;
  readonly max: number;
}

/**
 * The interval of weights at which ONE named service is at rank 1.
 *
 * Solved exactly rather than sampled: for each competitor the requirement
 * `base_t + w·slope_t >= base_k + w·slope_k` is linear in `w`, so the interval is
 * the intersection of at most one half-line per competitor. A competitor with a
 * larger slope caps `w`; one with a smaller slope floors it; one with the same
 * slope either never wins or is an unconditional blocker.
 *
 * @param scores - The case's affine scores.
 * @param target - The service that must be first.
 * @returns The interval, or `undefined` when the service is not described or is
 *   never first.
 */
function targetInterval(
  scores: WeightSeparationCase['scores'],
  target: string,
): WeightInterval | undefined {
  const t = scores.get(target);
  // A target the dump does not describe cannot be satisfied by ANY weight. The
  // caller must not read that as "unconstrained" — the aggregate would then claim
  // separability on the strength of a case it never read.
  if (t === undefined) return undefined;

  let min = 0;
  let max = Number.POSITIVE_INFINITY;
  for (const [service, other] of scores) {
    if (service === target) continue;
    const slopeGap = t.slope - other.slope;
    const baseGap = other.base - t.base;
    if (slopeGap > WEIGHT_EPSILON) {
      // Raising the weight helps the target against this competitor.
      min = Math.max(min, baseGap / slopeGap);
    } else if (slopeGap < -WEIGHT_EPSILON) {
      // Raising the weight hurts it: this competitor caps the weight.
      max = Math.min(max, baseGap / slopeGap);
    } else if (baseGap > 0) {
      // Equal slopes and the competitor is ahead at every weight: the target can
      // never be rank 1, so the case excludes every weight. Reported as an empty
      // interval rather than as a large number, so a caller cannot mistake it for
      // a satisfiable constraint.
      max = Number.NEGATIVE_INFINITY;
    }
  }
  return { min, max };
}

/** Merge ascending intervals, joining any pair that touches. */
function mergeIntervals(sorted: readonly WeightInterval[]): WeightInterval[] {
  const merged: WeightInterval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && interval.min <= last.max + WEIGHT_EPSILON) {
      merged[merged.length - 1] = { min: last.min, max: Math.max(last.max, interval.max) };
    } else {
      merged.push(interval);
    }
  }
  return merged;
}

/**
 * The set of weights at which one case is satisfied.
 *
 * A LIST, not one interval, because a case is satisfied by ANY of its acceptable
 * roots and the union of their intervals need not be an interval: two roots can
 * each be first over disjoint weight ranges. Collapsing that to a single interval
 * would silently claim the gap between them, so a caller reading the gap as
 * feasible would measure a weight this method had no evidence for.
 *
 * @param one - The case.
 * @returns Disjoint intervals in ascending order; EMPTY when no weight satisfies
 *   the case, which is the honest answer for a case the dump does not describe.
 */
export function caseWeightInterval(one: WeightSeparationCase): readonly WeightInterval[] {
  const intervals: WeightInterval[] = [];
  for (const name of one.targets) {
    const interval = targetInterval(one.scores, name);
    // `min > max` is `targetInterval`'s empty set: a root that can never be first.
    if (interval === undefined || interval.min > interval.max) continue;
    intervals.push(interval);
  }
  intervals.sort((a, b) => a.min - b.min);
  return mergeIntervals(intervals);
}

/**
 * Whether a single weight satisfies every case at once.
 *
 * This is the cheap substitute for a weight sweep. A sweep over `k` weights costs
 * `k` full benchmark runs; this costs nothing, because the dump already carries
 * both terms. It answers only the QUESTION a sweep would answer — "does a weight
 * exist that keeps every case?" — and not what that weight would do to cases that
 * are currently wrong for other reasons, so it can prove a sweep is futile and
 * cannot prove one is sufficient. That asymmetry is the point: it is a
 * falsifier.
 *
 * @param cases - One entry per case that the weight is supposed to move.
 * @returns The aggregate interval and whether it is non-empty.
 */
export function computeWeightSeparation(cases: readonly WeightSeparationCase[]): WeightSeparation {
  let requiredMin = 0;
  let allowedMax = Number.POSITIVE_INFINITY;
  let bindingMin: string | undefined;
  let bindingMax: string | undefined;
  // The feasible set is the INTERSECTION of the cases' sets, and an intersection of
  // unions is not described by its extremes: two cases can each allow disjoint
  // ranges whose overlap is empty while the extremes still look compatible. So the
  // verdict comes from folding the sets, and the extremes are reported as bounds.
  let feasible: readonly WeightInterval[] = [{ min: 0, max: Number.POSITIVE_INFINITY }];
  for (const one of cases) {
    const allowed = caseWeightInterval(one);
    const next: WeightInterval[] = [];
    for (const have of feasible) {
      for (const want of allowed) {
        const lo = Math.max(have.min, want.min);
        const hi = Math.min(have.max, want.max);
        if (lo <= hi) next.push({ min: lo, max: hi });
      }
    }
    next.sort((a, b) => a.min - b.min);
    feasible = mergeIntervals(next);
    // The earliest weight this case permits, and the latest: `allowed` is ascending
    // and a case with no feasible weight at all contributes an empty extreme, which
    // is what makes the aggregate unsatisfiable rather than merely narrow.
    const lo = allowed[0]?.min ?? Number.POSITIVE_INFINITY;
    const hi = allowed[allowed.length - 1]?.max ?? Number.NEGATIVE_INFINITY;
    if (lo > requiredMin) {
      requiredMin = lo;
      bindingMin = one.datapack;
    }
    if (hi < allowedMax) {
      allowedMax = hi;
      bindingMax = one.datapack;
    }
  }
  return {
    cases: cases.length,
    requiredMin,
    allowedMax,
    separable: feasible.length > 0,
    bindingMin,
    bindingMax,
  };
}

/**
 * Build the solver's input from parsed cases, for the shipped score formula.
 *
 * The base is `log1p(selfAnomaly) + logWeight × logScore` and the slope is the
 * selected term's score, so a dump from a run with the term OFF still predicts what
 * turning it on would do — which is what makes the control run sufficient and the
 * sweep unnecessary.
 *
 * @param cases - Parsed cases.
 * @param weights - The run's log weight.
 * @param slope - Which term's score is the coefficient. Defaults to `failedEdge`,
 *   the term this solver was built for, so existing callers are unaffected.
 * @param latFloor - Rise a service must clear before the latency term credits it,
 *   when `slope` is `lat`. Default 1 = the shipped shape.
 * @returns One entry per case whose target the dump describes.
 */
export function buildWeightSeparationCases(
  cases: readonly DiagnosedCase[],
  weights: MissAttributionWeights,
  slope: SlopeKind = 'failedEdge',
  latFloor = 1,
): WeightSeparationCase[] {
  const built: WeightSeparationCase[] = [];
  for (const kase of cases) {
    // EVERY acceptable root, not the first: the benchmark's labels are a list and
    // the engine is correct when it ranks any of them first.
    const targets = kase.groundTruth.filter((name) => name !== '');
    if (targets.length === 0) continue;
    // Computed once per case, not per service: the latency term is max-normalised
    // ACROSS the case, so a per-service call would divide by a per-service maximum.
    const lat = slope === 'lat' ? latencySlopes(kase.services, latFloor) : undefined;
    const scores = new Map<string, { base: number; slope: number }>();
    for (const service of kase.services) {
      scores.set(service.serviceId, {
        base: Math.log1p(service.selfAnomaly) + weights.logWeight * service.logScore,
        slope:
          lat === undefined ? (service.failedEdgeScore ?? 0) : (lat.get(service.serviceId) ?? 0),
      });
    }
    built.push({ datapack: kase.datapack, targets, scores });
  }
  return built;
}

/**
 * Render {@link computeWeightSeparation} as a report.
 *
 * @param cases - Parsed cases.
 * @param weights - The run's log weight.
 * @returns One multi-line report, without a trailing newline.
 */
export function formatWeightSeparationReport(
  cases: readonly DiagnosedCase[],
  weights: MissAttributionWeights,
  slope: SlopeKind = 'failedEdge',
): string {
  const report = computeWeightSeparation(buildWeightSeparationCases(cases, weights, slope));
  const lines: string[] = [];
  lines.push(
    `Weight separation (slope=${slope}; logWeight=${weights.logWeight}; solved from the dump, no sweep needed):`,
  );
  lines.push(`  cases the weight is supposed to satisfy: ${report.cases}`);
  // Four distinct meanings, and collapsing any two would misreport the verdict: a
  // finite bound, no cap at all (`+Infinity` on the cap), and "no weight works"
  // (`+Infinity` on the floor, or `-Infinity` on the cap, which is what an
  // unsatisfiable case contributes). A non-finite FLOOR printed as a number would
  // be worse than useless — `Infinity` reads as a very large weight, and the old
  // rendering of an unsatisfiable case showed `0.000`, which reads as "w = 0
  // satisfies this", the opposite of what the case says.
  const floor = Number.isFinite(report.requiredMin)
    ? report.requiredMin.toFixed(3)
    : 'none — no weight is enough for every case';
  const cap =
    report.allowedMax === Number.POSITIVE_INFINITY
      ? 'unbounded'
      : report.allowedMax === Number.NEGATIVE_INFINITY
        ? 'none — some case is unsatisfiable at every weight'
        : report.allowedMax.toFixed(3);
  lines.push(`  required min weight: ${floor}`);
  lines.push(`  allowed max weight:  ${cap}`);
  lines.push(`  separable: ${report.separable ? 'YES' : 'NO'}`);
  if (!report.separable) {
    // Two shapes, and they need different sentences. A genuine conflict has two
    // finite bounds with the floor above the cap, and naming both binders is the
    // useful statement. An unsatisfiable case has NO numeric bound, so the
    // comparison form would print the two infinities and read as if a weight
    // existed — the opposite of the verdict it is meant to convey.
    // Both names are guaranteed on this path, and the assertion records WHY rather
    // than papering over a gap: an inseparable report either has a finite conflict —
    // and a finite bound is always set by some case — or a case that admits no
    // weight, which is itself the floor's binder. The fields stay optional on the
    // interface only because a SEPARABLE report has no binders to name.
    const minName = report.bindingMin as string;
    const maxName = report.bindingMax as string;
    if (Number.isFinite(report.requiredMin) && Number.isFinite(report.allowedMax)) {
      lines.push(
        `  binding cases: needs ${floor} for ${minName}, but only ${cap} before ${maxName} breaks`,
      );
    } else {
      lines.push(`  binding cases: ${minName} admits no weight at all, so no sweep can pass`);
    }
  }
  return lines.join('\n');
}

/**
 * Weights at which NO case that is correct today becomes incorrect.
 *
 * ## Why this is not {@link computeWeightSeparation}
 *
 * The two are easy to confuse and they answer different questions:
 *
 * - `computeWeightSeparation` asks *"is there a weight at which EVERY case is
 *   satisfied?"*. One case that no weight can satisfy makes it say NO, and on the
 *   per-edge latency slope that is exactly what it says — `separable: NO`,
 *   `cases: 1380` — even though a weight at which nothing gets worse plainly
 *   exists.
 * - This asks *"is there a weight at which no case gets WORSE?"*, which is the
 *   question the kill criterion asks. A case that is already wrong cannot get
 *   worse, so it constrains nothing here; it is only a candidate to be GAINED.
 *
 * A wrong negative on the first question is not a curiosity: the register cited the
 * window below as the reason the latency axis could be reopened, and no shipped
 * instrument could compute it. The report therefore names which question it
 * answered, and the CLI flag that prints it is separate.
 *
 * ## The algebra
 *
 * `score(v) = base(v) + w·slope(v)` with `base = log1p(selfAnomaly) +
 * logWeight·logScore`, so for each competitor the requirement is linear in `w` and
 * a case's feasible set is a union of intervals ({@link caseWeightInterval}).
 * Intersecting that union over every currently-correct case leaves the interval
 * containing 0; its right end is the cap.
 */
export interface ZeroRegressionWindow {
  /** Cases the dump describes and that name at least one acceptable root. */
  readonly cases: number;
  /** Cases satisfied at `w = 0` — the population the window must protect. */
  readonly satisfied: number;
  /** Cases no weight can satisfy, and that are not satisfied at 0 either. */
  readonly unreachable: number;
  /** The largest weight at which no currently-correct case loses rank 1. */
  readonly cap: number;
  /** The case that sets `cap`, and the pair whose ratio the cap is. */
  readonly capBinder?: WindowCapBinder;
  /** Currently-wrong cases a weight can fix, with the weights that fix them. */
  readonly gains: readonly WindowGain[];
}

/** One currently-wrong case, and the weights at which it becomes correct. */
export interface WindowGain {
  readonly datapack: string;
  readonly intervals: readonly WeightInterval[];
}

/**
 * WHY the window stops where it does.
 *
 * A cap on its own is not actionable. The cap is `lead / slopeGap` for exactly one
 * currently-correct case, and those two quantities decide what — if anything — could
 * move it:
 *
 * - a target whose slope is already `0` against a rival whose slope is already `1`
 *   is the maximal gap, so **no** pointwise reshaping of the term can raise the cap.
 *   That case's cap is a property of the rest of the score, not of the term's shape;
 * - a modest gap is where a reshaping of the term has room, and the three numbers
 *   below are what a candidate must be designed against.
 *
 * `lead` and `slopeGap` are recorded rather than recomputed so a report can print the
 * division it performed.
 */
export interface WindowCapBinder {
  readonly datapack: string;
  /** The service that must stay at rank 1. */
  readonly target: string;
  /** The service that takes rank 1 from it. */
  readonly rival: string;
  readonly targetSlope: number;
  readonly rivalSlope: number;
  /** `target.base − rival.base`, the target's lead at `w = 0` (always positive). */
  readonly lead: number;
  /** `rival.slope − target.slope`, always positive. */
  readonly slopeGap: number;
}

/** One weight, and what the case set looks like there. */
export interface WindowSample {
  readonly weight: number;
  /** Cases satisfied at this weight (including the gains below). */
  readonly correct: number;
  /** Satisfied here, unsatisfied at 0. */
  readonly gained: number;
  /** Satisfied at 0, unsatisfied here — the regressions the criterion forbids. */
  readonly lost: number;
}

/**
 * Weights every window report probes, unless a caller supplies its own.
 *
 * Includes 0.03 because that is the shipped latency weight: a window report that
 * did not sample the operating point could not be compared with the run that
 * measured it.
 */
export const DEFAULT_WINDOW_GRID: readonly number[] = [
  0, 0.01, 0.02, 0.03, 0.04, 0.05, 0.1, 0.25, 0.5, 0.75, 1,
];

/** Whether a union of intervals covers `w`. */
function intervalsCover(intervals: readonly WeightInterval[], w: number): boolean {
  return intervals.some(
    (interval) => w >= interval.min - WEIGHT_EPSILON && w <= interval.max + WEIGHT_EPSILON,
  );
}

/**
 * The right end of the interval component containing 0.
 *
 * `+Infinity` when the component is unbounded, `-Infinity` when 0 is not covered
 * at all. The distinction matters: only a case that IS covered at 0 can cap the
 * window, because only a case that is correct today can regress.
 */
function componentEndingAtZero(intervals: readonly WeightInterval[]): number {
  let end = Number.NEGATIVE_INFINITY;
  for (const interval of intervals) {
    if (interval.min <= WEIGHT_EPSILON && interval.max >= -WEIGHT_EPSILON) {
      end = Math.max(end, interval.max);
    }
  }
  return end;
}

/**
 * Recover the pair whose ratio IS the cap, for the report.
 *
 * Recomputed from the case's scores instead of threaded out of
 * {@link componentEndingAtZero}: that helper works on the union over a case's
 * acceptable roots, where the binding root is exactly what it discards. One scan of
 * one case is cheaper than making every caller carry a root it does not need.
 *
 * @param one - The binding case.
 * @param cap - The cap it set.
 * @returns The overtaking pair, or `undefined` when none reproduces the cap: an
 *   unbounded cap, or a cap inside the epsilon band below zero, where float noise
 *   in `(−lead)/(−slopeGap)` can leave the ratio negative while the case still
 *   counts as covered at zero. The search is a search rather than a value threaded
 *   out of {@link componentEndingAtZero} because that helper works on the union
 *   over a case's acceptable roots — which is exactly where the binding root is
 *   discarded.
 */
function capBinderOf(one: WeightSeparationCase, cap: number): WindowCapBinder | undefined {
  if (!Number.isFinite(cap)) return undefined;
  for (const target of one.targets) {
    const t = one.scores.get(target);
    if (t === undefined) continue;
    for (const [rival, other] of one.scores) {
      if (rival === target) continue;
      const slopeGap = other.slope - t.slope;
      const lead = t.base - other.base;
      // `lead < 0`, not `lead <= 0`: a target LEVEL with a steeper rival is held
      // by a tie at zero and lost by any weight above it, so its cap is zero and
      // `0 / slopeGap` IS that cap. Excluding it made the only reachable
      // `undefined` return print "no case can be overtaken at any weight" about a
      // case that every weight overtakes.
      if (slopeGap <= WEIGHT_EPSILON || lead < 0) continue;
      // Relative tolerance: the cap was chosen as this very ratio, so a match is
      // exact up to the float arithmetic that produced both.
      if (Math.abs(lead / slopeGap - cap) <= Math.max(WEIGHT_EPSILON, Math.abs(cap) * 1e-9)) {
        return {
          datapack: one.datapack,
          target,
          rival,
          targetSlope: t.slope,
          rivalSlope: other.slope,
          lead,
          slopeGap,
        };
      }
    }
  }
  return undefined;
}

/**
 * Solve the zero-regression window for a case set.
 *
 * @param cases - Input from {@link buildWeightSeparationCases}.
 * @returns The window, with its binder and the gains inside it.
 */
export function computeZeroRegressionWindow(
  cases: readonly WeightSeparationCase[],
): ZeroRegressionWindow {
  let satisfied = 0;
  let unreachable = 0;
  let cap = Number.POSITIVE_INFINITY;
  let capCase: WeightSeparationCase | undefined;
  const gains: WindowGain[] = [];

  for (const one of cases) {
    const allowed = caseWeightInterval(one);
    const baseline = componentEndingAtZero(allowed);
    if (baseline === Number.NEGATIVE_INFINITY) {
      // Not correct at w = 0. It cannot regress, so it never caps the window: an
      // empty interval means no weight satisfies it, which is a gain that is out of
      // reach rather than a constraint.
      if (allowed.length === 0) unreachable++;
      else gains.push({ datapack: one.datapack, intervals: allowed });
      continue;
    }
    satisfied++;
    // With a union of intervals per case, the intersection's component at 0 ends at
    // the SMALLEST of the per-case component ends — the case that reaches the least
    // far is the one that binds.
    if (baseline < cap) {
      cap = baseline;
      capCase = one;
    }
  }

  return {
    cases: cases.length,
    satisfied,
    unreachable,
    cap,
    capBinder: capCase === undefined ? undefined : capBinderOf(capCase, cap),
    gains,
  };
}

/**
 * Evaluate the case set at each weight in `grid`.
 *
 * @param cases - Input from {@link buildWeightSeparationCases}.
 * @param grid - Weights to probe, in any order; the result keeps that order.
 * @returns One sample per weight.
 */
export function zeroRegressionSamples(
  cases: readonly WeightSeparationCase[],
  grid: readonly number[],
): readonly WindowSample[] {
  const intervals = cases.map((one) => caseWeightInterval(one));
  const atZero = intervals.map((one) => intervalsCover(one, 0));
  return grid.map((weight) => {
    let correct = 0;
    let gained = 0;
    let lost = 0;
    intervals.forEach((one, index) => {
      const here = intervalsCover(one, weight);
      if (here) correct++;
      if (here && !atZero[index]) gained++;
      if (!here && atZero[index]) lost++;
    });
    return { weight, correct, gained, lost };
  });
}

/**
 * Render {@link computeZeroRegressionWindow} as a report.
 *
 * The cap is inserted into the grid, plus one weight just above it, so the claim is
 * two-sided: nothing is lost up to the cap, and the case named as the binder is
 * lost immediately after it. A report that only probed the grid could state a cap
 * it never demonstrated.
 *
 * @param cases - Parsed cases.
 * @param weights - The run's log weight.
 * @param slope - Which term's score is the coefficient.
 * @param latFloor - Rise a service must clear for the latency term to credit it, when
 *   `slope` is `lat`. This models a term SHAPE the engine does not have yet, so a
 *   report that names it is a prediction rather than a measurement — the default is
 *   the shipped shape and says so in the header.
 * @param grid - Weights to probe; defaults to {@link DEFAULT_WINDOW_GRID}.
 * @returns A multi-line report, without a trailing newline.
 */
export function formatZeroRegressionWindowReport(
  cases: readonly DiagnosedCase[],
  weights: MissAttributionWeights,
  slope: SlopeKind = 'failedEdge',
  latFloor = 1,
  grid: readonly number[] = DEFAULT_WINDOW_GRID,
): string {
  const built = buildWeightSeparationCases(cases, weights, slope, latFloor);
  const window = computeZeroRegressionWindow(built);
  // A relative step, so the probe lands just outside the cap whatever its scale.
  // It must clear the SAME epsilon the interval test inflates by: `Number.EPSILON`
  // alone is smaller than `WEIGHT_EPSILON`, so for a cap of ZERO — a case held only
  // by a tie — the probe landed back inside the window and the "first weight above
  // the cap" row showed the case still standing, which reads as the cap being wrong.
  const justAbove = Number.isFinite(window.cap)
    ? window.cap * (1 + 1e-6) + WEIGHT_EPSILON * 2
    : Number.POSITIVE_INFINITY;
  const probes = Number.isFinite(justAbove) ? [...grid, window.cap, justAbove] : [...grid];
  const samples = zeroRegressionSamples(built, probes);

  // Six decimals, not three. The cap is the number a flip decision is made
  // against, and the shipped latency weight (0.03) sits 1.5% below it: at three
  // decimals both render as `0.030`, so a reader could not tell how much room the
  // shipped point has, nor separate the cap from a grid point beside it.
  const cap = Number.isFinite(window.cap) ? window.cap.toFixed(6) : 'unbounded';
  const lines: string[] = [];
  lines.push(
    `Weight window (slope=${slope}${latFloor > 1 ? `, latFloor=${latFloor}` : ''}; ` +
      `logWeight=${weights.logWeight}; no case correct today may become incorrect):`,
  );
  lines.push(
    `  cases: ${window.cases}   correct at 0: ${window.satisfied}   ` +
      `unreachable at every weight: ${window.unreachable}`,
  );
  lines.push(
    window.capBinder === undefined
      ? `  cap weight: ${cap}   no case can be overtaken at any weight`
      : `  cap weight: ${cap}   binder ${window.capBinder.datapack}`,
  );
  if (window.capBinder !== undefined) {
    // The cap's own arithmetic, so a reader can see what a reshaping of the term
    // would have to change. A target slope of 0 against a rival slope of 1 is the
    // maximal gap: no pointwise reshaping can widen that case's window.
    const b = window.capBinder;
    lines.push(
      `  cap detail: ${b.rival} overtakes ${b.target} — lead ${b.lead.toFixed(6)} / ` +
        `slope gap ${b.slopeGap.toFixed(6)} (slopes ${b.targetSlope.toFixed(6)} -> ` +
        `${b.rivalSlope.toFixed(6)})`,
    );
  }
  lines.push(
    `  gains reachable inside the window: ${window.gains.length}` +
      (window.gains.length === 0 ? '' : ` (${window.gains.map((g) => g.datapack).join(', ')})`),
  );
  lines.push(
    `  ${'w'.padEnd(12)}${'correct'.padStart(8)}${'gained'.padStart(8)}${'lost'.padStart(6)}`,
  );
  for (const sample of samples) {
    const mark = sample.weight === justAbove ? '   <- first weight above the cap' : '';
    lines.push(
      `  ${sample.weight.toFixed(6).padEnd(12)}${String(sample.correct).padStart(8)}` +
        `${String(sample.gained).padStart(8)}${String(sample.lost).padStart(6)}${mark}`,
    );
  }
  return lines.join('\n');
}

export interface MetricFamily {
  /** How the report names the family. */
  readonly label: string;
  /** Matches the labels that belong to the family. */
  readonly pattern: RegExp;
}

/**
 * One fault type's answer to the only question a metric diagnostic can settle:
 * was the fault signature DISCARDED BY A GUARD, or SCORED AND OUT-COMPETED?
 *
 * Those two readings call for completely different work — a guard fix against a
 * scoring change — and the scalar anomaly score cannot tell them apart, because
 * both leave the service with a score that some other metric produced.
 */
export interface FamilyCompetitionCell {
  readonly faultType: string;
  readonly cases: number;
  /** Cases whose source carries at least one metric of the family. */
  readonly sourcesWithFamily: number;
  /** Cases where at least one family metric survived the guards. */
  readonly sourcesKeepingFamily: number;
  /** Cases where every family metric the source carries was discarded. */
  readonly sourcesDroppingFamily: number;
  /** Cases where the source carries no family metric at all (a data gap). */
  readonly sourcesWithoutFamily: number;
  /** Cases whose source's DOMINANT metric is in the family. */
  readonly sourcesDominantInFamily: number;
  /** Cases where a family metric survived AND still lost the service competition. */
  readonly sourcesKeepingButLosingFamily: number;
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

/**
 * A non-stateful matcher for a metric family.
 *
 * A global or sticky pattern carries `lastIndex` between calls, so `test` would
 * answer differently on alternate invocations and silently halve every count.
 * Rebuilt without those flags, so the reducer stays a pure function of its
 * inputs regardless of how the caller wrote the pattern.
 */
function familyMatcher(family: MetricFamily): (label: string) => boolean {
  const pattern = new RegExp(family.pattern.source, family.pattern.flags.replace(/[gy]/g, ''));
  return (label) => pattern.test(label);
}

/**
 * Reduce one dump to the per-fault-type fate of a metric family.
 *
 * Only ground-truth services are examined: the question is what happened to the
 * fault source's signature, and a service that is neither the source nor a
 * prediction carries no answer. A case whose ground-truth service was not
 * rendered at all (no metric outcomes reported) is counted in `cases` but in
 * none of the family columns, which is how a dump produced by an older engine
 * reads as "unreported" rather than as "absent".
 *
 * @param cases - A parsed dump.
 * @param family - The labels that constitute the fault signature.
 * @returns One cell per fault type, in descending case count.
 */
export function familyCompetition(
  cases: readonly DiagnosedCase[],
  family: MetricFamily,
): FamilyCompetitionCell[] {
  interface Mutable {
    faultType: string;
    cases: number;
    sourcesWithFamily: number;
    sourcesKeepingFamily: number;
    sourcesDroppingFamily: number;
    sourcesWithoutFamily: number;
    sourcesDominantInFamily: number;
    sourcesKeepingButLosingFamily: number;
  }
  const byType = new Map<string, Mutable>();
  const isFamily = familyMatcher(family);

  for (const kase of cases) {
    const cell = byType.get(kase.faultType) ?? {
      faultType: kase.faultType,
      cases: 0,
      sourcesWithFamily: 0,
      sourcesKeepingFamily: 0,
      sourcesDroppingFamily: 0,
      sourcesWithoutFamily: 0,
      sourcesDominantInFamily: 0,
      sourcesKeepingButLosingFamily: 0,
    };
    cell.cases++;
    for (const source of kase.services) {
      if (!source.isGroundTruth || source.metricOutcomes === undefined) continue;
      const ofFamily = source.metricOutcomes.filter((outcome) => isFamily(outcome.label));
      const kept = ofFamily.filter((outcome) => outcome.outcome === 'kept');
      if (ofFamily.length === 0) cell.sourcesWithoutFamily++;
      else cell.sourcesWithFamily++;
      if (kept.length > 0) cell.sourcesKeepingFamily++;
      if (ofFamily.length > 0 && kept.length === 0) cell.sourcesDroppingFamily++;
      const dominantIsFamily = isFamily(source.dominantMetric);
      if (dominantIsFamily) cell.sourcesDominantInFamily++;
      if (kept.length > 0 && !dominantIsFamily) cell.sourcesKeepingButLosingFamily++;
    }
    byType.set(kase.faultType, cell);
  }

  return [...byType.values()].sort(
    (a, b) => b.cases - a.cases || (a.faultType < b.faultType ? -1 : 1),
  );
}

/**
 * Render the metric-competition report for a dump.
 *
 * @param cases - A parsed dump.
 * @param family - The metric family under investigation.
 * @param modeLabel - How to describe the configuration in the header.
 * @returns The report text, ending with a newline.
 */
export function formatMetricCompetitionReport(
  cases: readonly DiagnosedCase[],
  family: MetricFamily,
  modeLabel: string,
): string {
  const cells = familyCompetition(cases, family);
  const modes = [...new Set(cases.map((kase) => kase.logSignalMode))].filter((m) => m !== '');
  const lines: string[] = [];
  lines.push(`FSE'26 metric competition — ${modeLabel}`);
  lines.push(`  after-mode: ${modes.length > 0 ? modes.join(', ') : '(unrecorded)'}`);
  lines.push(`  cases: ${cases.length}`);
  lines.push(`  tracked family: ${family.label}`);
  lines.push('');
  if (cells.length === 0) {
    lines.push('No DIAG blocks were parsed.');
    return `${lines.join('\n')}\n`;
  }

  lines.push(
    `  ${'fault type'.padEnd(30)} ${'cases'.padStart(6)} ${'has-fam'.padStart(8)} ` +
      `${'kept'.padStart(6)} ${'dropped'.padStart(8)} ${'absent'.padStart(7)} ` +
      `${'dominant'.padStart(9)} ${'kept-lost'.padStart(10)}`,
  );
  for (const cell of cells) {
    lines.push(
      `  ${cell.faultType.padEnd(30)} ${String(cell.cases).padStart(6)} ` +
        `${String(cell.sourcesWithFamily).padStart(8)} ${String(cell.sourcesKeepingFamily).padStart(6)} ` +
        `${String(cell.sourcesDroppingFamily).padStart(8)} ` +
        `${String(cell.sourcesWithoutFamily).padStart(7)} ` +
        `${String(cell.sourcesDominantInFamily).padStart(9)} ` +
        `${String(cell.sourcesKeepingButLosingFamily).padStart(10)}`,
    );
  }
  lines.push('');
  lines.push('  A source counts in "dropped" when every family metric it carries was discarded');
  lines.push('  by a guard, and in "kept-lost" when a family metric survived but lost');
  lines.push("  the competition for the source's own anomaly score.");
  return `${lines.join('\n')}\n`;
}

/**
 * `value` with fixed decimals, or `-` when the datum is absent.
 *
 * No non-finite guard: every caller passes a count the parser read with
 * `/\d+/`, so the value is `undefined` or a finite integer by construction.
 */
function num(value: number | undefined, digits = 3): string {
  return value === undefined ? '-' : value.toFixed(digits);
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
 * The one metric that decided a service's anomaly score: the highest-scoring
 * kept metric that carries a decomposition.
 *
 * A service with no such metric contributes nothing — its score cannot be
 * attributed, and inventing an attribution would be worse than reporting one.
 */
function decisiveMetric(
  service: DiagnosedService,
): (DiagnosedMetricOutcome & { breakdown: DiagnosedBreakdown }) | undefined {
  const candidates = (service.metricOutcomes ?? []).filter(
    (outcome): outcome is DiagnosedMetricOutcome & { breakdown: DiagnosedBreakdown } =>
      outcome.outcome === 'kept' && outcome.breakdown !== undefined,
  );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, current) => (current.score > best.score ? current : best));
}

/** How one population's decisive metrics were won. */
export interface AnomalyShapeCell {
  readonly population: string;
  /** Services in this population that carried an attributable metric. */
  readonly services: number;
  /** Decisive on the deviation term: `deviation ≥ 0.5 × score`. */
  readonly deviationLed: number;
  /** Decisive on a bonus: the three bonuses together exceed the deviation. */
  readonly bonusLed: number;
  /** A rise, not a drop: `riseRatio > dropRatio`. */
  readonly rise: number;
  readonly drop: number;
  /** Median `riseRatio` over the population, or `undefined` when empty. */
  readonly medianRiseRatio: number | undefined;
  readonly medianBaselineMean: number | undefined;
  /**
   * Decisive metrics whose baseline is at or below the `0.001` floor the
   * near-zero-baseline guard tests. A large surge here means the ABSOLUTE floor
   * is miscalibrated for the source's units, not that the guard is wrong.
   */
  readonly baselineAtFloor: number;
  /**
   * Median share of the decisive score contributed by each term. Read together
   * with the source population, this separates "the winner is carried by a
   * term the source is not" from "both are carried by the same term and the
   * winner simply has more of it" — only the first is a reweighting defect.
   */
  readonly medianDeviationShare: number | undefined;
  readonly medianTrendShare: number | undefined;
  readonly medianCvShare: number | undefined;
  readonly medianBurstShare: number | undefined;
  /**
   * Decisive metrics whose trend bonus is at least a quarter of the score.
   * `trendBonus = trendStrength × 0.15` and `trendStrength` is unbounded, so a
   * metric that drifts monotonically without a fault earns an open-ended bonus.
   */
  readonly trendHeavy: number;
}

/**
 * Profile how the decisive metrics of each service population were won.
 *
 * The question this answers: is a rank decided by a genuine deviation, or by a
 * bonus computed on a ratio whose baseline was tiny? The three bonuses are
 * bounded (`trend` by construction, `cv ≤ 0.075`, `burst = 0.1 × deviation`),
 * while `riseRatio` is unbounded — so a high score with a bonus-led
 * decomposition would be a different defect from a high score with a
 * deviation-led one.
 *
 * Populations are separated because a verdict needs a control: the ground-truth
 * source's decisive metric is what a *correct* attribution looks like on the
 * same cases as the wrong winner's.
 *
 * @param cases - A parsed dump.
 * @returns One cell per population, in a fixed order.
 */
export function anomalyShape(cases: readonly DiagnosedCase[]): AnomalyShapeCell[] {
  interface Mutable {
    population: string;
    services: number;
    deviationLed: number;
    bonusLed: number;
    rise: number;
    drop: number;
    rises: number[];
    baselines: number[];
    baselineAtFloor: number;
    deviationShares: number[];
    trendShares: number[];
    cvShares: number[];
    burstShares: number[];
    trendHeavy: number;
  }
  const populations: Mutable[] = [
    'ground-truth source',
    'wrong top-1 winner',
    'other predicted / bystander',
  ].map((population) => ({
    population,
    services: 0,
    deviationLed: 0,
    bonusLed: 0,
    rise: 0,
    drop: 0,
    rises: [],
    baselines: [],
    baselineAtFloor: 0,
    deviationShares: [],
    trendShares: [],
    cvShares: [],
    burstShares: [],
    trendHeavy: 0,
  }));

  for (const kase of cases) {
    for (const service of kase.services) {
      const decisive = decisiveMetric(service);
      if (decisive === undefined) continue;
      const { deviation, trend, cv, burst, riseRatio, dropRatio, baselineMean } =
        decisive.breakdown;
      const bonus = trend + cv + burst;
      const cell = service.isGroundTruth
        ? populations[0]!
        : service.serviceId === kase.prediction[0]
          ? populations[1]!
          : populations[2]!;
      cell.services++;
      if (deviation >= 0.5 * decisive.score) cell.deviationLed++;
      if (bonus > deviation) cell.bonusLed++;
      if (riseRatio > dropRatio) cell.rise++;
      else cell.drop++;
      cell.rises.push(riseRatio);
      cell.baselines.push(baselineMean);
      if (baselineMean <= 0.001) cell.baselineAtFloor++;
      // Shares are undefined for a non-positive score, which no kept metric can
      // have; guarded so the ratio never divides by zero if that changes.
      if (decisive.score > 0) {
        cell.deviationShares.push(deviation / decisive.score);
        cell.trendShares.push(trend / decisive.score);
        cell.cvShares.push(cv / decisive.score);
        cell.burstShares.push(burst / decisive.score);
      }
      if (trend >= 0.25 * decisive.score) cell.trendHeavy++;
    }
  }

  const median = (values: readonly number[]): number | undefined => {
    if (values.length === 0) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  return populations.map((cell) => ({
    population: cell.population,
    services: cell.services,
    deviationLed: cell.deviationLed,
    bonusLed: cell.bonusLed,
    rise: cell.rise,
    drop: cell.drop,
    medianRiseRatio: median(cell.rises),
    medianBaselineMean: median(cell.baselines),
    baselineAtFloor: cell.baselineAtFloor,
    medianDeviationShare: median(cell.deviationShares),
    medianTrendShare: median(cell.trendShares),
    medianCvShare: median(cell.cvShares),
    medianBurstShare: median(cell.burstShares),
    trendHeavy: cell.trendHeavy,
  }));
}

/** `value` as a compact magnitude, or `-` when absent. */
function magnitude(value: number | undefined): string {
  if (value === undefined) return '-';
  if (value === 0) return '0';
  return Math.abs(value) >= 1000 || Math.abs(value) < 0.01
    ? value.toExponential(2)
    : value.toFixed(2);
}

/** A score share in [0, 1] at three decimals, or `-` when absent. */
function share(value: number | undefined): string {
  return value === undefined ? '-' : value.toFixed(3);
}

/**
 * Render the anomaly-shape profile for a dump.
 *
 * @param cases - A parsed dump.
 * @param label - How to describe the source in the header.
 * @returns The report text, ending with a newline.
 */
export function formatAnomalyShapeReport(cases: readonly DiagnosedCase[], label: string): string {
  const cells = anomalyShape(cases);
  const attributable = cells.reduce((sum, cell) => sum + cell.services, 0);
  const lines: string[] = [];
  lines.push(`FSE'26 anomaly shape — ${label}`);
  lines.push(`  cases: ${cases.length}   services with an attributable metric: ${attributable}`);
  lines.push('');
  lines.push(
    `  ${'population'.padEnd(28)} ${'n'.padStart(5)} ${'dev-led'.padStart(8)} ` +
      `${'bonus-led'.padStart(10)} ${'rise'.padStart(6)} ${'drop'.padStart(6)} ` +
      `${'med-rise'.padStart(9)} ${'med-base'.padStart(9)} ${'base<=1e-3'.padStart(11)}`,
  );
  for (const cell of cells) {
    lines.push(
      `  ${cell.population.padEnd(28)} ${String(cell.services).padStart(5)} ` +
        `${String(cell.deviationLed).padStart(8)} ${String(cell.bonusLed).padStart(10)} ` +
        `${String(cell.rise).padStart(6)} ${String(cell.drop).padStart(6)} ` +
        `${magnitude(cell.medianRiseRatio).padStart(9)} ` +
        `${magnitude(cell.medianBaselineMean).padStart(9)} ` +
        `${String(cell.baselineAtFloor).padStart(11)}`,
    );
  }
  lines.push('');
  lines.push('  How those scores were composed (median share of the score):');
  lines.push(
    `  ${'population'.padEnd(28)} ${'n'.padStart(5)} ${'dev'.padStart(7)} ${'trend'.padStart(7)} ` +
      `${'cv'.padStart(7)} ${'burst'.padStart(7)} ${'trend>=25%'.padStart(11)}`,
  );
  for (const cell of cells) {
    lines.push(
      `  ${cell.population.padEnd(28)} ${String(cell.services).padStart(5)} ` +
        `${share(cell.medianDeviationShare).padStart(7)} ` +
        `${share(cell.medianTrendShare).padStart(7)} ` +
        `${share(cell.medianCvShare).padStart(7)} ` +
        `${share(cell.medianBurstShare).padStart(7)} ` +
        `${String(cell.trendHeavy).padStart(11)}`,
    );
  }
  lines.push('');
  lines.push('  "dev-led" means deviation ≥ half the score. A relative DROP is capped');
  lines.push('  at log10(2) ≈ 0.301, so a high score with rise > drop is an unbounded');
  lines.push('  rise; "base<=1e-3" counts decisive metrics the near-zero-baseline guard');
  lines.push('  would test, which is how a miscalibrated ABSOLUTE floor shows up. Compare');
  lines.push('  the composition columns across populations: the same term in both means the');
  lines.push('  winner has MORE of it, not a different one, and no reweighting separates them.');
  return `${lines.join('\n')}\n`;
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
    // Only `top1After` can be absent here, and only because "wrong" includes
    // "predicted nothing". The other three cannot be: `faultType` is a required
    // string, and a regression is defined as CORRECT before, which requires the
    // case to have named a ground truth and the engine to have ranked it first.
    // Defaulting those would be dead code that hides a widened type.
    lines.push(
      `  ${mechanism.datapack.padEnd(36)} ${mechanism.faultType.padEnd(20)} ` +
        `${mechanism.groundTruth.padEnd(15)} ` +
        `${`${mechanism.top1Before}→${mechanism.top1After ?? '-'}`.padEnd(30)} ` +
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
/**
 * The command line of `analyze-fse26-diagnose`, as data.
 *
 * It lives here, beside the functions it configures, rather than in the entry
 * point, for one reason: the entry point calls `main()` at import time, so a test
 * cannot load it, so its flags were unmeasured. That is how the defect below got
 * in, and it is why the parser is now a pure function that returns an option
 * object instead of reading `process.argv`.
 *
 * The defect, concretely. The run's LOG weight was accepted on FOUR flags — on
 * `--log-weight` and on each of `--misses`, `--weight-sweep` and `--window`. Two
 * invocations of this tool that differ only in which flag got the number:
 *
 *   --dump d --window 1        --slope lat --lat-floor 10.3   -> correct at 0: 673
 *   --dump d --window 0.561495 --slope lat --lat-floor 10.3   -> correct at 0: 669
 *
 * The second passed the shipped LATENCY weight where a LOG weight belongs, and it
 * printed a self-consistent report whose baseline and (more importantly) whose cap
 * were wrong. The cap is the number the register quotes and a flip is decided
 * against, so a tool that accepts the wrong weight in that slot is a tool that
 * corrupts the record while looking like it is checking it.
 *
 * The repair is structural: the weight has ONE owner, the three sections are
 * switches, and a number where a switch is expected is an error that names
 * `--log-weight` — because the old form is in shell histories and a bare
 * "unrecognised argument" would send a reader looking for a flag that moved.
 *
 * @module benchmarks/fse26-diagnose-analyze
 */

/** Where the two modes of the command line are declared. */
export type AnalyzeOptions = AnalyzeComparisonOptions | AnalyzeDumpOptions;

export interface AnalyzeComparisonOptions {
  readonly kind: 'comparison';
  readonly before: string;
  readonly after: string;
  readonly output: string | undefined;
}

/** The sections that reconstruct a score from the dump. */
export type AnalyzeSectionKind = 'misses' | 'weightSweep' | 'window' | 'termOracle';

/**
 * One requested section, CARRYING the weight it is computed at.
 *
 * The pairing is the whole point. A section cannot be requested without a weight
 * because there is no way to write one down without the other, so "which weight
 * did this section use" — the question that produced a wrong cap — has exactly
 * one answer per section and it is on the section. Canonical order, which
 * {@link formatAnalyzeSections} prints in: window, weightSweep, misses.
 */
export interface AnalyzeSection {
  readonly kind: AnalyzeSectionKind;
  /**
   * The weight the run used on its log term — the ONLY owner of that number.
   *
   * Never defaulted: the dump's order is only self-consistent with the weight its
   * own run used, so a section computed at a guessed weight reports real cases as
   * `unexplained` and reads as a measurement.
   */
  readonly logWeight: number;
  /**
   * The run's per-edge latency weight and rise floor — the shape the section
   * describes.
   *
   * On the section rather than in the section's options for the same reason as the
   * log weight, and it is not hypothetical: the miss attribution and the window
   * both read a floor, and while it lived in one place and was read in two, the
   * attribution could describe a shape the window did not. The DEFAULTS are the
   * shipped constants, so a reader diagnosing the shipped engine gets the shipped
   * engine and an ablation has to be written down.
   */
  readonly latWeight: number;
  readonly latFloor: number;
}

export interface AnalyzeDumpOptions {
  readonly kind: 'dump';
  readonly dump: string;
  readonly family: MetricFamily | undefined;
  /** The sections to print, in canonical order; empty when none was requested. */
  readonly sections: readonly AnalyzeSection[];
  readonly slope: SlopeKind;
  readonly output: string | undefined;
}

/** Canonical section order, which is also the order the report prints them in. */
export const ANALYZE_SECTION_ORDER: readonly AnalyzeSectionKind[] = [
  'window',
  'weightSweep',
  'termOracle',
  'misses',
];

/**
 * The dominance thresholds the log-mode pre-screen sweeps.
 *
 * Data rather than a literal inside the renderer so the frontier a report shows is
 * the grid that was asked for. The threshold itself is NOT restated here: it comes
 * from the engine's `DEFAULT_HTTP_DOMINANCE_THRESHOLD`, and the grid brackets it.
 * The grid is coarse on purpose — the mode's frontier is a STEP, and a fine grid
 * would print a plateau twenty times and hide that it is one step.
 */
export const DEFAULT_TERM_ORACLE_DOMINANCE_GRID: readonly number[] = [
  0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 0.95,
];

const ANALYZE_USAGE =
  'usage: analyze-fse26-diagnose --before <dump> --after <dump> | ' +
  '--dump <dump> [--log-weight <w>] [--lat-weight <w>] [--lat-floor <rise>] ' +
  '[--misses] [--weight-sweep] [--window] [--term-oracle] [--family <regex>] ' +
  '[--family-label <name>] [--slope failedEdge|lat] [--output <file>]';

/**
 * Flags that take a value.
 *
 * Naming them explicitly — rather than treating every `--flag` as a key and the
 * next token as its value — is what lets a number after a SWITCH be recognised as
 * the mistake it is. A permissive parser reads `--window 0.561495` as a section at
 * the weight 0.561495, which is precisely how the wrong cap was produced.
 */
const VALUE_FLAGS = new Set([
  'dump',
  'before',
  'after',
  'family',
  'family-label',
  'lat-floor',
  'lat-weight',
  'log-weight',
  'output',
  'slope',
]);

/** Flags that take no value. */
const SWITCH_FLAGS = new Set(['misses', 'weight-sweep', 'window', 'term-oracle']);

/**
 * Parse the analyzer's command line.
 *
 * @param argv - Arguments WITHOUT the interpreter and script path.
 * @returns The parsed options.
 * @throws When a value is unusable, a section is requested without the log weight
 *   it has to reconstruct at, or the line names neither mode. Every one of these
 *   is a hard failure: the alternative is a report that looks like a measurement.
 */
export function parseAnalyzeArgs(argv: readonly string[]): AnalyzeOptions {
  const values = new Map<string, string>();
  const switches = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (SWITCH_FLAGS.has(token.replace(/^--/, ''))) {
      switches.add(token.replace(/^--/, ''));
      continue;
    }
    const name = token.startsWith('--') ? token.slice(2) : undefined;
    if (name === undefined || !VALUE_FLAGS.has(name)) {
      throw new Error(unrecognised(token, argv[i - 1]) + '\n' + ANALYZE_USAGE);
    }
    if (i + 1 >= argv.length) throw new Error(`--${name} expects a value\n${ANALYZE_USAGE}`);
    values.set(name, argv[++i]!);
  }

  const output = values.get('output');
  const before = values.get('before');
  const after = values.get('after');
  if (before !== undefined && after !== undefined) {
    return { kind: 'comparison', before, after, output };
  }

  const dump = values.get('dump');
  if (dump === undefined) throw new Error(ANALYZE_USAGE);

  // Kebab to camel, in one place: a switch whose name does not map to its section
  // kind is silently never rendered, which is how a flag can be accepted and ignored.
  const requested = new Set<string>(
    [...switches].map((name) => name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())),
  );
  const rawWeight = values.get('log-weight');
  if (requested.size > 0 && rawWeight === undefined) {
    // Names the flags, states which weight it is, and gives the shipped value, so
    // the reader does not have to guess between the four weights this tool knows.
    throw new Error(
      '--misses/--weight-sweep/--window/--term-oracle reconstruct a score, so they need ' +
        "the weight that score ran at: pass --log-weight <w>, the run's LOG weight (the " +
        `coefficient on logScore; the shipped runs use 1).\n${ANALYZE_USAGE}`,
    );
  }
  let logWeight = 0;
  if (rawWeight !== undefined) {
    // STRICT, with no fallback: the flag is REQUIRED by any section, so a typo would
    // otherwise leave the reader with a report at whatever weight the fallback named
    // — numbers the run did not produce.
    const parsed = Number(rawWeight);
    if (rawWeight.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`--log-weight expects a non-negative finite number, got '${rawWeight}'`);
    }
    logWeight = parsed;
  }

  // Both defaults are the SHIPPED constants, imported: a diagnostic describes an
  // engine, and a defaulted-to-something-else reader describes an engine that does
  // not exist. `--lat-weight 0` and `--lat-floor 1` are the explicit ablations.
  const latWeight = numberFlag(
    values.get('lat-weight'),
    '--lat-weight',
    DEFAULT_LAT_WEIGHT,
    (n) => n >= 0,
  );
  const latFloor = numberFlag(
    values.get('lat-floor'),
    '--lat-floor',
    DEFAULT_LAT_MIN_RISE,
    // Below 1 is refused rather than accepted as a no-op: magnitudes are
    // `log1p(max(0, rise - 1))`, so such a floor masks nothing, and accepting it
    // would render a configuration the operator believes changed something.
    (n) => n >= 1,
  );

  const family = values.get('family');

  return {
    kind: 'dump',
    dump,
    // An invalid pattern is a loud failure, never a report whose family silently
    // matches nothing.
    family:
      family === undefined
        ? undefined
        : { label: values.get('family-label') ?? family, pattern: new RegExp(family) },
    sections: ANALYZE_SECTION_ORDER.filter((kind) => requested.has(kind)).map((kind) => ({
      kind,
      logWeight,
      latWeight,
      latFloor,
    })),
    // Anything that is not exactly `lat` falls back to the term this solver was
    // built for, like every other switch here: a typo has to reproduce a known
    // configuration rather than invent one.
    slope: values.get('slope') === 'lat' ? 'lat' : 'failedEdge',
    output,
  };
}

/**
 * Read a numeric flag, or fall back to the SHIPPED value.
 *
 * Never to `0`: `0` is a *different measured configuration* for both of these, so a
 * typo would silently run an ablation and label it with the shipped configuration's
 * name. The predicate states each flag's own domain — a latency weight may be 0 (the
 * term off) and a rise floor may not be below 1 (it would mask nothing).
 *
 * @param raw - The flag's value, or `undefined` when absent.
 * @param flag - The flag's spelling, for the error.
 * @param fallback - The shipped value.
 * @param usable - Whether the parsed number is in the flag's domain.
 * @returns The parsed value or the fallback.
 * @throws When the value is present and unusable, because the fallback would then
 *   describe a configuration nobody asked for while the report looked measured.
 */
function numberFlag(
  raw: string | undefined,
  flag: string,
  fallback: number,
  usable: (value: number) => boolean,
): number {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (raw.trim() === '' || !Number.isFinite(parsed) || !usable(parsed)) {
    throw new Error(`${flag} expects a usable number, got '${raw}'`);
  }
  return parsed;
}

/**
 * Explain an unusable token, recognising the one mistake this parser exists for.
 *
 * @param token - The offending token.
 * @param previous - The token before it, which is a switch when the mistake is the
 *   pre-`--log-weight` form `--window <w>`.
 * @returns The message, without the usage block.
 */
function unrecognised(token: string, previous: string | undefined): string {
  const prev = previous?.replace(/^--/, '');
  const numeric = token !== '' && Number.isFinite(Number(token));
  if (prev !== undefined && SWITCH_FLAGS.has(prev) && numeric) {
    return (
      `--${prev} is a switch and takes no value, so '${token}' has nowhere to go. ` +
      "The run's LOG weight — not a signal weight such as latWeight — belongs on " +
      '--log-weight.'
    );
  }
  return `unrecognised argument '${token}'`;
}

/**
 * Render the report for one dump, in the canonical section order.
 *
 * Extracted from the entry point for the same reason the parser was: the entry
 * point calls `main()` at import time, so nothing here was measured. The ORDER is
 * part of the contract rather than an artefact of `unshift` calls: the sections
 * that answer a question about a candidate weight come first, then the metric
 * family, then the shape summary, which is the context for all of them.
 *
 * @param cases - Parsed dump.
 * @param dumpLabel - The path, echoed so a pasted report is traceable.
 * @param opts - The parsed options; `sections` is already in canonical order.
 * @returns The report text.
 */
export function formatAnalyzeSections(
  cases: readonly DiagnosedCase[],
  dumpLabel: string,
  opts: AnalyzeDumpOptions,
): string {
  const sections: string[] = [];
  if (opts.family !== undefined) {
    sections.push(formatMetricCompetitionReport(cases, opts.family, dumpLabel));
  }
  for (const section of opts.sections) {
    sections.push(analyzeSectionText(cases, section, opts, dumpLabel));
  }
  sections.push(formatAnomalyShapeReport(cases, dumpLabel));
  return sections.join('\n');
}

/**
 * Render one requested section, at the weight that section carries.
 *
 * A `switch` with no default: adding a section kind is a compile error until it is
 * rendered, which is the only way this stays exhaustive now that sections are data.
 *
 * @param cases - Parsed dump.
 * @param section - The section and the weight it is computed at.
 * @param opts - For the slope and the rise floor, which are properties of the
 *   shape rather than of the section.
 * @param dumpLabel - The dump's path, which only the section that echoes its own
 *   configuration into the report needs.
 * @returns The section text.
 */
function analyzeSectionText(
  cases: readonly DiagnosedCase[],
  section: AnalyzeSection,
  opts: AnalyzeDumpOptions,
  dumpLabel: string,
): string {
  switch (section.kind) {
    case 'window':
      return formatZeroRegressionWindowReport(
        cases,
        { logWeight: section.logWeight },
        opts.slope,
        section.latFloor,
      );
    case 'weightSweep':
      return formatWeightSeparationReport(cases, { logWeight: section.logWeight }, opts.slope);
    case 'termOracle':
      // The dominance threshold is the ENGINE's constant, imported rather than
      // typed here, and the grid brackets it: a pre-screen read at a threshold the
      // engine does not have would describe a mode that cannot be run.
      return formatTermOracleReport(cases, dumpLabel, {
        logWeight: section.logWeight,
        latWeight: section.latWeight,
        latFloor: section.latFloor,
        dominance: DEFAULT_HTTP_DOMINANCE_THRESHOLD,
        dominanceGrid: DEFAULT_TERM_ORACLE_DOMINANCE_GRID,
      });
    case 'misses':
      return formatMissReport(cases, {
        logWeight: section.logWeight,
        latWeight: section.latWeight,
        latFloor: section.latFloor,
      });
  }
}
